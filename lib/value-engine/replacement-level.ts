/**
 * Replacement Level Calculator
 *
 * Calculates the replacement level threshold for each position
 * based on league settings, including flex eligibility and IDP.
 *
 * Uses projection-aware replacement: separates production scarcity
 * (who is the replacement starter?) from liquidity scarcity
 * (how hard is acquisition given roster depth?).
 */

import type { FlexRule } from "@/types";

interface ReplacementLevelInput {
  position: string;
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  totalTeams: number;
  allPlayerPoints: Record<string, number[]>;
}

/** Buffer above starter demand for byes/injuries. */
const REPLACEMENT_BUFFER = 0.15;

/**
 * Threshold for data-driven production cap.
 * Cap = rank where projectedPts < this fraction of
 * average starter projected points.
 */
const CAP_THRESHOLD = 0.65;

/**
 * Hard floor caps — minimum production cap per position.
 * Prevents caps from collapsing to unreasonably low values
 * when projection data is sparse or skewed.
 */
const MIN_PRODUCTION_CAPS: Record<string, number> = {
  QB: 16, RB: 32, WR: 40, TE: 16,
  DL: 24, LB: 32, DB: 28,
  EDR: 20, IL: 16, CB: 20, S: 20,
};

/**
 * Hard ceiling caps — absolute max regardless of projections.
 * Based on realistic NFL production supply.
 * K excluded — not tracked in pointsByPosition consistently.
 */
const MAX_PRODUCTION_CAPS: Record<string, number> = {
  QB: 36, RB: 72, WR: 100, TE: 40,
  DL: 60, LB: 90, DB: 80,
  EDR: 48, IL: 36, CB: 50, S: 45,
};

/**
 * Base depth factors per position — used when league size is unknown.
 * In small leagues (10-12 teams) these are accurate. In large leagues
 * (24-32 teams), `getDepthFactor()` adjusts dynamically.
 */
const BASE_DEPTH_FACTORS: Record<string, number> = {
  QB: 0.8,
  RB: 1.1,
  WR: 0.9,
  TE: 1.15,
  K: 0.5,
  LB: 0.9,
  DL: 1.0,
  DB: 0.9,
  EDR: 1.1,
  IL: 0.85,
  CB: 0.9,
  S: 0.9,
};

/**
 * Compute a league-size-aware depth factor for a position.
 *
 * Uses `starterDemand / productionCap` to measure how saturated the
 * position is. When nearly all viable producers are starters (ratio
 * near 1.0, e.g. QB in 32-team), the depth factor increases because
 * there is no positional depth. When the ratio is low (QB in 12-team),
 * the base factor is used unchanged.
 *
 * When no productionCap is provided, falls back to MAX_PRODUCTION_CAPS
 * which represent realistic NFL production supply per position.
 *
 * @param position - Position string
 * @param starterDemand - League-wide starter demand at position
 * @returns Depth factor (higher = scarcer position in this league)
 */
export function getDepthFactor(
  position: string,
  starterDemand?: number,
): number {
  const base = BASE_DEPTH_FACTORS[position] ?? 1.0;

  if (!starterDemand || starterDemand <= 0) return base;

  const cap = MAX_PRODUCTION_CAPS[position] ?? 50;

  // Saturation: what fraction of viable producers are starters?
  const saturation = Math.min(1.0, starterDemand / cap);

  // Below 50% saturation, use base factor (small league, deep pool).
  // Above 50%, linearly scale up toward 1.3 at full saturation.
  if (saturation <= 0.5) return base;

  const scaleFactor = (saturation - 0.5) / 0.5; // 0 at 50%, 1 at 100%
  const boost = scaleFactor * (1.3 - base);
  return base + Math.max(0, boost);
}

/** Liquidity scaling coefficients per position. K excluded. */
const LIQUIDITY_COEFFICIENTS: Record<string, number> = {
  QB: 0.05, RB: 0.15, WR: 0.08, TE: 0.12,
  DL: 0.06, LB: 0.05, DB: 0.05,
  EDR: 0.08, IL: 0.06, CB: 0.05, S: 0.05,
};

/**
 * Compute the data-driven production cap for a position.
 *
 * Finds the rank where projected points drop below
 * CAP_THRESHOLD × average starter projected points,
 * clamped between floor and ceiling caps.
 */
