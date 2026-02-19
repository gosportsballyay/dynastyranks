/**
 * Market Divergence Detection
 *
 * Compares league-specific structural values against
 * external consensus values to surface discrepancies.
 */

import type {
  PlayerAsset,
  DivergenceResult,
  TradeDivergenceResult,
  TradeAsset,
} from "./types";

/** Divergence threshold: >30% = significant. */
const DIVERGENCE_THRESHOLD = 0.30;

/**
 * Detect divergence between league signal and consensus for one player.
 *
 * @param asset - Player with both structural and consensus values
 * @returns Divergence analysis
 */
export function detectAssetDivergence(
  asset: PlayerAsset,
): DivergenceResult {
  const structural = asset.value;
  const consensus = asset.consensusValue ?? asset.value;

  const maxVal = Math.max(structural, consensus, 1);
  const divergencePct = Math.abs(structural - consensus) / maxVal;

  let direction: DivergenceResult["direction"] = "aligned";
  if (divergencePct > 0.05) {
    direction =
      structural > consensus ? "league-higher" : "market-higher";
  }

  return {
    playerId: asset.playerId,
    playerName: asset.playerName,
    structuralValue: structural,
    consensusValue: consensus,
    divergencePct,
    direction,
    significant: divergencePct > DIVERGENCE_THRESHOLD,
  };
}

/**
 * Detect trade-level divergence between structural and consensus.
 *
 * @param side1Assets - Assets team 1 sends away
 * @param side2Assets - Assets team 2 sends away
 * @returns Trade-level divergence summary
 */
export function detectTradeDivergence(
  side1Assets: TradeAsset[],
  side2Assets: TradeAsset[],
): TradeDivergenceResult {
  const assetDivergences: DivergenceResult[] = [];

  const side1Players = side1Assets
    .filter((a): a is { type: "player"; asset: PlayerAsset } =>
      a.type === "player",
    )
    .map((a) => a.asset);
  const side2Players = side2Assets
    .filter((a): a is { type: "player"; asset: PlayerAsset } =>
      a.type === "player",
    )
    .map((a) => a.asset);

  for (const p of [...side1Players, ...side2Players]) {
    assetDivergences.push(detectAssetDivergence(p));
  }

  const sumStructural = (assets: TradeAsset[]) =>
    assets.reduce((s, a) => s + a.asset.value, 0);
  const sumConsensus = (assets: TradeAsset[]) =>
    assets.reduce((s, a) => {
      if (a.type === "player") {
        return s + (a.asset.consensusValue ?? a.asset.value);
      }
      return s + a.asset.value;
    }, 0);

  const s1Structural = sumStructural(side1Assets);
  const s1Consensus = sumConsensus(side1Assets);
  const s2Structural = sumStructural(side2Assets);
  const s2Consensus = sumConsensus(side2Assets);

  const maxStructural = Math.max(s1Structural, s2Structural, 1);
  const maxConsensus = Math.max(s1Consensus, s2Consensus, 1);

  return {
    side1StructuralTotal: s1Structural,
    side1ConsensusTotal: s1Consensus,
    side2StructuralTotal: s2Structural,
    side2ConsensusTotal: s2Consensus,
    structuralDeltaPct:
      ((s1Structural - s2Structural) / maxStructural) * 100,
    consensusDeltaPct:
      ((s1Consensus - s2Consensus) / maxConsensus) * 100,
    assetDivergences,
  };
}
