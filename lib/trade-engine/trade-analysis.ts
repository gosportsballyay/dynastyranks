/**
 * Trade Analysis Orchestrator
 *
 * Composes sub-modules to produce the full trade analysis:
 * structural fairness, market divergence, and roster impact.
 */

import type {
  PlayerAsset,
  TradeAsset,
  LeagueConfig,
  FairnessResult,
  RosterImpactResult,
} from "./types";
import { solveOptimalLineup } from "./optimal-lineup";
import { projectRosterValue } from "./roster-projection";
import { computeRosterEfficiency } from "./roster-efficiency";
import { detectTradeDivergence } from "./market-divergence";
import type { TradeDivergenceResult } from "./types";

/** Value threshold for stud premium activation (top ~30%). */
const STUD_THRESHOLD = 7000;
/** Maximum stud premium rate for a perfect-10000 asset. */
const STUD_RATE = 0.08;
/** Fallback replacement value when league stats unavailable. */
const DEFAULT_REPLACEMENT = 300;

/**
 * Compute structural fairness from asset values.
 * Runs client-side — just summing values.
 *
 * Applies a two-component consolidation adjustment:
 * 1. Waiver cost — each extra roster spot costs replacementValue
 * 2. Stud premium — elite assets on the fewer-asset side get a bonus
 *
 * @param side1Assets - Assets team 1 sends
 * @param side2Assets - Assets team 2 sends
 * @param replacementValue - League-specific waiver wire value
 * @returns Fairness verdict
 */
export function computeFairness(
  side1Assets: TradeAsset[],
  side2Assets: TradeAsset[],
  replacementValue?: number,
): FairnessResult {
  const side1Total = side1Assets.reduce((s, a) => s + a.asset.value, 0);
  const side2Total = side2Assets.reduce((s, a) => s + a.asset.value, 0);
  const delta = side1Total - side2Total;
  const maxTotal = Math.max(side1Total, side2Total, 1);
  const pctDiff = (delta / maxTotal) * 100;

  const repVal = replacementValue ?? DEFAULT_REPLACEMENT;

  // Identify which side has more/fewer assets
  const side1More = side1Assets.length > side2Assets.length;
  const side2More = side2Assets.length > side1Assets.length;
  const extraCount = Math.abs(
    side1Assets.length - side2Assets.length,
  );

  const moreSideTotal = side1More ? side1Total : side2Total;
  const fewerSideAssets = side1More ? side2Assets : side1Assets;
  const topValue = fewerSideAssets.length > 0
    ? Math.max(...fewerSideAssets.map((a) => a.asset.value))
    : 0;

  // Component 1: waiver cost for extra roster spots
  let waiverAdjustment = 0;
  for (let i = 0; i < extraCount; i++) {
    waiverAdjustment += repVal * (1 + 0.1 * i);
  }
  waiverAdjustment = Math.round(waiverAdjustment);

  // Component 2: stud premium for elite assets
  let studAdjustment = 0;
  if (topValue > STUD_THRESHOLD && extraCount > 0) {
    const studPct = (topValue - STUD_THRESHOLD)
      / (10000 - STUD_THRESHOLD);
    studAdjustment = Math.round(
      studPct * STUD_RATE * moreSideTotal,
    );
  }

  const totalAdj = waiverAdjustment + studAdjustment;

  // Apply adjustment: reduce the more-asset side's effective value
  let adjSide1 = side1Total;
  let adjSide2 = side2Total;
  if (side2More) {
    adjSide2 = side2Total - totalAdj;
  } else if (side1More) {
    adjSide1 = side1Total - totalAdj;
  }

  const adjustedDelta = adjSide1 - adjSide2;
  const adjMax = Math.max(adjSide1, adjSide2, 1);
  const adjustedPctDiff = (adjustedDelta / adjMax) * 100;

  // Verdict uses adjusted values
  let verdict: FairnessResult["verdict"] = "balanced";
  if (Math.abs(adjustedPctDiff) > 15) {
    verdict = "imbalanced";
  } else if (Math.abs(adjustedPctDiff) > 5) {
    verdict = "slight-edge";
  }

  return {
    side1Total,
    side2Total,
    delta,
    pctDiff,
    adjustedDelta: Math.round(adjustedDelta),
    adjustedPctDiff,
    totalAdjustmentValue: totalAdj,
    waiverAdjustment,
    studAdjustment,
    adjustedSide: side2More ? 2 : side1More ? 1 : null,
    verdict,
  };
}

/**
 * Analyze the full roster impact of a trade.
 * Runs server-side — needs the full roster.
 *
 * @param input - Full roster context
 * @returns Roster impact analysis
 */
export function analyzeRosterImpact(input: {
  myRoster: PlayerAsset[];
  assetsOut: TradeAsset[];
  assetsIn: TradeAsset[];
  config: LeagueConfig;
}): RosterImpactResult {
  const { myRoster, assetsOut, assetsIn, config } = input;

  // Build roster after trade
  const outPlayerIds = new Set(
    assetsOut
      .filter((a): a is { type: "player"; asset: PlayerAsset } =>
        a.type === "player",
      )
      .map((a) => a.asset.playerId),
  );

  const inPlayers = assetsIn
    .filter((a): a is { type: "player"; asset: PlayerAsset } =>
      a.type === "player",
    )
    .map((a) => a.asset);

  const rosterAfter = [
    ...myRoster.filter((p) => !outPlayerIds.has(p.playerId)),
    ...inPlayers,
  ];

  // Lineup delta
  const lineupBefore = solveOptimalLineup(myRoster, config);
  const lineupAfter = solveOptimalLineup(rosterAfter, config);
  const lineupDelta =
    lineupAfter.totalStarterPoints - lineupBefore.totalStarterPoints;

  // 1-year competitive delta
  const valueBefore1yr = projectRosterValue(myRoster, 1);
  const valueAfter1yr = projectRosterValue(rosterAfter, 1);
  const oneYearDelta = valueAfter1yr - valueBefore1yr;

  // 3-year dynasty delta
  const valueBefore3yr = projectRosterValue(myRoster, 3);
  const valueAfter3yr = projectRosterValue(rosterAfter, 3);
  const threeYearDelta = valueAfter3yr - valueBefore3yr;

  // Roster efficiency
  const efficiency = computeRosterEfficiency(
    myRoster,
    rosterAfter,
    config,
  );

  return {
    lineupDelta,
    lineupBefore,
    lineupAfter,
    oneYearDelta,
    threeYearDelta,
    efficiency,
  };
}

/**
 * Compute market divergence for a trade.
 * Re-export convenience wrapper.
 */
export function computeMarketDivergence(
  side1Assets: TradeAsset[],
  side2Assets: TradeAsset[],
): TradeDivergenceResult {
  return detectTradeDivergence(side1Assets, side2Assets);
}