function computeProductionCap(
  position: string,
  allPlayerPoints: Record<string, number[]>,
  starterDemandBuffered: number,
): number {
  const floor = MIN_PRODUCTION_CAPS[position] ?? 16;
  const ceiling = MAX_PRODUCTION_CAPS[position] ?? 50;
  const pts = allPlayerPoints[position] ?? [];

  if (pts.length === 0) return floor;

  const starterCount = Math.min(
    Math.max(1, Math.round(starterDemandBuffered)),
    pts.length,
  );
  const starterAvg =
    pts.slice(0, starterCount).reduce((s, p) => s + p, 0)
    / starterCount;

  const threshold = starterAvg * CAP_THRESHOLD;
  let cap = pts.findIndex((p) => p < threshold);
  if (cap === -1) cap = pts.length;

  return Math.max(floor, Math.min(cap, ceiling));
}

/**
 * Compute the dynamic flex share for a position.
 *
 * For each flex slot the position is eligible for, allocates
 * flex demand proportionally based on surplus production above
 * direct-starter baselines. Replaces static FLEX_USAGE_WEIGHTS.
 */
function dynamicFlexShare(
  position: string,
  flexRules: FlexRule[],
  rosterPositions: Record<string, number>,
  totalTeams: number,
  allPlayerPoints: Record<string, number[]>,
): number {
  let totalShare = 0;

  for (const rule of flexRules) {
    if (!rule.eligible.includes(position)) continue;

    const flexSlots =
      (rosterPositions[rule.slot] || 0) * totalTeams;
    if (flexSlots === 0) continue;

    const surplusScores: Record<string, number> = {};
    let totalSurplus = 0;

    for (const eligPos of rule.eligible) {
      const pts = allPlayerPoints[eligPos] ?? [];
      const directDemand =
        (rosterPositions[eligPos] || 0) * totalTeams;
      const baseIdx = Math.min(
        Math.max(0, Math.floor(directDemand) - 1),
        pts.length - 1,
      );
      const baselinePts =
        pts.length > 0 ? pts[Math.max(0, baseIdx)] : 0;

      let surplus = 0;
      const startIdx = Math.round(directDemand);
      const endIdx = Math.min(pts.length, startIdx + flexSlots);
      for (let i = startIdx; i < endIdx; i++) {
        surplus += Math.max(0, pts[i] - baselinePts);
      }
      surplusScores[eligPos] = surplus;
      totalSurplus += surplus;
    }

    if (totalSurplus > 0) {
      totalShare +=
        flexSlots * (surplusScores[position] ?? 0) / totalSurplus;
    } else {
      totalShare += flexSlots / rule.eligible.length;
    }
  }

  return totalShare;
}

/**
 * Calculate the replacement level rank for a position.
 *
 * Determines which player is considered "replacement level" —
 * the Nth best player at the position, where N is calculated
 * based on:
 * 1. Direct starters (roster slots × teams)
 * 2. Dynamic flex share (projection-based allocation)
 * 3. Buffer for byes/injuries (15%)
 * 4. Production cap (data-driven ceiling)
 */
export function calculateReplacementLevel(
  input: ReplacementLevelInput,
): number {
  const {
    position,
    rosterPositions,
    flexRules,
    positionMappings,
    totalTeams,
    allPlayerPoints,
  } = input;

  // 1. Direct starters
  let directStarters =
    (rosterPositions[position] || 0) * totalTeams;

  // 2. Consolidated position mapping share
  if (positionMappings) {
    for (const [consolidatedPos, granularPositions] of
      Object.entries(positionMappings)) {
      if (granularPositions.includes(position)) {
        const consolidatedSlots =
          (rosterPositions[consolidatedPos] || 0) * totalTeams;
        directStarters +=
          consolidatedSlots / granularPositions.length;
      }
    }
  }

  // 3. Dynamic flex share
  const flexShare = dynamicFlexShare(
    position,
    flexRules,
    rosterPositions,
    totalTeams,
    allPlayerPoints,
  );

  // 4. Starter demand + buffer
  const starterDemand = directStarters + flexShare;
  const buffered = starterDemand * (1 + REPLACEMENT_BUFFER);

  // 5. Production cap
  const cap = computeProductionCap(
    position,
    allPlayerPoints,
    buffered,
  );

  return Math.max(1, Math.round(Math.min(buffered, cap)));
}

/**
 * Calculate replacement levels for all positions in a league.
 *
 * @param allPlayerPoints - Position → sorted desc points array.
 *   Pass `{}` when projections are unavailable (e.g. team-needs);
 *   flex allocation falls back to equal-split and production caps
 *   use floor values.
 */
