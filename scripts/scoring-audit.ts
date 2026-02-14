#!/usr/bin/env npx tsx
/**
 * Scoring Audit
 *
 * Prints computed historical points with detailed breakdown for top N players
 * per position in a given league. Shows:
 * - Stat-key breakdown (each stat × scoring rule)
 * - Bonuses fired (threshold bonuses with estimated game counts)
 * - Games counted
 *
 * Usage:
 *   npx tsx scripts/scoring-audit.ts <league-id-or-external-id> [--top N] [--season YYYY] [--position POS]
 *
 * The league identifier can be either:
 *   - Internal UUID (e.g., ee5ebec8-4f76-40a9-9dc1-b9a3a8116366)
 *   - External league ID from provider (e.g., 333258 for Fleaflicker)
 *
 * Examples:
 *   npx tsx scripts/scoring-audit.ts 333258 --top 5
 *   npx tsx scripts/scoring-audit.ts ee5ebec8-... --top 3 --position QB
 *   npx tsx scripts/scoring-audit.ts 333258 --season 2024
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, desc, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";

interface BonusThreshold {
  min: number;
  max?: number;
  bonus: number;
}

interface StatBreakdown {
  stat: string;
  value: number;
  rule: number;
  points: number;
  isOverride: boolean;
}

interface BonusFired {
  stat: string;
  threshold: string;
  bonus: number;
  estimatedGames: number;
  totalBonus: number;
}

interface PlayerAudit {
  name: string;
  position: string;
  gamesPlayed: number;
  totalPoints: number;
  basePoints: number;
  bonusPoints: number;
  statBreakdown: StatBreakdown[];
  bonusesFired: BonusFired[];
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

/**
 * Calculate fantasy points with detailed breakdown
 */
