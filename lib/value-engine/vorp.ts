/**
 * VORP (Value Over Replacement Player) Calculation
 *
 * VORP measures how much better a player is than a freely available
 * replacement player at the same position. This is the core of our
 * value system.
 */

import { calculateReplacementLevel, calculateStarterDemand } from "./replacement-level";
import type { FlexRule } from "@/types";
import {
  VALID_STAT_KEYS,
  type CanonicalStatKey,
} from "@/lib/stats/canonical-keys";

interface VORPInput {
  playerPoints: number;
  position: string;
  allPlayerPoints: Record<string, number[]>; // position -> sorted points array (desc)
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  totalTeams: number;
  liquidityMultiplier?: number;
}

interface VORPResult {
  vorp: number;
  replacementPoints: number;
  replacementRank: number;
  normalizedVorp: number;
  scarcityMultiplier: number;
  rankInPosition: number;
  liquidityMultiplier: number;
}

/**
 * Calculate VORP for a single player
 */
export function calculateVORP(input: VORPInput): VORPResult {
  const {
    playerPoints,
    position,
    allPlayerPoints,
    rosterPositions,
    flexRules,
    positionMappings,
    totalTeams,
    liquidityMultiplier: liqMult = 1.0,
  } = input;

  // Get sorted points for this position
  const positionPoints = allPlayerPoints[position] || [];

  // Find player's rank in position
  const rankInPosition = positionPoints.findIndex((pts) => pts <= playerPoints) + 1 || positionPoints.length + 1;

  // Calculate replacement level
  const replacementRank = calculateReplacementLevel({
    position,
    rosterPositions,
    flexRules,
    positionMappings,
    totalTeams,
    allPlayerPoints,
  });

  // Get replacement player's points
  const replacementPoints =
    replacementRank <= positionPoints.length
      ? positionPoints[replacementRank - 1]
      : 0;

  // Raw VORP
  const rawVorp = Math.max(0, playerPoints - replacementPoints);

  // Calculate starter demand for normalization
  const starterDemand = calculateStarterDemand(
    position,
    rosterPositions,
    flexRules,
    positionMappings,
    totalTeams,
    allPlayerPoints,
  );

  // Normalize VORP by positional demand, scaled by liquidity
  const demandFactor = Math.sqrt(starterDemand);
  const normalizedVorp =
    (rawVorp / Math.max(1, demandFactor)) * liqMult;

  // Calculate scarcity multiplier
  const scarcityMultiplier = calculateScarcityMultiplier(
    rankInPosition,
    starterDemand,
    position,
    positionPoints.length
  );

  return {
    vorp: rawVorp,
    replacementPoints,
    replacementRank,
    normalizedVorp,
    scarcityMultiplier,
    rankInPosition,
    liquidityMultiplier: liqMult,
  };
}

/**
 * Calculate scarcity multiplier
 *
 * Elite players at thin positions get a boost.
 * The further above replacement, the more valuable.
 */
function calculateScarcityMultiplier(
  rankInPosition: number,
  starterDemand: number,
  position: string,
  totalPlayersAtPosition: number
): number {
  // Position depth factors - thin positions are more scarce
  const depthFactors: Record<string, number> = {
    QB: 0.8, // Deep position
    RB: 1.1, // Medium scarcity, high attrition
    WR: 0.9, // Deepest skill position
    TE: 1.15, // Scarcity boost for elite TEs (McBride ~top 15-20)
    K: 0.5, // Replaceable
    // IDP
    LB: 0.9, // Deep
    DL: 1.0, // Medium
    DB: 0.9, // Deep
    EDR: 1.1, // Thin elite tier
    IL: 0.85,
    CB: 0.9,
    S: 0.9,
  };

  const depthFactor = depthFactors[position] || 1.0;

  // Tier factor: how close to the top of the position
  // Elite players (top 25% of starters) get full boost
  const eliteThreshold = Math.max(1, starterDemand * 0.25);
  const starterThreshold = Math.max(1, starterDemand);

  let tierFactor = 0;
  if (rankInPosition <= eliteThreshold) {
    // Elite tier: full scarcity boost
    tierFactor = 1.0;
  } else if (rankInPosition <= starterThreshold) {
    // Starter tier: linear decay
    tierFactor = 1 - (rankInPosition - eliteThreshold) / (starterThreshold - eliteThreshold);
  }
  // Below replacement: no boost

  // Calculate multiplier (ranges from 1.0 to ~1.5)
  const scarcity = 1 + (0.3 * depthFactor * tierFactor);

  return scarcity;
}

/**
 * Bonus threshold definition for yardage/stat bonuses
 */
export interface BonusThreshold {
  min: number;
  max?: number;
  bonus: number;
}

/**
 * Normalized scoring rule from platform API.
 * Self-contained: each rule knows its stat, points, bonus status,
 * bounds, and which positions it applies to.
 */
export interface ScoringRule {
  statKey: string;
  points: number;
  forEvery?: number;
  isBonus: boolean;
  boundLower?: number;
  boundUpper?: number;
  applyTo?: string[];  // undefined = all positions
}

