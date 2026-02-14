/**
 * VORP (Value Over Replacement Player) Calculation
 *
 * VORP measures how much better a player is than a freely available
 * replacement player at the same position. This is the core of our
 * value system.
 */

import { calculateReplacementLevel, calculateStarterDemand } from "./replacement-level";
import type { FlexRule } from "@/types";

interface VORPInput {
  playerPoints: number;
  position: string;
  allPlayerPoints: Record<string, number[]>; // position -> sorted points array (desc)
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  totalTeams: number;
  benchSlots: number;
}

interface VORPResult {
  vorp: number;
  replacementPoints: number;
  replacementRank: number;
  normalizedVorp: number;
  scarcityMultiplier: number;
  rankInPosition: number;
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
    benchSlots,
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
    benchSlots,
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
    totalTeams
  );

  // Normalize VORP by positional demand
  // This makes values comparable across positions
  const demandFactor = Math.sqrt(starterDemand);
  const normalizedVorp = rawVorp / Math.max(1, demandFactor);

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
    TE: 1.3, // Very thin at top
    K: 0.5, // Replaceable
    // IDP
    LB: 0.9, // Deep
    DL: 1.0, // Medium
    DB: 0.9, // Deep
    EDR: 1.2, // Thin elite tier
    IL: 1.0,
    CB: 0.95,
    S: 0.95,
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
 * Calculate points for a player given projections and scoring rules.
 * Supports bonus thresholds for yardage milestones.
 *
 * @param projections - Season-level stat projections
 * @param scoringRules - Per-stat point values
 * @param positionOverrides - Position-specific scoring overrides
 * @param bonusThresholds - Optional threshold bonuses (e.g., 300+ passing yards)
 * @param gamesPlayed - Number of games for per-game calculation (default: 17)
 */
export function calculateFantasyPoints(
  projections: Record<string, number>,
  scoringRules: Record<string, number>,
  positionOverrides?: Record<string, number>,
  bonusThresholds?: Record<string, BonusThreshold[]>,
  gamesPlayed: number = 17
): number {
  let points = 0;

  // Apply general scoring rules
  for (const [stat, value] of Object.entries(projections)) {
    const pts = scoringRules[stat] || 0;
    points += value * pts;
  }

  // Apply position-specific overrides
  if (positionOverrides) {
    for (const [stat, pts] of Object.entries(positionOverrides)) {
      const value = projections[stat] || 0;
      // Override replaces the general rule
      const generalPts = scoringRules[stat] || 0;
      points -= value * generalPts;
      points += value * pts;
    }
  }

  // Apply threshold bonuses (per-game bonuses)
  if (bonusThresholds && gamesPlayed > 0) {
    for (const [stat, thresholds] of Object.entries(bonusThresholds)) {
      const seasonTotal = projections[stat] || 0;
      const perGame = seasonTotal / gamesPlayed;

      for (const { min, max, bonus } of thresholds) {
        // Estimate how many games would hit this threshold
        // Using a simplified model: if per-game avg exceeds threshold, count games
        const gamesHittingBonus = estimateBonusGames(perGame, min, max, gamesPlayed);
        points += bonus * gamesHittingBonus;
      }
    }
  }

  return points;
}

/**
 * Estimate how many games a player hits a bonus threshold.
 * Uses a simplified variance model based on per-game average.
 *
 * @param perGameAvg - Average stat value per game
 * @param min - Minimum threshold
 * @param max - Maximum threshold (undefined = no upper bound)
 * @param totalGames - Total games in season
 */
function estimateBonusGames(
  perGameAvg: number,
  min: number,
  max: number | undefined,
  totalGames: number
): number {
  // If average is well below threshold, unlikely to hit bonus
  if (perGameAvg < min * 0.7) {
    return 0;
  }

  // If average exceeds threshold, estimate how many games hit it
  // Using coefficient of variation ~0.3 for fantasy football stats
  const cv = 0.3;
  const stdDev = perGameAvg * cv;

  // Estimate probability of exceeding min threshold (simplified normal approximation)
  const zScore = (min - perGameAvg) / stdDev;
  let probExceedsMin = 1 - normalCDF(zScore);

  // If there's a max, calculate probability of being within range
  if (max !== undefined) {
    const zScoreMax = (max - perGameAvg) / stdDev;
    const probBelowMax = normalCDF(zScoreMax);
    probExceedsMin = probBelowMax - normalCDF(zScore);
  }

  // Expected games hitting this bonus
  return Math.max(0, probExceedsMin * totalGames);
}

/**
 * Standard normal CDF approximation
 */
function normalCDF(x: number): number {
  // Approximation using error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
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
