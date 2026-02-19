/**
 * Trade Engine Types
 *
 * Shared types for the league-specific trade calculator.
 * All values are on the 0–10000 scale from player_values.
 */

import type { FlexRule } from "@/types";

/** League configuration needed by the trade engine. */
export interface LeagueConfig {
  totalTeams: number;
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  benchSlots: number;
  taxiSlots: number;
  irSlots: number;
}

/** A player asset in a trade with all engine-relevant fields. */
export interface PlayerAsset {
  playerId: string;
  playerName: string;
  position: string;
  positionGroup: "offense" | "defense";
  age: number | null;
  nflTeam: string | null;
  /** League-specific structural value (0–10000). */
  value: number;
  projectedPoints: number;
  /** Market consensus value (0–10000). */
  consensusValue: number | null;
  consensusComponent: number | null;
  leagueSignalComponent: number | null;
  rank: number;
  rankInPosition: number;
  tier: number;
  scarcityMultiplier: number;
  ageCurveMultiplier: number;
  dynastyPremium: number;
}

/** A draft pick asset in a trade. */
export interface DraftPickAsset {
  pickId: string;
  season: number;
  round: number;
  pickNumber: number | null;
  projectedPickNumber: number | null;
  originalTeamId: string | null;
  originalTeamName: string | null;
  ownerTeamId: string;
  /** Computed value on the same 0–10000 scale. */
  value: number;
  /** Pre-computed value at top-25% slot (when pick position unknown). */
  earlyValue?: number;
  /** Pre-computed value at midpoint slot (when pick position unknown). */
  midValue?: number;
  /** Pre-computed value at bottom-25% slot (when pick position unknown). */
  lateValue?: number;
  /** Original value based on projected pick position (before E/M/L override). */
  projectedValue?: number;
}

/** Union of tradeable assets. */
export type TradeAsset =
  | { type: "player"; asset: PlayerAsset }
  | { type: "pick"; asset: DraftPickAsset };

/** Stats derived from league-wide player values. */
export interface LeagueValueStats {
  avgStarterValue: number;
  avgBenchValue: number;
  replacementValue: number;
}

/** Result of the optimal lineup solver. */
export interface LineupResult {
  starters: Array<{
    slot: string;
    player: PlayerAsset;
  }>;
  bench: PlayerAsset[];
  totalStarterPoints: number;
}

/** Per-asset divergence between league signal and consensus. */
export interface DivergenceResult {
  playerId: string;
  playerName: string;
  structuralValue: number;
  consensusValue: number;
  divergencePct: number;
  direction: "league-higher" | "market-higher" | "aligned";
  significant: boolean;
}

/** Trade-level divergence summary. */
export interface TradeDivergenceResult {
  side1StructuralTotal: number;
  side1ConsensusTotal: number;
  side2StructuralTotal: number;
  side2ConsensusTotal: number;
  structuralDeltaPct: number;
  consensusDeltaPct: number;
  assetDivergences: DivergenceResult[];
}

/** Roster efficiency analysis. */
export interface EfficiencyResult {
  spotDelta: number;
  consolidation: boolean;
  thinPositions: string[];
}

/** Full roster impact analysis (server-side). */
export interface RosterImpactResult {
  lineupDelta: number;
  lineupBefore: LineupResult;
  lineupAfter: LineupResult;
  oneYearDelta: number;
  threeYearDelta: number;
  efficiency: EfficiencyResult;
}

/** Structural fairness summary (client-side). */
export interface FairnessResult {
  side1Total: number;
  side2Total: number;
  delta: number;
  pctDiff: number;
  /** Adjusted delta after waiver + stud premium adjustments. */
  adjustedDelta: number;
  /** Adjusted percentage difference. */
  adjustedPctDiff: number;
  /** Total absolute value adjustment applied. */
  totalAdjustmentValue: number;
  /** Roster-spot cost component (waiver wire value). */
  waiverAdjustment: number;
  /** Stud premium component for elite assets. */
  studAdjustment: number;
  /** Which side the adjustment is subtracted from (1 or 2), null if none. */
  adjustedSide: 1 | 2 | null;
  verdict: "balanced" | "slight-edge" | "imbalanced";
}
