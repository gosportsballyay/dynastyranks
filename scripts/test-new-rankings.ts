#!/usr/bin/env npx tsx
/**
 * Test New Rankings: Hybrid Asset Model with Scarcity-Adjusted Value (SAV)
 *
 * Reads all player data from DB, applies:
 * - PPG calculation with multi-year dynasty smoothing
 * - Pedigree floor for high draft picks
 * - Z-score normalization with IDP variance buffer
 * - NFL market-based scarcity ratio (leagueStarters / NFL_POOL)
 * - Dynasty age curve premium
 *
 * Outputs top 50 players. NO database writes — purely a verification tool.
 *
 * Usage:
 *   npx tsx scripts/test-new-rankings.ts
 *   npx tsx scripts/test-new-rankings.ts --position QB
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// ── Types ──────────────────────────────────────────────────────

interface FlexRule {
  slot: string;
  eligible: string[];
}

interface PlayerEntry {
  id: string;
  name: string;
  position: string;
  positionGroup: string;
  nflTeam: string | null;
  age: number | null;
  draftRound: number | null;
  draftPick: number | null;
  yearsExperience: number | null;
}

interface RankedPlayer {
  player: PlayerEntry;
  seasonPoints: number;
  gamesPlayed: number;
  ppg: number;
  blendedPPG: number;
  pedigreeFloor: number;
  careerGames: number;
  rawVorp: number;
  zScore: number;
  scarcityFactor: number;
  dynastyPremium: number;
  finalValue: number;
  dataSource: string;
}

// ── Constants ──────────────────────────────────────────────────

/** Draft capital PPG floors (only kicks in as a floor) */
function getDraftCapitalFloor(
  draftRound: number | null,
  draftPick: number | null
): number {
  if (!draftRound) return 0;
  if (draftRound === 1) {
    if (draftPick && draftPick <= 5) return 16.0;
    if (draftPick && draftPick <= 15) return 14.5;
    return 12.0; // picks 16-32
  }
  if (draftRound === 2) return 9.5;
  if (draftRound === 3) return 7.0;
  return 0; // R4+ / UDFA: no floor
}

/** Career games threshold for pedigree blend */
const CAREER_GAMES_THRESHOLD = 34;

/**
 * IDP variance buffer: added to stddev for defensive positions.
 * Prevents ultra-high z-scores from consistent but low-ceiling
 * defensive players whose position has naturally low variance.
 */
const IDP_VARIANCE_BUFFER = 2.0;

/** Z-score scale factor to convert to user-friendly values */
const SCALE_FACTOR = 2000;

/**
 * Minimum games threshold for reliable PPG.
 * Players below this regress toward position mean PPG.
 */
const MIN_GAMES_RELIABLE = 8;

/**
 * NFL starter pool per position archetype.
 * Used to calculate scarcity ratio: leagueStarters / NFL_POOL
 * Higher ratio = scarcer position = more valuable
 */
const NFL_POOL_BASE: Record<string, number> = {
  QB: 32,   // 32 starting QBs
  RB: 40,   // ~40 viable fantasy RBs (bellcows + backups with value)
  WR: 80,   // Deep position - WR1/2/3 on most teams
  TE: 32,   // 32 starting TEs
  K: 32,
  // IDP archetypes
  EDR: 64,  // Edge rushers (32 teams × 2)
  IL: 64,   // Interior linemen / DTs
  LB: 96,   // Off-ball linebackers (many 4-3 and 3-4 schemes)
  CB: 64,   // Cornerbacks (32 teams × 2)
  S: 64,    // Safeties (32 teams × 2)
};

/**
 * Get NFL pool size for a position, handling consolidated positions.
 * DL = EDR + IL (128), DB = CB + S (128)
 */
function getNFLPool(
  position: string,
  positionMappings?: Record<string, string[]>
): number {
  if (positionMappings) {
    const granular = positionMappings[position];
    if (granular) {
      return granular.reduce(
        (sum, pos) => sum + (NFL_POOL_BASE[pos] || 64),
        0
      );
    }
  }
  return NFL_POOL_BASE[position] || 64;
}

