/**
 * Recompute player values for ALL leagues.
 *
 * Run after any value engine change so stored values reflect
 * the latest logic. Does not re-sync platform data.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && \
 *     npx tsx scripts/recompute-all-leagues.ts
 */

import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import {
  computeUnifiedValues,
  ENGINE_VERSION,
} from "../lib/value-engine";

async function main() {
  const allLeagues = await db
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues);

  console.log(
    `Recomputing ${allLeagues.length} leagues ` +
      `(engine ${ENGINE_VERSION})...\n`,
  );

  let success = 0;
  let failed = 0;

  for (const league of allLeagues) {
    const label = `${league.name} (${league.id.slice(0, 8)})`;
    try {
      const result = await computeUnifiedValues(league.id);
      if (result.success) {
        console.log(
          `  OK  ${label} — ${result.playerCount} players, ` +
            `${result.durationMs}ms`,
        );
        success++;
      } else {
        console.log(
          `  ERR ${label} — ${result.errors.join("; ")}`,
        );
        failed++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ERR ${label} — ${msg}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${success} succeeded, ${failed} failed ` +
      `out of ${allLeagues.length} leagues.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
