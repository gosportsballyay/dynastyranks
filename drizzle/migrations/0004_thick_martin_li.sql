ALTER TYPE "public"."data_source" ADD VALUE 'unified';--> statement-breakpoint
ALTER TYPE "public"."projection_source" ADD VALUE 'unified_blend';--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "consensus_value" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "ktc_value" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "fc_value" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "dp_value" integer;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "consensus_component" real;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "league_signal_component" real;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "low_confidence" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "value_source" varchar(30);