/** Dynasty smoothing weights: Current 60%, Year-1 30%, Year-2 10% */
const DYNASTY_WEIGHTS = [0.6, 0.3, 0.1];

/**
 * Calculate weighted multi-year PPG for dynasty smoothing.
 * Rewards consistency, dampens one-off seasons.
 */
function calcMultiYearPPG(
  history: Array<{ season: number; points: number; gamesPlayed: number }>,
  targetSeason: number
): number {
  const sorted = history
    .filter((h) => h.season <= targetSeason)
    .sort((a, b) => b.season - a.season);

  if (sorted.length === 0) return 0;

  let weightedPPG = 0;
  let totalWeight = 0;

  for (let i = 0; i < Math.min(sorted.length, 3); i++) {
    const seasonData = sorted[i];
    const ppg =
      seasonData.gamesPlayed > 0
        ? seasonData.points / seasonData.gamesPlayed
        : 0;
    const weight = DYNASTY_WEIGHTS[i];
    weightedPPG += ppg * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedPPG / totalWeight : 0;
}

// ── Age curves (copied from age-curves.ts to keep standalone) ─

const PEAK_AGES: Record<string, { start: number; end: number }> = {
  QB: { start: 28, end: 33 },
  RB: { start: 24, end: 27 },
  WR: { start: 24, end: 28 },
  TE: { start: 26, end: 29 },
  K: { start: 25, end: 38 },
  LB: { start: 25, end: 30 },
  DL: { start: 25, end: 29 },
  DB: { start: 25, end: 30 },
  EDR: { start: 25, end: 29 },
  IL: { start: 25, end: 29 },
  CB: { start: 25, end: 30 },
  S: { start: 25, end: 31 },
};

const DECLINE_RATES: Record<string, number> = {
  QB: 0.025, RB: 0.10, WR: 0.04, TE: 0.05, K: 0.02,
  LB: 0.05, DL: 0.06, DB: 0.04, EDR: 0.06, IL: 0.05,
  CB: 0.04, S: 0.04,
};

const IMPROVEMENT_RATES: Record<string, number> = {
  QB: 0.08, RB: 0.06, WR: 0.07, TE: 0.08, K: 0.02,
  LB: 0.04, DL: 0.04, DB: 0.04, EDR: 0.04, IL: 0.04,
  CB: 0.05, S: 0.04,
};

function getAgeCurveMultiplier(
  position: string,
  age: number
): number {
  const peak = PEAK_AGES[position] || { start: 26, end: 30 };
  const declineRate = DECLINE_RATES[position] || 0.05;
  const improvementRate = IMPROVEMENT_RATES[position] || 0.04;

  if (age >= peak.start && age <= peak.end) return 1.0;

  if (age < peak.start) {
    const yearsToGo = peak.start - age;
    const developmentDiscount =
      Math.pow(1 - improvementRate, yearsToGo);
    const youthPremium = position === "RB" ? 1.05 : 1.0;
    return Math.min(1.1, developmentDiscount * youthPremium);
  }

  const yearsPastPeak = age - peak.end;
  const declineMultiplier =
    Math.pow(1 - declineRate, yearsPastPeak);

  if (position === "RB" && age > 28) {
    const cliffYears = age - 28;
    const cliffPenalty = Math.pow(0.85, cliffYears);
    return Math.max(0.3, declineMultiplier * cliffPenalty);
  }

  return Math.max(0.4, declineMultiplier);
}

function getDynastyPremium(
  position: string,
  age: number,
  yearsExperience?: number,
  draftRound?: number
): number {
  let premium = 1.0;
  premium *= getAgeCurveMultiplier(position, age);

  if (yearsExperience !== undefined && yearsExperience <= 2) {
    if (draftRound !== undefined) {
      const capitalBonus = Math.max(0, (8 - draftRound) / 20);
      premium += capitalBonus;
    }
    if (position === "RB" && age <= 24) {
      premium *= 1.12;
    } else if (
      (position === "WR" || position === "TE") &&
      yearsExperience === 1
    ) {
      premium *= 1.08;
    }
  }

  if (
    yearsExperience !== undefined &&
    yearsExperience >= 3 &&
    yearsExperience <= 4
  ) {
    if (position === "WR") premium *= 1.05;
    else if (position === "TE") premium *= 1.06;
  }

  return Math.min(1.4, Math.max(0.5, premium));
}

// ── Replacement level (simplified inline) ──────────────────────

const FLEX_USAGE_WEIGHTS: Record<
  string,
  Record<string, number>
> = {
  FLEX: { RB: 0.40, WR: 0.40, TE: 0.20 },
  SUPERFLEX: { QB: 0.80, RB: 0.08, WR: 0.08, TE: 0.04 },
  IDP_FLEX: {
    LB: 0.50, DL: 0.25, DB: 0.25,
    EDR: 0.15, IL: 0.10, CB: 0.12, S: 0.13,
  },
};

const BENCH_WEIGHTS: Record<string, number> = {
  QB: 0.5, RB: 1.0, WR: 1.0, TE: 0.7, K: 0.1,
  DL: 0.6, LB: 0.8, DB: 0.6,
  EDR: 0.5, IL: 0.4, CB: 0.5, S: 0.5,
};

function calcReplacementLevel(
  position: string,
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number,
  benchSlots: number
): number {
  let direct = (rosterPositions[position] || 0) * totalTeams;
  if (positionMappings) {
    for (const [cp, gp] of Object.entries(positionMappings)) {
      if (gp.includes(position)) {
        direct +=
          ((rosterPositions[cp] || 0) * totalTeams) / gp.length;
      }
    }
  }
  let flexDemand = 0;
  for (const rule of flexRules) {
    if (rule.eligible.includes(position)) {
      const slots =
        (rosterPositions[rule.slot] || 0) * totalTeams;
      const wt =
        FLEX_USAGE_WEIGHTS[rule.slot.toUpperCase()]?.[position] ||
        1 / rule.eligible.length;
      flexDemand += slots * wt;
    }
  }
  const benchWeight = BENCH_WEIGHTS[position] || 0.5;
  const benchFactor = (benchSlots / totalTeams) * benchWeight;
  return Math.max(1, Math.round(direct + flexDemand + benchFactor));
}

/**
 * Calculate starter demand for scarcity factor.
 * Returns the number of starters at a position across the league.
 */
function calcStarterDemand(
  position: string,
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number
): number {
  let demand = (rosterPositions[position] || 0) * totalTeams;
  if (positionMappings) {
    for (const [cp, gp] of Object.entries(positionMappings)) {
      if (gp.includes(position)) {
        demand +=
          ((rosterPositions[cp] || 0) * totalTeams) /
          gp.length;
      }
    }
  }
  for (const rule of flexRules) {
    if (rule.eligible.includes(position)) {
      const slots =
        (rosterPositions[rule.slot] || 0) * totalTeams;
      const wt =
        FLEX_USAGE_WEIGHTS[rule.slot.toUpperCase()]?.[
          position
        ] || 1 / rule.eligible.length;
      demand += slots * wt;
    }
  }
  return Math.max(1, demand);
}

// ── Scoring engine (simplified from vorp.ts) ───────────────────

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736,
    a3 = 1.421413741, a4 = -1.453152027,
    a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
    t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

function calcFantasyPoints(
  stats: Record<string, number>,
  scoringRules: Record<string, number>,
  positionOverrides?: Record<string, number>,
  bonusThresholds?: Record<
    string,
    Array<{ min: number; max?: number; bonus: number }>
  >,
  gamesPlayed: number = 17
): number {
  let pts = 0;
  for (const [stat, value] of Object.entries(stats)) {
    pts += value * (scoringRules[stat] || 0);
  }
  if (positionOverrides) {
    for (const [stat, p] of Object.entries(positionOverrides)) {
      const value = stats[stat] || 0;
      pts -= value * (scoringRules[stat] || 0);
      pts += value * p;
    }
  }
  if (bonusThresholds && gamesPlayed > 0) {
    for (const [stat, thresholds] of Object.entries(
      bonusThresholds
    )) {
      const seasonTotal = stats[stat] || 0;
      const perGame = seasonTotal / gamesPlayed;
      for (const { min, max, bonus } of thresholds) {
        if (perGame < min * 0.7) continue;
        const cv = 0.3;
        const stdDev = perGame * cv;
        const zMin = (min - perGame) / stdDev;
        let prob = 1 - normalCDF(zMin);
        if (max !== undefined) {
          const zMax = (max - perGame) / stdDev;
          prob = normalCDF(zMax) - normalCDF(zMin);
        }
        pts += bonus * Math.max(0, prob * gamesPlayed);
      }
    }
  }
  return pts;
}

// ── Estimator gating ───────────────────────────────────────────

const IDP_POSITIONS = ["LB", "CB", "S", "EDR", "IL", "DB"];

function shouldGenerate(
  player: {
    position: string;
    nflTeam: string | null;
    yearsExperience: number | null;
  },
  mostRecentSeason: number,
  mostRecentGames: number,
  targetSeason: number
): { generate: boolean; discount: number } {
  const age = targetSeason - mostRecentSeason;
  if (age > 2) return { generate: false, discount: 0 };
  if (player.yearsExperience === 0)
    return { generate: false, discount: 0 };

  const isFA =
    !player.nflTeam || player.nflTeam === "FA";
  const isDef = IDP_POSITIONS.includes(player.position);
  const snapsThresh = isDef ? 400 : 200;
  const estSnaps = mostRecentGames * (isDef ? 40 : 50);
  const meetsSnaps = estSnaps >= snapsThresh;
  const meetsGames = mostRecentGames >= 8;

  if (meetsGames || meetsSnaps) {
    return { generate: true, discount: isFA ? 0.5 : 1.0 };
  }
  if (isFA) return { generate: false, discount: 0 };
  return { generate: true, discount: 0.8 };
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const posFilter = process.argv.includes("--position")
    ? process.argv[process.argv.indexOf("--position") + 1]
    : null;

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // 1. Fetch league + settings
  const allLeagues = await db.select().from(schema.leagues);
  if (allLeagues.length === 0) {
    console.error("No leagues found");
    process.exit(1);
  }
  const league = allLeagues[0];
  console.log(`League: ${league.name} (${league.totalTeams} teams)`);

  const [settings] = await db
    .select()
    .from(schema.leagueSettings)
    .where(eq(schema.leagueSettings.leagueId, league.id))
    .limit(1);

  if (!settings) {
    console.error("No league settings found");
    process.exit(1);
  }

  const bonusThresholds = (
    settings.metadata as Record<string, unknown> | null
  )?.bonusThresholds as
    | Record<
        string,
        Array<{ min: number; max?: number; bonus: number }>
      >
    | undefined;

  // 2. Fetch all active players
  const players = await db
    .select()
    .from(schema.canonicalPlayers)
    .where(eq(schema.canonicalPlayers.isActive, true));

  console.log(`Active players: ${players.length}`);

  // 3. Fetch ALL historical stats (for career games + recent scoring)
  const allHistorical = await db
    .select()
    .from(schema.historicalStats);

  // Group by player
  const histByPlayer = new Map<
    string,
    Array<{
      season: number;
      stats: Record<string, number>;
      gamesPlayed: number;
    }>
  >();
  for (const row of allHistorical) {
    const existing = histByPlayer.get(row.canonicalPlayerId) || [];
    existing.push({
      season: row.season,
      stats: row.stats as Record<string, number>,
      gamesPlayed: row.gamesPlayed || 17,
    });
    histByPlayer.set(row.canonicalPlayerId, existing);
  }

  // 4. Determine target season
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const targetSeason = month >= 9 ? year : year - 1;
  console.log(`Target season: ${targetSeason}`);

  // 5. Calculate PPG for each player
  const playerData: RankedPlayer[] = [];

  for (const player of players) {
    const history = histByPlayer.get(player.id);
    if (!history || history.length === 0) continue;

    const sorted = [...history].sort(
      (a, b) => b.season - a.season
    );

    // Find target season stats (actuals)
    const targetStats = sorted.find(
      (s) => s.season === targetSeason
    );

    let seasonPoints = 0;
    let gamesPlayed = 0;
    let dataSource = "offseason_estimate";

    if (targetStats) {
      // Use actual stats directly
      seasonPoints = calcFantasyPoints(
        targetStats.stats,
        settings.scoringRules,
        settings.positionScoringOverrides?.[
          player.position
        ] ?? undefined,
        bonusThresholds,
        targetStats.gamesPlayed
      );
      gamesPlayed = targetStats.gamesPlayed;
      dataSource = "last_season_actual";
    } else {
      // Offseason estimate from prior seasons
      const priorSeasons = sorted.filter(
        (s) => s.season < targetSeason
      );
      if (priorSeasons.length === 0) continue;

      const mostRecent = priorSeasons[0];
      const gate = shouldGenerate(
        {
          position: player.position,
          nflTeam: player.nflTeam,
          yearsExperience: player.yearsExperience,
        },
        mostRecent.season,
        mostRecent.gamesPlayed,
        targetSeason
      );
      if (!gate.generate) continue;

      // Scale to 17 games
      let projStats = { ...mostRecent.stats };
      if (
        mostRecent.gamesPlayed < 17 &&
        mostRecent.gamesPlayed > 0
      ) {
        const ratio = 17 / mostRecent.gamesPlayed;
        for (const stat of Object.keys(projStats)) {
          if (
            !stat.includes("pct") &&
            !stat.includes("rate")
          ) {
            projStats[stat] *= ratio;
          }
        }
      }

      // Age curve adjustment
      if (player.age) {
        const ageFactor = getAgeCurveMultiplier(
          player.position,
          player.age + 1
        );
        for (const stat of Object.keys(projStats)) {
          projStats[stat] *= ageFactor;
        }
      }

      // Regression to career mean (2-season blend)
      if (priorSeasons.length >= 2) {
        let weightedStats: Record<string, number> = {};
        let totalWeight = 0;
        for (
          let i = 0;
          i < Math.min(priorSeasons.length, 2);
          i++
        ) {
          const seasonAge =
            targetSeason - priorSeasons[i].season;
          const wt =
            seasonAge === 0
              ? 1.0
              : seasonAge === 1
                ? 0.5
                : 0;
          if (wt > 0) {
            totalWeight += wt;
            for (const [stat, val] of Object.entries(
              priorSeasons[i].stats
            )) {
              weightedStats[stat] =
                (weightedStats[stat] || 0) + val * wt;
            }
          }
        }
        if (totalWeight > 0) {
          for (const stat of Object.keys(weightedStats)) {
            weightedStats[stat] /= totalWeight;
          }
          for (const stat of Object.keys(projStats)) {
            const avg = weightedStats[stat] || 0;
            if (avg > 0) {
              projStats[stat] =
                projStats[stat] * 0.6 + avg * 0.4;
            }
          }
        }
      }

      if (mostRecent.gamesPlayed < 12) {
        for (const stat of Object.keys(projStats)) {
          projStats[stat] *= 0.9;
        }
      }

      seasonPoints = calcFantasyPoints(
        projStats,
        settings.scoringRules,
        settings.positionScoringOverrides?.[
          player.position
        ] ?? undefined,
        bonusThresholds
      );
      if (gate.discount < 1.0) {
        seasonPoints *= gate.discount;
      }

      // Stats were scaled to 17 games, so PPG denominator is 17
      gamesPlayed = 17;
    }

    if (seasonPoints <= 0) continue;

    // ── PPG ─────────────────────────────────────────
    const ppg =
      gamesPlayed > 0 ? seasonPoints / gamesPlayed : 0;

    // ── Career games ────────────────────────────────
    const careerGames = history.reduce(
      (sum, s) => sum + s.gamesPlayed,
      0
    );

    // ── Pedigree floor ──────────────────────────────
    const pedigreeFloor = getDraftCapitalFloor(
      player.draftRound,
      player.draftPick
    );

    let blendedPPG = ppg;
    if (
      careerGames < CAREER_GAMES_THRESHOLD &&
      pedigreeFloor > 0 &&
      ppg < pedigreeFloor
    ) {
      const weight = Math.min(
        1.0,
        careerGames / CAREER_GAMES_THRESHOLD
      );
      blendedPPG =
        ppg * weight + pedigreeFloor * (1 - weight);
    }

    // ── Dynasty premium ─────────────────────────────
    let dynastyPremium = 1.0;
    if (player.age) {
      dynastyPremium = getDynastyPremium(
        player.position,
        player.age,
        player.yearsExperience ?? undefined,
        player.draftRound ?? undefined
      );
    }

    playerData.push({
      player: {
        id: player.id,
        name: player.name,
        position: player.position,
        positionGroup: player.positionGroup,
        nflTeam: player.nflTeam,
        age: player.age,
        draftRound: player.draftRound,
        draftPick: player.draftPick,
        yearsExperience: player.yearsExperience,
      },
      seasonPoints,
      gamesPlayed,
      ppg,
      blendedPPG,
      pedigreeFloor,
      careerGames,
      rawVorp: 0, // calculated next
      zScore: 0,
      scarcityFactor: 0,
      dynastyPremium,
      finalValue: 0,
      dataSource,
    });
  }

  console.log(`Players with points: ${playerData.length}`);

  // 5b. Games-played regression: regress small-sample PPG toward position mean
  // First, calculate position mean PPG from reliable samples (8+ games)
  const reliablePPGByPosition: Record<string, number[]> = {};
  for (const pd of playerData) {
    if (pd.gamesPlayed >= MIN_GAMES_RELIABLE) {
      const pos = pd.player.position;
      if (!reliablePPGByPosition[pos])
        reliablePPGByPosition[pos] = [];
      reliablePPGByPosition[pos].push(pd.blendedPPG);
    }
  }

  const positionMeanPPG: Record<string, number> = {};
  for (const pos of Object.keys(reliablePPGByPosition)) {
    const vals = reliablePPGByPosition[pos];
    positionMeanPPG[pos] =
      vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Regress players with <8 games toward position mean
  // EXCEPTION: Don't regress players protected by pedigree floor
  for (const pd of playerData) {
    if (pd.gamesPlayed < MIN_GAMES_RELIABLE) {
      // Skip regression for players with pedigree floor protection
      // (high draft picks with limited sample are protected by draft capital)
      const hasPedigreeProtection =
        pd.pedigreeFloor > 0 &&
        pd.careerGames < CAREER_GAMES_THRESHOLD;
      if (hasPedigreeProtection) continue;

      const posMean =
        positionMeanPPG[pd.player.position] || pd.blendedPPG;
      const weight = pd.gamesPlayed / MIN_GAMES_RELIABLE;
      const regressedPPG =
        pd.blendedPPG * weight + posMean * (1 - weight);
      // Only regress if it lowers the PPG (don't boost bad players)
      if (regressedPPG < pd.blendedPPG) {
        pd.blendedPPG = regressedPPG;
      }
    }
  }

  // 6. Calculate VORP from blended PPG
  // Group blended PPG by position (sorted desc)
  const ppgByPosition: Record<string, number[]> = {};
  for (const pd of playerData) {
    const pos = pd.player.position;
    if (!ppgByPosition[pos]) ppgByPosition[pos] = [];
    ppgByPosition[pos].push(pd.blendedPPG);
  }
  for (const pos of Object.keys(ppgByPosition)) {
    ppgByPosition[pos].sort((a, b) => b - a);
  }

  // Calculate replacement PPG per position
  const replacementPPG: Record<string, number> = {};
  for (const pos of Object.keys(ppgByPosition)) {
    const repLevel = calcReplacementLevel(
      pos,
      settings.rosterPositions,
      settings.flexRules as FlexRule[],
      settings.positionMappings as
        | Record<string, string[]>
        | undefined,
      league.totalTeams,
      settings.benchSlots
    );
    const pts = ppgByPosition[pos];
    replacementPPG[pos] =
      repLevel <= pts.length ? pts[repLevel - 1] : 0;
  }

  // Assign raw VORP
  for (const pd of playerData) {
    const repPPG =
      replacementPPG[pd.player.position] || 0;
    pd.rawVorp = Math.max(0, pd.blendedPPG - repPPG);
  }

  // 7. Positional z-score with IDP variance buffer
  const vorpByPosition: Record<string, number[]> = {};
  for (const pd of playerData) {
    const pos = pd.player.position;
    if (!vorpByPosition[pos]) vorpByPosition[pos] = [];
    vorpByPosition[pos].push(pd.rawVorp);
  }

  const posStats: Record<
    string,
    { mean: number; stddev: number; rawStddev: number }
  > = {};
  for (const pos of Object.keys(vorpByPosition)) {
    const vals = vorpByPosition[pos];
    const mean =
      vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
      vals.length;
    const rawStddev = Math.sqrt(variance);

    // IDP variance buffer: add 2.0 to stddev for defensive
    // positions to prevent ultra-high z-scores
    const isIDP = IDP_POSITIONS.includes(pos);
    const stddev = Math.max(
      1.0,
      rawStddev + (isIDP ? IDP_VARIANCE_BUFFER : 0)
    );

    posStats[pos] = { mean, stddev, rawStddev };
  }

  // 7b. Scarcity ratio = leagueStarters / NFL_POOL
  // High ratio = scarce position (RB ~0.75), Low ratio = deep (IL ~0.16)
  const scarcityFactors: Record<string, number> = {};
  const posMappings = settings.positionMappings as
    | Record<string, string[]>
    | undefined;
  for (const pos of Object.keys(vorpByPosition)) {
    const leagueStarters = calcStarterDemand(
      pos,
      settings.rosterPositions,
      settings.flexRules as FlexRule[],
      posMappings,
      league.totalTeams
    );
    const nflPool = getNFLPool(pos, posMappings);
    scarcityFactors[pos] = leagueStarters / nflPool;
  }

  // 8. Final value = z-score × scarcityFactor × dynastyPremium × scale
  for (const pd of playerData) {
    const { mean, stddev } =
      posStats[pd.player.position] || {
        mean: 0,
        stddev: 1,
      };
    const rawZ =
      stddev > 0 ? (pd.rawVorp - mean) / stddev : 0;
    const sf =
      scarcityFactors[pd.player.position] || 1.0;
    pd.zScore = rawZ * sf;
    pd.scarcityFactor = sf;
    pd.finalValue =
      pd.zScore * pd.dynastyPremium * SCALE_FACTOR;
  }

  // 8b. Draft pick anchoring: 1st round pick value =
  //     average final value of top 12 rookies
  const rookies = playerData
    .filter(
      (pd) =>
        pd.player.yearsExperience !== null &&
        pd.player.yearsExperience <= 1
    )
    .sort((a, b) => b.finalValue - a.finalValue)
    .slice(0, 12);

  const firstRoundPickValue =
    rookies.length > 0
      ? rookies.reduce((sum, r) => sum + r.finalValue, 0) /
        rookies.length
      : 0;

  // Sort by final value descending
  playerData.sort((a, b) => b.finalValue - a.finalValue);

  // ── Output ──────────────────────────────────────────────────

  // Position filter
  const filtered = posFilter
    ? playerData.filter(
        (pd) =>
          pd.player.position.toUpperCase() ===
          posFilter.toUpperCase()
      )
    : playerData;

  const top = filtered.slice(0, 50);

  console.log("\n=== Hybrid Asset Model: Top 50 ===\n");
  console.log(
    [
      "#".padStart(3),
      "Name".padEnd(22),
      "Pos",
      "Age".padStart(3),
      "Rd".padStart(2),
      "Gms".padStart(4),
      "PPG".padStart(6),
      "Blend".padStart(6),
      "VORP".padStart(6),
      "Scarc".padStart(5),
      "Z*Sc".padStart(6),
      "Dyn".padStart(5),
      "Value".padStart(7),
      "Src",
    ].join(" | ")
  );
  console.log("-".repeat(120));

  top.forEach((pd, idx) => {
    const p = pd.player;
    console.log(
      [
        String(idx + 1).padStart(3),
        p.name.padEnd(22).slice(0, 22),
        p.position.padEnd(3),
        (p.age?.toString() || "-").padStart(3),
        (p.draftRound?.toString() || "-").padStart(2),
        pd.gamesPlayed.toString().padStart(4),
        pd.ppg.toFixed(1).padStart(6),
        pd.blendedPPG.toFixed(1).padStart(6),
        pd.rawVorp.toFixed(1).padStart(6),
        pd.scarcityFactor.toFixed(2).padStart(5),
        pd.zScore.toFixed(2).padStart(6),
        pd.dynastyPremium.toFixed(2).padStart(5),
        pd.finalValue.toFixed(0).padStart(7),
        pd.dataSource.slice(0, 8),
      ].join(" | ")
    );
  });

  // Show replacement levels
  console.log("\n--- Replacement PPG by Position ---");
  const posOrder = [
    "QB", "RB", "WR", "TE",
    "LB", "DL", "DB", "EDR", "IL", "CB", "S",
  ];
  for (const pos of posOrder) {
    if (replacementPPG[pos] !== undefined) {
      const count = ppgByPosition[pos]?.length || 0;
      const stats = posStats[pos];
      const sf = scarcityFactors[pos];
      const isIDP = IDP_POSITIONS.includes(pos);
      console.log(
        `  ${pos.padEnd(4)}: rep=${replacementPPG[pos].toFixed(1)} PPG, ` +
        `n=${count}, ` +
        `stddev=${stats?.rawStddev.toFixed(1)}` +
        (isIDP ? `+${IDP_VARIANCE_BUFFER}buf` : "") +
        `=${stats?.stddev.toFixed(1)}, ` +
        `scarcity=${sf?.toFixed(3)}`
      );
    }
  }

  // Draft pick anchoring
  console.log("\n--- Draft Pick Anchoring ---");
  console.log(
    `1st Round Pick Value: ${firstRoundPickValue.toFixed(0)} ` +
    `(avg of top ${rookies.length} rookies)`
  );
  if (rookies.length > 0) {
    for (const r of rookies) {
      console.log(
        `  ${r.player.name.padEnd(22)} ${r.player.position} ` +
        `R${r.player.draftRound || "?"} | ` +
        `val=${r.finalValue.toFixed(0)}`
      );
    }
  }

  // Show pedigree floor players
  console.log("\n--- Pedigree Floor Applied ---");
  const pedigreeApplied = playerData
    .filter(
      (pd) =>
        pd.careerGames < CAREER_GAMES_THRESHOLD &&
        pd.pedigreeFloor > 0 &&
        pd.ppg < pd.pedigreeFloor
    )
    .sort((a, b) => b.finalValue - a.finalValue)
    .slice(0, 15);

  if (pedigreeApplied.length === 0) {
    console.log("  (none)");
  } else {
    for (const pd of pedigreeApplied) {
      const boost = pd.blendedPPG - pd.ppg;
      console.log(
        `  ${pd.player.name.padEnd(22)} ${pd.player.position} ` +
        `R${pd.player.draftRound || "?"} | ` +
        `career=${pd.careerGames}g | ` +
        `ppg=${pd.ppg.toFixed(1)} -> blended=${pd.blendedPPG.toFixed(1)} ` +
        `(+${boost.toFixed(1)}) | ` +
        `val=${pd.finalValue.toFixed(0)}`
      );
    }
  }
}

main().catch(console.error);
