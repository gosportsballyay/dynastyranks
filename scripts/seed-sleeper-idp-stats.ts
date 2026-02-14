#!/usr/bin/env npx tsx
/**
 * Seed IDP Stats from Sleeper API
 *
 * Fetches weekly defensive player stats from Sleeper's public API and merges
 * them into the historical_stats table. This supplements the PBP-sourced offense
 * stats with IDP stats (tackles, sacks, INTs, etc.) that aren't available in PBP.
 *
 * Usage:
 *   npx tsx scripts/seed-sleeper-idp-stats.ts --season 2025
 *
 * Data source: https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";

const SLEEPER_API_BASE = "https://api.sleeper.app/v1";
const RATE_LIMIT_MS = 100; // Be nice to Sleeper's API

// Map Sleeper stat keys to our canonical stat keys
const SLEEPER_TO_OUR_KEYS: Record<string, string> = {
  idp_tkl: "tackle",
  idp_tkl_solo: "tackle_solo",
  idp_tkl_ast: "tackle_assist",
  idp_sack: "sack",
  idp_sack_yd: "sack_yd",
  idp_qb_hit: "qb_hit",
  idp_tkl_loss: "tfl",
  idp_ff: "fum_force",
  idp_fum_rec: "fum_rec",
  idp_pass_def: "pass_def",
  idp_int: "def_int",
  idp_int_yd: "def_int_yd",
  idp_td: "def_td",
  idp_safe: "safety",
  idp_blk_kick: "blk_kick",
};

// IDP stat keys to check if player has any IDP stats
const IDP_STAT_KEYS = Object.keys(SLEEPER_TO_OUR_KEYS);

interface SleeperPlayer {
  player_id: string;
  gsis_id: string | null;
  full_name: string;
  position: string;
  team: string | null;
}

interface SleeperWeeklyStats {
  [playerId: string]: {
    gp?: number;
    [key: string]: number | undefined;
  };
}

interface AggregatedPlayerStats {
  sleeperId: string;
  weeksPlayed: Set<number>;
  stats: Record<string, number>;
}

/**
 * Sleep for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON from Sleeper API with rate limiting
 */
async function fetchSleeper<T>(endpoint: string): Promise<T> {
  await sleep(RATE_LIMIT_MS);
  const url = `${SLEEPER_API_BASE}${endpoint}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} for ${url}`);
  }
  return response.json();
}

/**
 * Fetch Sleeper player database
 */
async function fetchSleeperPlayers(): Promise<Map<string, SleeperPlayer>> {
  console.log("Fetching Sleeper player database...");
  const players = await fetchSleeper<Record<string, SleeperPlayer>>("/players/nfl");

  const playerMap = new Map<string, SleeperPlayer>();
  for (const [id, player] of Object.entries(players)) {
    playerMap.set(id, {
      player_id: id,
      gsis_id: player.gsis_id,
      full_name: player.full_name,
      position: player.position,
      team: player.team,
    });
  }

  console.log(`  Loaded ${playerMap.size} players from Sleeper`);
  return playerMap;
}

/**
 * Fetch weekly stats for a specific week
 */
async function fetchWeeklyStats(season: number, week: number): Promise<SleeperWeeklyStats> {
  return fetchSleeper<SleeperWeeklyStats>(`/stats/nfl/regular/${season}/${week}`);
}

/**
 * Check if a player has any IDP stats in their weekly data
 */
function hasIdpStats(stats: Record<string, number | undefined>): boolean {
  return IDP_STAT_KEYS.some((key) => stats[key] !== undefined && stats[key] !== 0);
}

/**
 * Extract IDP stats from weekly stats and convert to our keys
 */
function extractIdpStats(weeklyStats: Record<string, number | undefined>): Record<string, number> {
  const idpStats: Record<string, number> = {};

  for (const [sleeperKey, ourKey] of Object.entries(SLEEPER_TO_OUR_KEYS)) {
    const value = weeklyStats[sleeperKey];
    if (value !== undefined && value !== 0) {
      idpStats[ourKey] = value;
    }
  }

  return idpStats;
}

/**
 * Aggregate weekly stats into season totals
 */
