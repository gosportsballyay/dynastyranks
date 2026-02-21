CREATE TABLE "user_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"league_id" varchar(255),
	"engine_version" varchar(20),
	"message" text NOT NULL,
	"page" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
