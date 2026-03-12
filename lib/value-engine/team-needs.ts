/**
 * Team Needs V2 Engine
 *
 * Computes positional needs and surplus for a team using a single
 * signed PositionStrengthDelta per position. The sign of the starter
 * score determines whether a position is a need or surplus — depth
 * modifies magnitude but cannot flip the sign.
 *
 * Pure functions — no DB access.
 */

/** Per-position input for the needs calculator. */
export interface TeamNeedInput {
  /** All players at this position across the league, sorted desc. */
  leaguePlayers: Array<{ value: number }>;
  /** This team's players at this position, sorted desc. */
  teamPlayers: Array<{ value: number }>;
  /** Per-team starter demand (fractional, includes flex share). */
  starterDemand: number;
  /** Replacement-level rank for this position in the league. */
  replacementRank: number;
}

/**
 * Unified position strength result.
 *
 * Used for both needs (negative delta) and surplus (positive delta).
 * The `score` field is always positive (absolute magnitude after
 * scarcity/leverage weighting).
 */
export interface PositionStrength {
  position: string;
  /** Absolute score after scarcity/leverage (always positive). */
  score: number;
  /** Signed starter-level delta before depth/scarcity. */
  starterScore: number;
  /** Depth contribution to magnitude (always >= 0). */
  depthModifier: number;
  /** Number of depth players with value > repValue. */
  tradeableDepthCount: number;
  /** Sum of (d.value - repValue) for above-rep depth players. */
  tradeableDepthValue: number;
}

/** Team competitive tier classification. */
export type TeamTier = "contender" | "middling" | "rebuilder";

/** Full result from the team-needs engine. */
export interface TeamNeedsResult {
  needs: PositionStrength[];
  surplus: PositionStrength[];
  /** Positions above replacement but below contender baseline. Set by computeUpgradeTargets(). */
  upgradeTargets: PositionStrength[];
  /**
   * Sum of per-position starterScore across all positions.
   * Raw delta vs replacement — no scarcity/leverage/depth applied.
   */
  teamCompetitiveScore: number;
  /** Percentile rank within the league (0–100). Set by classifyTeams(). */
  teamCompetitivePercentile: number | null;
  /** Tier classification. Set by classifyTeams(). */
  teamTier: TeamTier | null;
  /** Per-position starterScore (pre-scarcity/leverage). Used by computeUpgradeTargets(). */
  positionStarterScores: Record<string, number>;
  /** All surplus-side entries before top-3 truncation. Used by computeUpgradeTargets(). */
  _allSurplusEntries: PositionStrength[];
}

/** Weight applied to bench depth modifier. */
const DEPTH_WEIGHT = 0.25;

/** Max positions returned in each list. */
const MAX_RESULTS = 3;

import { getDepthFactor } from "./replacement-level";

/**
 * Default depth factors — used when no scarcityFactors override
 * is provided. Uses the dynamic `getDepthFactor()` which accounts
 * for league size when starterDemand/productionCap are available.
 */