function aggregateSeasonStats(
  allWeeklyStats: Map<number, SleeperWeeklyStats>
): Map<string, AggregatedPlayerStats> {
  const aggregated = new Map<string, AggregatedPlayerStats>();

  for (const [week, weekStats] of allWeeklyStats) {
    for (const [playerId, stats] of Object.entries(weekStats)) {
      if (!hasIdpStats(stats)) continue;

      if (!aggregated.has(playerId)) {
        aggregated.set(playerId, {
          sleeperId: playerId,
          weeksPlayed: new Set(),
          stats: {},
        });
      }

      const player = aggregated.get(playerId)!;
      player.weeksPlayed.add(week);

      // Aggregate IDP stats
      const idpStats = extractIdpStats(stats);
      for (const [key, value] of Object.entries(idpStats)) {
        player.stats[key] = (player.stats[key] || 0) + value;
      }
    }
  }

  return aggregated;
}

/**
 * Build mapping from Sleeper player_id to canonical_player_id via gsis_id
 */
function buildPlayerMapping(
  sleeperPlayers: Map<string, SleeperPlayer>,
  canonicalPlayers: Array<{ id: string; gsisPid: string | null; name: string; position: string }>
): Map<string, { canonicalId: string; name: string; position: string }> {
  const mapping = new Map<string, { canonicalId: string; name: string; position: string }>();

  // Build gsis_id -> canonical mapping
  const gsisToCanonical = new Map<string, { canonicalId: string; name: string; position: string }>();
  for (const player of canonicalPlayers) {
    if (player.gsisPid) {
      gsisToCanonical.set(player.gsisPid, {
        canonicalId: player.id,
        name: player.name,
        position: player.position,
      });
    }
  }

  // Map sleeper_id -> canonical via gsis_id
  // Note: Sleeper gsis_id often has leading whitespace that needs trimming
  for (const [sleeperId, sleeperPlayer] of sleeperPlayers) {
    if (sleeperPlayer.gsis_id) {
      const trimmedGsisId = sleeperPlayer.gsis_id.trim();
      const canonical = gsisToCanonical.get(trimmedGsisId);
      if (canonical) {
        mapping.set(sleeperId, canonical);
      }
    }
  }

  return mapping;
}

