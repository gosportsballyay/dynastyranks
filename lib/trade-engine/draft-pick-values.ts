/**
 * Draft Pick Valuation Engine
 *
 * Values draft picks on the same 0–10000 scale as players.
 * Two-tier model:
 *   Rounds 1-4: Expected value based on hit rates
 *   Rounds 5+: Roster spot premium with decay
 */

import type { LeagueValueStats } from "./types";

/**
 * Anchor points for continuous hit-rate interpolation.
 * Each entry is [overallPick, hitRate]. Values between anchors
 * are linearly interpolated, giving every pick a unique value
 * regardless of league size.
 */
const HIT_RATE_ANCHORS: Array<[number, number]> = [
  [1, 0.75],
  [4, 0.65],
  [8, 0.55],
  [12, 0.45],
  [18, 0.35],
  [24, 0.28],
  [36, 0.20],
  [48, 0.14],
  [60, 0.10],
  [72, 0.07],
];

/** Late-round decay factors for roster-spot premium model. */
const LATE_ROUND_DECAY: Record<number, number> = {
  5: 0.60,
  6: 0.35,
  7: 0.20,
};
const DEFAULT_LATE_DECAY = 0.10;

/** Rookie dynasty premium — youth at ~22 years old. */
const ROOKIE_DYNASTY_PREMIUM = 1.15;

/** Future discount per year: 0.90^yearsOut. */
const FUTURE_DISCOUNT_BASE = 0.90;

/** Rounds 1-4 use the expected-value model. */
const EXPECTED_VALUE_MAX_ROUND = 4;

/**
 * Get the hit rate for a given overall pick number via linear
 * interpolation between anchor points. Every pick gets a unique
 * value that smoothly decays — no step-function plateaus.
 *
 * @param overallPick - The overall pick number (1-based)
 * @returns Hit rate probability (0-1)
 */
function getHitRate(overallPick: number): number {
  const anchors = HIT_RATE_ANCHORS;
  if (overallPick <= anchors[0][0]) return anchors[0][1];

  for (let i = 1; i < anchors.length; i++) {
    const [prevPick, prevRate] = anchors[i - 1];
    const [currPick, currRate] = anchors[i];
    if (overallPick <= currPick) {
      const t = (overallPick - prevPick) / (currPick - prevPick);
      return prevRate + t * (currRate - prevRate);
    }
  }

  // Beyond last anchor: gentle linear decay, floor at 0.02
  const [lastPick, lastRate] = anchors[anchors.length - 1];
  const decay = (overallPick - lastPick) * 0.001;
  return Math.max(0.02, lastRate - decay);
}

/**
 * Convert a round + slot position into an overall pick number.
 *
 * @param round - Draft round (1-based)
 * @param slotInRound - Position within the round (1-based)
 * @param totalTeams - Number of teams in the league
 * @returns Estimated overall pick number
 */
function toOverallPick(
  round: number,
  slotInRound: number,
  totalTeams: number,
): number {
  return (round - 1) * totalTeams + slotInRound;
}

/**
 * Compute the value of a single draft pick.
 *
 * @param round - Draft round (1-based)
 * @param slotInRound - Position within the round (1-based)
 * @param totalTeams - Number of teams in the league
 * @param stats - League-wide value statistics
 * @param yearsOut - Years until the pick conveys (0 = this year)
 * @returns Pick value on the 0–10000 scale
 */
export function computePickValue(
  round: number,
  slotInRound: number,
  totalTeams: number,
  stats: LeagueValueStats,
  yearsOut: number,
): number {
  const futureDiscount = Math.pow(FUTURE_DISCOUNT_BASE, yearsOut);

  if (round <= EXPECTED_VALUE_MAX_ROUND) {
    const overallPick = toOverallPick(round, slotInRound, totalTeams);
    const hitRate = getHitRate(overallPick);
    const rawValue =
      hitRate * stats.avgStarterValue +
      (1 - hitRate) * stats.replacementValue;
    return Math.round(rawValue * ROOKIE_DYNASTY_PREMIUM * futureDiscount);
  }

  // Rounds 5+: roster spot premium model
  const rosterSpotPremium = Math.max(
    0,
    stats.avgBenchValue - stats.replacementValue,
  );
  const decayFactor = LATE_ROUND_DECAY[round] ?? DEFAULT_LATE_DECAY;
  return Math.round(
    rosterSpotPremium *
      decayFactor *
      ROOKIE_DYNASTY_PREMIUM *
      futureDiscount,
  );
}

/**
 * Derive league-wide value statistics from all player values.
 *
 * @param playerValues - Array of {value, rank} for all league players
 * @returns Stats needed for pick valuation
 */
export function getLeagueValueStats(
  playerValues: Array<{ value: number; rank: number }>,
): LeagueValueStats {
  if (playerValues.length === 0) {
    return {
      avgStarterValue: 5000,
      avgBenchValue: 1500,
      replacementValue: 500,
    };
  }

  const sorted = [...playerValues].sort((a, b) => a.rank - b.rank);

  // Top 24 players = starters (top-2 at ~12 positions)
  const starterCount = Math.min(24, sorted.length);
  const starters = sorted.slice(0, starterCount);
  const avgStarterValue =
    starters.reduce((s, p) => s + p.value, 0) / starters.length;

  // 50th–75th percentile = solid bench
  const p50 = Math.floor(sorted.length * 0.5);
  const p75 = Math.floor(sorted.length * 0.75);
  const benchSlice = sorted.slice(p50, Math.max(p75, p50 + 1));
  const avgBenchValue =
    benchSlice.reduce((s, p) => s + p.value, 0) / benchSlice.length;

  // Bottom 20% = replacement level
  const p80 = Math.floor(sorted.length * 0.8);
  const replacementSlice = sorted.slice(p80);
  const replacementValue = replacementSlice.length > 0
    ? replacementSlice.reduce((s, p) => s + p.value, 0) /
        replacementSlice.length
    : 0;

  return { avgStarterValue, avgBenchValue, replacementValue };
}

/**
 * Compute values for all draft picks in a set.
 *
 * @param picks - Draft picks to value
 * @param leaguePlayerValues - All player values in the league
 * @param currentSeason - The current season year
 * @param totalTeams - Number of teams in the league
 * @returns Map from pickId to computed value
 */
export function computeAllPickValues(
  picks: Array<{
    id: string;
    season: number;
    round: number;
    pickNumber: number | null;
    projectedPickNumber: number | null;
  }>,
  leaguePlayerValues: Array<{ value: number; rank: number }>,
  currentSeason: number,
  totalTeams: number,
): Map<string, number> {
  const stats = getLeagueValueStats(leaguePlayerValues);
  const result = new Map<string, number>();

  for (const pick of picks) {
    const slotInRound =
      pick.projectedPickNumber ??
      pick.pickNumber ??
      Math.ceil(totalTeams / 2);
    const yearsOut = Math.max(0, pick.season - currentSeason);
    const value = computePickValue(
      pick.round,
      slotInRound,
      totalTeams,
      stats,
      yearsOut,
    );
    result.set(pick.id, value);
  }

  return result;
}