const DEPTH_FACTORS: Record<string, number> = {
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
 * Compute positional needs and surplus for one team.
 *
 * Uses a single signed delta per position so that a position can
 * never appear in both needs and surplus.
 *
 * @param positionInputs - Keyed by position string (QB, RB, etc.)
 * @param scarcityFactors - Optional override for depth factors.
 *   Falls back to built-in DEPTH_FACTORS.
 * @returns Top 3 needs and top 3 surplus positions (score > 0 only).
 */
export function computeTeamNeeds(
  positionInputs: Record<string, TeamNeedInput>,
  scarcityFactors?: Record<string, number>,
): TeamNeedsResult {
  const factors = scarcityFactors ?? DEPTH_FACTORS;

  // Max starterDemand across positions for leverage normalisation
  let maxDemand = 0;
  for (const input of Object.values(positionInputs)) {
    if (input.starterDemand > maxDemand) {
      maxDemand = input.starterDemand;
    }
  }
  if (maxDemand === 0) maxDemand = 1;

  const rawNeeds: PositionStrength[] = [];
  const rawSurplus: PositionStrength[] = [];
  let teamCompetitiveScore = 0;
  const positionStarterScores: Record<string, number> = {};

  for (const [position, input] of Object.entries(positionInputs)) {
    const { leaguePlayers, teamPlayers, starterDemand, replacementRank } =
      input;

    // Replacement value: Nth-ranked league player
    const repValue =
      replacementRank <= leaguePlayers.length
        ? leaguePlayers[replacementRank - 1].value
        : 0;

    const starterSlots = Math.ceil(starterDemand);
    const scarcityWeight = factors[position] ?? 1.0;
    const leverageWeight = starterDemand / maxDemand;

    // Split roster into starters and depth
    const starters = teamPlayers.slice(0, starterSlots);
    const depth = teamPlayers.slice(starterSlots);

    // Signed starter score: Σ (starterValue - repValue)
    let starterScore = 0;
    for (let i = 0; i < starterSlots; i++) {
      const playerVal = starters[i]?.value ?? 0;
      starterScore += playerVal - repValue;
    }

    // Accumulate raw starter advantage for team classification
    teamCompetitiveScore += starterScore;
    positionStarterScores[position] = starterScore;

    // Depth components (always >= 0)
    let depthPenalty = 0;
    let depthBonus = 0;
    let tradeableDepthCount = 0;
    let tradeableDepthValue = 0;

    for (const p of depth) {
      const gap = p.value - repValue;
      if (gap < 0) {
        depthPenalty += Math.abs(gap) * DEPTH_WEIGHT;
      } else if (gap > 0) {
        depthBonus += gap * DEPTH_WEIGHT;
        tradeableDepthCount++;
        tradeableDepthValue += gap;
      }
    }

    // Determine rawDelta: sign from starterScore, depth modifies magnitude
    let rawDelta: number;
    let depthModifier: number;

    if (starterScore < 0) {
      depthModifier = depthPenalty;
      rawDelta = starterScore - depthPenalty;
    } else if (starterScore > 0) {
      depthModifier = depthBonus;
      rawDelta = starterScore + depthBonus;
    } else {
      // starterScore == 0: depth breaks the tie
      if (depthPenalty > 0) {
        depthModifier = depthPenalty;
        rawDelta = -depthPenalty;
      } else if (depthBonus > 0) {
        depthModifier = depthBonus;
        rawDelta = depthBonus;
      } else {
        depthModifier = 0;
        rawDelta = 0;
      }
    }

    if (rawDelta === 0) continue;

    const score =
      Math.abs(rawDelta) * scarcityWeight * leverageWeight;

    const entry: PositionStrength = {
      position,
      score,
      starterScore,
      depthModifier,
      tradeableDepthCount,
      tradeableDepthValue,
    };

    if (rawDelta < 0) {
      rawNeeds.push(entry);
    } else {
      rawSurplus.push(entry);
    }
  }

  rawNeeds.sort((a, b) => b.score - a.score);
  rawSurplus.sort((a, b) => b.score - a.score);

  return {
    needs: rawNeeds.slice(0, MAX_RESULTS),
    surplus: rawSurplus.slice(0, MAX_RESULTS),
    upgradeTargets: [],
    teamCompetitiveScore,
    teamCompetitivePercentile: null,
    teamTier: null,
    positionStarterScores,
    _allSurplusEntries: rawSurplus,
  };
}

/** Contender/Rebuilder percentile thresholds. */
const CONTENDER_THRESHOLD = 70; // top 30%
const REBUILDER_THRESHOLD = 30; // bottom 30%

/**
 * Classify teams by competitive tier using teamCompetitiveScore.
 *
 * Ranks all results descending by score, computes percentile (0–100),
 * and assigns a tier. Mutates the input results in place.
 *
 * @param results - Array of TeamNeedsResult from computeTeamNeeds().
 *   Each entry's teamCompetitivePercentile and teamTier are set.
 */
export function classifyTeams(results: TeamNeedsResult[]): void {
  if (results.length === 0) return;

  // Sort indices by teamCompetitiveScore descending
  const indexed = results.map((r, i) => ({ i, score: r.teamCompetitiveScore }));
  indexed.sort((a, b) => b.score - a.score);

  for (let rank = 0; rank < indexed.length; rank++) {
    const entry = indexed[rank];
    // Percentile: 100 = best, 0 = worst
    const percentile =
      results.length === 1
        ? 50
        : ((results.length - 1 - rank) / (results.length - 1)) * 100;

    const result = results[entry.i];
    result.teamCompetitivePercentile = Math.round(percentile);
    result.teamTier =
      percentile >= CONTENDER_THRESHOLD
        ? "contender"
        : percentile <= REBUILDER_THRESHOLD
          ? "rebuilder"
          : "middling";
  }
}

/**
 * Compute the median of a sorted (ascending) number array.
 */
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Split surplus entries into upgrade targets and true surplus
 * using contender-level baselines.
 *
 * Must be called AFTER classifyTeams() so that teamTier is set.
 * Mutates each result's `surplus` and `upgradeTargets` arrays.
 *
 * For each position, the contenderBaseline is the median starterScore
 * among contender teams. Positions where a team's starterScore is
 * >= 0 but below that baseline become upgrade targets instead of
 * surplus. Needs (starterScore < 0) are never touched.
 *
 * @param results - Array of TeamNeedsResult with teamTier already set.
 */
export function computeUpgradeTargets(results: TeamNeedsResult[]): void {
  // 1. Identify contender results
  const contenders = results.filter((r) => r.teamTier === "contender");

  // 2. Compute contenderBaseline per position
  const baselines: Record<string, number> = {};

  if (contenders.length > 0) {
    // Collect all positions across contenders
    const positionScores: Record<string, number[]> = {};
    for (const c of contenders) {
      for (const [pos, score] of Object.entries(c.positionStarterScores)) {
        if (!positionScores[pos]) positionScores[pos] = [];
        positionScores[pos].push(score);
      }
    }

    for (const [pos, scores] of Object.entries(positionScores)) {
      scores.sort((a, b) => a - b);
      baselines[pos] = median(scores);
    }
  }

  // 3. For each team, reclassify surplus entries
  for (const result of results) {
    const upgrades: PositionStrength[] = [];
    const trueSurplus: PositionStrength[] = [];

    for (const entry of result._allSurplusEntries) {
      const baseline = baselines[entry.position] ?? 0;

      if (entry.starterScore < baseline) {
        upgrades.push(entry);
      } else {
        trueSurplus.push(entry);
      }
    }

    upgrades.sort((a, b) => b.score - a.score);
    trueSurplus.sort((a, b) => b.score - a.score);

    result.upgradeTargets = upgrades.slice(0, MAX_RESULTS);
    result.surplus = trueSurplus.slice(0, MAX_RESULTS);
  }
}
