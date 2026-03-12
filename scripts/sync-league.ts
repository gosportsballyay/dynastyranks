#!/usr/bin/env npx tsx
/**
 * Sync League Data
 *
 * Re-syncs a league from its provider to get fresh scoring rules.
 * Usage: npx tsx scripts/sync-league.ts <league-id>
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import {
  createSleeperAdapter,
  createFleaflickerAdapter,
  createMFLAdapter,
} from "../lib/adapters";
import { getPlayersByProviderIds } from "../lib/player-mapping";
import type { Provider } from "../types";

async function main() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.log("Usage: npx tsx scripts/sync-league.ts <league-id>");
    console.log("Example: npx tsx scripts/sync-league.ts ee5ebec8-4f76-40a9-9dc1-b9a3a8116366");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // Get league
  const [league] = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.id, leagueId))
    .limit(1);

  if (!league) {
    console.error(`League not found: ${leagueId}`);
    process.exit(1);
  }

  console.log(`\n=== Syncing League: ${league.name} ===`);
  console.log(`Provider: ${league.provider}`);
  console.log(`External ID: ${league.externalLeagueId}`);
  console.log(`Season: ${league.season}\n`);

  // Update status to syncing
  await db
    .update(schema.leagues)
    .set({ syncStatus: "syncing", syncError: null })
    .where(eq(schema.leagues.id, leagueId));

  try {
    // Clear existing settings and raw payloads (keep teams and rosters for now)
    console.log("Clearing existing league settings...");
    await db
      .delete(schema.leagueSettings)
      .where(eq(schema.leagueSettings.leagueId, leagueId));
    await db
      .delete(schema.rawPayloads)
      .where(eq(schema.rawPayloads.leagueId, leagueId));

    // Create adapter
    const adapter =
      league.provider === "sleeper"
        ? createSleeperAdapter(league.externalLeagueId)
        : league.provider === "mfl"
          ? createMFLAdapter({ leagueId: league.externalLeagueId, season: league.season })
          : createFleaflickerAdapter();

    // Fetch settings
    console.log("Fetching league settings from provider...");
    const settings = await adapter.getLeagueSettings(league.externalLeagueId);

    // Extract structuredRules from metadata for dedicated DB column
    const metadataObj = settings.metadata as Record<string, unknown> | undefined;
    const structuredRules = metadataObj?.structuredRules ?? null;

    // Store settings
    console.log("Storing settings in database...");
    await db.insert(schema.leagueSettings).values({
      leagueId,
      scoringRules: settings.scoringRules,
      positionScoringOverrides: settings.positionScoringOverrides,
      rosterPositions: settings.rosterPositions,
      flexRules: settings.flexRules,
      positionMappings: settings.positionMappings,
      idpStructure: settings.idpStructure,
      benchSlots: settings.benchSlots,
      taxiSlots: settings.taxiSlots,
      irSlots: settings.irSlots,
      metadata: settings.metadata,
      structuredRules: structuredRules as typeof schema.leagueSettings.$inferInsert.structuredRules,
    });

    // Store raw payloads
    const payloads = adapter.getRawPayloads();
    if (payloads.length > 0) {
      await db.insert(schema.rawPayloads).values(
        payloads.map((p) => ({
          leagueId,
          provider: league.provider,
          endpoint: p.endpoint,
          requestParams: p.requestParams,
          payload: p.payload,
          status: p.status,
          errorMessage: p.errorMessage,
          fetchedAt: p.fetchedAt,
        }))
      );
    }

    adapter.clearRawPayloads();

    // Update sync status
    await db
      .update(schema.leagues)
      .set({ syncStatus: "success", lastSyncedAt: new Date() })
      .where(eq(schema.leagues.id, leagueId));

    // Display results
    console.log("\n=== Sync Complete ===\n");
    console.log("Scoring Rules:");
    console.log(JSON.stringify(settings.scoringRules, null, 2));

    console.log("\nPosition Scoring Overrides:");
    console.log(JSON.stringify(settings.positionScoringOverrides, null, 2));

    if (settings.metadata) {
      const metadata = settings.metadata as Record<string, unknown>;
      if (metadata.bonusThresholds) {
        console.log("\nBonus Thresholds:");
        console.log(JSON.stringify(metadata.bonusThresholds, null, 2));
      }
    }

    console.log("\nRoster Positions:");
    console.log(JSON.stringify(settings.rosterPositions, null, 2));

    console.log("\n✓ League synced successfully");
  } catch (error) {
    console.error("Sync error:", error);
    await db
      .update(schema.leagues)
      .set({
        syncStatus: "failed",
        syncError: error instanceof Error ? error.message : "Sync failed",
      })
      .where(eq(schema.leagues.id, leagueId));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
