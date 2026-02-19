#!/usr/bin/env npx tsx
/**
 * One-time data fix: Travis Hunter combo-position mapping
 *
 * Fleaflicker returns Travis Hunter as position "WR/CB" but his
 * canonical entry has position "WR". The name-fallback failed because
 * getPositionVariants didn't handle "/" delimiters (now fixed).
 *
 * This script:
 * 1. Finds Travis Hunter's canonical entry by name + position.
 * 2. Sets fleaflickerId = "19244" so future syncs match by provider ID.
 * 3. Updates roster entries with external_player_id = "19244" and
 *    null canonical_player_id to point to the correct canonical ID.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, isNull, like } from "drizzle-orm";
import * as schema from "../lib/db/schema";

const FLEAFLICKER_EXT_ID = "19244";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = neon(connectionString);
  const db = drizzle(client, { schema });

  // Step 1: Find Travis Hunter's canonical entry
  const candidates = await db
    .select({
      id: schema.canonicalPlayers.id,
      name: schema.canonicalPlayers.name,
      position: schema.canonicalPlayers.position,
      fleaflickerId: schema.canonicalPlayers.fleaflickerId,
    })
    .from(schema.canonicalPlayers)
    .where(like(schema.canonicalPlayers.name, "Travis Hunter%"));

  if (candidates.length === 0) {
    console.error("No canonical player matching 'Travis Hunter' found");
    process.exit(1);
  }

  if (candidates.length > 1) {
    console.log("Multiple matches found:");
    for (const c of candidates) {
      console.log(`  ${c.id} - ${c.name} (${c.position})`);
    }
    console.error("Ambiguous match — aborting");
    process.exit(1);
  }

  const player = candidates[0];
  console.log(`Found: ${player.name} (${player.position})`);
  console.log(`  ID: ${player.id}`);
  console.log(
    `  Current fleaflickerId: ${player.fleaflickerId ?? "null"}`
  );

  // Step 2: Set fleaflickerId on the canonical entry
  if (player.fleaflickerId === FLEAFLICKER_EXT_ID) {
    console.log("  fleaflickerId already set, skipping update");
  } else {
    await db
      .update(schema.canonicalPlayers)
      .set({ fleaflickerId: FLEAFLICKER_EXT_ID })
      .where(eq(schema.canonicalPlayers.id, player.id));
    console.log(`  Set fleaflickerId = "${FLEAFLICKER_EXT_ID}"`);
  }

  // Step 3: Fix roster entries
  const unmapped = await db
    .select({
      id: schema.rosters.id,
      teamId: schema.rosters.teamId,
      playerName: schema.rosters.playerName,
    })
    .from(schema.rosters)
    .where(
      and(
        eq(schema.rosters.externalPlayerId, FLEAFLICKER_EXT_ID),
        isNull(schema.rosters.canonicalPlayerId)
      )
    );

  console.log(`\nFound ${unmapped.length} unmapped roster entries`);

  if (unmapped.length > 0) {
    for (const row of unmapped) {
      console.log(`  Fixing: ${row.playerName} (team ${row.teamId})`);
    }

    await db
      .update(schema.rosters)
      .set({ canonicalPlayerId: player.id })
      .where(
        and(
          eq(schema.rosters.externalPlayerId, FLEAFLICKER_EXT_ID),
          isNull(schema.rosters.canonicalPlayerId)
        )
      );

    console.log("  Updated roster entries");
  }

  // Step 4: Verify
  const verification = await db
    .select({
      id: schema.rosters.id,
      canonicalPlayerId: schema.rosters.canonicalPlayerId,
      playerName: schema.rosters.playerName,
    })
    .from(schema.rosters)
    .where(eq(schema.rosters.externalPlayerId, FLEAFLICKER_EXT_ID));

  console.log("\nVerification:");
  for (const row of verification) {
    const status = row.canonicalPlayerId
      ? `mapped → ${row.canonicalPlayerId}`
      : "STILL UNMAPPED";
    console.log(`  ${row.playerName}: ${status}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
