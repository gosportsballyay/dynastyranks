import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  real,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { CanonicalStatKey } from "@/lib/stats/canonical-keys";

/**
 * Enums
 */
export const providerEnum = pgEnum("provider", [
  "sleeper",
  "fleaflicker",
  "espn",
  "yahoo",
]);

export const idpStructureEnum = pgEnum("idp_structure", [
  "none",
  "consolidated",
  "granular",
  "mixed",
]);

export const positionGroupEnum = pgEnum("position_group", ["offense", "defense"]);

export const projectionSourceEnum = pgEnum("projection_source", [
  "in_season",
  "offseason_model",
  "expert_consensus",
  "unified_blend",
]);

export const uncertaintyEnum = pgEnum("uncertainty", ["low", "medium", "high"]);

export const dataSourceEnum = pgEnum("data_source", [
  "projections",
  "offseason_estimate",
  "last_season_actual",
  "last_season_only",
  "unified",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "pending",
  "syncing",
  "success",
  "failed",
]);

/**
 * Users & Authentication
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
});

export const userTokens = pgTable(
  "user_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    scope: varchar("scope", { length: 255 }),
    providerUserId: varchar("provider_user_id", { length: 255 }),
    providerUsername: varchar("provider_username", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userProviderIdx: uniqueIndex("user_provider_idx").on(
      table.userId,
      table.provider
    ),
  })
);

/**
 * Leagues
 */
export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    externalLeagueId: varchar("external_league_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    season: integer("season").notNull(),
    totalTeams: integer("total_teams").notNull(),
    draftType: varchar("draft_type", { length: 50 }),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    syncStatus: syncStatusEnum("sync_status").default("pending").notNull(),
    syncError: text("sync_error"),
    // User's selected team in this league (for "My Team" page)
    userTeamId: uuid("user_team_id"),
    // Computation metadata
    lastComputedAt: timestamp("last_computed_at"),
    leagueConfigHash: varchar("league_config_hash", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userLeagueIdx: index("user_league_idx").on(table.userId),
    providerLeagueIdx: uniqueIndex("provider_league_idx").on(
      table.userId,
      table.provider,
      table.externalLeagueId,
      table.season
    ),
  })
);

export const leagueSettings = pgTable("league_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  leagueId: uuid("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" })
    .unique(),
  // Scoring rules: {"pass_yd": 0.04, "rush_yd": 0.1, "rec": 1.0, ...}
  scoringRules: jsonb("scoring_rules").notNull().$type<
    Partial<Record<CanonicalStatKey, number>>
  >(),
  // Position-specific scoring overrides: {"EDR": {"sack": 3.5}, "CB": {"int": 5.0}}
  positionScoringOverrides: jsonb("position_scoring_overrides").$type<
    Record<string, Partial<Record<CanonicalStatKey, number>>>
  >(),
  // Roster positions: {"QB": 1, "RB": 2, "FLEX": 2, "DL": 2, "LB": 3, ...}
  rosterPositions: jsonb("roster_positions").notNull().$type<Record<string, number>>(),
  // Flex eligibility: [{"slot": "FLEX", "eligible": ["RB", "WR", "TE"]}, ...]
  flexRules: jsonb("flex_rules").notNull().$type<
    Array<{ slot: string; eligible: string[] }>
  >(),
  // Position mappings for consolidated IDP: {"DL": ["EDR", "IL"], "DB": ["CB", "S"]}
  positionMappings: jsonb("position_mappings").$type<Record<string, string[]>>(),
  // IDP structure detected
  idpStructure: idpStructureEnum("idp_structure").default("none").notNull(),
  // Bench/taxi/IR slots
  benchSlots: integer("bench_slots").default(0).notNull(),
  taxiSlots: integer("taxi_slots").default(0).notNull(),
  irSlots: integer("ir_slots").default(0).notNull(),
  // Additional settings metadata
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  // Version for deterministic reruns
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Teams
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    externalTeamId: varchar("external_team_id", { length: 255 }).notNull(),
    ownerName: varchar("owner_name", { length: 255 }),
    teamName: varchar("team_name", { length: 255 }),
    standingRank: integer("standing_rank"),
    totalPoints: real("total_points"),
    optimalPoints: real("optimal_points"),
    wins: integer("wins").default(0),
    losses: integer("losses").default(0),
    ties: integer("ties").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leagueTeamIdx: uniqueIndex("league_team_idx").on(
      table.leagueId,
      table.externalTeamId
    ),
  })
);

