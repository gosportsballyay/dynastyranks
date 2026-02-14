CREATE TYPE "public"."idp_structure" AS ENUM('none', 'consolidated', 'granular', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."position_group" AS ENUM('offense', 'defense');--> statement-breakpoint
CREATE TYPE "public"."projection_source" AS ENUM('in_season', 'offseason_model', 'expert_consensus');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('sleeper', 'fleaflicker', 'espn', 'yahoo');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'syncing', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."uncertainty" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "canonical_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"position" varchar(20) NOT NULL,
	"position_group" "position_group" NOT NULL,
	"nfl_team" varchar(10),
	"age" integer,
	"birthdate" varchar(10),
	"rookie_year" integer,
	"draft_round" integer,
	"draft_pick" integer,
	"years_experience" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"injury_status" varchar(50),
	"sleeper_id" varchar(50),
	"fleaflicker_id" varchar(50),
	"espn_id" varchar(50),
	"yahoo_id" varchar(50),
	"mfl_id" varchar(50),
	"fantasy_data_id" varchar(50),
	"pfr_id" varchar(50),
	"gsis_pid" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"owner_team_id" uuid NOT NULL,
	"original_team_id" uuid,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"pick_number" integer,
	"projected_pick_number" integer,
	"value" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"scoring_rules" jsonb NOT NULL,
	"position_scoring_overrides" jsonb,
	"roster_positions" jsonb NOT NULL,
	"flex_rules" jsonb NOT NULL,
	"position_mappings" jsonb,
	"idp_structure" "idp_structure" DEFAULT 'none' NOT NULL,
	"bench_slots" integer DEFAULT 0 NOT NULL,
	"taxi_slots" integer DEFAULT 0 NOT NULL,
	"ir_slots" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "league_settings_league_id_unique" UNIQUE("league_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"external_league_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"season" integer NOT NULL,
	"total_teams" integer NOT NULL,
	"draft_type" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"canonical_player_id" uuid NOT NULL,
	"value" real NOT NULL,
	"rank" integer NOT NULL,
	"rank_in_position" integer NOT NULL,
	"tier" integer NOT NULL,
	"projected_points" real NOT NULL,
	"replacement_points" real NOT NULL,
	"vorp" real NOT NULL,
	"normalized_vorp" real NOT NULL,
	"scarcity_multiplier" real NOT NULL,
	"age_curve_multiplier" real NOT NULL,
	"dynasty_premium" real DEFAULT 0,
	"risk_discount" real DEFAULT 0,
	"confidence_band" jsonb,
	"position_group" "position_group" NOT NULL,
	"projection_source" "projection_source" NOT NULL,
	"uncertainty" "uncertainty" NOT NULL,
	"engine_version" varchar(50) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_player_id" uuid NOT NULL,
	"source" varchar(50) NOT NULL,
	"season" integer NOT NULL,
	"week" integer,
	"stats" jsonb NOT NULL,
	"confidence" jsonb,
	"methodology" varchar(255),
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid,
	"provider" "provider" NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"request_params" jsonb,
	"payload" jsonb NOT NULL,
	"status" varchar(50) NOT NULL,
	"error_message" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"canonical_player_id" uuid,
	"external_player_id" varchar(255) NOT NULL,
	"slot_position" varchar(50),
	"player_name" varchar(255),
	"player_position" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"external_team_id" varchar(255) NOT NULL,
	"owner_name" varchar(255),
	"team_name" varchar(255),
	"standing_rank" integer,
	"total_points" real,
	"optimal_points" real,
	"wins" integer DEFAULT 0,
	"losses" integer DEFAULT 0,
	"ties" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"scope" varchar(255),
	"provider_user_id" varchar(255),
	"provider_username" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "value_computation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"engine_version" varchar(50) NOT NULL,
	"inputs_hash" varchar(64) NOT NULL,
	"player_count" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"warnings" jsonb,
	"errors" jsonb,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_original_team_id_teams_id_fk" FOREIGN KEY ("original_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_settings" ADD CONSTRAINT "league_settings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_values" ADD CONSTRAINT "player_values_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_values" ADD CONSTRAINT "player_values_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projections" ADD CONSTRAINT "projections_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_computation_logs" ADD CONSTRAINT "value_computation_logs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sleeper_idx" ON "canonical_players" USING btree ("sleeper_id");--> statement-breakpoint
CREATE INDEX "fleaflicker_idx" ON "canonical_players" USING btree ("fleaflicker_id");--> statement-breakpoint
CREATE INDEX "espn_idx" ON "canonical_players" USING btree ("espn_id");--> statement-breakpoint
CREATE INDEX "yahoo_idx" ON "canonical_players" USING btree ("yahoo_id");--> statement-breakpoint
CREATE INDEX "position_idx" ON "canonical_players" USING btree ("position");--> statement-breakpoint
CREATE INDEX "name_position_idx" ON "canonical_players" USING btree ("name","position");--> statement-breakpoint
CREATE INDEX "league_pick_idx" ON "draft_picks" USING btree ("league_id","season");--> statement-breakpoint
CREATE INDEX "user_league_idx" ON "leagues" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_league_idx" ON "leagues" USING btree ("user_id","provider","external_league_id","season");--> statement-breakpoint
CREATE UNIQUE INDEX "league_player_value_idx" ON "player_values" USING btree ("league_id","canonical_player_id");--> statement-breakpoint
CREATE INDEX "league_rank_idx" ON "player_values" USING btree ("league_id","rank");--> statement-breakpoint
CREATE INDEX "league_position_rank_idx" ON "player_values" USING btree ("league_id","rank_in_position");--> statement-breakpoint
CREATE UNIQUE INDEX "player_source_season_idx" ON "projections" USING btree ("canonical_player_id","source","season","week");--> statement-breakpoint
CREATE INDEX "league_fetched_idx" ON "raw_payloads" USING btree ("league_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_player_idx" ON "rosters" USING btree ("team_id","external_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_team_idx" ON "teams" USING btree ("league_id","external_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_provider_idx" ON "user_tokens" USING btree ("user_id","provider");