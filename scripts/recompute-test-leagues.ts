#!/usr/bin/env tsx
/**
 * Recompute values for all Test02-2026 leagues.
 */

import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { computeAggregatedValues } from "../lib/value-engine/aggregate";
import { computeUnifiedValues } from "../lib/value-engine/compute-unified";

async function main() {
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
    })
    .from(leagues)
    .where(eq(leagues.userId, "1a1786c0-6792-4c92-8cc6-57af880cb424"));

  console.log(`Found ${rows.length} leagues for Test02-2026\n`);

  let success = 0;
  let failed = 0;

  for (const league of rows) {
    try {
      await computeAggregatedValues(league.id);
      const result = await computeUnifiedValues(league.id);
      console.log(
        `[OK] ${league.name}\n` +
          `     leagueId=${league.id}\n` +
          `     engine=${result.engineVersion} ` +
          `proj=${result.projectionVersion} ` +
          `dataSeason=${result.latestDataSeason}\n` +
          `     ${result.playerCount} values (${result.durationMs}ms)`,
      );
      success++;
    } catch (err) {
      failed++;
      console.log(
        `[FAIL] ${league.name}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `\n=== Done: ${success} success, ${failed} failed ===`,
  );
}

main();