/**
 * Canonical Players (our internal player database)
 */
export const canonicalPlayers = pgTable(
  "canonical_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Primary identifiers
    name: varchar("name", { length: 255 }).notNull(),
    position: varchar("position", { length: 20 }).notNull(), // QB, RB, WR, TE, EDR, IL, CB, S, etc.
    positionGroup: positionGroupEnum("position_group").notNull(),
    nflTeam: varchar("nfl_team", { length: 10 }), // Current NFL team abbreviation
    // Dynasty-relevant info
    age: integer("age"),
    birthdate: varchar("birthdate", { length: 10 }), // YYYY-MM-DD
    rookieYear: integer("rookie_year"),
    draftRound: integer("draft_round"), // 1-7, null for UDFA
    draftPick: integer("draft_pick"), // Overall pick number
    yearsExperience: integer("years_experience"),
    // Status
    isActive: boolean("is_active").default(true).notNull(),
    injuryStatus: varchar("injury_status", { length: 50 }),
    // External IDs from DynastyProcess
    sleeperId: varchar("sleeper_id", { length: 50 }),
    fleaflickerId: varchar("fleaflicker_id", { length: 50 }),
    espnId: varchar("espn_id", { length: 50 }),
    yahooId: varchar("yahoo_id", { length: 50 }),
    mflId: varchar("mfl_id", { length: 50 }),
    fantasyDataId: varchar("fantasy_data_id", { length: 50 }),
    pfrId: varchar("pfr_id", { length: 50 }), // Pro Football Reference
    gsisPid: varchar("gsis_pid", { length: 50 }), // NFL Game Stats ID
    // Metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sleeperIdx: index("sleeper_idx").on(table.sleeperId),
    fleaflickerIdx: index("fleaflicker_idx").on(table.fleaflickerId),
    espnIdx: index("espn_idx").on(table.espnId),
    yahooIdx: index("yahoo_idx").on(table.yahooId),
    positionIdx: index("position_idx").on(table.position),
    namePositionIdx: index("name_position_idx").on(table.name, table.position),
  })
);

/**
 * Rosters (players on teams)
 */
export const rosters = pgTable(
  "rosters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    canonicalPlayerId: uuid("canonical_player_id").references(
      () => canonicalPlayers.id
    ),
    // Store external ID in case player not yet mapped
    externalPlayerId: varchar("external_player_id", { length: 255 }).notNull(),
    // Roster slot: "QB1", "RB1", "FLEX", "BN", "TAXI", "IR"
    slotPosition: varchar("slot_position", { length: 50 }),
    // For unmapped players, store basic info
    playerName: varchar("player_name", { length: 255 }),
    playerPosition: varchar("player_position", { length: 20 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    teamPlayerIdx: uniqueIndex("team_player_idx").on(
      table.teamId,
      table.externalPlayerId
    ),
  })
);

/**
 * Draft Picks (tradeable assets)
 */
export const draftPicks = pgTable(
  "draft_picks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    ownerTeamId: uuid("owner_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    originalTeamId: uuid("original_team_id").references(() => teams.id),
    season: integer("season").notNull(),
    round: integer("round").notNull(),
    pickNumber: integer("pick_number"), // Specific slot if known
    projectedPickNumber: integer("projected_pick_number"), // Estimated based on standings
    // Calculated value (filled by value engine)
    value: real("value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    leaguePickIdx: index("league_pick_idx").on(table.leagueId, table.season),
  })
);

/**
 * Projections (stats from projection sources)
 */
export const projections = pgTable(
  "projections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalPlayerId: uuid("canonical_player_id")
      .notNull()
      .references(() => canonicalPlayers.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 50 }).notNull(), // "sleeper", "fantasypros", "offseason_model"
    season: integer("season").notNull(),
    week: integer("week"), // null for season-long projections
    // Raw stat projections: {"pass_yd": 4200, "pass_td": 28, "rush_yd": 150, ...}
    stats: jsonb("stats").notNull().$type<Record<string, number>>(),
    // Confidence intervals if available: {"mean": 250, "p10": 180, "p90": 320}
    confidence: jsonb("confidence").$type<{
      mean: number;
      p10: number;
      p90: number;
    }>(),
    // Metadata
    methodology: varchar("methodology", { length: 255 }),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => ({
    playerSourceSeasonIdx: uniqueIndex("player_source_season_idx").on(
      table.canonicalPlayerId,
      table.source,
      table.season,
      table.week
    ),
  })
);

