CREATE TABLE "player_position_overrides" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"canonical_position" varchar(20) NOT NULL,
	"source" varchar(20) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_values" ADD COLUMN "eligibility_position" varchar(20);--> statement-breakpoint
ALTER TABLE "player_position_overrides" ADD CONSTRAINT "player_position_overrides_player_id_canonical_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."canonical_players"("id") ON DELETE cascade ON UPDATE no action;