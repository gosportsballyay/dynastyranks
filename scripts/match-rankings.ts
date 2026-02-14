#!/usr/bin/env npx tsx
/**
 * Match External Rankings to Canonical Players
 *
 * This script links external_rankings entries to our canonical_players table
 * by matching player names. Run after scraping to enable aggregation.
 *
 * Usage:
 *   npx tsx scripts/match-rankings.ts
 */

import { matchExternalRankingsToPlayers } from "../lib/value-engine/aggregate";

async function main() {
  console.log("Matching external rankings to canonical players...\n");

  try {
    await matchExternalRankingsToPlayers();
    console.log("\nDone!");
    process.exit(0);
  } catch (error) {
    console.error("Error matching rankings:", error);
    process.exit(1);
  }
}

main();