/**
 * Historical Stats (actual season stats for computing last-season points)
 */
export const historicalStats = pgTable(
  "historical_stats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalPlayerId: uuid("canonical_player_id")
      .notNull()
      .references(() => canonicalPlayers.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    gamesPlayed: integer("games_played"),
    // Raw stat totals: {"pass_yd": 4500, "pass_td": 35, "rush_yd": 200, ...}
    stats: jsonb("stats").notNull().$type<Record<string, number>>(),
    // Source of the data
    source: varchar("source", { length: 50 }).notNull(), // "dynastyprocess", "nflfastr"
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    playerSeasonIdx: uniqueIndex("hist_player_season_idx").on(
      table.canonicalPlayerId,
      table.season
    ),
    seasonIdx: index("hist_season_idx").on(table.season),
  })
);

/**
 * Player Values (computed by value engine per league)
 */
export const playerValues = pgTable(
  "player_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    canonicalPlayerId: uuid("canonical_player_id")
      .notNull()
      .references(() => canonicalPlayers.id, { onDelete: "cascade" }),
    // Core value metrics
    value: real("value").notNull(), // Final unified value
    rank: integer("rank").notNull(), // Global rank (offense + IDP)
    rankInPosition: integer("rank_in_position").notNull(),
    tier: integer("tier").notNull(),
    // VORP breakdown
    projectedPoints: real("projected_points").notNull(),
    replacementPoints: real("replacement_points").notNull(),
    vorp: real("vorp").notNull(), // Raw VORP
    normalizedVorp: real("normalized_vorp").notNull(), // Opportunity-cost adjusted
    // Multipliers applied
    scarcityMultiplier: real("scarcity_multiplier").notNull(),
    ageCurveMultiplier: real("age_curve_multiplier").notNull(),
    dynastyPremium: real("dynasty_premium").default(0),
    riskDiscount: real("risk_discount").default(0),
    // Last season stats (for proof layer)
    lastSeasonPoints: real("last_season_points"),
    lastSeasonRankOverall: integer("last_season_rank_overall"),
    lastSeasonRankPosition: integer("last_season_rank_position"),
    // Data source for transparency
    dataSource: dataSourceEnum("data_source"),
    // Consensus breakdown (unified engine)
    consensusValue: integer("consensus_value"),
    ktcValue: integer("ktc_value"),
    fcValue: integer("fc_value"),
    dpValue: integer("dp_value"),
    fpValue: integer("fp_value"), // FantasyPros
    // Blend components (transparency)
    consensusComponent: real("consensus_component"),
    leagueSignalComponent: real("league_signal_component"),
    // Unified engine confidence
    lowConfidence: boolean("low_confidence").default(false),
    valueSource: varchar("value_source", { length: 30 }),
    // Normalized eligibility position (null = no normalization applied)
    eligibilityPosition: varchar("eligibility_position", { length: 20 }),
    // Confidence
    confidenceBand: jsonb("confidence_band").$type<{
      lower: number;
      upper: number;
    }>(),
    // Metadata
    positionGroup: positionGroupEnum("position_group").notNull(),
    projectionSource: projectionSourceEnum("projection_source").notNull(),
    uncertainty: uncertaintyEnum("uncertainty").notNull(),
    // Engine version for deterministic reruns
    engineVersion: varchar("engine_version", { length: 50 }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => ({
    leaguePlayerIdx: uniqueIndex("league_player_value_idx").on(
      table.leagueId,
      table.canonicalPlayerId
    ),
    leagueRankIdx: index("league_rank_idx").on(table.leagueId, table.rank),
    leaguePositionRankIdx: index("league_position_rank_idx").on(
      table.leagueId,
      table.rankInPosition
    ),
  })
);

/**
 * Raw Payloads (audit trail)
 */
export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leagueId: uuid("league_id").references(() => leagues.id, {
      onDelete: "set null",
    }),
    provider: providerEnum("provider").notNull(),
    endpoint: varchar("endpoint", { length: 255 }).notNull(),
    requestParams: jsonb("request_params").$type<Record<string, unknown>>(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 50 }).notNull(), // "success", "error"
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => ({
    leagueFetchedIdx: index("league_fetched_idx").on(
      table.leagueId,
      table.fetchedAt
    ),
  })
);

