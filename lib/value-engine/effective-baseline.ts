/**
 * Effective Baseline Calculator
 *
 * Blends starter-level and waiver-level baselines based on bench
 * depth, producing a single replacement threshold per position
 * that accounts for league roster construction.
 */

/**
 * Compute an effective baseline for a position.
 *
 * Shallow-bench leagues push the baseline toward starter quality
 * (making depth less valuable). Deep-bench leagues pull it toward
 * the waiver wire (making depth more valuable).
 *
 * @param position - Player position (for logging; unused in math)
 * @param positionPoints - Sorted desc array of projected points
 *   for all players at this position
 * @param starterDemand - Number of starter-quality slots league-wide
 * @param benchSlots - Total bench slots per team
 * @param totalTeams - Number of teams in the league
 * @returns Effective baseline projected points
 */
export function computeEffectiveBaseline(
  position: string,
  positionPoints: number[],
  starterDemand: number,
  benchSlots: number,
  totalTeams: number,
): number {
  if (positionPoints.length === 0) return 0;

  // Starter baseline: points at the starterDemand rank
  const starterIdx = Math.min(
    Math.round(starterDemand) - 1,
    positionPoints.length - 1,
  );
  const starterBaseline = positionPoints[Math.max(0, starterIdx)];

  // Waiver baseline: points at 1.5× starterDemand (deeper pool)
  const waiverIdx = Math.min(
    Math.round(starterDemand * 1.5) - 1,
    positionPoints.length - 1,
  );
  const waiverBaseline = positionPoints[Math.max(0, waiverIdx)];

  // Bench depth ratio determines blend weights
  // benchDepthRatio ~ 0 → shallow bench → starterWeight high
  // benchDepthRatio ~ 1+ → deep bench → waiverWeight high
  const benchDepthRatio = benchSlots / (totalTeams * 2);
  const starterWeight = 1 / (1 + benchDepthRatio);
  const waiverWeight = 1 - starterWeight;

  return starterBaseline * starterWeight + waiverBaseline * waiverWeight;
}
