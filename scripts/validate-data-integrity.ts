#!/usr/bin/env npx tsx
/**
 * Validate Data Integrity
 *
 * Ensures post-ETL data quality:
 * 1. One row per (player_id, season) in historical_stats
 * 2. One row per (player_id, season) in projections
 * 3. No orphaned records
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Validation errors found (duplicates or orphans)
 *   2 - Script error
 *
 * Usage:
 *   npx tsx scripts/validate-data-integrity.ts [--fix] [--verbose]
 *
 * Options:
 *   --fix      Attempt to fix duplicates by keeping most recent
 *   --verbose  Show detailed output
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql, eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";

interface DuplicateRecord {
  canonicalPlayerId: string;
  season: number;
  rowCount: number;
  playerName?: string;
  position?: string;
}

interface ValidationResult {
  passed: boolean;
  historicalDuplicates: DuplicateRecord[];
  projectionDuplicates: DuplicateRecord[];
  orphanedHistorical: number;
  orphanedProjections: number;
}

/**
 * Check for duplicate rows in a table
 */
async function checkDuplicates(
  db: ReturnType<typeof drizzle>,
  tableName: "historical_stats" | "projections"
): Promise<DuplicateRecord[]> {
  const result = await db.execute(sql`
    SELECT
      canonical_player_id,
      season,
      COUNT(*) as row_count
    FROM ${sql.identifier(tableName)}
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    ORDER BY row_count DESC, season DESC
    LIMIT 100
  `);

  const duplicates: DuplicateRecord[] = [];

  for (const row of result.rows) {
    duplicates.push({
      canonicalPlayerId: row.canonical_player_id as string,
      season: row.season as number,
      rowCount: Number(row.row_count),
    });
  }

  // Enrich with player names
  if (duplicates.length > 0) {
    const playerIds = duplicates.map((d) => d.canonicalPlayerId);
    const players = await db
      .select({ id: schema.canonicalPlayers.id, name: schema.canonicalPlayers.name, position: schema.canonicalPlayers.position })
      .from(schema.canonicalPlayers);

    const playerMap = new Map(players.map((p) => [p.id, { name: p.name, position: p.position }]));

    for (const dup of duplicates) {
      const player = playerMap.get(dup.canonicalPlayerId);
      if (player) {
        dup.playerName = player.name;
        dup.position = player.position;
      }
    }
  }

  return duplicates;
}

/**
 * Check for orphaned records (stats without matching players)
 */
