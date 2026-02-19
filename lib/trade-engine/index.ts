/**
 * Trade Engine — barrel exports.
 */

export type {
  PlayerAsset,
  DraftPickAsset,
  TradeAsset,
  LeagueConfig,
  LeagueValueStats,
  LineupResult,
  DivergenceResult,
  TradeDivergenceResult,
  EfficiencyResult,
  RosterImpactResult,
  FairnessResult,
} from "./types";

export {
  computePickValue,
  computeAllPickValues,
  getLeagueValueStats,
} from "./draft-pick-values";

export { solveOptimalLineup } from "./optimal-lineup";

export {
  projectPlayerValue,
  projectRosterValue,
} from "./roster-projection";

export { computeRosterEfficiency } from "./roster-efficiency";

export {
  detectAssetDivergence,
  detectTradeDivergence,
} from "./market-divergence";

export {
  computeFairness,
  analyzeRosterImpact,
  computeMarketDivergence,
} from "./trade-analysis";
