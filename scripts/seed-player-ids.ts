#!/usr/bin/env npx tsx
/**
 * Seed Player IDs from DynastyProcess
 *
 * Downloads the player ID mappings CSV from DynastyProcess GitHub
 * and populates the canonical_players table.
 *
 * Usage: npx tsx scripts/seed-player-ids.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { getPositionGroup, calculateAge } from "../lib/utils";

// DynastyProcess player ID mappings CSV URL
const DYNASTY_PROCESS_CSV_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

interface DynastyProcessRow {
  name?: string;
  merge_name?: string;
  position?: string;
  team?: string;
  age?: string;
  birthdate?: string;
  college?: string;
  draft_year?: string;
  draft_round?: string;
  draft_pick?: string;
  rookie_year?: string;
  entry_year?: string;
  sleeper_id?: string;
  mfl_id?: string;
  espn_id?: string;
  yahoo_id?: string;
  fleaflicker_id?: string;
  cbs_id?: string;
  pfr_id?: string;
  cfbref_id?: string;
  rotowire_id?: string;
  rotoworld_id?: string;
  ktc_id?: string;
  stats_id?: string;
  stats_global_id?: string;
  fantasy_data_id?: string;
  swish_id?: string;
  gsis_id?: string;
  pff_id?: string;
  sportradar_id?: string;
  fantasypros_id?: string;
  nfl_id?: string;
}

async function main() {
  console.log("Starting player ID seed...");

  // Check for database URL
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    console.log("Please create a .env file with your Neon database URL");
    process.exit(1);
  }

  // Connect to database
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  console.log("Connected to database");

  // Fetch CSV from DynastyProcess
  console.log("Fetching player data from DynastyProcess...");
  const response = await fetch(DYNASTY_PROCESS_CSV_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status}`);
  }

  const csvText = await response.text();
  console.log(`Downloaded CSV (${csvText.length} bytes)`);

  // Parse CSV
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} players from CSV`);

  // Filter to fantasy-relevant positions
  const fantasyPositions = new Set([
    "QB",
    "RB",
    "WR",
    "TE",
    "K",
    "FB",
    // IDP positions
    "DL",
    "DE",
    "DT",
    "LB",
    "DB",
    "CB",
    "S",
    "EDR",
    "ILB",
    "OLB",
    "NT",
  ]);

  const relevantPlayers = rows.filter(
    (row) => row.position && fantasyPositions.has(row.position.toUpperCase())
  );
  console.log(`Filtered to ${relevantPlayers.length} fantasy-relevant players`);

  // Prepare players for insert
  const playersToInsert = relevantPlayers
    .filter((row) => row.name) // Must have name
    .map((row) => {
      // Normalize position
      let position = (row.position || "").toUpperCase();

      // Map some positions to our standardized versions
      if (position === "DE" || position === "OLB") {
        position = "EDR"; // Edge rusher
      } else if (position === "DT" || position === "NT") {
        position = "IL"; // Interior line
      } else if (position === "ILB") {
        position = "LB";
      }

      // Calculate age from birthdate if provided
      let age: number | undefined;
      if (row.birthdate) {
        try {
          age = calculateAge(row.birthdate);
        } catch {
          // Ignore invalid dates
        }
      }

      // Parse draft info
      let draftRound: number | undefined;
      let draftPick: number | undefined;
      let rookieYear: number | undefined;

      if (row.draft_round && !isNaN(parseInt(row.draft_round))) {
        draftRound = parseInt(row.draft_round);
      }
      if (row.draft_pick && !isNaN(parseInt(row.draft_pick))) {
        draftPick = parseInt(row.draft_pick);
      }
      if (row.rookie_year && !isNaN(parseInt(row.rookie_year))) {
        rookieYear = parseInt(row.rookie_year);
      } else if (row.entry_year && !isNaN(parseInt(row.entry_year))) {
        rookieYear = parseInt(row.entry_year);
      } else if (row.draft_year && !isNaN(parseInt(row.draft_year))) {
        rookieYear = parseInt(row.draft_year);
      }

      // Calculate years of experience
      let yearsExperience: number | undefined;
      if (rookieYear) {
        yearsExperience = new Date().getFullYear() - rookieYear;
      }

      return {
        name: row.name!,
        position,
        positionGroup: getPositionGroup(position),
        nflTeam: row.team || null,
        age: age ?? null,
        birthdate: row.birthdate || null,
        rookieYear: rookieYear ?? null,
        draftRound: draftRound ?? null,
        draftPick: draftPick ?? null,
        yearsExperience: yearsExperience ?? null,
        isActive: true, // Assume active, will filter on sync
        sleeperId: row.sleeper_id || null,
        fleaflickerId: row.fleaflicker_id || null,
        espnId: row.espn_id || null,
        yahooId: row.yahoo_id || null,
        mflId: row.mfl_id || null,
        fantasyDataId: row.fantasy_data_id || null,
        pfrId: row.pfr_id || null,
        gsisPid: row.gsis_id || null,
      };
    });

  console.log(`Prepared ${playersToInsert.length} players for insert`);

  // Fetch existing players to enable upsert by provider ID
  console.log("Fetching existing players for deduplication...");
  const existingPlayers = await db.select().from(schema.canonicalPlayers);

  // Build lookup maps by provider ID
  const sleeperIdMap = new Map<string, string>();
  const fleaflickerIdMap = new Map<string, string>();
  const espnIdMap = new Map<string, string>();
  const namePositionMap = new Map<string, string>();

  for (const player of existingPlayers) {
    if (player.sleeperId) sleeperIdMap.set(player.sleeperId, player.id);
    if (player.fleaflickerId) fleaflickerIdMap.set(player.fleaflickerId, player.id);
    if (player.espnId) espnIdMap.set(player.espnId, player.id);
    // Fallback: name + position combination
    namePositionMap.set(`${player.name}|${player.position}`, player.id);
  }

  console.log(`Found ${existingPlayers.length} existing players`);

  // Separate into updates and inserts
  const updates: Array<{ id: string; data: (typeof playersToInsert)[0] }> = [];
  const inserts: Array<(typeof playersToInsert)[0]> = [];

  for (const player of playersToInsert) {
    // Try to find existing player by provider ID (most reliable)
    let existingId: string | undefined;

    if (player.sleeperId && sleeperIdMap.has(player.sleeperId)) {
      existingId = sleeperIdMap.get(player.sleeperId);
    } else if (player.fleaflickerId && fleaflickerIdMap.has(player.fleaflickerId)) {
      existingId = fleaflickerIdMap.get(player.fleaflickerId);
    } else if (player.espnId && espnIdMap.has(player.espnId)) {
      existingId = espnIdMap.get(player.espnId);
    } else {
      // Fallback: try name + position match
      const key = `${player.name}|${player.position}`;
      if (namePositionMap.has(key)) {
        existingId = namePositionMap.get(key);
      }
    }

    if (existingId) {
      updates.push({ id: existingId, data: player });
    } else {
      inserts.push(player);
    }
  }

  console.log(`Will update ${updates.length} existing players`);
  console.log(`Will insert ${inserts.length} new players`);

  // Process updates in batches
  const BATCH_SIZE = 100;
  let updated = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(({ id, data }) =>
        db
          .update(schema.canonicalPlayers)
          .set({
            name: data.name,
            position: data.position,
            positionGroup: data.positionGroup,
            nflTeam: data.nflTeam,
            age: data.age,
            birthdate: data.birthdate,
            rookieYear: data.rookieYear,
            draftRound: data.draftRound,
            draftPick: data.draftPick,
            yearsExperience: data.yearsExperience,
            isActive: data.isActive,
            sleeperId: data.sleeperId,
            fleaflickerId: data.fleaflickerId,
            espnId: data.espnId,
            yahooId: data.yahooId,
            mflId: data.mflId,
            fantasyDataId: data.fantasyDataId,
            pfrId: data.pfrId,
            gsisPid: data.gsisPid,
            updatedAt: new Date(),
          })
          .where(eq(schema.canonicalPlayers.id, id))
      )
    );
    updated += batch.length;
    console.log(`Updated ${updated}/${updates.length} players...`);
  }

  // Insert new players in batches
  let inserted = 0;

  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const batch = inserts.slice(i, i + BATCH_SIZE);
    await db.insert(schema.canonicalPlayers).values(batch);
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${inserts.length} players...`);
  }

  const totalProcessed = updated + inserted;

  // Print summary
  console.log("\n=== Seed Complete ===");
  console.log(`Total players updated: ${updated}`);
  console.log(`Total players inserted: ${inserted}`);
  console.log(`Total players processed: ${totalProcessed}`);

  // Count by position
  const positionCounts: Record<string, number> = {};
  for (const player of playersToInsert) {
    positionCounts[player.position] =
      (positionCounts[player.position] || 0) + 1;
  }

  console.log("\nPlayers by position:");
  Object.entries(positionCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  // Count by provider ID availability
  const providerCounts = {
    sleeper: playersToInsert.filter((p) => p.sleeperId).length,
    fleaflicker: playersToInsert.filter((p) => p.fleaflickerId).length,
    espn: playersToInsert.filter((p) => p.espnId).length,
    yahoo: playersToInsert.filter((p) => p.yahooId).length,
  };

  console.log("\nPlayers with provider IDs:");
  Object.entries(providerCounts).forEach(([provider, count]) => {
    console.log(`  ${provider}: ${count}`);
  });

  console.log("\nDone!");
}

/**
 * Parse CSV text into array of objects
 */
function parseCSV(csvText: string): DynastyProcessRow[] {
  const lines = csvText.split("\n");
  if (lines.length < 2) return [];

  // Parse header
  const header = parseCSVLine(lines[0]);

  // Parse data rows
  const rows: DynastyProcessRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: DynastyProcessRow = {};

    for (let j = 0; j < header.length; j++) {
      const key = header[j].toLowerCase().replace(/\s+/g, "_");
      const value = values[j] || "";

      // Only set non-empty values
      if (value && value !== "NA" && value !== "N/A") {
        (row as Record<string, string>)[key] = value;
      }
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  // Don't forget the last field
  result.push(current.trim());

  return result;
}

// Run the script
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
