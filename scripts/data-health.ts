#!/usr/bin/env npx tsx
/**
 * Data Health Check
 *
 * Validates the health of the data pipeline:
 * - Historical stats coverage by position
 * - Projections coverage
 * - VORP distribution sanity (not flat)
 * - Player values computation status
 * - Join/duplication audit (invariant A1)
 * - Top-20 sanity report with outlier detection (invariant A3)
 *
 * Usage:
 *   npx tsx scripts/data-health.ts
 *   npx tsx scripts/data-health.ts --league <league-id>
 *   npx tsx scripts/data-health.ts --mode dev  # fail on outliers
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc, sql, count, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";

interface PositionCount {
  position: string;
  count: number;
}

// Position bounds for projected points (per plan)
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

function isOutlier(position: string, points: number): boolean {
  const bounds = POSITION_BOUNDS[position];
  if (!bounds) return false;
  return points > bounds.max;
}

async function main() {
  const args = process.argv.slice(2);
  let leagueId: string | undefined;
  let mode: "production" | "dev" = "production";

  const leagueIndex = args.indexOf("--league");
  if (leagueIndex !== -1 && args[leagueIndex + 1]) {
    leagueId = args[leagueIndex + 1];
  }

  const modeIndex = args.indexOf("--mode");
  if (modeIndex !== -1 && args[modeIndex + 1] === "dev") {
    mode = "dev";
  }

  console.log("=== DynastyRanks Data Health Check ===");
  console.log(`Mode: ${mode}\n`);

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sql_client = neon(process.env.DATABASE_URL);
  const db = drizzle(sql_client, { schema });

  // 1. Historical stats coverage
  console.log("1. Historical Stats Coverage");
  console.log("----------------------------");

  const statsBySeasonQuery = await db
    .select({
      season: schema.historicalStats.season,
    })
    .from(schema.historicalStats);

  const statsBySeason: Record<number, number> = {};
  for (const row of statsBySeasonQuery) {
    statsBySeason[row.season] = (statsBySeason[row.season] || 0) + 1;
  }

  if (Object.keys(statsBySeason).length === 0) {
    console.log("  ⚠️ WARNING: No historical stats found!");
    console.log("  Run: npx tsx scripts/seed-historical-stats.ts");
  } else {
    for (const [season, count] of Object.entries(statsBySeason).sort(
      ([a], [b]) => parseInt(b) - parseInt(a)
    )) {
      const status = count >= 500 ? "✓" : "⚠️";
      console.log(`  ${status} ${season}: ${count} players`);
    }
  }

  // Get most recent season for position breakdown
  const latestSeason = Math.max(...Object.keys(statsBySeason).map(Number));
  if (latestSeason) {
    console.log(`\n  Position breakdown for ${latestSeason}:`);

    const statsWithPlayers = await db
      .select({
        position: schema.canonicalPlayers.position,
      })
      .from(schema.historicalStats)
      .innerJoin(
        schema.canonicalPlayers,
        eq(schema.historicalStats.canonicalPlayerId, schema.canonicalPlayers.id)
      )
      .where(eq(schema.historicalStats.season, latestSeason));

    const byPosition: Record<string, number> = {};
    for (const row of statsWithPlayers) {
      byPosition[row.position] = (byPosition[row.position] || 0) + 1;
    }

    for (const [pos, count] of Object.entries(byPosition).sort()) {
      console.log(`    ${pos}: ${count}`);
    }
  }

  // Check for games_played=0 issues per season
  if (Object.keys(statsBySeason).length > 0) {
    console.log(`\n  Games Played Check:`);

    for (const [season, totalCount] of Object.entries(statsBySeason).sort(
      ([a], [b]) => parseInt(b) - parseInt(a)
    )) {
      const zeroGamesResult = await db.execute(sql`
        SELECT COUNT(*) as cnt
        FROM historical_stats
        WHERE season = ${parseInt(season)}
          AND (games_played = 0 OR games_played IS NULL)
      `);
      const zeroCount = Number(zeroGamesResult.rows[0]?.cnt || 0);
      const pct = ((zeroCount / totalCount) * 100).toFixed(1);

      if (zeroCount > totalCount * 0.5) {
        console.log(`    ❌ ${season}: ${zeroCount}/${totalCount} (${pct}%) have games_played=0`);
      } else if (zeroCount > 0) {
        console.log(`    ⚠️  ${season}: ${zeroCount}/${totalCount} (${pct}%) have games_played=0`);
      } else {
        console.log(`    ✓ ${season}: All players have games_played > 0`);
      }
    }
  }

  // 2. Projections coverage
  console.log("\n2. Projections Coverage");
  console.log("-----------------------");

  const projectionsBySeasonQuery = await db
    .select({
      season: schema.projections.season,
    })
    .from(schema.projections);

  const projsBySeason: Record<number, number> = {};
  for (const row of projectionsBySeasonQuery) {
    projsBySeason[row.season] = (projsBySeason[row.season] || 0) + 1;
  }

  if (Object.keys(projsBySeason).length === 0) {
    console.log("  ⚠️ WARNING: No projections found!");
    console.log("  Run: npx tsx scripts/seed-projections.ts");
  } else {
    for (const [season, count] of Object.entries(projsBySeason).sort(
      ([a], [b]) => parseInt(b) - parseInt(a)
    )) {
      const status = count >= 500 ? "✓" : "⚠️";
      console.log(`  ${status} ${season}: ${count} players`);
    }
  }

  // 3. Canonical players
  console.log("\n3. Canonical Players");
  console.log("--------------------");

  const playerCounts = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${schema.canonicalPlayers.isActive} = true)`,
    })
    .from(schema.canonicalPlayers);

  const { total, active } = playerCounts[0];
  console.log(`  Total: ${total}`);
  console.log(`  Active: ${active}`);

  // 4. Duplication Audit (Invariant A1)
  console.log("\n4. Duplication Audit (Invariant A1)");
  console.log("-----------------------------------");

  // Check for duplicate historical_stats rows
  const duplicateHistorical = await db.execute(sql`
    SELECT canonical_player_id, season, COUNT(*) as row_count
    FROM historical_stats
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  if (duplicateHistorical.rows.length > 0) {
    console.log(`  ❌ FAIL: Found ${duplicateHistorical.rows.length} duplicate player-seasons in historical_stats`);
    for (const row of duplicateHistorical.rows.slice(0, 5)) {
      const [player] = await db
        .select({ name: schema.canonicalPlayers.name })
        .from(schema.canonicalPlayers)
        .where(eq(schema.canonicalPlayers.id, row.canonical_player_id as string))
        .limit(1);
      console.log(`    - ${player?.name || "Unknown"}: Season ${row.season} has ${row.row_count} rows`);
    }
    if (mode === "dev") {
      throw new Error("Duplicate rows found in historical_stats");
    }
  } else {
    console.log("  ✓ historical_stats: No duplicate player-season rows");
  }

  // Check for duplicate projections rows
  const duplicateProjections = await db.execute(sql`
    SELECT canonical_player_id, season, COUNT(*) as row_count
    FROM projections
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  if (duplicateProjections.rows.length > 0) {
    console.log(`  ❌ FAIL: Found ${duplicateProjections.rows.length} duplicate player-seasons in projections`);
    for (const row of duplicateProjections.rows.slice(0, 5)) {
      const [player] = await db
        .select({ name: schema.canonicalPlayers.name })
        .from(schema.canonicalPlayers)
        .where(eq(schema.canonicalPlayers.id, row.canonical_player_id as string))
        .limit(1);
      console.log(`    - ${player?.name || "Unknown"}: Season ${row.season} has ${row.row_count} rows`);
    }
    if (mode === "dev") {
      throw new Error("Duplicate rows found in projections");
    }
  } else {
    console.log("  ✓ projections: No duplicate player-season rows");
  }

  // 5. Top-20 Sanity Report (Invariant A3)
  console.log("\n5. Top-20 Sanity Report (Invariant A3)");
  console.log("--------------------------------------");

  // Get first league for analysis if not specified
  let analysisLeagueId = leagueId;
  if (!analysisLeagueId) {
    const [firstLeague] = await db
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .limit(1);
    analysisLeagueId = firstLeague?.id;
  }

  if (!analysisLeagueId) {
    console.log("  ⚠️ No leagues found for sanity check");
  } else {
    const positions = ["QB", "RB", "WR", "TE", "LB", "CB", "S", "EDR", "IL"];
    let totalOutliers = 0;
    const outlierDetails: Array<{ name: string; position: string; points: number; max: number }> = [];

    for (const pos of positions) {
      const topPlayers = await db
        .select({
          name: schema.canonicalPlayers.name,
          position: schema.canonicalPlayers.position,
          nflTeam: schema.canonicalPlayers.nflTeam,
          projectedPoints: schema.playerValues.projectedPoints,
          dataSource: schema.playerValues.dataSource,
        })
        .from(schema.playerValues)
        .innerJoin(
          schema.canonicalPlayers,
          eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id)
        )
        .where(
          and(
            eq(schema.playerValues.leagueId, analysisLeagueId),
            eq(schema.canonicalPlayers.position, pos)
          )
        )
        .orderBy(desc(schema.playerValues.projectedPoints))
        .limit(20);

      if (topPlayers.length === 0) continue;

      const bounds = POSITION_BOUNDS[pos];
      const posOutliers = topPlayers.filter((p) => p.projectedPoints > bounds.max);

      console.log(`\n  ${pos} (max: ${bounds.max} pts):`);

      // Show top 5
      for (const p of topPlayers.slice(0, 5)) {
        const flag = isOutlier(pos, p.projectedPoints) ? "⚠️ " : "   ";
        const team = p.nflTeam || "FA";
        console.log(
          `  ${flag}${p.name} (${team}): ${p.projectedPoints?.toFixed(1)} pts [${p.dataSource}]`
        );
      }

      if (posOutliers.length > 0) {
        totalOutliers += posOutliers.length;
        for (const p of posOutliers) {
          outlierDetails.push({
            name: p.name,
            position: pos,
            points: p.projectedPoints,
            max: bounds.max,
          });
        }
        console.log(`    ... ${posOutliers.length} outliers above ${bounds.max} pts`);
      }
    }

    console.log("\n  --- Outlier Summary ---");
    if (totalOutliers === 0) {
      console.log("  ✓ No outliers detected");
    } else {
      console.log(`  ❌ FAIL: ${totalOutliers} total outliers detected`);
      for (const o of outlierDetails.slice(0, 10)) {
        console.log(`    - ${o.name} (${o.position}): ${o.points.toFixed(1)} > max ${o.max}`);
      }
      if (outlierDetails.length > 10) {
        console.log(`    ... and ${outlierDetails.length - 10} more`);
      }
      if (mode === "dev") {
        throw new Error(`Found ${totalOutliers} outliers exceeding position bounds`);
      }
    }
  }

  // 6. League-specific checks
  if (leagueId) {
    console.log(`\n6. League Values: ${leagueId}`);
    console.log("-".repeat(40));

    // Check if league exists
    const [league] = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);

    if (!league) {
      console.log("  ❌ League not found!");
    } else {
      console.log(`  League: ${league.name}`);
      console.log(`  Teams: ${league.totalTeams}`);
      console.log(`  Season: ${league.season}`);

      // Get player values
      const values = await db
        .select()
        .from(schema.playerValues)
        .where(eq(schema.playerValues.leagueId, leagueId))
        .orderBy(desc(schema.playerValues.value))
        .limit(100);

      if (values.length === 0) {
        console.log("\n  ⚠️ No player values computed yet!");
        console.log("  Trigger computation by visiting the rankings page.");
      } else {
        console.log(`\n  Total values: ${values.length}`);

        // Data source distribution
        const dataSourceCounts: Record<string, number> = {};
        for (const v of values) {
          const source = v.dataSource || "unknown";
          dataSourceCounts[source] = (dataSourceCounts[source] || 0) + 1;
        }
        console.log("\n  Data sources:");
        for (const [source, count] of Object.entries(dataSourceCounts)) {
          console.log(`    ${source}: ${count}`);
        }

        // VORP distribution
        const vorpValues = values.map((v) => v.vorp);
        const vorpMin = Math.min(...vorpValues);
        const vorpMax = Math.max(...vorpValues);
        const vorpMean = vorpValues.reduce((a, b) => a + b, 0) / vorpValues.length;
        const vorpStdDev = Math.sqrt(
          vorpValues.reduce((sum, v) => sum + Math.pow(v - vorpMean, 2), 0) /
            vorpValues.length
        );

        console.log("\n  VORP Distribution (top 100):");
        console.log(`    Range: ${vorpMin.toFixed(1)} - ${vorpMax.toFixed(1)}`);
        console.log(`    Mean: ${vorpMean.toFixed(1)}`);
        console.log(`    Std Dev: ${vorpStdDev.toFixed(1)}`);
        console.log(
          `    Top 5: ${vorpValues.slice(0, 5).map((v) => v.toFixed(1)).join(", ")}`
        );

        if (vorpStdDev < 5) {
          console.log("\n  ⚠️ WARNING: VORP distribution is too flat!");
          console.log("  This suggests projections may be using flat estimates.");
        } else {
          console.log("\n  ✓ VORP distribution looks healthy");
        }

        // Check last season points
        const withLastSeason = values.filter((v) => v.lastSeasonPoints !== null);
        console.log(
          `\n  Players with last season data: ${withLastSeason.length}/${values.length}`
        );

        if (withLastSeason.length > 0) {
          const lastSeasonPoints = withLastSeason
            .map((v) => v.lastSeasonPoints!)
            .sort((a, b) => b - a);
          console.log(`    Top 5 last season: ${lastSeasonPoints.slice(0, 5).map((v) => v.toFixed(1)).join(", ")}`);
        }
      }
    }
  } else {
    // List all leagues
    console.log("\n6. Leagues");
    console.log("----------");

    const leagues = await db
      .select({
        id: schema.leagues.id,
        name: schema.leagues.name,
        totalTeams: schema.leagues.totalTeams,
        season: schema.leagues.season,
      })
      .from(schema.leagues)
      .limit(10);

    if (leagues.length === 0) {
      console.log("  No leagues found.");
    } else {
      for (const league of leagues) {
        // Count values for this league
        const [valueCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.playerValues)
          .where(eq(schema.playerValues.leagueId, league.id));

        const status = valueCount.count > 0 ? "✓" : "○";
        console.log(
          `  ${status} ${league.name} (${league.totalTeams} teams, ${league.season})`
        );
        console.log(`    ID: ${league.id}`);
        console.log(`    Values: ${valueCount.count}`);
      }
      console.log("\n  Run with --league <id> for detailed analysis");
    }
  }

  console.log("\n=== Health Check Complete ===\n");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
