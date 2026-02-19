/**
 * Optimal Lineup Solver
 *
 * Greedy assignment algorithm with flex deferral.
 * Fills dedicated position slots first, then flex slots
 * from remaining players — this produces optimal results
 * because flex slots have strictly wider eligibility.
 */

import type { PlayerAsset, LeagueConfig, LineupResult } from "./types";

/**
 * Solve the optimal starting lineup given a roster and config.
 *
 * @param roster - All players on the roster
 * @param config - League configuration (roster slots, flex rules, mappings)
 * @returns Optimal lineup with starters, bench, and total projected points
 */
export function solveOptimalLineup(
  roster: PlayerAsset[],
  config: LeagueConfig,
): LineupResult {
  const assigned = new Set<string>();
  const starters: Array<{ slot: string; player: PlayerAsset }> = [];

  // Sort all players by projectedPoints descending
  const sorted = [...roster].sort(
    (a, b) => b.projectedPoints - a.projectedPoints,
  );

  // Build the set of positions that map to each slot
  const slotEligibility = buildSlotEligibility(config);

  // Phase 1: Fill dedicated (non-flex) slots
  const dedicatedSlots = getDedicatedSlots(config);

  for (const { slot, count } of dedicatedSlots) {
    const eligible = slotEligibility.get(slot) ?? new Set([slot]);
    let filled = 0;

    for (const player of sorted) {
      if (filled >= count) break;
      if (assigned.has(player.playerId)) continue;
      if (eligible.has(player.position)) {
        starters.push({ slot, player });
        assigned.add(player.playerId);
        filled++;
      }
    }
  }

  // Phase 2: Fill flex slots from remaining players
  for (const flexRule of config.flexRules) {
    const flexCount = config.rosterPositions[flexRule.slot] ?? 0;
    const eligiblePositions = new Set(flexRule.eligible);

    // Expand eligible via position mappings
    if (config.positionMappings) {
      for (const pos of flexRule.eligible) {
        const mapped = config.positionMappings[pos];
        if (mapped) {
          for (const mp of mapped) eligiblePositions.add(mp);
        }
      }
    }

    let filled = 0;
    for (const player of sorted) {
      if (filled >= flexCount) break;
      if (assigned.has(player.playerId)) continue;
      if (eligiblePositions.has(player.position)) {
        starters.push({ slot: flexRule.slot, player });
        assigned.add(player.playerId);
        filled++;
      }
    }
  }

  const bench = sorted.filter((p) => !assigned.has(p.playerId));
  const totalStarterPoints = starters.reduce(
    (sum, s) => sum + s.player.projectedPoints,
    0,
  );

  return { starters, bench, totalStarterPoints };
}

/**
 * Build a map of slot -> set of positions eligible for that slot,
 * expanding position mappings (e.g. DL -> [EDR, IL]).
 */
function buildSlotEligibility(
  config: LeagueConfig,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const slot of Object.keys(config.rosterPositions)) {
    // Skip meta-slots
    if (["BN", "TAXI", "IR"].includes(slot)) continue;
    // Skip flex slots (handled in phase 2)
    const isFlexSlot = config.flexRules.some((r) => r.slot === slot);
    if (isFlexSlot) continue;

    const eligible = new Set<string>([slot]);

    // Check if this slot is a consolidated position (e.g. DL)
    if (config.positionMappings?.[slot]) {
      for (const pos of config.positionMappings[slot]) {
        eligible.add(pos);
      }
    }

    map.set(slot, eligible);
  }

  return map;
}

/**
 * Get dedicated (non-flex, non-bench) slots sorted by
 * eligibility width (narrowest first for optimal assignment).
 */
function getDedicatedSlots(
  config: LeagueConfig,
): Array<{ slot: string; count: number }> {
  const slots: Array<{ slot: string; count: number; width: number }> = [];

  for (const [slot, count] of Object.entries(config.rosterPositions)) {
    if (count <= 0) continue;
    if (["BN", "TAXI", "IR"].includes(slot)) continue;
    const isFlexSlot = config.flexRules.some((r) => r.slot === slot);
    if (isFlexSlot) continue;

    // Width = number of eligible positions (for sort priority)
    let width = 1;
    if (config.positionMappings?.[slot]) {
      width += config.positionMappings[slot].length;
    }

    slots.push({ slot, count, width });
  }

  // Sort narrowest first for optimal greedy assignment
  return slots.sort((a, b) => a.width - b.width);
}
