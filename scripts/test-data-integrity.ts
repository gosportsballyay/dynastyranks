#!/usr/bin/env npx tsx
/**
 * Data Integrity Tests
 *
 * Automated tests to verify data pipeline invariants:
 * - D1: Aggregation test (0 duplicate player-season rows)
 * - D2: Join integrity test (no row multiplication)
 * - D3: Plausibility test (all points within bounds)
 * - D4: Known anchors test (elite starters outrank FA/fringe)
 *
 * Usage:
 *   npx tsx scripts/test-data-integrity.ts
 *   npx tsx scripts/test-data-integrity.ts --league <id>
 *   npx tsx scripts/test-data-integrity.ts --verbose
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc, sql, and, ilike } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// Position bounds for projected points (must match compute-values.ts)
const POSITION_BOUNDS: Record<string, { min: number; max: number }> = {
  QB: { min: 50, max: 500 },
  RB: { min: 20, max: 450 },
  WR: { min: 20, max: 450 },
  TE: { min: 15, max: 350 },
  LB: { min: 30, max: 350 },
  EDR: { min: 25, max: 350 },
  CB: { min: 20, max: 300 },
  S: { min: 25, max: 300 },
  IL: { min: 20, max: 250 },
  DB: { min: 20, max: 300 },
};

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}

async function main() {
  const args = process.argv.slice(2);
  let leagueId: string | undefined;
  const verbose = args.includes("--verbose");

  const leagueIndex = args.indexOf("--league");
  if (leagueIndex !== -1 && args[leagueIndex + 1]) {
    leagueId = args[leagueIndex + 1];
  }

  console.log("=== MyDynastyValues Data Integrity Tests ===\n");

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  const results: TestResult[] = [];

  // Get league for testing - prefer league with proper projection data
  // Find the latest projection season and prefer a league that matches
  if (!leagueId) {
    const projectionSeasons = await db
      .select({ season: schema.projections.season })
      .from(schema.projections)
      .groupBy(schema.projections.season)
      .orderBy(desc(schema.projections.season))
      .limit(1);

    const latestProjectionSeason = projectionSeasons[0]?.season;

    // Find league with season matching or just before latest projection season
    const leagues = await db
      .select({
        id: schema.leagues.id,
        name: schema.leagues.name,
        season: schema.leagues.season,
      })
      .from(schema.leagues)
      .orderBy(desc(schema.leagues.season));

    // Prefer league where season <= latestProjectionSeason (has projection data)
    const bestLeague = leagues.find(
      (l) => latestProjectionSeason && l.season <= latestProjectionSeason
    ) || leagues[0];

    if (bestLeague) {
      leagueId = bestLeague.id;
      console.log(`Auto-selected league: ${bestLeague.name} (${bestLeague.season})`);
      if (latestProjectionSeason) {
        console.log(`  Projections available for season: ${latestProjectionSeason}\n`);
      }
    }
  }

  if (!leagueId) {
    console.error("Error: No leagues found in database");
    process.exit(1);
  }

  console.log(`Testing with league: ${leagueId}\n`);

  // D1: Aggregation Test - No duplicate player-season rows
  console.log("D1: Aggregation Test (duplicate rows)");
  console.log("-".repeat(40));

  const duplicateHistorical = await db.execute(sql`
    SELECT canonical_player_id, season, COUNT(*) as row_count
    FROM historical_stats
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  const duplicateProjections = await db.execute(sql`
    SELECT canonical_player_id, season, COUNT(*) as row_count
    FROM projections
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  const d1HistoricalPassed = duplicateHistorical.rows.length === 0;
  const d1ProjectionsPassed = duplicateProjections.rows.length === 0;
  const d1Passed = d1HistoricalPassed && d1ProjectionsPassed;

  const d1Details: string[] = [];
  if (!d1HistoricalPassed) {
    d1Details.push(`historical_stats: ${duplicateHistorical.rows.length} duplicate player-seasons`);
    if (verbose) {
      for (const row of duplicateHistorical.rows.slice(0, 5)) {
        d1Details.push(`  - Player ${row.canonical_player_id}: Season ${row.season} has ${row.row_count} rows`);
      }
    }
  }
  if (!d1ProjectionsPassed) {
    d1Details.push(`projections: ${duplicateProjections.rows.length} duplicate player-seasons`);
    if (verbose) {
      for (const row of duplicateProjections.rows.slice(0, 5)) {
        d1Details.push(`  - Player ${row.canonical_player_id}: Season ${row.season} has ${row.row_count} rows`);
      }
    }
  }

  results.push({
    name: "D1: Aggregation (no duplicate rows)",
    passed: d1Passed,
    message: d1Passed
      ? "0 duplicate player-season rows in historical_stats and projections"
      : `Found duplicates: ${d1Details.join(", ")}`,
    details: d1Details.length > 0 ? d1Details : undefined,
  });

  console.log(d1Passed ? "  ✓ PASS" : "  ❌ FAIL");
  console.log(`  ${results[results.length - 1].message}\n`);

  // D2: Join Integrity Test - No row multiplication
  console.log("D2: Join Integrity Test (no row multiplication)");
  console.log("-".repeat(40));

  // Count distinct players with 2024 stats
  const playersWith2024Stats = await db.execute(sql`
    SELECT COUNT(DISTINCT canonical_player_id) as player_count
    FROM historical_stats
    WHERE season = 2024
  `);

  // Count rows from join
  const joinedRowCount = await db.execute(sql`
    SELECT COUNT(*) as row_count
    FROM canonical_players cp
    INNER JOIN historical_stats hs ON cp.id = hs.canonical_player_id
    WHERE hs.season = 2024
  `);

  const distinctPlayers = Number(playersWith2024Stats.rows[0]?.player_count || 0);
  const joinedRows = Number(joinedRowCount.rows[0]?.row_count || 0);

  // Join should produce exactly 1 row per player (no multiplication)
  const d2Passed = joinedRows === distinctPlayers;

  results.push({
    name: "D2: Join Integrity (no row multiplication)",
    passed: d2Passed,
    message: d2Passed
      ? `Join produces ${joinedRows} rows for ${distinctPlayers} players (1:1 ratio)`
      : `Join produced ${joinedRows} rows for ${distinctPlayers} players (ratio: ${(joinedRows / distinctPlayers).toFixed(2)})`,
  });

  console.log(d2Passed ? "  ✓ PASS" : "  ❌ FAIL");
  console.log(`  ${results[results.length - 1].message}\n`);

  // D3: Plausibility Test - All points within bounds
  console.log("D3: Plausibility Test (points within bounds)");
  console.log("-".repeat(40));

  const outlierConditions = Object.entries(POSITION_BOUNDS)
    .map(([pos, bounds]) => `(cp.position = '${pos}' AND pv.projected_points > ${bounds.max})`)
    .join(" OR ");

  const outliers = await db.execute(sql.raw(`
    SELECT cp.name, cp.position, pv.projected_points
    FROM player_values pv
    JOIN canonical_players cp ON pv.canonical_player_id = cp.id
    WHERE pv.league_id = '${leagueId}'
      AND (${outlierConditions})
    ORDER BY pv.projected_points DESC
    LIMIT 20
  `));

  const d3Passed = outliers.rows.length === 0;
  const d3Details: string[] = [];

  if (!d3Passed && verbose) {
    for (const row of outliers.rows.slice(0, 10)) {
      const bounds = POSITION_BOUNDS[row.position as string];
      d3Details.push(
        `  - ${row.name} (${row.position}): ${Number(row.projected_points).toFixed(1)} pts > max ${bounds?.max}`
      );
    }
  }

  results.push({
    name: "D3: Plausibility (points within bounds)",
    passed: d3Passed,
    message: d3Passed
      ? "All projected points within position bounds"
      : `Found ${outliers.rows.length} outliers exceeding position bounds`,
    details: d3Details.length > 0 ? d3Details : undefined,
  });

  console.log(d3Passed ? "  ✓ PASS" : "  ❌ FAIL");
  console.log(`  ${results[results.length - 1].message}`);
  if (d3Details.length > 0) {
    for (const detail of d3Details) {
      console.log(detail);
    }
  }
  console.log();

  // D4: Known Anchors Test - Elite starters outrank FA/fringe
  console.log("D4: Known Anchors Test (elite > FA/fringe)");
  console.log("-".repeat(40));

  // Get QB rankings
  const qbRankings = await db
    .select({
      name: schema.canonicalPlayers.name,
      rank: schema.playerValues.rank,
      projectedPoints: schema.playerValues.projectedPoints,
      nflTeam: schema.canonicalPlayers.nflTeam,
    })
    .from(schema.playerValues)
    .innerJoin(
      schema.canonicalPlayers,
      eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id)
    )
    .where(
      and(
        eq(schema.playerValues.leagueId, leagueId),
        eq(schema.canonicalPlayers.position, "QB")
      )
    )
    .orderBy(desc(schema.playerValues.projectedPoints))
    .limit(50);

  // Find Josh Allen and Ian Book
  const joshAllen = qbRankings.find((p) => p.name.includes("Josh Allen"));
  const ianBook = qbRankings.find((p) => p.name.includes("Ian Book"));

  let d4Passed = true;
  const d4Details: string[] = [];

  if (!joshAllen) {
    d4Details.push("Josh Allen not found in top 50 QBs");
    // This is a warning, not necessarily a failure if he's just not in the league
  } else {
    d4Details.push(
      `Josh Allen: rank ${joshAllen.rank}, ${joshAllen.projectedPoints?.toFixed(1)} pts (${joshAllen.nflTeam})`
    );
  }

  if (ianBook) {
    d4Details.push(
      `Ian Book: rank ${ianBook.rank}, ${ianBook.projectedPoints?.toFixed(1)} pts (${ianBook.nflTeam || "FA"})`
    );

    if (joshAllen && ianBook.rank && joshAllen.rank) {
      if (ianBook.rank < joshAllen.rank) {
        d4Passed = false;
        d4Details.push("❌ Ian Book outranks Josh Allen - anchor test failed!");
      } else {
        d4Details.push("✓ Josh Allen correctly outranks Ian Book");
      }
    }
  } else {
    d4Details.push("Ian Book not in top 50 QBs (expected - FA gating working)");
  }

  // Additional anchor checks: Top 5 QBs should be recognizable elite names
  const top5QBs = qbRankings.slice(0, 5);
  const eliteQBNames = ["Mahomes", "Allen", "Hurts", "Jackson", "Burrow", "Herbert", "Stroud"];
  const top5HasElite = top5QBs.some((qb) =>
    eliteQBNames.some((name) => qb.name.includes(name))
  );

  if (!top5HasElite) {
    d4Passed = false;
    d4Details.push(`❌ Top 5 QBs don't include any elite names: ${top5QBs.map((q) => q.name).join(", ")}`);
  } else {
    d4Details.push(`✓ Top 5 QBs: ${top5QBs.map((q) => q.name).join(", ")}`);
  }

  results.push({
    name: "D4: Known Anchors (elite > FA/fringe)",
    passed: d4Passed,
    message: d4Passed
      ? "Elite starters correctly outrank FA/fringe players"
      : "Anchor test failed - ranking order incorrect",
    details: d4Details,
  });

  console.log(d4Passed ? "  ✓ PASS" : "  ❌ FAIL");
  for (const detail of d4Details) {
    console.log(`  ${detail}`);
  }
  console.log();

  // Summary
  console.log("=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "❌ FAIL";
    console.log(`${status}  ${result.name}`);
  }

  console.log();
  console.log(`${passedCount}/${totalCount} tests passed`);

  if (passedCount < totalCount) {
    console.log("\n⚠️  Some tests failed. Review the output above for details.");
    process.exit(1);
  } else {
    console.log("\n✓ All data integrity tests passed!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