function calculateWithBreakdown(
  stats: Record<string, number>,
  scoringRules: Record<string, number>,
  positionOverrides: Record<string, number> | undefined,
  bonusThresholds: Record<string, BonusThreshold[]> | undefined,
  gamesPlayed: number
): { total: number; base: number; bonus: number; statBreakdown: StatBreakdown[]; bonusesFired: BonusFired[] } {
  const statBreakdown: StatBreakdown[] = [];
  const bonusesFired: BonusFired[] = [];
  let basePoints = 0;
  let bonusPoints = 0;

  // Track which stats have overrides
  const overrideStats = new Set(Object.keys(positionOverrides || {}));

  // Apply scoring rules
  for (const [stat, value] of Object.entries(stats)) {
    if (value === 0) continue;

    let rule = scoringRules[stat] || 0;
    let isOverride = false;

    // Check for position override
    if (positionOverrides && stat in positionOverrides) {
      rule = positionOverrides[stat];
      isOverride = true;
    }

    if (rule !== 0) {
      const points = value * rule;
      basePoints += points;
      statBreakdown.push({ stat, value, rule, points, isOverride });
    }
  }

  // Apply bonus thresholds
  if (bonusThresholds && gamesPlayed > 0) {
    for (const [stat, thresholds] of Object.entries(bonusThresholds)) {
      const seasonTotal = stats[stat] || 0;
      if (seasonTotal === 0) continue;

      const perGame = seasonTotal / gamesPlayed;

      for (const { min, max, bonus } of thresholds) {
        const estimatedGames = estimateBonusGames(perGame, min, max, gamesPlayed);
        if (estimatedGames > 0.01) {
          const totalBonus = bonus * estimatedGames;
          bonusPoints += totalBonus;
          bonusesFired.push({
            stat,
            threshold: max ? `${min}-${max}` : `${min}+`,
            bonus,
            estimatedGames,
            totalBonus,
          });
        }
      }
    }
  }

  // Sort breakdown by absolute points contribution
  statBreakdown.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    total: basePoints + bonusPoints,
    base: basePoints,
    bonus: bonusPoints,
    statBreakdown,
    bonusesFired,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const leagueArg = args.find((a) => !a.startsWith("--"));

  if (!leagueArg) {
    console.log("Usage: npx tsx scripts/scoring-audit.ts <league-id-or-external-id> [options]");
    console.log("\nThe league identifier can be either:");
    console.log("  - Internal UUID (e.g., ee5ebec8-4f76-40a9-9dc1-b9a3a8116366)");
    console.log("  - External league ID from provider (e.g., 333258 for Fleaflicker)");
    console.log("\nOptions:");
    console.log("  --top N        Number of players per position (default: 5)");
    console.log("  --season YYYY  Season year (default: most recent)");
    console.log("  --position POS Filter to specific position (e.g., QB, RB)");
    process.exit(1);
  }

  // Parse options
  let topN = 5;
  let filterSeason: number | undefined;
  let filterPosition: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1]) {
      topN = parseInt(args[i + 1], 10);
    } else if (args[i] === "--season" && args[i + 1]) {
      filterSeason = parseInt(args[i + 1], 10);
    } else if (args[i] === "--position" && args[i + 1]) {
      filterPosition = args[i + 1].toUpperCase();
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // Determine if leagueArg is a UUID or external ID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leagueArg);

  // Get league info
  let league: typeof schema.leagues.$inferSelect | undefined;

  if (isUuid) {
    const [result] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueArg)).limit(1);
    league = result;
  } else {
    // For external ID, get all matches and pick the most recently synced
    const matches = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.externalLeagueId, leagueArg))
      .orderBy(desc(schema.leagues.lastSyncedAt));

    if (matches.length > 1) {
      console.log(`Note: Found ${matches.length} leagues with external ID "${leagueArg}":`);
      for (const m of matches) {
        const syncedAt = m.lastSyncedAt ? m.lastSyncedAt.toISOString().split("T")[0] : "never";
        console.log(`  - ${m.id} (season ${m.season}, synced ${syncedAt})`);
      }
      console.log(`Using most recently synced: ${matches[0].id}\n`);
    }
    league = matches[0];
  }

  if (!league) {
    console.error(`League not found: ${leagueArg}`);
    console.error(`\nSearched by: ${isUuid ? "internal UUID" : "external league ID"}`);

    // List available leagues
    const allLeagues = await db
      .select({
        id: schema.leagues.id,
        externalLeagueId: schema.leagues.externalLeagueId,
        name: schema.leagues.name,
        provider: schema.leagues.provider,
        season: schema.leagues.season,
      })
      .from(schema.leagues)
      .orderBy(schema.leagues.name);

    if (allLeagues.length > 0) {
      console.error("\nAvailable leagues:");
      for (const l of allLeagues) {
        console.error(`  ${l.externalLeagueId.padEnd(12)} ${l.id}  ${l.name} (${l.provider}, ${l.season})`);
      }
    } else {
      console.error("\nNo leagues found in database. Connect a league first.");
    }
    process.exit(1);
  }

  const leagueId = league.id;

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

  const scoringRules = settings.scoringRules as Record<string, number>;
  const positionOverrides = settings.positionScoringOverrides as Record<string, Record<string, number>> | null;
  const metadata = settings.metadata as Record<string, unknown> | null;
  const bonusThresholds = metadata?.bonusThresholds as Record<string, BonusThreshold[]> | undefined;

  // Determine season
  const season = filterSeason ?? getMostRecentCompletedSeason();

  console.log("=".repeat(80));
  console.log(`SCORING AUDIT: ${league.name}`);
  console.log("=".repeat(80));
  console.log(`League ID: ${leagueId}`);
  console.log(`Season: ${season}`);
  console.log(`Top N per position: ${topN}`);
  if (filterPosition) console.log(`Position filter: ${filterPosition}`);
  console.log();

  // Print scoring rules summary
  console.log("--- Scoring Rules ---");
  const sortedRules = Object.entries(scoringRules).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [stat, pts] of sortedRules) {
    if (pts !== 0) {
      console.log(`  ${stat}: ${pts > 0 ? "+" : ""}${pts}`);
    }
  }

  if (positionOverrides && Object.keys(positionOverrides).length > 0) {
    console.log("\n--- Position Overrides ---");
    for (const [pos, overrides] of Object.entries(positionOverrides)) {
      const overrideStr = Object.entries(overrides)
        .map(([s, p]) => `${s}:${p > 0 ? "+" : ""}${p}`)
        .join(", ");
      console.log(`  ${pos}: ${overrideStr}`);
    }
  }

  if (bonusThresholds && Object.keys(bonusThresholds).length > 0) {
    console.log("\n--- Bonus Thresholds ---");
    for (const [stat, thresholds] of Object.entries(bonusThresholds)) {
      const threshStr = thresholds
        .map((t) => `${t.max ? `${t.min}-${t.max}` : `${t.min}+`}:+${t.bonus}`)
        .join(", ");
      console.log(`  ${stat}: ${threshStr}`);
    }
  }
  console.log();

  // Get historical stats with player info
  const statsWithPlayers = await db
    .select({
      stat: schema.historicalStats,
      player: schema.canonicalPlayers,
    })
    .from(schema.historicalStats)
    .innerJoin(
      schema.canonicalPlayers,
      eq(schema.historicalStats.canonicalPlayerId, schema.canonicalPlayers.id)
    )
    .where(eq(schema.historicalStats.season, season));

  if (statsWithPlayers.length === 0) {
    console.log(`No historical stats found for season ${season}`);
    process.exit(0);
  }

  // Calculate points for all players
  const playerAudits: PlayerAudit[] = [];

  for (const { stat, player } of statsWithPlayers) {
    if (filterPosition && player.position !== filterPosition) continue;

    const stats = stat.stats as Record<string, number>;
    const gamesPlayed = stat.gamesPlayed ?? 17;
    const overrides = positionOverrides?.[player.position];

    const breakdown = calculateWithBreakdown(
      stats,
      scoringRules,
      overrides,
      bonusThresholds,
      gamesPlayed
    );

    playerAudits.push({
      name: player.name,
      position: player.position,
      gamesPlayed,
      totalPoints: breakdown.total,
      basePoints: breakdown.base,
      bonusPoints: breakdown.bonus,
      statBreakdown: breakdown.statBreakdown,
      bonusesFired: breakdown.bonusesFired,
    });
  }

  // Group by position and get top N
  const positions = filterPosition
    ? [filterPosition]
    : [...new Set(playerAudits.map((p) => p.position))].sort();

  for (const position of positions) {
    const positionPlayers = playerAudits
      .filter((p) => p.position === position)
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, topN);

    if (positionPlayers.length === 0) continue;

    console.log("=".repeat(80));
    console.log(`${position} - Top ${topN}`);
    console.log("=".repeat(80));

    for (let i = 0; i < positionPlayers.length; i++) {
      const p = positionPlayers[i];
      console.log(`\n${i + 1}. ${p.name} (${p.gamesPlayed} games)`);
      console.log(`   TOTAL: ${p.totalPoints.toFixed(1)} pts (base: ${p.basePoints.toFixed(1)}, bonus: ${p.bonusPoints.toFixed(1)})`);

      // Stat breakdown (top 10 contributing stats)
      console.log("\n   Stat Breakdown:");
      const topStats = p.statBreakdown.slice(0, 10);
      for (const s of topStats) {
        const override = s.isOverride ? " [override]" : "";
        const sign = s.rule > 0 ? "+" : "";
        console.log(
          `     ${s.stat.padEnd(15)} ${s.value.toFixed(1).padStart(8)} × ${sign}${s.rule.toString().padStart(5)} = ${s.points >= 0 ? "+" : ""}${s.points.toFixed(1).padStart(8)}${override}`
        );
      }
      if (p.statBreakdown.length > 10) {
        const remaining = p.statBreakdown.slice(10);
        const remainingTotal = remaining.reduce((sum, s) => sum + s.points, 0);
        console.log(`     ... and ${remaining.length} more stats = ${remainingTotal >= 0 ? "+" : ""}${remainingTotal.toFixed(1)}`);
      }

      // Bonuses fired
      if (p.bonusesFired.length > 0) {
        console.log("\n   Bonuses Fired:");
        for (const b of p.bonusesFired) {
          console.log(
            `     ${b.stat.padEnd(15)} ${b.threshold.padEnd(10)} +${b.bonus} × ${b.estimatedGames.toFixed(1)} games = +${b.totalBonus.toFixed(1)}`
          );
        }
      }
    }
    console.log();
  }

  // Summary statistics
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total players audited: ${playerAudits.length}`);
  console.log(`Season: ${season}`);

  const byPosition = new Map<string, number[]>();
  for (const p of playerAudits) {
    const arr = byPosition.get(p.position) || [];
    arr.push(p.totalPoints);
    byPosition.set(p.position, arr);
  }

  console.log("\nPoints by Position (avg / max):");
  for (const [pos, pts] of [...byPosition.entries()].sort()) {
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    const max = Math.max(...pts);
    console.log(`  ${pos.padEnd(5)}: avg ${avg.toFixed(1).padStart(6)}, max ${max.toFixed(1).padStart(6)} (${pts.length} players)`);
  }
}

function getMostRecentCompletedSeason(): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  return currentMonth <= 7 ? currentYear - 1 : currentYear - 1;
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
