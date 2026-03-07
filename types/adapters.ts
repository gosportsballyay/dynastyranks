/**
 * Adapter Types - Normalized data structures from fantasy providers
 */

import type { CanonicalStatKey } from "@/lib/stats/canonical-keys";

export type Provider = "sleeper" | "fleaflicker" | "espn" | "yahoo";

export type IDPStructure = "none" | "consolidated" | "granular" | "mixed";

export type PositionGroup = "offense" | "defense";

export type DataSource = "projections" | "offseason_estimate" | "last_season_actual" | "last_season_only" | "unified";

/**
 * Normalized league metadata from any provider
 */
export interface AdapterLeague {
  externalLeagueId: string;
  name: string;
  season: number;
  totalTeams: number;
  draftType: string; // "snake", "auction", "linear"
}

/**
 * Flex eligibility rule
 */
export interface FlexRule {
  slot: string; // "FLEX", "SUPER_FLEX", "IDP_FLEX", "REC_FLEX"
  eligible: string[]; // ["RB", "WR", "TE"] or ["QB", "RB", "WR", "TE"]
}

/**
 * Normalized league settings from any provider
 */
export interface AdapterSettings {
  // Scoring: {"pass_yd": 0.04, "rush_yd": 0.1, "rec": 1.0, "tackle_solo": 1.0, ...}
  scoringRules: Partial<Record<CanonicalStatKey, number>>;
  // Position-specific overrides: {"EDR": {"sack": 3.5}, "CB": {"int": 5.0}}
  positionScoringOverrides?: Record<
    string,
    Partial<Record<CanonicalStatKey, number>>
  >;
  // Roster positions: {"QB": 1, "RB": 2, "FLEX": 2, "DL": 2, ...}
  rosterPositions: Record<string, number>;
  // Flex eligibility rules
  flexRules: FlexRule[];
  // Position mappings for consolidated IDP: {"DL": ["EDR", "IL"], "DB": ["CB", "S"]}
  positionMappings?: Record<string, string[]>;
  // IDP structure detected
  idpStructure: IDPStructure;
  // Bench/taxi/IR
  benchSlots: number;
  taxiSlots: number;
  irSlots: number;
  // Additional metadata
  metadata?: Record<string, unknown>;
}

/**
 * Normalized team from any provider
 */
export interface AdapterTeam {
  externalTeamId: string;
  ownerName?: string;
  teamName?: string;
  standingRank?: number;
  totalPoints?: number;
  optimalPoints?: number;
  wins?: number;
  losses?: number;
  ties?: number;
}

/**
 * Normalized player on a roster
 */
export interface AdapterPlayer {
  externalPlayerId: string;
  teamExternalId: string;
  slotPosition?: string; // "QB1", "FLEX", "BN", "TAXI", "IR"
  playerName?: string;
  playerPosition?: string;
}

/**
 * Normalized draft pick
 */
export interface AdapterDraftPick {
  season: number;
  round: number;
  pickNumber?: number;
  projectedPickNumber?: number;
  ownerTeamExternalId: string;
  originalTeamExternalId?: string;
}

/**
 * Raw payload for audit storage
 */
export interface RawPayload {
  endpoint: string;
  requestParams?: Record<string, unknown>;
  payload: unknown;
  status: "success" | "error";
  errorMessage?: string;
  fetchedAt: Date;
}

/**
 * Validation result for league settings
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hasIdp: boolean;
  idpStructure: IDPStructure;
}

/**
 * League Provider Adapter Interface
 * All adapters must implement these methods
 */
export interface LeagueProviderAdapter {
  readonly provider: Provider;

  /**
   * Fetch all leagues for authenticated user in given season
   */
  getUserLeagues(season: number): Promise<AdapterLeague[]>;

  /**
   * Fetch and normalize league settings
   * Must handle: PPR/half-PPR, TE premium, IDP scoring, bonus scoring,
   * superflex, multiple flex types, position limits
   */
  getLeagueSettings(leagueId: string): Promise<AdapterSettings>;

  /**
   * Fetch all teams in league with standings if available
   */
  getTeams(leagueId: string): Promise<AdapterTeam[]>;

  /**
   * Fetch all rostered players across all teams
   */
  getRosters(leagueId: string): Promise<AdapterPlayer[]>;

  /**
   * Fetch traded draft picks if available
   */
  getDraftPicks(leagueId: string): Promise<AdapterDraftPick[]>;

  /**
   * Validate league settings and return warnings/errors
   */
  validateSettings(settings: AdapterSettings): ValidationResult;

  /**
   * Get all raw payloads from this session (for audit trail)
   */
  getRawPayloads(): RawPayload[];

  /**
   * Clear raw payloads after storing to database
   */
  clearRawPayloads(): void;
}

/**
 * Adapter configuration
 */
export interface AdapterConfig {
  accessToken?: string;
  username?: string; // For Sleeper (uses username, not OAuth)
  rateLimitMs?: number; // Delay between requests
  maxRetries?: number;
}
