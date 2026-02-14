#!/usr/bin/env npx tsx
/**
 * Recompute League Values
 *
 * Forces recomputation of player values for one or all leagues.
 *
 * Usage:
 *   npx tsx scripts/recompute-values.ts                    # All leagues
 *   npx tsx scripts/recompute-values.ts --league <id>      # Specific league
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// Import the compute function directly
import { computeLeagueValues } from "../lib/value-engine/compute-values";

async function main() {
  console.warn(
    "DEPRECATED: Use scripts/compute-unified-values.ts instead.\n" +
    "This script uses the old VORP-only pipeline.\n"
  );
  const args = process.argv.slice(2);
  let targetLeagueId: string | undefined;

  const leagueIndex = args.indexOf("--league");
  if (leagueIndex !== -1 && args[leagueIndex + 1]) {
    targetLeagueId = args[leagueIndex + 1];
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  console.log("=== Recompute League Values ===\n");

  // Get leagues to process
  let leagues;
  if (targetLeagueId) {
    leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, targetLeagueId));
  } else {
    leagues = await db.select().from(schema.leagues);
  }

  if (leagues.length === 0) {
    console.log("No leagues found.");
    return;
  }

  console.log(`Processing ${leagues.length} league(s)...\n`);

  for (const league of leagues) {
    console.log(`--- ${league.name} (${league.season}) ---`);
    console.log(`    ID: ${league.id}`);

    try {
      const result = await computeLeagueValues(league.id);

      if (result.success) {
        console.log(`    ✓ Computed ${result.playerCount} player values`);
        console.log(`    Duration: ${result.durationMs}ms`);
      } else {
        console.log(`    ❌ Failed: ${result.errors.join(", ")}`);
      }

      if (result.warnings.length > 0) {
        console.log(`    Warnings:`);
        for (const w of result.warnings.slice(0, 10)) {
          console.log(`      - ${w}`);
        }
        if (result.warnings.length > 10) {
          console.log(`      ... and ${result.warnings.length - 10} more`);
        }
      }
    } catch (error) {
      console.log(`    ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log();
  }

  console.log("=== Complete ===");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