/**
 * Score a single game deterministically using structured rules.
 *
 * Each rule is self-contained: base scoring uses stat * points (or
 * floor(stat / forEvery) * points), bonus rules check per-game stat
 * against bounds. Position filtering via applyTo.
 */
export function scoreGame(
  gameStats: Record<string, number>,
  rules: ScoringRule[],
  playerPosition: string,
): number {
  let points = 0;

  for (const rule of rules) {
    if (rule.applyTo && !rule.applyTo.includes(playerPosition)) {
      continue;
    }

    const statValue = gameStats[rule.statKey] || 0;

    if (!rule.isBonus) {
      if (rule.forEvery) {
        points +=
          Math.floor(statValue / rule.forEvery) * rule.points;
      } else {
        points += statValue * rule.points;
      }
    } else {
      if (
        statValue >= (rule.boundLower ?? 0) &&
        (rule.boundUpper == null || statValue <= rule.boundUpper)
      ) {
        points += rule.points;
      }
    }
  }

  return points;
}

/**
 * Calculate points for a player given projections and scoring rules.
 * Supports bonus thresholds for yardage milestones.
 *
 * @param projections - Season-level stat projections
 * @param scoringRules - Per-stat point values
 * @param positionOverrides - Position-specific scoring overrides
 * @param bonusThresholds - Optional threshold bonuses (legacy, unused when structuredRules present)
 * @param gamesPlayed - Number of games for per-game calculation (default: 17)
 * @param gameLogs - Per-game stat breakdowns keyed by week number (for deterministic bonus scoring)
 * @param structuredRules - Normalized scoring rules from platform API
 * @param playerPosition - Player position for applyTo filtering
 */
export function calculateFantasyPoints(
  projections: Partial<Record<CanonicalStatKey, number>>,
  scoringRules: Partial<Record<CanonicalStatKey, number>>,
  positionOverrides?: Partial<Record<CanonicalStatKey, number>>,
  bonusThresholds?: Partial<
    Record<CanonicalStatKey, BonusThreshold[]>
  >,
  gamesPlayed: number = 17,
  gameLogs?: Record<number, Record<string, number>> | null,
  structuredRules?: ScoringRule[] | null,
  playerPosition?: string,
): number {
  // Path 1: gameLogs + structuredRules → deterministic per-game scoring
  if (gameLogs && structuredRules && structuredRules.length > 0) {
    let total = 0;
    for (const weekStats of Object.values(gameLogs)) {
      total += scoreGame(
        weekStats,
        structuredRules,
        playerPosition ?? "",
      );
    }
    return total;
  }

  // Path 2: structuredRules but no gameLogs → base scoring from
  // season totals, skip bonus rules (no per-game data to evaluate)
  if (structuredRules && structuredRules.length > 0) {
    const baseRules = structuredRules.filter((r) => !r.isBonus);
    const proj = projections as Record<string, number>;
    return scoreGame(proj, baseRules, playerPosition ?? "");
  }

  // Path 3: No structuredRules (Sleeper, legacy) → original logic
  // Warn on unknown scoring rule keys and skip them
  const unknownRuleKeys = Object.keys(scoringRules)
    .filter((k) => !VALID_STAT_KEYS.has(k));
  if (unknownRuleKeys.length > 0) {
    console.warn(
      `Skipping non-canonical scoring rule keys: ${unknownRuleKeys.join(", ")}`,
    );
  }

  // Warn on unknown projection stat keys and skip them
  const unknownStatKeys = Object.keys(projections)
    .filter((k) => !VALID_STAT_KEYS.has(k));
  if (unknownStatKeys.length > 0) {
    console.warn(
      `Skipping non-canonical projection stat keys: ${unknownStatKeys.join(", ")}`,
    );
  }

  let points = 0;

  // Keys are validated canonical above; cast for Object.entries iteration
  const proj = projections as Record<string, number>;
  const rules = scoringRules as Record<string, number>;

  // Apply general scoring rules
  for (const [stat, value] of Object.entries(proj)) {
    const pts = rules[stat] || 0;
    points += value * pts;
  }

  // Apply position-specific overrides
  if (positionOverrides) {
    const overrides = positionOverrides as Record<string, number>;
    for (const [stat, pts] of Object.entries(overrides)) {
      const value = proj[stat] || 0;
      // Override replaces the general rule
      const generalPts = rules[stat] || 0;
      points -= value * generalPts;
      points += value * pts;
    }
  }

  // Bonuses skipped in fallback path — deterministic scoring requires
  // per-game data which is only available via gameLogs + structuredRules.

  return points;
}

/**
 * Get the Nth percentile points for a position
 * Useful for confidence bands
 */
export function getPercentilePoints(
  positionPoints: number[],
  percentile: number
): number {
  if (positionPoints.length === 0) return 0;

  const index = Math.floor((percentile / 100) * positionPoints.length);
  return positionPoints[Math.min(index, positionPoints.length - 1)];
}