/**
 * Value Computation Logs (for debugging/auditing)
 */
export const valueComputationLogs = pgTable("value_computation_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  leagueId: uuid("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  engineVersion: varchar("engine_version", { length: 50 }).notNull(),
  projectionVersion: varchar("projection_version", { length: 50 }),
  inputsHash: varchar("inputs_hash", { length: 64 }).notNull(), // SHA256 of inputs
  playerCount: integer("player_count").notNull(),
  durationMs: integer("duration_ms").notNull(),
  warnings: jsonb("warnings").$type<string[]>(),
  errors: jsonb("errors").$type<string[]>(),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
});

/**
 * Per-user API rate limits (sliding window counters).
 */
export const apiRateLimits = pgTable("api_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  key: varchar("key", { length: 50 }).notNull(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * External Rankings (scraped from KTC, FantasyCalc, FantasyPros, etc.)
 */
export const externalRankingSourceEnum = pgEnum("external_ranking_source", [
  "ktc",
  "fantasycalc",
  "fantasypros",
  "dynastyprocess",
  "dynastysuperflex",
]);

export const externalRankings = pgTable(
  "external_rankings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: externalRankingSourceEnum("source").notNull(),
    // Player identification - try to match to canonical_players
    playerName: varchar("player_name", { length: 255 }).notNull(),
    position: varchar("position", { length: 20 }).notNull(),
    nflTeam: varchar("nfl_team", { length: 10 }),
    // Link to our player DB (nullable until matched)
    canonicalPlayerId: uuid("canonical_player_id").references(
      () => canonicalPlayers.id
    ),
    // Rankings data
    rank: integer("rank"), // Overall rank from source
    positionRank: integer("position_rank"),
    value: integer("value"), // Raw value from source (normalized 0-10000)
    tier: integer("tier"),
    // Settings context (for KTC which has SF/TEP variants)
    isSuperFlex: boolean("is_super_flex").default(false).notNull(),
    isTEPremium: boolean("is_te_premium").default(false).notNull(),
    // Metadata
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    season: integer("season").notNull(),
  },
  (table) => ({
    sourcePlayerIdx: uniqueIndex("source_player_settings_idx").on(
      table.source,
      table.playerName,
      table.position,
      table.isSuperFlex,
      table.isTEPremium,
      table.season
    ),
    canonicalPlayerIdx: index("external_canonical_player_idx").on(
      table.canonicalPlayerId
    ),
    fetchedAtIdx: index("external_fetched_at_idx").on(table.fetchedAt),
  })
);

/**
 * Aggregated Values (blended from multiple sources, league-specific)
 */
export const aggregatedValues = pgTable(
  "aggregated_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalPlayerId: uuid("canonical_player_id")
      .notNull()
      .references(() => canonicalPlayers.id, { onDelete: "cascade" }),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // Aggregated value (weighted blend of sources)
    aggregatedValue: integer("aggregated_value").notNull(),
    aggregatedRank: integer("aggregated_rank").notNull(),
    aggregatedPositionRank: integer("aggregated_position_rank").notNull(),
    // Individual source values (for transparency)
    ktcValue: integer("ktc_value"),
    fcValue: integer("fc_value"), // FantasyCalc
    fpValue: integer("fp_value"), // FantasyPros
    dpValue: integer("dp_value"), // DynastyProcess
    // Our calculated IDP value (for IDP positions only)
    idpValue: integer("idp_value"),
    // Adjustments applied
    sfAdjustment: real("sf_adjustment").default(0), // Superflex boost
    tepAdjustment: real("te_adjustment").default(0), // TE Premium boost
    // Metadata
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => ({
    leaguePlayerAggIdx: uniqueIndex("league_player_agg_idx").on(
      table.leagueId,
      table.canonicalPlayerId
    ),
    leagueRankAggIdx: index("league_rank_agg_idx").on(
      table.leagueId,
      table.aggregatedRank
    ),
  })
);

