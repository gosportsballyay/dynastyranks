/**
 * Roster Value Projection
 *
 * Projects player and roster values forward using age curves.
 * Used for 1-year competitive delta and 3-year dynasty trajectory.
 */

import { getAgeCurveMultiplier } from "@/lib/value-engine/age-curves";
import type { PlayerAsset } from "./types";

/**
 * Project a single player's value forward by N years.
 *
 * @param value - Current structural value
 * @param position - Player position
 * @param age - Current age (null defaults to 26)
 * @param yearsForward - Number of years to project
 * @returns Projected value
 */
export function projectPlayerValue(
  value: number,
  position: string,
  age: number | null,
  yearsForward: number,
): number {
  const currentAge = age ?? 26;
  const currentCurve = getAgeCurveMultiplier(position, currentAge);
  const futureCurve = getAgeCurveMultiplier(
    position,
    currentAge + yearsForward,
  );

  if (currentCurve === 0) return 0;
  return Math.round(value * (futureCurve / currentCurve));
}

/**
 * Project the total value of a roster forward by N years.
 *
 * @param roster - Array of player assets
 * @param yearsForward - Number of years to project
 * @returns Total projected roster value
 */
export function projectRosterValue(
  roster: PlayerAsset[],
  yearsForward: number,
): number {
  return roster.reduce(
    (sum, p) =>
      sum + projectPlayerValue(p.value, p.position, p.age, yearsForward),
    0,
  );
}