export function calculateAllReplacementLevels(
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number,
  allPlayerPoints: Record<string, number[]>,
): Record<string, number> {
  const levels: Record<string, number> = {};

  const positions = new Set<string>();

  // Add roster positions
  for (const pos of Object.keys(rosterPositions)) {
    if (
      !["BN", "TAXI", "IR"].includes(pos)
      && !pos.includes("FLEX")
    ) {
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
    for (const granularPositions of
      Object.values(positionMappings)) {
      for (const pos of granularPositions) {
        positions.add(pos);
      }
    }
  }

  for (const position of positions) {
    levels[position] = calculateReplacementLevel({
      position,
      rosterPositions,
      flexRules,
      positionMappings,
      totalTeams,
      allPlayerPoints,
    });
  }

  return levels;
}

/**
 * Calculate effective starter demand for scarcity calculation.
 *
 * This is the number of players at a position that will start
 * in an average week. When `allPlayerPoints` is provided, uses
 * dynamic flex allocation; otherwise falls back to equal-split.
 */
export function calculateStarterDemand(
  position: string,
  rosterPositions: Record<string, number>,
  flexRules: FlexRule[],
  positionMappings: Record<string, string[]> | undefined,
  totalTeams: number,
  allPlayerPoints?: Record<string, number[]>,
): number {
  // Direct starters
  let demand = (rosterPositions[position] || 0) * totalTeams;

  // Consolidated position contribution
  if (positionMappings) {
    for (const [consolidatedPos, granularPositions] of
      Object.entries(positionMappings)) {
      if (granularPositions.includes(position)) {
        const consolidatedSlots =
          (rosterPositions[consolidatedPos] || 0) * totalTeams;
        demand += consolidatedSlots / granularPositions.length;
      }
    }
  }

  // Flex contribution
  if (
    allPlayerPoints
    && Object.keys(allPlayerPoints).length > 0
  ) {
    demand += dynamicFlexShare(
      position,
      flexRules,
      rosterPositions,
      totalTeams,
      allPlayerPoints,
    );
  } else {
    // Fallback: equal-split across eligible positions
    for (const flexRule of flexRules) {
      if (flexRule.eligible.includes(position)) {
        const flexSlots =
          (rosterPositions[flexRule.slot] || 0) * totalTeams;
        demand += flexSlots / flexRule.eligible.length;
      }
    }
  }

  return demand;
}

/**
 * Calculate liquidity multiplier for a position.
 *
 * Measures how hard it is to acquire players at a position
 * given roster depth. Higher values mean tighter markets.
 *
 * Three sub-factors:
 * - Roster saturation: rostered players / viable producers
 * - Bench/starter ratio: bench depth vs starter demand
 * - FA quality gap: drop-off from replacement to best FA
 *
 * @returns Multiplier in range [1.0, ~1.35]
 */
export function calculateLiquidityMultiplier(
  position: string,
  positionPoints: number[],
  starterDemand: number,
  benchSlots: number,
  totalTeams: number,
): number {
  const coeff = LIQUIDITY_COEFFICIENTS[position] ?? 0.05;

  if (positionPoints.length === 0 || starterDemand <= 0) {
    return 1.0;
  }

  // Roster saturation: how many players are rostered vs viable
  const rosteredCount = Math.min(
    positionPoints.length,
    Math.round(starterDemand + benchSlots),
  );
  const viableProducers = Math.max(1, positionPoints.length);
  const saturation = Math.min(
    1.0,
    rosteredCount / viableProducers,
  );

  // Bench/starter ratio
  const benchRatio = Math.min(
    1.0,
    starterDemand > 0 ? benchSlots / starterDemand : 0,
  );

  // FA quality gap
  const repIdx = Math.min(
    Math.max(0, Math.round(starterDemand) - 1),
    positionPoints.length - 1,
  );
  const replacementPts = positionPoints[repIdx];
  const faIdx = Math.min(
    Math.round(starterDemand + benchSlots),
    positionPoints.length - 1,
  );
  const bestFAPts =
    faIdx < positionPoints.length ? positionPoints[faIdx] : 0;
  const gap =
    replacementPts > 0
      ? Math.min(
          1.0,
          (replacementPts - bestFAPts) / replacementPts,
        )
      : 0;

  const liquidityFactor =
    saturation * 0.4 + benchRatio * 0.3 + gap * 0.3;

  return 1.0 + liquidityFactor * coeff * 3;
}
