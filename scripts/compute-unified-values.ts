#!/usr/bin/env npx tsx
/**
 * Compute Unified Values
 *
 * Single entry point that runs consensus aggregation then unified
 * value blending for one or all leagues.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/compute-unified-values.ts
 *   export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/compute-unified-values.ts --league <id>
 */

import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { computeAggregatedValues } from "../lib/value-engine/aggregate";
import { computeUnifiedValues } from "../lib/value-engine/compute-unified";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let targetLeagueId: string | undefined;

  const leagueIndex = args.indexOf("--league");
  if (leagueIndex !== -1 && args[leagueIndex + 1]) {
    targetLeagueId = args[leagueIndex + 1];
  }

  console.log("=== Compute Unified Values ===\n");

  // Get leagues to process
  let leagueRows;
  if (targetLeagueId) {
    leagueRows = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, targetLeagueId));
  } else {
    leagueRows = await db.select().from(leagues);
  }

  if (leagueRows.length === 0) {
    console.log("No leagues found.");
    return;
  }

  console.log(`Processing ${leagueRows.length} league(s)...\n`);

  for (const league of leagueRows) {
    console.log(`--- ${league.name} (${league.season}) ---`);
    console.log(`    ID: ${league.id}`);

    try {
      // Step 1: Refresh consensus aggregation
      console.log("    [1/2] Aggregating consensus rankings...");
      await computeAggregatedValues(league.id);

      // Step 2: Compute unified values
      console.log("    [2/2] Computing unified values...");
      const result = await computeUnifiedValues(league.id);

      if (result.success) {
        console.log(
          `    Computed ${result.playerCount} unified values`,
        );
        console.log(`    Duration: ${result.durationMs}ms`);
      } else {
        console.log(
          `    Failed: ${result.errors.join(", ")}`,
        );
      }

      if (result.warnings.length > 0) {
        console.log("    Warnings:");
        for (const w of result.warnings.slice(0, 10)) {
          console.log(`      - ${w}`);
        }
        if (result.warnings.length > 10) {
          console.log(
            `      ... and ${result.warnings.length - 10} more`,
          );
        }
      }
    } catch (error) {
      console.log(
        `    Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    console.log();
  }

  console.log("=== Complete ===");
  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