async function checkOrphans(
  db: ReturnType<typeof drizzle>,
  tableName: "historical_stats" | "projections"
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as orphan_count
    FROM ${sql.identifier(tableName)} t
    LEFT JOIN canonical_players p ON t.canonical_player_id = p.id
    WHERE p.id IS NULL
  `);

  return Number(result.rows[0]?.orphan_count || 0);
}

/**
 * Fix duplicates by keeping the most recently updated row
 */
async function fixDuplicates(
  db: ReturnType<typeof drizzle>,
  tableName: "historical_stats" | "projections",
  duplicates: DuplicateRecord[]
): Promise<number> {
  let fixed = 0;

  for (const dup of duplicates) {
    // Get all rows for this player/season, ordered by updated_at desc (or created_at)
    const rows = await db.execute(sql`
      SELECT id, updated_at, created_at
      FROM ${sql.identifier(tableName)}
      WHERE canonical_player_id = ${dup.canonicalPlayerId}
        AND season = ${dup.season}
      ORDER BY COALESCE(updated_at, created_at) DESC
    `);

    if (rows.rows.length > 1) {
      // Keep the first (most recent), delete the rest
      const idsToDelete = rows.rows.slice(1).map((r) => r.id as string);

      for (const id of idsToDelete) {
        await db.execute(sql`
          DELETE FROM ${sql.identifier(tableName)}
          WHERE id = ${id}
        `);
        fixed++;
      }
    }
  }

  return fixed;
}

/**
 * Run all validation checks
 */
export async function validateDataIntegrity(
  db: ReturnType<typeof drizzle>,
  options: { fix?: boolean; verbose?: boolean } = {}
): Promise<ValidationResult> {
  const result: ValidationResult = {
    passed: true,
    historicalDuplicates: [],
    projectionDuplicates: [],
    orphanedHistorical: 0,
    orphanedProjections: 0,
  };

  // Check historical_stats duplicates
  result.historicalDuplicates = await checkDuplicates(db, "historical_stats");
  if (result.historicalDuplicates.length > 0) {
    result.passed = false;
  }

  // Check projections duplicates
  result.projectionDuplicates = await checkDuplicates(db, "projections");
  if (result.projectionDuplicates.length > 0) {
    result.passed = false;
  }

  // Check orphans
  result.orphanedHistorical = await checkOrphans(db, "historical_stats");
  result.orphanedProjections = await checkOrphans(db, "projections");

  if (result.orphanedHistorical > 0 || result.orphanedProjections > 0) {
    result.passed = false;
  }

  // Fix duplicates if requested
  if (options.fix && !result.passed) {
    if (result.historicalDuplicates.length > 0) {
      const fixed = await fixDuplicates(db, "historical_stats", result.historicalDuplicates);
      if (options.verbose) {
        console.log(`Fixed ${fixed} duplicate historical_stats rows`);
      }
    }
    if (result.projectionDuplicates.length > 0) {
      const fixed = await fixDuplicates(db, "projections", result.projectionDuplicates);
      if (options.verbose) {
        console.log(`Fixed ${fixed} duplicate projections rows`);
      }
    }

    // Re-check after fix
    result.historicalDuplicates = await checkDuplicates(db, "historical_stats");
    result.projectionDuplicates = await checkDuplicates(db, "projections");
    result.passed =
      result.historicalDuplicates.length === 0 &&
      result.projectionDuplicates.length === 0 &&
      result.orphanedHistorical === 0 &&
      result.orphanedProjections === 0;
  }

  return result;
}

/**
 * Assert data integrity - throws if validation fails
 * Use this in ETL scripts to gate further processing
 */
export async function assertDataIntegrity(
  db: ReturnType<typeof drizzle>,
  context?: string
): Promise<void> {
  const result = await validateDataIntegrity(db);

  if (!result.passed) {
    const errors: string[] = [];

    if (result.historicalDuplicates.length > 0) {
      errors.push(
        `${result.historicalDuplicates.length} duplicate (player, season) rows in historical_stats`
      );
    }
    if (result.projectionDuplicates.length > 0) {
      errors.push(
        `${result.projectionDuplicates.length} duplicate (player, season) rows in projections`
      );
    }
    if (result.orphanedHistorical > 0) {
      errors.push(`${result.orphanedHistorical} orphaned historical_stats rows`);
    }
    if (result.orphanedProjections > 0) {
      errors.push(`${result.orphanedProjections} orphaned projections rows`);
    }

    const contextStr = context ? ` [${context}]` : "";
    throw new Error(`Data integrity check failed${contextStr}: ${errors.join("; ")}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const verbose = args.includes("--verbose");

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(2);
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  console.log("=".repeat(60));
  console.log("DATA INTEGRITY VALIDATION");
  console.log("=".repeat(60));
  console.log();

  const result = await validateDataIntegrity(db, { fix, verbose });

  // Report historical_stats
  console.log("--- historical_stats ---");
  if (result.historicalDuplicates.length === 0) {
    console.log("✓ No duplicate (player_id, season) rows");
  } else {
    console.log(`✗ ${result.historicalDuplicates.length} duplicate (player_id, season) combinations found:`);
    for (const dup of result.historicalDuplicates.slice(0, 10)) {
      const name = dup.playerName || dup.canonicalPlayerId.slice(0, 8);
      console.log(`    ${name} (${dup.position || "?"}) season ${dup.season}: ${dup.rowCount} rows`);
    }
    if (result.historicalDuplicates.length > 10) {
      console.log(`    ... and ${result.historicalDuplicates.length - 10} more`);
    }
  }

  if (result.orphanedHistorical > 0) {
    console.log(`✗ ${result.orphanedHistorical} orphaned rows (no matching player)`);
  } else if (verbose) {
    console.log("✓ No orphaned rows");
  }
  console.log();

  // Report projections
  console.log("--- projections ---");
  if (result.projectionDuplicates.length === 0) {
    console.log("✓ No duplicate (player_id, season) rows");
  } else {
    console.log(`✗ ${result.projectionDuplicates.length} duplicate (player_id, season) combinations found:`);
    for (const dup of result.projectionDuplicates.slice(0, 10)) {
      const name = dup.playerName || dup.canonicalPlayerId.slice(0, 8);
      console.log(`    ${name} (${dup.position || "?"}) season ${dup.season}: ${dup.rowCount} rows`);
    }
    if (result.projectionDuplicates.length > 10) {
      console.log(`    ... and ${result.projectionDuplicates.length - 10} more`);
    }
  }

  if (result.orphanedProjections > 0) {
    console.log(`✗ ${result.orphanedProjections} orphaned rows (no matching player)`);
  } else if (verbose) {
    console.log("✓ No orphaned rows");
  }
  console.log();

  // Summary
  console.log("=".repeat(60));
  if (result.passed) {
    console.log("✓ ALL CHECKS PASSED");
    process.exit(0);
  } else {
    console.log("✗ VALIDATION FAILED");
    if (!fix) {
      console.log("\nRun with --fix to attempt automatic repair of duplicates.");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(2);
});
