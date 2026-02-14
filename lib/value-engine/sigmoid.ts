/**
 * Sigmoid scaling for league signal computation.
 *
 * Converts a points-above-replacement delta into a 0-10000 scale
 * using a logistic sigmoid. Eliminates the hard-zero problem in
 * the old VORP pipeline — every player gets a nonzero value.
 */

/** Minimum output to prevent true-zero values. */
const FLOOR = 200;

/** Scale ceiling. */
const CEILING = 10000;

/**
 * Map a delta (projected points minus effective baseline) to
 * a value on a 0-10000 scale via logistic sigmoid.
 *
 * @param delta - Points above/below replacement baseline
 * @param steepness - Controls curve sharpness (default 0.02)
 * @returns Value between FLOOR and CEILING
 *
 * Approximate outputs at default steepness:
 *   delta=0   → 5000  (replacement level)
 *   delta=+50 → ~7300 (solid starter)
 *   delta=+100→ ~8800 (elite)
 *   delta=+150→ ~9500 (generational)
 *   delta=-50 → ~2700 (deep bench)
 *   delta=-100→ ~1200 (roster clog)
 */
export function sigmoidScale(
  delta: number,
  steepness: number = 0.02,
): number {
  // Standard logistic: 1 / (1 + e^(-k*x))  → range (0, 1)
  const raw = 1 / (1 + Math.exp(-steepness * delta));

  // Scale to (FLOOR, CEILING)
  const scaled = FLOOR + (CEILING - FLOOR) * raw;

  return Math.round(scaled);
}
