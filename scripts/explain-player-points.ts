#!/usr/bin/env npx tsx
/**
 * Explain Player Points
 *
 * Shows the full lineage for a player's fantasy points calculation:
 * 1. Raw stats rows from historical_stats or projections
 * 2. Derived stat keys that match scoring rules
 * 3. Scoring rules applied (per-stat points)
 * 4. Bonus thresholds triggered
 * 5. Final total
 *
 * Usage:
 *   npx tsx scripts/explain-player-points.ts "Josh Allen" --league <id> [--season YYYY] [--source historical|projection]
 *
 * Examples:
 *   npx tsx scripts/explain-player-points.ts "Josh Allen" --league ee5ebec8-...
 *   npx tsx scripts/explain-player-points.ts "Patrick Mahomes" --league ee5ebec8-... --season 2023
 *   npx tsx scripts/explain-player-points.ts "CeeDee Lamb" --league ee5ebec8-... --source projection
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, ilike, desc, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";

interface BonusThreshold {
  min: number;
  max?: number;
  bonus: number;
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Estimate how many games hit a bonus threshold
 */
function estimateBonusGames(
  perGameAvg: number,
  min: number,
  max: number | undefined,
  totalGames: number
): number {
  if (perGameAvg < min * 0.7) {
    return 0;
  }

  const cv = 0.3;
  const stdDev = perGameAvg * cv;

  const zScore = (min - perGameAvg) / stdDev;
  let probExceedsMin = 1 - normalCDF(zScore);

  if (max !== undefined) {
    const zScoreMax = (max - perGameAvg) / stdDev;
    const probBelowMax = normalCDF(zScoreMax);
    probExceedsMin = probBelowMax - normalCDF(zScore);
  }

  return Math.max(0, probExceedsMin * totalGames);
}

function getMostRecentCompletedSeason(): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  return currentMonth <= 7 ? currentYear - 1 : currentYear - 1;
}

