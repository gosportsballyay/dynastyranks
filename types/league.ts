/**
 * League Types
 */

import type { Provider, IDPStructure, FlexRule } from "./adapters";
import type { CanonicalStatKey } from "@/lib/stats/canonical-keys";

/**
 * League from database
 */
export interface League {
  id: string;
  userId: string;
  provider: Provider;
  externalLeagueId: string;
  name: string;
  season: number;
  totalTeams: number;
  draftType?: string;
  isActive: boolean;
  lastSyncedAt?: Date;
  syncStatus: "pending" | "syncing" | "success" | "failed";
  syncError?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * League settings from database
 */
export interface LeagueSettings {
  id: string;
  leagueId: string;
  scoringRules: Partial<Record<CanonicalStatKey, number>>;
  positionScoringOverrides?: Record<
    string,
    Partial<Record<CanonicalStatKey, number>>
  >;
  rosterPositions: Record<string, number>;
  flexRules: FlexRule[];
  positionMappings?: Record<string, string[]>;
  idpStructure: IDPStructure;
  benchSlots: number;
  taxiSlots: number;
  irSlots: number;
  metadata?: Record<string, unknown>;
  version: number;
}

/**
 * Team from database
 */
export interface Team {
  id: string;
  leagueId: string;
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
 * Roster entry from database
 */
export interface RosterEntry {
  id: string;
  teamId: string;
  canonicalPlayerId?: string;
  externalPlayerId: string;
  slotPosition?: string;
  playerName?: string;
  playerPosition?: string;
}

/**
 * Draft pick from database
 */
export interface DraftPick {
  id: string;
  leagueId: string;
  ownerTeamId: string;
  originalTeamId?: string;
  season: number;
  round: number;
  pickNumber?: number;
  projectedPickNumber?: number;
  value?: number;
}

/**
 * League with all related data (for full sync)
 */
export interface LeagueWithData {
  league: League;
  settings: LeagueSettings;
  teams: Team[];
  rosters: RosterEntry[];
  draftPicks: DraftPick[];
}

/**
 * League sync request
 */
export interface LeagueSyncRequest {
  provider: Provider;
  externalLeagueId: string;
  season: number;
  accessToken?: string;
  username?: string;
}

/**
 * League sync result
 */
export interface LeagueSyncResult {
  success: boolean;
  leagueId?: string;
  error?: string;
  warnings?: string[];
  playersMapped: number;
  playersUnmapped: number;
  durationMs: number;
}