/**
 * Player Position Overrides (manual or external position corrections)
 */
export const playerPositionOverrides = pgTable(
  "player_position_overrides",
  {
    playerId: uuid("player_id")
      .primaryKey()
      .references(() => canonicalPlayers.id, { onDelete: "cascade" }),
    canonicalPosition: varchar("canonical_position", { length: 20 })
      .notNull(),
    source: varchar("source", { length: 20 }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

/**
 * Relations
 */
export const usersRelations = relations(users, ({ many }) => ({
  tokens: many(userTokens),
  leagues: many(leagues),
}));

export const userTokensRelations = relations(userTokens, ({ one }) => ({
  user: one(users, {
    fields: [userTokens.userId],
    references: [users.id],
  }),
}));

export const leaguesRelations = relations(leagues, ({ one, many }) => ({
  user: one(users, {
    fields: [leagues.userId],
    references: [users.id],
  }),
  settings: one(leagueSettings),
  teams: many(teams),
  draftPicks: many(draftPicks),
  playerValues: many(playerValues),
  rawPayloads: many(rawPayloads),
  computationLogs: many(valueComputationLogs),
  aggregatedValues: many(aggregatedValues),
}));

export const leagueSettingsRelations = relations(leagueSettings, ({ one }) => ({
  league: one(leagues, {
    fields: [leagueSettings.leagueId],
    references: [leagues.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  rosters: many(rosters),
  ownedPicks: many(draftPicks, { relationName: "ownerTeam" }),
  originalPicks: many(draftPicks, { relationName: "originalTeam" }),
}));

export const rostersRelations = relations(rosters, ({ one }) => ({
  team: one(teams, {
    fields: [rosters.teamId],
    references: [teams.id],
  }),
  player: one(canonicalPlayers, {
    fields: [rosters.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
}));

export const canonicalPlayersRelations = relations(
  canonicalPlayers,
  ({ many }) => ({
    rosters: many(rosters),
    projections: many(projections),
    historicalStats: many(historicalStats),
    values: many(playerValues),
    externalRankings: many(externalRankings),
    aggregatedValues: many(aggregatedValues),
  })
);

export const historicalStatsRelations = relations(historicalStats, ({ one }) => ({
  player: one(canonicalPlayers, {
    fields: [historicalStats.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
}));

export const projectionsRelations = relations(projections, ({ one }) => ({
  player: one(canonicalPlayers, {
    fields: [projections.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
}));

export const playerValuesRelations = relations(playerValues, ({ one }) => ({
  league: one(leagues, {
    fields: [playerValues.leagueId],
    references: [leagues.id],
  }),
  player: one(canonicalPlayers, {
    fields: [playerValues.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
}));

export const draftPicksRelations = relations(draftPicks, ({ one }) => ({
  league: one(leagues, {
    fields: [draftPicks.leagueId],
    references: [leagues.id],
  }),
  ownerTeam: one(teams, {
    fields: [draftPicks.ownerTeamId],
    references: [teams.id],
    relationName: "ownerTeam",
  }),
  originalTeam: one(teams, {
    fields: [draftPicks.originalTeamId],
    references: [teams.id],
    relationName: "originalTeam",
  }),
}));

export const rawPayloadsRelations = relations(rawPayloads, ({ one }) => ({
  league: one(leagues, {
    fields: [rawPayloads.leagueId],
    references: [leagues.id],
  }),
}));

export const valueComputationLogsRelations = relations(
  valueComputationLogs,
  ({ one }) => ({
    league: one(leagues, {
      fields: [valueComputationLogs.leagueId],
      references: [leagues.id],
    }),
  })
);

export const externalRankingsRelations = relations(externalRankings, ({ one }) => ({
  player: one(canonicalPlayers, {
    fields: [externalRankings.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
}));

export const aggregatedValuesRelations = relations(aggregatedValues, ({ one }) => ({
  player: one(canonicalPlayers, {
    fields: [aggregatedValues.canonicalPlayerId],
    references: [canonicalPlayers.id],
  }),
  league: one(leagues, {
    fields: [aggregatedValues.leagueId],
    references: [leagues.id],
  }),
}));
