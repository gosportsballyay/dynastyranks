#!/usr/bin/env npx tsx
/**
 * Debug Replacement Levels
 *
 * Prints detailed breakdown of replacement level calculation for a league:
 * 1. League config (teamCount, slots)
 * 2. Starters consumed by position (including flex allocations)
 * 3. Replacement baseline points per position
 * 4. Top 20 overall rankings
 *
 * Usage:
 *   npx tsx scripts/debug-replacement-levels.ts <league-id>
 *   npx tsx scripts/debug-replacement-levels.ts --all  # List all leagues first
 *
 * Example:
 *   npx tsx scripts/debug-replacement-levels.ts ee5ebec8-4f76-40a9-9dc1-b9a3a8116366
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc, asc } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { calculateAllReplacementLevels } from "../lib/value-engine/replacement-level";

async function main() {
  const args = process.argv.slice(2);

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // List all leagues if --all flag
  if (args[0] === "--all" || args.length === 0) {
    console.log("=".repeat(60));
    console.log("AVAILABLE LEAGUES");
    console.log("=".repeat(60));

    const leagues = await db
      .select({
        id: schema.leagues.id,
        name: schema.leagues.name,
        season: schema.leagues.season,
        totalTeams: schema.leagues.totalTeams,
      })
      .from(schema.leagues)
      .orderBy(desc(schema.leagues.season));

    for (const league of leagues) {
      console.log(`\n${league.name} (${league.season})`);
      console.log(`  ID: ${league.id}`);
      console.log(`  Teams: ${league.totalTeams}`);
    }

    console.log("\n\nUsage: npx tsx scripts/debug-replacement-levels.ts <league-id>");
    return;
  }

  const leagueId = args[0];

  // Fetch league
  const [league] = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.error(`Error: League not found: ${leagueId}`);
    process.exit(1);
  }

  // Fetch settings
  const [settings] = await db
    .select()
    .from(schema.leagueSettings)
    .where(eq(schema.leagueSettings.leagueId, leagueId))
    .limit(1);

  if (!settings) {
    console.error(`Error: League settings not found for: ${leagueId}`);
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("REPLACEMENT LEVEL DEBUG");
  console.log("=".repeat(60));

  // --- League Config ---
  console.log("\n--- League Config ---");
  console.log(`League: ${league.name}`);
  console.log(`Season: ${league.season}`);
  console.log(`Team Count: ${league.totalTeams}`);

  console.log("\nRoster Slots:");
  const rosterPositions = settings.rosterPositions as Record<string, number>;
  for (const [slot, count] of Object.entries(rosterPositions)) {
    console.log(`  ${slot}: ${count}`);
  }

  console.log("\nFlex Rules:");
  const flexRules = settings.flexRules as Array<{ slot: string; eligible: string[] }>;
  for (const rule of flexRules) {
    console.log(`  ${rule.slot}: ${rule.eligible.join(", ")}`);
  }

  if (settings.positionMappings) {
    console.log("\nPosition Mappings:");
    const mappings = settings.positionMappings as Record<string, string[]>;
    for (const [slot, positions] of Object.entries(mappings)) {
      console.log(`  ${slot}: ${positions.join(", ")}`);
    }
  }

  console.log(`\nBench Slots: ${settings.benchSlots}`);

  // --- Calculate Replacement Levels ---
  console.log("\n--- Replacement Levels ---");

  const replacementLevels = calculateAllReplacementLevels(
    rosterPositions,
    flexRules,
    settings.positionMappings as Record<string, string[]> | undefined,
    league.totalTeams,
    settings.benchSlots
  );

  console.log("\nStarters Required by Position:");
  for (const [pos, level] of Object.entries(replacementLevels).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pos.padEnd(5)}: ${level} starters (replacement = ${pos}${level + 1})`);
  }

  // --- Fetch player values for this league ---
  console.log("\n--- Player Pool by Position ---");

  const playerValues = await db
    .select({
      id: schema.playerValues.id,
      canonicalPlayerId: schema.playerValues.canonicalPlayerId,
      rank: schema.playerValues.rank,
      rankInPosition: schema.playerValues.rankInPosition,
      projectedPoints: schema.playerValues.projectedPoints,
      vorp: schema.playerValues.vorp,
      value: schema.playerValues.value,
      dataSource: schema.playerValues.dataSource,
      name: schema.canonicalPlayers.name,
      position: schema.canonicalPlayers.position,
    })
    .from(schema.playerValues)
    .innerJoin(
      schema.canonicalPlayers,
      eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id)
    )
    .where(eq(schema.playerValues.leagueId, leagueId))
    .orderBy(asc(schema.playerValues.rank));

  // Group by position
  const byPosition: Record<string, typeof playerValues> = {};
  for (const pv of playerValues) {
    const pos = pv.position;
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(pv);
  }

  // Show player pool and replacement baselines
  console.log("\nPlayer Pool & Replacement Baselines:");
  const positions = Object.keys(byPosition).sort();
  for (const pos of positions) {
    const players = byPosition[pos];
    const repLevel = replacementLevels[pos] || 0;
    const repPlayer = players[repLevel] || players[players.length - 1];

    console.log(`\n  ${pos}: ${players.length} players`);
    console.log(`    Replacement Level: ${repLevel + 1} (${pos}${repLevel + 1})`);
    if (repPlayer) {
      console.log(`    Replacement Points: ${repPlayer.projectedPoints?.toFixed(1) || "N/A"}`);
      console.log(`    Replacement Player: ${repPlayer.name}`);
    }

    // Show top 3 at position
    console.log(`    Top 3:`);
    for (let i = 0; i < Math.min(3, players.length); i++) {
      const p = players[i];
      console.log(
        `      ${(i + 1).toString().padStart(2)}. ${p.name?.padEnd(22)} ${p.projectedPoints?.toFixed(1).padStart(7)} pts`
      );
    }
  }

  // --- Top 20 Overall ---
  console.log("\n--- Top 20 Overall ---");
  console.log(
    "Rank".padStart(4) +
      " | " +
      "Name".padEnd(24) +
      " | " +
      "Pos".padEnd(4) +
      " | " +
      "Points".padStart(8) +
      " | " +
      "VORP".padStart(8) +
      " | " +
      "Value".padStart(10) +
      " | " +
      "Source"
  );
  console.log("-".repeat(90));

  for (let i = 0; i < Math.min(20, playerValues.length); i++) {
    const p = playerValues[i];
    console.log(
      `${p.rank?.toString().padStart(4)} | ` +
        `${(p.name || "Unknown").padEnd(24)} | ` +
        `${(p.position || "?").padEnd(4)} | ` +
        `${(p.projectedPoints?.toFixed(1) || "0").padStart(8)} | ` +
        `${(p.vorp?.toFixed(1) || "0").padStart(8)} | ` +
        `${(p.value?.toFixed(1) || "0").padStart(10)} | ` +
        `${p.dataSource || "?"}`
    );
  }

  // --- Summary Stats ---
  console.log("\n--- Summary ---");
  console.log(`Total Ranked Players: ${playerValues.length}`);

  const dataSources: Record<string, number> = {};
  for (const pv of playerValues) {
    const src = pv.dataSource || "unknown";
    dataSources[src] = (dataSources[src] || 0) + 1;
  }

  console.log("Data Sources:");
  for (const [src, count] of Object.entries(dataSources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  console.log("\n✓ Done");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
