#!/usr/bin/env npx tsx
/**
 * Debug Player Lineage
 *
 * Traces the data flow for specific players to identify data integrity issues:
 * - Historical stats rows (should be 1 per player-season)
 * - Projection rows (should be 1 per player-season)
 * - Player value computation breakdown
 *
 * Usage:
 *   npx tsx scripts/debug-player-lineage.ts "Ivan Pace"
 *   npx tsx scripts/debug-player-lineage.ts "Ian Book" "Josh Allen"
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql, ilike, or, and, desc } from "drizzle-orm";
import * as schema from "../lib/db/schema";

async function main() {
  const playerNames = process.argv.slice(2);

  if (playerNames.length === 0) {
    console.log("Usage: npx tsx scripts/debug-player-lineage.ts <player_name> [player_name2] ...");
    console.log("Example: npx tsx scripts/debug-player-lineage.ts 'Ivan Pace' 'Ian Book' 'Josh Allen'");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  console.log("=== Player Data Lineage Debug ===\n");

  for (const nameQuery of playerNames) {
    console.log(`${"=".repeat(60)}`);
    console.log(`Searching for: "${nameQuery}"`);
    console.log("=".repeat(60));

    // 1. Find canonical player(s) matching the name
    const players = await db
      .select()
      .from(schema.canonicalPlayers)
      .where(ilike(schema.canonicalPlayers.name, `%${nameQuery}%`))
      .limit(10);

    if (players.length === 0) {
      console.log("❌ No canonical player found with this name\n");
      continue;
    }

    console.log(`Found ${players.length} matching player(s):\n`);

    for (const player of players) {
      console.log(`\n--- ${player.name} (${player.position}) ---`);
      console.log(`  Canonical ID: ${player.id}`);
      console.log(`  GSIS ID: ${player.gsisPid || "N/A"}`);
      console.log(`  Sleeper ID: ${player.sleeperId || "N/A"}`);
      console.log(`  NFL Team: ${player.nflTeam || "N/A"}`);
      console.log(`  Age: ${player.age || "N/A"}`);
      console.log(`  Active: ${player.isActive}`);

      // 2. Check historical stats - should be ONE row per season
      console.log("\n  Historical Stats:");
      const historicalStats = await db
        .select()
        .from(schema.historicalStats)
        .where(eq(schema.historicalStats.canonicalPlayerId, player.id))
        .orderBy(desc(schema.historicalStats.season));

      if (historicalStats.length === 0) {
        console.log("    ❌ No historical stats found");
      } else {
        // Check for duplicate seasons
        const seasonCounts: Record<number, number> = {};
        for (const stat of historicalStats) {
          seasonCounts[stat.season] = (seasonCounts[stat.season] || 0) + 1;
        }

        const duplicateSeasons = Object.entries(seasonCounts).filter(
          ([, count]) => count > 1
        );
        if (duplicateSeasons.length > 0) {
          console.log(
            `    ⚠️  DUPLICATE ROWS DETECTED: ${duplicateSeasons
              .map(([s, c]) => `${s}(${c} rows)`)
              .join(", ")}`
          );
        }

        for (const stat of historicalStats) {
          const stats = stat.stats as Record<string, number>;
          const gamesPlayed = stat.gamesPlayed || 1;
          const scalingFactor = 17 / gamesPlayed;

          console.log(`    Season ${stat.season}:`);
          console.log(`      Games: ${gamesPlayed}`);
          console.log(`      Source: ${stat.source}`);
          console.log(`      Scaling Factor: 17 / ${gamesPlayed} = ${scalingFactor.toFixed(2)}x`);

          // Show key stats based on position with scaling breakdown
          const isDefensive = ["LB", "CB", "S", "EDR", "IL", "DB"].includes(
            player.position
          );
          if (isDefensive) {
            const tackles = stats.tackle || 0;
            const sacks = stats.sack || 0;
            const ints = stats.def_int || 0;
            console.log(
              `      Tackles: ${tackles} (per-game: ${(tackles / gamesPlayed).toFixed(1)}, scaled: ${(tackles * scalingFactor).toFixed(1)})`
            );
            console.log(
              `      Sacks: ${sacks} (per-game: ${(sacks / gamesPlayed).toFixed(2)}, scaled: ${(sacks * scalingFactor).toFixed(1)})`
            );
            console.log(
              `      INTs: ${ints} (per-game: ${(ints / gamesPlayed).toFixed(2)}, scaled: ${(ints * scalingFactor).toFixed(1)})`
            );
            console.log(`      Pass Defended: ${stats.pass_def || 0}`);
            console.log(`      Forced Fumbles: ${stats.fum_force || 0}`);
          } else {
            if (player.position === "QB") {
              const passYd = stats.pass_yd || 0;
              const passTd = stats.pass_td || 0;
              console.log(
                `      Pass Yards: ${passYd} (per-game: ${(passYd / gamesPlayed).toFixed(1)}, scaled: ${(passYd * scalingFactor).toFixed(0)})`
              );
              console.log(
                `      Pass TDs: ${passTd} (per-game: ${(passTd / gamesPlayed).toFixed(2)}, scaled: ${(passTd * scalingFactor).toFixed(1)})`
              );
              console.log(`      INTs: ${stats.int || 0}`);
            }
            const rushYd = stats.rush_yd || 0;
            const rushTd = stats.rush_td || 0;
            console.log(
              `      Rush Yards: ${rushYd} (per-game: ${(rushYd / gamesPlayed).toFixed(1)}, scaled: ${(rushYd * scalingFactor).toFixed(0)})`
            );
            console.log(`      Rush TDs: ${rushTd}`);
            const rec = stats.rec || 0;
            const recYd = stats.rec_yd || 0;
            console.log(
              `      Rec: ${rec}, Yards: ${recYd} (per-game: ${(recYd / gamesPlayed).toFixed(1)})`
            );
            console.log(`      Rec TDs: ${stats.rec_td || 0}`);
          }

          // Show if scaling factor would cause outlier
          if (scalingFactor > 2) {
            console.log(`      ⚠️  High scaling factor (${scalingFactor.toFixed(2)}x) - may cause inflated projections`);
          }

          // Show ALL stats for debugging
          console.log(`      All stats: ${JSON.stringify(stats)}`);
        }
      }

      // 3. Check projections - should be ONE row per season
      console.log("\n  Projections:");
      const projections = await db
        .select()
        .from(schema.projections)
        .where(eq(schema.projections.canonicalPlayerId, player.id))
        .orderBy(desc(schema.projections.season));

      if (projections.length === 0) {
        console.log("    ❌ No projections found");
      } else {
        // Check for duplicate seasons
        const seasonCounts: Record<number, number> = {};
        for (const proj of projections) {
          seasonCounts[proj.season] = (seasonCounts[proj.season] || 0) + 1;
        }

        const duplicateSeasons = Object.entries(seasonCounts).filter(
          ([, count]) => count > 1
        );
        if (duplicateSeasons.length > 0) {
          console.log(
            `    ⚠️  DUPLICATE ROWS DETECTED: ${duplicateSeasons
              .map(([s, c]) => `${s}(${c} rows)`)
              .join(", ")}`
          );
        }

        for (const proj of projections) {
          const stats = proj.stats as Record<string, number>;
          console.log(`    Season ${proj.season}:`);
          console.log(`      Source: ${proj.source}`);
          console.log(`      All stats: ${JSON.stringify(stats)}`);
        }
      }

      // 4. Check player values across all leagues
      console.log("\n  Player Values:");
      const values = await db
        .select({
          value: schema.playerValues,
          league: schema.leagues,
        })
        .from(schema.playerValues)
        .innerJoin(
          schema.leagues,
          eq(schema.playerValues.leagueId, schema.leagues.id)
        )
        .where(eq(schema.playerValues.canonicalPlayerId, player.id));

      if (values.length === 0) {
        console.log("    ❌ No player values computed");
      } else {
        for (const { value, league } of values) {
          console.log(`    League: ${league.name} (${league.season})`);
          console.log(`      Value: ${value.value?.toFixed(2)}`);
          console.log(`      Rank: ${value.rank}`);
          console.log(`      Projected Points: ${value.projectedPoints?.toFixed(2)}`);
          console.log(`      VORP: ${value.vorp?.toFixed(2)}`);
          console.log(`      Data Source: ${value.dataSource}`);
          console.log(`      Last Season Points: ${value.lastSeasonPoints?.toFixed(2) || "N/A"}`);
        }
      }
    }

    console.log("\n");
  }

  // Summary: Check for global data issues
  console.log("=".repeat(60));
  console.log("Global Data Integrity Checks");
  console.log("=".repeat(60));

  // Check for duplicate historical stats rows
  const duplicateHistorical = await db.execute(sql`
    SELECT canonical_player_id, season, COUNT(*) as row_count
    FROM historical_stats
    GROUP BY canonical_player_id, season
    HAVING COUNT(*) > 1
    LIMIT 20
  `);

  if (duplicateHistorical.rows.length > 0) {
    console.log(
      `\n⚠️  DUPLICATE HISTORICAL STATS: ${duplicateHistorical.rows.length} player-seasons have multiple rows!`
    );
    for (const row of duplicateHistorical.rows.slice(0, 5)) {
      const player = await db
        .select()
        .from(schema.canonicalPlayers)
        .where(eq(schema.canonicalPlayers.id, row.canonical_player_id as string))
        .limit(1);
      const name = player[0]?.name || "Unknown";
      console.log(
        `  - ${name}: Season ${row.season} has ${row.row_count} rows`
      );
    }
  } else {
    console.log("\n✓ No duplicate historical stats rows");
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
    console.log(
      `\n⚠️  DUPLICATE PROJECTIONS: ${duplicateProjections.rows.length} player-seasons have multiple rows!`
    );
    for (const row of duplicateProjections.rows.slice(0, 5)) {
      const player = await db
        .select()
        .from(schema.canonicalPlayers)
        .where(eq(schema.canonicalPlayers.id, row.canonical_player_id as string))
        .limit(1);
      const name = player[0]?.name || "Unknown";
      console.log(
        `  - ${name}: Season ${row.season} has ${row.row_count} rows`
      );
    }
  } else {
    console.log("✓ No duplicate projection rows");
  }

  // Check for implausibly high projected points
  console.log("\n=== Top 10 Projected Points by Position ===");
  const positions = ["QB", "RB", "WR", "TE", "LB", "CB", "S", "EDR", "IL"];

  for (const pos of positions) {
    const topPlayers = await db
      .select({
        name: schema.canonicalPlayers.name,
        position: schema.canonicalPlayers.position,
        projectedPoints: schema.playerValues.projectedPoints,
        dataSource: schema.playerValues.dataSource,
        leagueName: schema.leagues.name,
      })
      .from(schema.playerValues)
      .innerJoin(
        schema.canonicalPlayers,
        eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id)
      )
      .innerJoin(
        schema.leagues,
        eq(schema.playerValues.leagueId, schema.leagues.id)
      )
      .where(eq(schema.canonicalPlayers.position, pos))
      .orderBy(desc(schema.playerValues.projectedPoints))
      .limit(5);

    if (topPlayers.length > 0) {
      console.log(`\n${pos}:`);
      for (const p of topPlayers) {
        const flag = isOutlier(pos, p.projectedPoints) ? "⚠️ " : "   ";
        console.log(
          `${flag}${p.name}: ${p.projectedPoints?.toFixed(1)} pts (${p.dataSource})`
        );
      }
    }
  }

  console.log("\n=== Debug Complete ===\n");
}

function isOutlier(position: string, points: number | null): boolean {
  if (points === null) return false;

  // Reasonable bounds for projected fantasy points per season
  const bounds: Record<string, { min: number; max: number }> = {
    QB: { min: 100, max: 500 },
    RB: { min: 50, max: 400 },
    WR: { min: 50, max: 400 },
    TE: { min: 30, max: 300 },
    LB: { min: 50, max: 250 }, // IDP linebacker max ~250 in deep scoring
    CB: { min: 30, max: 150 },
    S: { min: 40, max: 200 },
    EDR: { min: 40, max: 200 },
    IL: { min: 30, max: 150 },
  };

  const bound = bounds[position];
  if (!bound) return false;

  return points > bound.max || points < bound.min;
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
