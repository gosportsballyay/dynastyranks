CREATE TYPE "public"."data_source" AS ENUM('projections', 'offseason_estimate', 'last_season_only');--> statement-breakpoint
CREATE TABLE "historical_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_player_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"games_played" integer,
	"stats" jsonb NOT NULL,
	"source" varchar(50) NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "user_team_id" uuid;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "last_season_points" real;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "last_season_rank_overall" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "last_season_rank_position" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "data_source" "data_source";--> statement-breakpoint
ALTER TABLE "historical_stats" ADD CONSTRAINT "historical_stats_canonical_player_id_canonical_players_id_fk" FOREIGN KEY ("canonical_player_id") REFERENCES "public"."canonical_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hist_player_season_idx" ON "historical_stats" USING btree ("canonical_player_id","season");--> statement-breakpoint
CREATE INDEX "hist_season_idx" ON "historical_stats" USING btree ("season");