async function main() {
  const args = process.argv.slice(2);
  let season = 2025;

  const seasonIndex = args.indexOf("--season");
  if (seasonIndex !== -1 && args[seasonIndex + 1]) {
    season = parseInt(args[seasonIndex + 1]);
  }

  console.log("=".repeat(60));
  console.log("SEED SLEEPER IDP STATS");
  console.log("=".repeat(60));
  console.log(`Season: ${season}`);
  console.log();

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // 1. Fetch Sleeper player database
  const sleeperPlayers = await fetchSleeperPlayers();

  // 2. Load canonical players for mapping
  console.log("Loading canonical players...");
  const canonicalPlayers = await db
    .select({
      id: schema.canonicalPlayers.id,
      gsisPid: schema.canonicalPlayers.gsisPid,
      name: schema.canonicalPlayers.name,
      position: schema.canonicalPlayers.position,
    })
    .from(schema.canonicalPlayers);
  console.log(`  Loaded ${canonicalPlayers.length} canonical players`);

  // 3. Build player mapping
  console.log("Building player mapping...");
  const playerMapping = buildPlayerMapping(sleeperPlayers, canonicalPlayers);
  console.log(`  Mapped ${playerMapping.size} players (Sleeper -> Canonical)`);

  // 4. Fetch all 18 weeks of stats
  console.log(`\nFetching weekly stats for ${season}...`);
  const allWeeklyStats = new Map<number, SleeperWeeklyStats>();

  for (let week = 1; week <= 18; week++) {
    process.stdout.write(`  Week ${week.toString().padStart(2)}...`);
    try {
      const weekStats = await fetchWeeklyStats(season, week);
      const playerCount = Object.keys(weekStats).length;
      allWeeklyStats.set(week, weekStats);
      console.log(` ${playerCount} players`);
    } catch (error) {
      console.log(` ❌ Failed (may not exist yet)`);
    }
  }

  if (allWeeklyStats.size === 0) {
    console.error("\n❌ No weekly stats found for this season");
    process.exit(1);
  }

  console.log(`\n  Fetched ${allWeeklyStats.size} weeks of data`);

  // 5. Aggregate season stats
  console.log("\nAggregating season stats...");
  const seasonStats = aggregateSeasonStats(allWeeklyStats);
  console.log(`  Found ${seasonStats.size} players with IDP stats`);

  // 6. Load existing historical stats for this season (batch lookup)
  console.log("\nLoading existing historical stats for season...");
  const existingStats = await db
    .select()
    .from(schema.historicalStats)
    .where(eq(schema.historicalStats.season, season));

  const existingByCanonicalId = new Map<string, typeof existingStats[0]>();
  for (const row of existingStats) {
    existingByCanonicalId.set(row.canonicalPlayerId, row);
  }
  console.log(`  Found ${existingStats.length} existing rows for season ${season}`);

  // 7. Prepare updates/inserts
  console.log("\nPreparing database updates...");

  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  let inserted = 0;

  const unmatchedPlayers: string[] = [];
  const toUpdate: Array<{ id: string; stats: Record<string, number>; gamesPlayed: number }> = [];
  const toInsert: Array<typeof schema.historicalStats.$inferInsert> = [];

  for (const [sleeperId, playerStats] of seasonStats) {
    const canonical = playerMapping.get(sleeperId);

    if (!canonical) {
      unmatched++;
      const sleeperPlayer = sleeperPlayers.get(sleeperId);
      if (sleeperPlayer && unmatchedPlayers.length < 20) {
        unmatchedPlayers.push(`${sleeperPlayer.full_name} (${sleeperPlayer.position})`);
      }
      continue;
    }

    matched++;

    // Check if player already has a row for this season
    const existingRow = existingByCanonicalId.get(canonical.canonicalId);

    if (existingRow) {
      // Merge IDP stats into existing row
      const mergedStats = { ...existingRow.stats as Record<string, number>, ...playerStats.stats };
      const gamesPlayed = Math.max(existingRow.gamesPlayed || 0, playerStats.weeksPlayed.size);

      toUpdate.push({
        id: existingRow.id,
        stats: mergedStats,
        gamesPlayed,
      });
      updated++;
    } else {
      // Insert new row for pure IDP player
      toInsert.push({
        canonicalPlayerId: canonical.canonicalId,
        season: season,
        gamesPlayed: playerStats.weeksPlayed.size,
        stats: playerStats.stats,
        source: "sleeper",
      });
      inserted++;
    }
  }

  // Execute updates in batches
  console.log(`\nExecuting ${toUpdate.length} updates...`);
  const UPDATE_BATCH_SIZE = 50;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + UPDATE_BATCH_SIZE);
    await Promise.all(
      batch.map((item) =>
        db
          .update(schema.historicalStats)
          .set({
            stats: item.stats,
            gamesPlayed: item.gamesPlayed,
          })
          .where(eq(schema.historicalStats.id, item.id))
      )
    );
    process.stdout.write(`  Updated ${Math.min(i + UPDATE_BATCH_SIZE, toUpdate.length)}/${toUpdate.length}\r`);
  }
  console.log();

  // Execute inserts in batches
  console.log(`Executing ${toInsert.length} inserts...`);
  const INSERT_BATCH_SIZE = 100;
  for (let i = 0; i < toInsert.length; i += INSERT_BATCH_SIZE) {
    const batch = toInsert.slice(i, i + INSERT_BATCH_SIZE);
    await db.insert(schema.historicalStats).values(batch);
    process.stdout.write(`  Inserted ${Math.min(i + INSERT_BATCH_SIZE, toInsert.length)}/${toInsert.length}\r`);
  }
  console.log();

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Players with IDP stats: ${seasonStats.size}`);
  console.log(`  Matched to canonical:   ${matched}`);
  console.log(`  Unmatched:              ${unmatched}`);
  console.log(`  Updated (merged):       ${updated}`);
  console.log(`  Inserted (new):         ${inserted}`);

  if (unmatchedPlayers.length > 0) {
    console.log(`\n  Unmatched examples:`);
    unmatchedPlayers.slice(0, 10).forEach((p) => console.log(`    - ${p}`));
    if (unmatchedPlayers.length > 10) {
      console.log(`    ... and ${unmatchedPlayers.length - 10} more`);
    }
  }

  // Position breakdown of inserted players
  console.log("\n  IDP stats by position:");
  const byPosition: Record<string, number> = {};
  for (const [sleeperId] of seasonStats) {
    const canonical = playerMapping.get(sleeperId);
    if (canonical) {
      byPosition[canonical.position] = (byPosition[canonical.position] || 0) + 1;
    }
  }

  Object.entries(byPosition)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .forEach(([pos, count]) => {
      console.log(`    ${pos}: ${count}`);
    });

  console.log("\n✓ Done");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
