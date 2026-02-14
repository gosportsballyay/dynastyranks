/**
 * Replacement Level Calculator
 *
 * Calculates the replacement level threshold for each position
 * based on league settings, including flex eligibility and IDP.
 */

import type { FlexRule } from "@/types";

interface ReplacementLevelInput {
  position: string;
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  totalTeams: number;
  benchSlots: number;
}

/**
 * Position usage weights for flex slots
 * Based on typical fantasy football usage patterns
 */
const FLEX_USAGE_WEIGHTS: Record<string, Record<string, number>> = {
  FLEX: {
    RB: 0.40,
    WR: 0.40,
    TE: 0.20,
  },
  SUPERFLEX: {
    QB: 0.80,
    RB: 0.08,
    WR: 0.08,
    TE: 0.04,
  },
  IDP_FLEX: {
    LB: 0.50,
    DL: 0.25,
    DB: 0.25,
    EDR: 0.15,
    IL: 0.10,
    CB: 0.12,
    S: 0.13,
  },
};

/**
 * Bench depth weights by position
 * How much bench depth matters for this position
 */
const BENCH_WEIGHTS: Record<string, number> = {
  // Offense
  QB: 0.5,
  RB: 1.0,
  WR: 1.0,
  TE: 0.7,
  K: 0.1,
  DST: 0.3,
  // IDP - Consolidated
  DL: 0.6,
  LB: 0.8,
  DB: 0.6,
  // IDP - Granular
  EDR: 0.5,
  IL: 0.4,
  CB: 0.5,
  S: 0.5,
};

/**
 * Calculate the replacement level rank for a position
 *
 * This determines which player is considered "replacement level" -
 * the Nth best player at the position, where N is calculated based on:
 * 1. Direct starters (roster slots × teams)
 * 2. Flex exposure (how often position fills flex slots)
 * 3. Bench depth factor
 */
export function calculateReplacementLevel(input: ReplacementLevelInput): number {
  const {
    position,
    rosterPositions,
    flexRules,
    positionMappings,
    totalTeams,
    benchSlots,
  } = input;

  // 1. Direct starters
  let directStarters = (rosterPositions[position] || 0) * totalTeams;

  // 2. Check if position can fill consolidated slots via position mappings
  if (positionMappings) {
    for (const [consolidatedPos, granularPositions] of Object.entries(
      positionMappings
    )) {
      if (granularPositions.includes(position)) {
        const consolidatedSlots =
          (rosterPositions[consolidatedPos] || 0) * totalTeams;
        // Split demand across granular positions
        directStarters += consolidatedSlots / granularPositions.length;
      }
    }
  }

  // 3. Flex demand
  let flexDemand = 0;
  for (const flexRule of flexRules) {
    if (flexRule.eligible.includes(position)) {
      const flexSlots = (rosterPositions[flexRule.slot] || 0) * totalTeams;

      // Get usage weight for this position in this flex
      const flexType = flexRule.slot.toUpperCase();
      const weights = FLEX_USAGE_WEIGHTS[flexType] || {};
      const positionWeight = weights[position] || 1 / flexRule.eligible.length;

      flexDemand += flexSlots * positionWeight;
    }
  }

  // 4. Bench depth factor
  const benchWeight = BENCH_WEIGHTS[position] || 0.5;
  const benchFactor = (benchSlots / totalTeams) * benchWeight;

  // 5. Calculate total replacement threshold
  const replacementRank = Math.round(
    directStarters + flexDemand + benchFactor
  );

  // Minimum of 1 (there's always a replacement level)
  return Math.max(1, replacementRank);
}

/**
 * Calculate replacement levels for all positions in a league
 */
export function calculateAllReplacementLevels(
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number,
  benchSlots: number
): Record<string, number> {
  const levels: Record<string, number> = {};

  // Get all positions to calculate
  const positions = new Set<string>();

  // Add roster positions
  for (const pos of Object.keys(rosterPositions)) {
    if (!["BN", "TAXI", "IR"].includes(pos) && !pos.includes("FLEX")) {
      positions.add(pos);
    }
  }

  // Add positions from flex rules
  for (const rule of flexRules) {
    for (const pos of rule.eligible) {
      positions.add(pos);
    }
  }

  // Add granular positions from mappings
  if (positionMappings) {
    for (const granularPositions of Object.values(positionMappings)) {
      for (const pos of granularPositions) {
        positions.add(pos);
      }
    }
  }

  // Calculate for each position
  for (const position of positions) {
    levels[position] = calculateReplacementLevel({
      position,
      rosterPositions,
      flexRules,
      positionMappings,
      totalTeams,
      benchSlots,
    });
  }

  return levels;
}

/**
 * Calculate effective starter demand for scarcity calculation
 * This is slightly different from replacement level - it's the number of
 * players at a position that will start in an average week
 */
export function calculateStarterDemand(
  position: string,
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number
): number {
  // Direct starters
  let demand = (rosterPositions[position] || 0) * totalTeams;

  // Consolidated position contribution
  if (positionMappings) {
    for (const [consolidatedPos, granularPositions] of Object.entries(
      positionMappings
    )) {
      if (granularPositions.includes(position)) {
        const consolidatedSlots =
          (rosterPositions[consolidatedPos] || 0) * totalTeams;
        demand += consolidatedSlots / granularPositions.length;
      }
    }
  }

  // Flex contribution
  for (const flexRule of flexRules) {
    if (flexRule.eligible.includes(position)) {
      const flexSlots = (rosterPositions[flexRule.slot] || 0) * totalTeams;
      const flexType = flexRule.slot.toUpperCase();
      const weights = FLEX_USAGE_WEIGHTS[flexType] || {};
      const positionWeight = weights[position] || 1 / flexRule.eligible.length;
      demand += flexSlots * positionWeight;
    }
  }

  return demand;
}
