#!/usr/bin/env npx tsx
/**
 * Aggregate Rankings for a League
 *
 * Computes aggregated dynasty values for all players in a league by combining
 * external rankings from KTC, FantasyCalc, and DynastyProcess.
 *
 * Usage:
 *   npx tsx scripts/aggregate-rankings.ts <league-id>
 *   npx tsx scripts/aggregate-rankings.ts --all  # All leagues
 */

import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import { computeAggregatedValues } from "../lib/value-engine/aggregate";

async function main() {
  console.warn(
    "DEPRECATED: Use scripts/compute-unified-values.ts instead.\n" +
    "It runs aggregation + unified blending in a single step.\n"
  );
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  npx tsx scripts/aggregate-rankings.ts <league-id>");
    console.log("  npx tsx scripts/aggregate-rankings.ts --all");
    process.exit(1);
  }

  try {
    if (args[0] === "--all") {
      // Aggregate for all leagues
      const allLeagues = await db.select({ id: leagues.id }).from(leagues);
      console.log(`Aggregating rankings for ${allLeagues.length} leagues...\n`);

      for (const league of allLeagues) {
        try {
          await computeAggregatedValues(league.id);
          console.log("");
        } catch (error) {
          console.error(`Error aggregating league ${league.id}:`, error);
        }
      }
    } else {
      // Aggregate for specific league
      const leagueId = args[0];
      await computeAggregatedValues(leagueId);
    }

    console.log("\nDone!");
    process.exit(0);
  } catch (error) {
    console.error("Error aggregating rankings:", error);
    process.exit(1);
  }
}

main();
