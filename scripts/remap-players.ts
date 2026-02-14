#!/usr/bin/env npx tsx
/**
 * Re-map roster players to canonical players
 *
 * Re-runs player mapping with name fallback for rosters that have
 * unmatched players (canonicalPlayerId is null).
 *
 * Usage: npx tsx scripts/remap-players.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, isNull } from "drizzle-orm";
import * as schema from "../lib/db/schema";

async function main() {
  console.log("Starting player remapping...");

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  console.log("Connected to database");

  // Fetch all unmatched rosters
  const unmatchedRosters = await db
    .select()
    .from(schema.rosters)
    .where(isNull(schema.rosters.canonicalPlayerId));

  console.log(`Found ${unmatchedRosters.length} unmatched roster entries`);

  if (unmatchedRosters.length === 0) {
    console.log("All players are already matched!");
    return;
  }

  // Fetch all canonical players
  const allPlayers = await db.select().from(schema.canonicalPlayers);
  console.log(`Loaded ${allPlayers.length} canonical players`);

  // Build name+position lookup
  const namePositionMap = new Map<string, typeof allPlayers[0]>();
  for (const player of allPlayers) {
    const key = normalizeNamePosition(player.name, player.position);
    namePositionMap.set(key, player);
  }

  // Process unmatched rosters
  let matched = 0;
  let failed = 0;

  for (const roster of unmatchedRosters) {
    if (!roster.playerName || !roster.playerPosition) {
      failed++;
      continue;
    }

    // Try to find a match
    const match = findMatch(
      allPlayers,
      namePositionMap,
      roster.playerName,
      roster.playerPosition
    );

    if (match) {
      await db
        .update(schema.rosters)
        .set({ canonicalPlayerId: match.id, updatedAt: new Date() })
        .where(eq(schema.rosters.id, roster.id));
      matched++;
      console.log(`  Matched: ${roster.playerName} (${roster.playerPosition}) -> ${match.name}`);
    } else {
      failed++;
      console.log(`  Failed: ${roster.playerName} (${roster.playerPosition})`);
    }
  }

  console.log(`\n=== Remapping Complete ===`);
  console.log(`Matched: ${matched}`);
  console.log(`Unmatched: ${failed}`);
  console.log(`Total: ${unmatchedRosters.length}`);
}

function normalizeNamePosition(name: string, position: string): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .trim();
  return `${normalizedName}|${position}`;
}

function findMatch(
  allPlayers: Array<typeof schema.canonicalPlayers.$inferSelect>,
  namePositionMap: Map<string, typeof schema.canonicalPlayers.$inferSelect>,
  name: string,
  position: string
): typeof schema.canonicalPlayers.$inferSelect | null {
  // Try exact name+position match first
  const key = normalizeNamePosition(name, position);
  if (namePositionMap.has(key)) {
    return namePositionMap.get(key)!;
  }

  // Try with position variants (IDP positions vary between systems)
  const positionVariants = getPositionVariants(position.toUpperCase());
  for (const variant of positionVariants) {
    const variantKey = normalizeNamePosition(name, variant);
    if (namePositionMap.has(variantKey)) {
      return namePositionMap.get(variantKey)!;
    }
  }

  // Try fuzzy name matching within position group
  const normalizedName = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .trim();

  const positionPlayers = allPlayers.filter((p) =>
    positionVariants.includes(p.position)
  );

  for (const player of positionPlayers) {
    const playerNormalizedName = player.name
      .toLowerCase()
      .replace(/[.']/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
      .trim();

    if (playerNormalizedName === normalizedName) {
      return player;
    }
  }

  return null;
}

function getPositionVariants(position: string): string[] {
  const variants: Record<string, string[]> = {
    DE: ["DE", "EDR", "DL"],
    OLB: ["OLB", "EDR", "LB"],
    DT: ["DT", "IL", "DL"],
    NT: ["NT", "IL", "DL"],
    ILB: ["ILB", "LB"],
    EDR: ["EDR", "DE", "OLB", "DL"],
    IL: ["IL", "DT", "NT", "DL"],
    DL: ["DL", "DE", "DT", "EDR", "IL"],
    DB: ["DB", "CB", "S"],
    CB: ["CB", "DB"],
    S: ["S", "DB"],
  };

  return variants[position] || [position];
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
