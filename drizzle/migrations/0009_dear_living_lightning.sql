ALTER TABLE "leagues" ADD COLUMN "recompute_count_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "recompute_date" date;