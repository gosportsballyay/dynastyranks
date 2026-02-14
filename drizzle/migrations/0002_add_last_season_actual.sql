-- Add 'last_season_actual' to data_source enum
ALTER TYPE "public"."data_source" ADD VALUE IF NOT EXISTS 'last_season_actual' BEFORE 'last_season_only';
