/**
 * Player Types
 */

import type { PositionGroup } from "./adapters";

/**
 * Canonical player from our database
 */
export interface CanonicalPlayer {
  id: string;
  name: string;
  position: string;
  positionGroup: PositionGroup;
  nflTeam?: string;
  age?: number;
  birthdate?: string;
  rookieYear?: number;
  draftRound?: number;
  draftPick?: number;
  yearsExperience?: number;
  isActive: boolean;
  injuryStatus?: string;
  // Provider IDs
  sleeperId?: string;
  fleaflickerId?: string;
  espnId?: string;
  yahooId?: string;
  mflId?: string;
}

/**
 * Player projections (stat-based)
 */
export interface PlayerProjection {
  playerId: string;
  source: string;
  season: number;
  week?: number;
  stats: Record<string, number>;
  confidence?: {
    mean: number;
    p10: number;
    p90: number;
  };
  methodology?: string;
}

/**
 * Computed player value for a specific league
 */
export interface PlayerValue {
  playerId: string;
  leagueId: string;
  // Core metrics
  value: number;
  rank: number;
  rankInPosition: number;
  tier: number;
  // VORP breakdown
  projectedPoints: number;
  replacementPoints: number;
  vorp: number;
  normalizedVorp: number;
  // Multipliers
  scarcityMultiplier: number;
  ageCurveMultiplier: number;
  dynastyPremium: number;
  riskDiscount: number;
  // Confidence
  confidenceBand?: {
    lower: number;
    upper: number;
  };
  // Metadata
  positionGroup: PositionGroup;
  projectionSource: "in_season" | "offseason_model" | "expert_consensus";
  uncertainty: "low" | "medium" | "high";
  engineVersion: string;
  computedAt: Date;
}

/**
 * Player with value (for UI display)
 */
export interface PlayerWithValue extends CanonicalPlayer {
  value: PlayerValue;
}

/**
 * DynastyProcess player mapping row (from CSV)
 */
export interface DynastyProcessPlayer {
  name: string;
  merge_name?: string;
  position: string;
  team?: string;
  age?: number;
  birthdate?: string;
  rookie_year?: number;
  draft_round?: number;
  draft_pick?: number;
  sleeper_id?: string;
  espn_id?: string;
  yahoo_id?: string;
  fleaflicker_id?: string;
  mfl_id?: string;
  fantasypros_id?: string;
  fantasy_data_id?: string;
  pfr_id?: string;
  gsis_id?: string;
}
