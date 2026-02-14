CREATE TYPE "public"."external_ranking_source" AS ENUM('ktc', 'fantasycalc', 'fantasypros', 'dynastyprocess', 'dynastysuperflex');--> statement-breakpoint
ALTER TYPE "public"."data_source" ADD VALUE 'last_season_actual' BEFORE 'last_season_only';--> statement-breakpoint
CREATE TABLE "aggregated_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_player_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"aggregated_value" integer NOT NULL,
	"aggregated_rank" integer NOT NULL,
	"aggregated_position_rank" integer NOT NULL,
	"ktc_value" integer,
	"fc_value" integer,
	"fp_value" integer,
	"dp_value" integer,
	"idp_value" integer,
	"sf_adjustment" real DEFAULT 0,
	"te_adjustment" real DEFAULT 0,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "external_ranking_source" NOT NULL,
	"player_name" varchar(255) NOT NULL,
	"position" varchar(20) NOT NULL,
	"nfl_team" varchar(10),
	"canonical_player_id" uuid,
	"rank" integer,
	"position_rank" integer,
	"value" integer,
	"tier" integer,
	"is_super_flex" boolean DEFAULT false NOT NULL,
	"is_te_premium" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"season" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aggregated_values" ADD CONSTRAINT "aggregated_values_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregated_values" ADD CONSTRAINT "aggregated_values_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_rankings" ADD CONSTRAINT "external_rankings_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "league_player_agg_idx" ON "aggregated_values" USING btree ("league_id","canonical_player_id");--> statement-breakpoint
CREATE INDEX "league_rank_agg_idx" ON "aggregated_values" USING btree ("league_id","aggregated_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "source_player_settings_idx" ON "external_rankings" USING btree ("source","player_name","position","is_super_flex","is_te_premium","season");--> statement-breakpoint
CREATE INDEX "external_canonical_player_idx" ON "external_rankings" USING btree ("canonical_player_id");--> statement-breakpoint
CREATE INDEX "external_fetched_at_idx" ON "external_rankings" USING btree ("fetched_at");