async function main() {
  const args = process.argv.slice(2);

  // Find player name (first non-flag argument)
  let playerName: string | undefined;
  let leagueId: string | undefined;
  let filterSeason: number | undefined;
  let source: "historical" | "projection" | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league" && args[i + 1]) {
      leagueId = args[i + 1];
      i++;
    } else if (args[i] === "--season" && args[i + 1]) {
      filterSeason = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--source" && args[i + 1]) {
      source = args[i + 1] as "historical" | "projection";
      i++;
    } else if (!args[i].startsWith("--")) {
      playerName = args[i];
    }
  }

  if (!playerName || !leagueId) {
    console.log('Usage: npx tsx scripts/explain-player-points.ts "<player name>" --league <id> [options]');
    console.log("\nOptions:");
    console.log("  --league ID           League ID (required)");
    console.log("  --season YYYY         Season year (default: most recent)");
    console.log("  --source TYPE         Data source: historical or projection");
    console.log("\nExamples:");
    console.log('  npx tsx scripts/explain-player-points.ts "Josh Allen" --league ee5ebec8-...');
    console.log('  npx tsx scripts/explain-player-points.ts "CeeDee Lamb" --league ee5ebec8-... --season 2023');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // Get league info
  const [league] = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.error(`League not found: ${leagueId}`);
    process.exit(1);
  }

  // Get league settings
  const [settings] = await db
    .select()
    .from(schema.leagueSettings)
    .where(eq(schema.leagueSettings.leagueId, leagueId))
    .limit(1);

  if (!settings) {
    console.error("League settings not found. Run sync first.");
    process.exit(1);
  }

  // Find player
  const players = await db
    .select()
    .from(schema.canonicalPlayers)
    .where(ilike(schema.canonicalPlayers.name, `%${playerName}%`))
    .limit(10);

  if (players.length === 0) {
    console.error(`No player found matching: ${playerName}`);
    process.exit(1);
  }

  if (players.length > 1) {
    console.log("Multiple players found:");
    for (const p of players) {
      console.log(`  - ${p.name} (${p.position}, ${p.nflTeam || "FA"}) [${p.id}]`);
    }
    console.log("\nUsing first match. Specify exact name if needed.");
  }

  const player = players[0];
  const season = filterSeason ?? getMostRecentCompletedSeason();

  const scoringRules = settings.scoringRules as Record<string, number>;
  const positionOverrides = settings.positionScoringOverrides as Record<string, Record<string, number>> | null;
  const metadata = settings.metadata as Record<string, unknown> | null;
  const bonusThresholds = metadata?.bonusThresholds as Record<string, BonusThreshold[]> | undefined;
  const playerOverrides = positionOverrides?.[player.position];

  console.log("=".repeat(80));
  console.log("EXPLAIN PLAYER POINTS");
  console.log("=".repeat(80));
  console.log(`Player: ${player.name} (${player.position})`);
  console.log(`Team: ${player.nflTeam || "Free Agent"}`);
  console.log(`Age: ${player.age || "Unknown"}`);
  console.log(`League: ${league.name}`);
  console.log(`Season: ${season}`);
  console.log();

  // Get historical stats
  const [historicalStat] = await db
    .select()
    .from(schema.historicalStats)
    .where(
      and(
        eq(schema.historicalStats.canonicalPlayerId, player.id),
        eq(schema.historicalStats.season, season)
      )
    )
    .limit(1);

  // Get projection stats
  const [projectionStat] = await db
    .select()
    .from(schema.projections)
    .where(
      and(
        eq(schema.projections.canonicalPlayerId, player.id),
        eq(schema.projections.season, season)
      )
    )
    .limit(1);

  // Determine which source to use
  const useHistorical = source === "historical" || (!source && historicalStat);
  const useProjection = source === "projection" || (!source && !historicalStat && projectionStat);

  if (useHistorical && !historicalStat) {
    console.log(`No historical stats found for ${player.name} in season ${season}`);
  }
  if (useProjection && !projectionStat) {
    console.log(`No projection found for ${player.name} in season ${season}`);
  }

  // Process each available data source
  const sources: Array<{ name: string; stats: Record<string, number>; gamesPlayed: number; source: string }> = [];

  if (historicalStat && (useHistorical || !source)) {
    sources.push({
      name: "Historical Stats",
      stats: historicalStat.stats as Record<string, number>,
      gamesPlayed: historicalStat.gamesPlayed ?? 17,
      source: historicalStat.source || "unknown",
    });
  }

  if (projectionStat && (useProjection || !source)) {
    sources.push({
      name: "Projection",
      stats: projectionStat.stats as Record<string, number>,
      gamesPlayed: 17,
      source: projectionStat.source || "unknown",
    });
  }

  if (sources.length === 0) {
    console.log("No data available for this player/season combination.");
    process.exit(0);
  }

  for (const dataSource of sources) {
    console.log("=".repeat(80));
    console.log(`DATA SOURCE: ${dataSource.name.toUpperCase()}`);
    console.log("=".repeat(80));
    console.log(`Source: ${dataSource.source}`);
    console.log(`Games: ${dataSource.gamesPlayed}`);
    console.log();

    // Step 1: Raw stats
    console.log("--- STEP 1: Raw Stats ---");
    const sortedStats = Object.entries(dataSource.stats)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [key, value] of sortedStats) {
      console.log(`  ${key.padEnd(20)}: ${typeof value === "number" ? value.toFixed(2) : value}`);
    }
    console.log();

    // Step 2: Stat keys that match scoring rules
    console.log("--- STEP 2: Derived Stat Keys (matching scoring rules) ---");
    const matchedStats: Array<{ key: string; value: number; rule: number; isOverride: boolean }> = [];
    const unmatchedStats: string[] = [];

    for (const [key, value] of sortedStats) {
      let rule = scoringRules[key];
      let isOverride = false;

      if (playerOverrides && key in playerOverrides) {
        rule = playerOverrides[key];
        isOverride = true;
      }

      if (rule !== undefined && rule !== 0) {
        matchedStats.push({ key, value, rule, isOverride });
        const override = isOverride ? " [position override]" : "";
        console.log(`  ✓ ${key.padEnd(20)} → ${rule > 0 ? "+" : ""}${rule} pts/unit${override}`);
      } else if (scoringRules[key] === 0) {
        console.log(`  - ${key.padEnd(20)} → 0 pts (rule exists but zero)`);
      } else {
        unmatchedStats.push(key);
      }
    }

    if (unmatchedStats.length > 0) {
      console.log("\n  Unmatched stats (no scoring rule):");
      for (const key of unmatchedStats) {
        console.log(`  ✗ ${key}`);
      }
    }
    console.log();

    // Step 3: Scoring applied
    console.log("--- STEP 3: Scoring Applied ---");
    let baseTotal = 0;

    const scoringDetails = matchedStats
      .map(({ key, value, rule, isOverride }) => {
        const points = value * rule;
        baseTotal += points;
        return { key, value, rule, points, isOverride };
      })
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

    for (const { key, value, rule, points, isOverride } of scoringDetails) {
      const override = isOverride ? " [override]" : "";
      console.log(
        `  ${key.padEnd(20)} ${value.toFixed(2).padStart(10)} × ${(rule > 0 ? "+" : "") + rule.toString().padStart(6)} = ${(points >= 0 ? "+" : "") + points.toFixed(2).padStart(10)}${override}`
      );
    }
    console.log(`  ${"─".repeat(60)}`);
    console.log(`  ${"BASE TOTAL".padEnd(20)} ${" ".repeat(10)}   ${" ".repeat(6)}   ${(baseTotal >= 0 ? "+" : "") + baseTotal.toFixed(2).padStart(10)}`);
    console.log();

    // Step 4: Bonus thresholds
    console.log("--- STEP 4: Bonus Thresholds ---");
    let bonusTotal = 0;

    if (!bonusThresholds || Object.keys(bonusThresholds).length === 0) {
      console.log("  No bonus thresholds configured for this league.");
    } else {
      const gamesPlayed = dataSource.gamesPlayed;
      const bonusesFired: Array<{ stat: string; threshold: string; bonus: number; games: number; total: number }> = [];
      const bonusesNotFired: Array<{ stat: string; threshold: string; reason: string }> = [];

      for (const [stat, thresholds] of Object.entries(bonusThresholds)) {
        const seasonTotal = dataSource.stats[stat] || 0;
        const perGame = gamesPlayed > 0 ? seasonTotal / gamesPlayed : 0;

        for (const { min, max, bonus } of thresholds) {
          const thresholdStr = max ? `${min}-${max}` : `${min}+`;
          const estimatedGames = estimateBonusGames(perGame, min, max, gamesPlayed);

          if (estimatedGames > 0.01) {
            const total = bonus * estimatedGames;
            bonusTotal += total;
            bonusesFired.push({ stat, threshold: thresholdStr, bonus, games: estimatedGames, total });
          } else {
            const reason = seasonTotal === 0
              ? "no stats"
              : `avg ${perGame.toFixed(1)}/game < ${(min * 0.7).toFixed(1)} threshold`;
            bonusesNotFired.push({ stat, threshold: thresholdStr, reason });
          }
        }
      }

      if (bonusesFired.length > 0) {
        console.log("  Bonuses Triggered:");
        for (const { stat, threshold, bonus, games, total } of bonusesFired) {
          console.log(
            `    ${stat.padEnd(15)} ${threshold.padEnd(10)} +${bonus} × ${games.toFixed(2).padStart(5)} games = +${total.toFixed(2)}`
          );
        }
        console.log(`    ${"─".repeat(55)}`);
        console.log(`    ${"BONUS TOTAL".padEnd(15)} ${" ".repeat(10)}   ${" ".repeat(5)}        +${bonusTotal.toFixed(2)}`);
      } else {
        console.log("  No bonuses triggered.");
      }

      if (bonusesNotFired.length > 0 && bonusesNotFired.length <= 10) {
        console.log("\n  Bonuses Not Triggered:");
        for (const { stat, threshold, reason } of bonusesNotFired.slice(0, 5)) {
          console.log(`    ${stat.padEnd(15)} ${threshold.padEnd(10)} - ${reason}`);
        }
        if (bonusesNotFired.length > 5) {
          console.log(`    ... and ${bonusesNotFired.length - 5} more`);
        }
      }
    }
    console.log();

    // Step 5: Final total
    console.log("--- STEP 5: Final Total ---");
    const grandTotal = baseTotal + bonusTotal;
    console.log(`  Base Points:  ${baseTotal >= 0 ? "+" : ""}${baseTotal.toFixed(2)}`);
    console.log(`  Bonus Points: ${bonusTotal >= 0 ? "+" : ""}${bonusTotal.toFixed(2)}`);
    console.log(`  ${"═".repeat(30)}`);
    console.log(`  GRAND TOTAL:  ${grandTotal.toFixed(2)} pts`);
    console.log();
  }

  // Show player values if available
  const playerValue = await db
    .select()
    .from(schema.playerValues)
    .where(
      and(
        eq(schema.playerValues.canonicalPlayerId, player.id),
        eq(schema.playerValues.leagueId, leagueId)
      )
    )
    .limit(1);

  if (playerValue.length > 0) {
    const pv = playerValue[0];
    console.log("=".repeat(80));
    console.log("STORED PLAYER VALUE");
    console.log("=".repeat(80));
    console.log(`Projected Points: ${pv.projectedPoints?.toFixed(2) ?? "N/A"}`);
    console.log(`VORP: ${pv.vorp?.toFixed(2) ?? "N/A"}`);
    console.log(`Value: ${pv.value?.toFixed(2) ?? "N/A"}`);
    console.log(`Rank: ${pv.rank ?? "N/A"}`);
    console.log(`Data Source: ${pv.dataSource ?? "N/A"}`);
    console.log(`Last Season Points: ${pv.lastSeasonPoints?.toFixed(2) ?? "N/A"}`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
