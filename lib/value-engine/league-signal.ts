/**
 * League Signal Computation
 *
 * Produces a league-specific signal for a player based on projected
 * points, positional scarcity, and dynasty age modifiers. Uses
 * sigmoid scaling to avoid hard zeros.
 */

import { sigmoidScale } from "./sigmoid";

/**
 * Position depth factors — thin positions get a scarcity boost.
 * Mirrors the factors from vorp.ts calculateScarcityMultiplier.
 */
const DEPTH_FACTORS: Record<string, number> = {
  QB: 0.8,
  RB: 1.1,
  WR: 0.9,
  TE: 1.05, // Thin at elite but shouldn't outrank WR/RB
  K: 0.5,
  LB: 0.9,
  DL: 1.0,
  DB: 0.9,
  EDR: 1.1,
  IL: 0.85,
  CB: 0.9,
  S: 0.9,
};

/** Result from league signal computation. */
export interface LeagueSignalResult {
  /** Final league signal value (0-10000 scale). */
  leagueSignal: number;
  /** Points above/below effective baseline. */
  delta: number;
  /** Sigmoid-scaled delta (before scarcity/dynasty). */
  sigmoidValue: number;
  /** Scarcity multiplier applied. */
  scarcity: number;
}

/**
 * Calculate scarcity multiplier for a player at a position.
 *
 * Elite players at thin positions get a boost (1.0 – ~1.4).
 *
 * @param rankInPosition - Player's rank among their position peers
 * @param starterDemand - League-wide starter demand at position
 * @param position - Position string
 */
export function calculateScarcity(
  rankInPosition: number,
  starterDemand: number,
  position: string,
): number {
  const depthFactor = DEPTH_FACTORS[position] ?? 1.0;

  const eliteThreshold = Math.max(1, starterDemand * 0.25);
  const starterThreshold = Math.max(1, starterDemand);

  let tierFactor = 0;
  if (rankInPosition <= eliteThreshold) {
    tierFactor = 1.0;
  } else if (rankInPosition <= starterThreshold) {
    tierFactor =
      1 -
      (rankInPosition - eliteThreshold) /
        (starterThreshold - eliteThreshold);
  }

  return 1 + 0.3 * depthFactor * tierFactor;
}

/**
 * Compute the league-specific signal for a single player.
 *
 * Pipeline: delta → sigmoid → × scarcity → × dampenedDynastyMod
 *
 * @param playerPoints - Player's projected fantasy points
 * @param position - Player position
 * @param effectiveBaseline - Baseline from computeEffectiveBaseline
 * @param starterDemand - League-wide starter demand at position
 * @param dampenedDynastyMod - Dynasty modifier from getDampenedDynastyMod
 * @param positionPoints - Sorted desc points array for the position
 * @returns LeagueSignalResult with value on 0-10000 scale
 */
export function computeLeagueSignal(
  playerPoints: number,
  position: string,
  effectiveBaseline: number,
  starterDemand: number,
  dampenedDynastyMod: number,
  positionPoints: number[],
): LeagueSignalResult {
  const delta = playerPoints - effectiveBaseline;
  const sigmoidValue = sigmoidScale(delta);

  // Determine rank in position for scarcity calc
  const rankInPosition =
    positionPoints.findIndex((pts) => pts <= playerPoints) + 1 ||
    positionPoints.length + 1;

  const scarcity = calculateScarcity(
    rankInPosition,
    starterDemand,
    position,
  );

  // Apply scarcity and dynasty modifier, then rescale to 0-10000
  // The sigmoid already outputs 200-10000. Scarcity and dynasty mod
  // can push it slightly beyond; we clamp to keep it in range.
  const raw = sigmoidValue * scarcity * dampenedDynastyMod;

  // Rescale: treat max possible as ~14000 (10000 * 1.4 * 1.2)
  const maxPossible = 10000 * 1.4 * 1.2;
  const leagueSignal = Math.round(
    Math.min(10000, Math.max(1, (raw / maxPossible) * 10000)),
  );

  return { leagueSignal, delta, sigmoidValue, scarcity };
}
