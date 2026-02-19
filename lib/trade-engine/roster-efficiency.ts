/**
 * Roster Efficiency Scorer
 *
 * Evaluates consolidation gain/loss and positional depth
 * changes resulting from a trade.
 */

import type { PlayerAsset, LeagueConfig, EfficiencyResult } from "./types";

/**
 * Compute roster efficiency changes from a trade.
 *
 * @param rosterBefore - Roster before the trade
 * @param rosterAfter - Roster after the trade
 * @param config - League configuration
 * @returns Efficiency analysis
 */
export function computeRosterEfficiency(
  rosterBefore: PlayerAsset[],
  rosterAfter: PlayerAsset[],
  config: LeagueConfig,
): EfficiencyResult {
  const spotDelta = rosterBefore.length - rosterAfter.length;

  const thinPositions: string[] = [];

  // Check each roster position for depth
  for (const [slot, requiredCount] of Object.entries(
    config.rosterPositions,
  )) {
    if (["BN", "TAXI", "IR"].includes(slot)) continue;
    if (config.flexRules.some((r) => r.slot === slot)) continue;

    const eligible = getEligiblePositions(slot, config);
    const countBefore = rosterBefore.filter((p) =>
      eligible.has(p.position),
    ).length;
    const countAfter = rosterAfter.filter((p) =>
      eligible.has(p.position),
    ).length;

    if (countAfter < requiredCount && countAfter < countBefore) {
      thinPositions.push(slot);
    }
  }

  return {
    spotDelta,
    consolidation: spotDelta > 0,
    thinPositions,
  };
}

/**
 * Get all positions eligible for a given roster slot.
 */
function getEligiblePositions(
  slot: string,
  config: LeagueConfig,
): Set<string> {
  const eligible = new Set<string>([slot]);
  if (config.positionMappings?.[slot]) {
    for (const pos of config.positionMappings[slot]) {
      eligible.add(pos);
    }
  }
  return eligible;
}
