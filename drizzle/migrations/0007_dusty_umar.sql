ALTER TABLE "leagues" ADD COLUMN "last_computed_at" timestamp;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "league_config_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "value_computation_logs" ADD COLUMN "projection_version" varchar(50);