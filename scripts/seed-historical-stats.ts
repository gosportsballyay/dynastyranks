#!/usr/bin/env npx tsx
/**
 * Seed Historical Stats from nflverse
 *
 * Downloads player stats CSVs from nflverse and populates the historical_stats table.
 * Stats are used for:
 * 1. Last season points calculation (proof layer)
 * 2. Offseason projections when current projections unavailable
 *
 * Data source: https://github.com/nflverse/nflverse-data
 *
 * Usage: npx tsx scripts/seed-historical-stats.ts [--season 2023]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// nflverse data URLs
const NFLVERSE_BASE_URL =
  "https://github.com/nflverse/nflverse-data/releases/download";

// URL patterns for player stats (in priority order)
const PLAYER_STATS_URLS = (season: number) => [
  // 1. Season-specific file (available for completed seasons)
  {
    url: `${NFLVERSE_BASE_URL}/player_stats/player_stats_${season}.csv`,
    description: `Season-specific file (player_stats_${season}.csv)`,
    filterBySeason: false,
  },
  // 2. Consolidated file (contains all historical data)
  {
    url: `${NFLVERSE_BASE_URL}/player_stats/player_stats.csv`,
    description: "Consolidated player_stats.csv",
    filterBySeason: true,
  },
];

// Defense stats URLs (same pattern)
const PLAYER_STATS_DEF_URLS = (season: number) => [
  {
    url: `${NFLVERSE_BASE_URL}/player_stats/player_stats_def_${season}.csv`,
    description: `Season-specific defense file (player_stats_def_${season}.csv)`,
    filterBySeason: false,
  },
  {
    url: `${NFLVERSE_BASE_URL}/player_stats/player_stats_def.csv`,
    description: "Consolidated player_stats_def.csv",
    filterBySeason: true,
  },
];

// Play-by-play URL (fallback for aggregating current season stats)
const PBP_URL = (season: number) =>
  `${NFLVERSE_BASE_URL}/pbp/play_by_play_${season}.csv`;

interface FetchResult {
  response: Response | null;
  source: string;
  filterBySeason: boolean;
}

// Expected stat mappings - we validate these against actual CSV headers
const EXPECTED_OFFENSE_COLUMNS: Record<string, string> = {
  // Passing
  passing_yards: "pass_yd",
  passing_tds: "pass_td",
  interceptions: "int",
  passing_air_yards: "pass_air_yd",
  passing_yards_after_catch: "pass_yac",
  passing_first_downs: "pass_fd",
  passing_2pt_conversions: "pass_2pt",
  completions: "pass_cmp",
  attempts: "pass_att",
  // Rushing
  rushing_yards: "rush_yd",
  rushing_tds: "rush_td",
  rushing_first_downs: "rush_fd",
  rushing_2pt_conversions: "rush_2pt",
  carries: "rush_att",
  rushing_fumbles: "rush_fum",
  rushing_fumbles_lost: "rush_fum_lost",
  // Receiving
  receptions: "rec",
  targets: "rec_tgt",
  receiving_yards: "rec_yd",
  receiving_tds: "rec_td",
  receiving_first_downs: "rec_fd",
  receiving_2pt_conversions: "rec_2pt",
  receiving_air_yards: "rec_air_yd",
  receiving_yards_after_catch: "rec_yac",
  receiving_fumbles: "rec_fum",
  receiving_fumbles_lost: "rec_fum_lost",
  // Special teams / Misc
  special_teams_tds: "st_td",
};

// Defense columns from player_stats_def_{year}.csv
const EXPECTED_DEFENSE_COLUMNS: Record<string, string> = {
  // Tackles
  def_tackles: "tackle",
  def_tackles_solo: "tackle_solo",
  def_tackles_with_assist: "tackle_ast",
  def_tackle_assists: "tackle_assist",
  def_tackles_for_loss: "tackle_loss",
  def_tackles_for_loss_yards: "tackle_loss_yd",
  // Sacks
  def_sacks: "sack",
  def_sack_yards: "sack_yd",
  def_qb_hits: "qb_hit",
  // Interceptions
  def_interceptions: "def_int",
  def_interception_yards: "def_int_yd",
  // Fumbles - note the actual column names from nflverse
  def_fumbles_forced: "fum_force",
  def_fumble_recovery_opp: "fum_rec", // Opponent fumble recoveries
  def_fumble_recovery_yards_opp: "fum_rec_yd",
  def_fumbles: "def_fum",
  // Pass defense
  def_pass_defended: "pass_def",
  // Touchdowns
  def_tds: "def_td",
  // Safeties - note: singular form in the actual CSV!
  def_safety: "safety",
};

interface NFLVerseRow {
  player_id?: string;
  player_name?: string;
  player_display_name?: string;
  position?: string;
  position_group?: string;
  headshot_url?: string;
  recent_team?: string;
  season?: string;
  week?: string;
  season_type?: string;
  [key: string]: string | undefined;
}

interface MatchStats {
  gsis_id: number;
  name_position: number;
  unmatched: number;
}

/**
 * Get position variants for matching - comprehensive NFL → canonical mapping
 */
function getPositionVariants(position: string): string[] {
  const pos = position.toUpperCase();

  const variants: Record<string, string[]> = {
    // Defensive Line → our EDR/IL
    DE: ["EDR", "DE", "DL", "EDGE"],
    DT: ["IL", "DT", "DL", "IDL", "NT"],
    NT: ["IL", "DT", "DL", "IDL", "NT"],
    // Edge rushers
    OLB: ["EDR", "OLB", "LB", "EDGE"],
    EDGE: ["EDR", "EDGE", "DE", "OLB"],
    // Linebackers
    ILB: ["LB", "ILB", "MLB"],
    MLB: ["LB", "MLB", "ILB"],
    LB: ["LB", "ILB", "MLB", "OLB"],
    // Secondary
    CB: ["CB", "DB"],
    FS: ["S", "FS", "DB", "SS"],
    SS: ["S", "SS", "DB", "FS"],
    S: ["S", "FS", "SS", "DB"],
    DB: ["DB", "CB", "S", "FS", "SS"],
    // Reverse lookup for our positions
    EDR: ["EDR", "DE", "OLB", "EDGE", "DL"],
    IL: ["IL", "DT", "NT", "IDL", "DL"],
  };

  return variants[pos] || [pos];
}

/**
 * Check if position is defensive
 */
function isDefensivePosition(position: string): boolean {
  const pos = position.toUpperCase();
  const defensivePositions = [
    "DE",
    "DT",
    "NT",
    "OLB",
    "ILB",
    "MLB",
    "LB",
    "CB",
    "FS",
    "SS",
    "S",
    "DB",
    "EDGE",
    "EDR",
    "IL",
    "DL",
    "IDL",
  ];
  return defensivePositions.includes(pos);
}

/**
 * Match player to canonical ID using stable IDs first, name/position as fallback
 */
function matchPlayer(
  nflverseId: string,
  playerName: string,
  position: string,
  gsisMap: Map<string, string>,
  namePositionMap: Map<string, string>,
  matchStats: MatchStats,
  nameMatchLog: string[]
): string | undefined {
  // 1. GSIS ID (most reliable - nflverse player_id IS the gsis_id)
  if (gsisMap.has(nflverseId)) {
    matchStats.gsis_id++;
    return gsisMap.get(nflverseId);
  }

  // 2. Name + position (last resort)
  const normalizedName = playerName
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .trim();

  const variants = getPositionVariants(position);

  for (const variant of variants) {
    const key = `${normalizedName}|${variant}`;
    if (namePositionMap.has(key)) {
      matchStats.name_position++;
      // Only log first 50 name matches to avoid spam
      if (nameMatchLog.length < 50) {
        nameMatchLog.push(`${playerName} (${position}) → ${variant}`);
      }
      return namePositionMap.get(key);
    }
  }

  matchStats.unmatched++;
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  let seasons = [2024, 2023, 2022, 2021, 2020];

  // Parse command line args
  const seasonIndex = args.indexOf("--season");
  if (seasonIndex !== -1 && args[seasonIndex + 1]) {
    seasons = [parseInt(args[seasonIndex + 1])];
  }

  console.log("Starting historical stats seed...");
  console.log(`Seasons to process: ${seasons.join(", ")}`);

  // Check for database URL
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  // Connect to database
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  console.log("Connected to database");

  // Fetch all canonical players for matching
  console.log("Fetching canonical players...");
  const canonicalPlayers = await db.select().from(schema.canonicalPlayers);
  console.log(`Found ${canonicalPlayers.length} canonical players`);

  // Build lookup maps
  const gsisIdMap = new Map<string, string>();
  const namePositionMap = new Map<string, string>();

  // Track canonical player positions for reporting
  const canonicalByPosition: Record<string, number> = {};

  for (const player of canonicalPlayers) {
    if (player.gsisPid) gsisIdMap.set(player.gsisPid, player.id);
    // Normalize name for fuzzy matching
    const normalizedName = player.name
      .toLowerCase()
      .replace(/[.']/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
      .trim();
    namePositionMap.set(`${normalizedName}|${player.position}`, player.id);

    // Count by position
    canonicalByPosition[player.position] =
      (canonicalByPosition[player.position] || 0) + 1;
  }

  console.log("\nCanonical players by position:");
  Object.entries(canonicalByPosition)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  console.log(`\nGSIS ID mappings available: ${gsisIdMap.size}`);

  // Process each season
  for (const season of seasons) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Processing season ${season}`);
    console.log("=".repeat(50));

    try {
      await processSeason(db, season, gsisIdMap, namePositionMap);
    } catch (error) {
      console.error(`Error processing season ${season}:`, error);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("Seed Complete");
  console.log("=".repeat(50));

  // Print summary
  const statCounts = await db
    .select({
      season: schema.historicalStats.season,
    })
    .from(schema.historicalStats);

  const countBySeason: Record<number, number> = {};
  for (const row of statCounts) {
    countBySeason[row.season] = (countBySeason[row.season] || 0) + 1;
  }

  console.log("\nFinal stats by season:");
  Object.entries(countBySeason)
    .sort(([a], [b]) => parseInt(b) - parseInt(a))
    .forEach(([season, count]) => {
      console.log(`  ${season}: ${count} players`);
    });
}

/**
 * Try to fetch from multiple URL patterns, returning the first successful response
 */
async function fetchWithFallback(
  urlPatterns: Array<{ url: string; description: string; filterBySeason: boolean }>,
  context: string
): Promise<FetchResult> {
  for (const pattern of urlPatterns) {
    console.log(`  Trying: ${pattern.description}`);
    console.log(`    URL: ${pattern.url}`);

    try {
      const response = await fetch(pattern.url);
      if (response.ok) {
        console.log(`  ✓ Found data at: ${pattern.description}`);
        return {
          response,
          source: pattern.description,
          filterBySeason: pattern.filterBySeason,
        };
      } else {
        console.log(`    ✗ ${response.status} - trying next source...`);
      }
    } catch (error) {
      console.log(`    ✗ Fetch error - trying next source...`);
    }
  }

  return { response: null, source: "", filterBySeason: false };
}

/**
 * Aggregate player stats from play-by-play data (fallback for current season)
 */
async function aggregateFromPBP(
  season: number
): Promise<{ offense: string | null; defense: string | null }> {
  const pbpUrl = PBP_URL(season);
  console.log(`\n  Attempting PBP aggregation fallback...`);
  console.log(`    URL: ${pbpUrl}`);

  try {
    const response = await fetch(pbpUrl);
    if (!response.ok) {
      console.log(`    ✗ PBP data not available (${response.status})`);
      return { offense: null, defense: null };
    }

    console.log(`  ✓ Found PBP data for ${season}`);
    const pbpText = await response.text();
    console.log(`    Downloaded ${(pbpText.length / 1024 / 1024).toFixed(1)} MB`);

    // Parse PBP and aggregate player stats
    const { offenseCSV, defenseCSV } = aggregatePBPToPlayerStats(pbpText, season);

    if (offenseCSV) {
      console.log(`  ✓ Aggregated offense stats from PBP`);
    }
    if (defenseCSV) {
      console.log(`  ✓ Aggregated defense stats from PBP`);
    }

    return { offense: offenseCSV, defense: defenseCSV };
  } catch (error) {
    console.log(`    ✗ PBP aggregation failed: ${error}`);
    return { offense: null, defense: null };
  }
}

/**
 * Aggregate play-by-play data into player season stats CSVs
 */
function aggregatePBPToPlayerStats(
  pbpText: string,
  season: number
): { offenseCSV: string | null; defenseCSV: string | null } {
  const lines = pbpText.split("\n");
  if (lines.length < 2) return { offenseCSV: null, defenseCSV: null };

  const headers = parseCSVLine(lines[0]);
  const headerIndex = new Map(headers.map((h, i) => [h.toLowerCase(), i]));

  // Find relevant column indices
  const getIdx = (name: string) => headerIndex.get(name.toLowerCase()) ?? -1;

  const colMap = {
    season_type: getIdx("season_type"),
    week: getIdx("week"),
    passer_player_id: getIdx("passer_player_id"),
    passer_player_name: getIdx("passer_player_name"),
    rusher_player_id: getIdx("rusher_player_id"),
    rusher_player_name: getIdx("rusher_player_name"),
    receiver_player_id: getIdx("receiver_player_id"),
    receiver_player_name: getIdx("receiver_player_name"),
    posteam: getIdx("posteam"),
    passing_yards: getIdx("passing_yards"),
    rushing_yards: getIdx("rushing_yards"),
    receiving_yards: getIdx("receiving_yards"),
    pass_touchdown: getIdx("pass_touchdown"),
    rush_touchdown: getIdx("rush_touchdown"),
    complete_pass: getIdx("complete_pass"),
    interception: getIdx("interception"),
    fumble_lost: getIdx("fumble_lost"),
    pass_attempt: getIdx("pass_attempt"),
    rush_attempt: getIdx("rush_attempt"),
    first_down_pass: getIdx("first_down_pass"),
    first_down_rush: getIdx("first_down_rush"),
    two_point_conv_result: getIdx("two_point_conv_result"),
  };

  // Player stats accumulators
  const playerStats = new Map<string, {
    id: string;
    name: string;
    team: string;
    weeks: Set<number>;
    passing_yards: number;
    passing_tds: number;
    interceptions: number;
    completions: number;
    attempts: number;
    passing_first_downs: number;
    rushing_yards: number;
    rushing_tds: number;
    carries: number;
    rushing_first_downs: number;
    receptions: number;
    receiving_yards: number;
    receiving_tds: number;
    targets: number;
    receiving_first_downs: number;
  }>();

  const getOrCreate = (id: string, name: string, team: string) => {
    if (!playerStats.has(id)) {
      playerStats.set(id, {
        id, name, team,
        weeks: new Set(),
        passing_yards: 0, passing_tds: 0, interceptions: 0, completions: 0, attempts: 0, passing_first_downs: 0,
        rushing_yards: 0, rushing_tds: 0, carries: 0, rushing_first_downs: 0,
        receptions: 0, receiving_yards: 0, receiving_tds: 0, targets: 0, receiving_first_downs: 0,
      });
    }
    return playerStats.get(id)!;
  };

  // Process each play
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 10) continue;

    const seasonType = colMap.season_type >= 0 ? values[colMap.season_type] : "";
    if (seasonType !== "REG") continue;

    const week = colMap.week >= 0 ? parseInt(values[colMap.week] || "0") : 0;

    // Passing stats
    const passerId = colMap.passer_player_id >= 0 ? values[colMap.passer_player_id] : "";
    if (passerId && passerId !== "NA") {
      const passerName = colMap.passer_player_name >= 0 ? values[colMap.passer_player_name] : "";
      const team = colMap.posteam >= 0 ? values[colMap.posteam] : "";
      const passer = getOrCreate(passerId, passerName, team);
      passer.weeks.add(week);

      const passYards = parseFloat(values[colMap.passing_yards] || "0") || 0;
      const passTd = parseInt(values[colMap.pass_touchdown] || "0") || 0;
      const complete = parseInt(values[colMap.complete_pass] || "0") || 0;
      const int = parseInt(values[colMap.interception] || "0") || 0;
      const attempt = parseInt(values[colMap.pass_attempt] || "0") || 0;
      const firstDown = parseInt(values[colMap.first_down_pass] || "0") || 0;

      passer.passing_yards += passYards;
      passer.passing_tds += passTd;
      passer.completions += complete;
      passer.interceptions += int;
      passer.attempts += attempt;
      passer.passing_first_downs += firstDown;
    }

    // Rushing stats
    const rusherId = colMap.rusher_player_id >= 0 ? values[colMap.rusher_player_id] : "";
    if (rusherId && rusherId !== "NA") {
      const rusherName = colMap.rusher_player_name >= 0 ? values[colMap.rusher_player_name] : "";
      const team = colMap.posteam >= 0 ? values[colMap.posteam] : "";
      const rusher = getOrCreate(rusherId, rusherName, team);
      rusher.weeks.add(week);

      const rushYards = parseFloat(values[colMap.rushing_yards] || "0") || 0;
      const rushTd = parseInt(values[colMap.rush_touchdown] || "0") || 0;
      const carry = parseInt(values[colMap.rush_attempt] || "0") || 0;
      const firstDown = parseInt(values[colMap.first_down_rush] || "0") || 0;

      rusher.rushing_yards += rushYards;
      rusher.rushing_tds += rushTd;
      rusher.carries += carry;
      rusher.rushing_first_downs += firstDown;
    }

    // Receiving stats
    const receiverId = colMap.receiver_player_id >= 0 ? values[colMap.receiver_player_id] : "";
    if (receiverId && receiverId !== "NA") {
      const receiverName = colMap.receiver_player_name >= 0 ? values[colMap.receiver_player_name] : "";
      const team = colMap.posteam >= 0 ? values[colMap.posteam] : "";
      const receiver = getOrCreate(receiverId, receiverName, team);
      receiver.weeks.add(week);

      const recYards = parseFloat(values[colMap.receiving_yards] || "0") || 0;
      const recTd = parseInt(values[colMap.pass_touchdown] || "0") || 0; // TD credited to receiver
      const complete = parseInt(values[colMap.complete_pass] || "0") || 0;

      receiver.receiving_yards += recYards;
      receiver.receiving_tds += recTd;
      receiver.receptions += complete;
      receiver.targets += 1; // Each row with receiver is a target
    }
  }

  if (playerStats.size === 0) {
    return { offenseCSV: null, defenseCSV: null };
  }

  // Build offense CSV
  // Note: games_played column added for PBP-aggregated data since week=0 indicates aggregated
  const offenseHeaders = [
    "player_id", "player_display_name", "position", "recent_team", "season", "week", "season_type",
    "games_played",  // Added: count of distinct weeks player participated in
    "passing_yards", "passing_tds", "interceptions", "completions", "attempts", "passing_first_downs",
    "rushing_yards", "rushing_tds", "carries", "rushing_first_downs",
    "receptions", "receiving_yards", "receiving_tds", "targets", "receiving_first_downs"
  ];

  const offenseRows = [offenseHeaders.join(",")];
  for (const [id, stats] of playerStats) {
    // Create a season summary row (week = 0 to indicate aggregated, games_played = actual count)
    const row = [
      id, stats.name, "SKILL", stats.team, season.toString(), "0", "REG",
      stats.weeks.size.toString(),  // games_played from distinct weeks
      stats.passing_yards.toString(), stats.passing_tds.toString(), stats.interceptions.toString(),
      stats.completions.toString(), stats.attempts.toString(), stats.passing_first_downs.toString(),
      stats.rushing_yards.toString(), stats.rushing_tds.toString(), stats.carries.toString(),
      stats.rushing_first_downs.toString(),
      stats.receptions.toString(), stats.receiving_yards.toString(), stats.receiving_tds.toString(),
      stats.targets.toString(), stats.receiving_first_downs.toString()
    ];
    offenseRows.push(row.join(","));
  }

  console.log(`    Aggregated ${playerStats.size} players from ${lines.length - 1} plays`);

  return {
    offenseCSV: offenseRows.join("\n"),
    defenseCSV: null, // Defense stats from PBP would require more complex parsing
  };
}

/**
 * Check if a CSV text has data for the target season
 */
function hasSeasonData(csvText: string, targetSeason: number): boolean {
  const lines = csvText.split("\n");
  if (lines.length < 2) return false;

  const headers = parseCSVLine(lines[0]);
  const seasonIdx = headers.findIndex((h) => h.toLowerCase() === "season");
  if (seasonIdx === -1) return false;

  // Check first 1000 data rows for target season
  for (let i = 1; i < Math.min(lines.length, 1000); i++) {
    const values = parseCSVLine(lines[i]);
    if (parseInt(values[seasonIdx] || "0") === targetSeason) {
      return true;
    }
  }

  // If not found in first 1000, check last 1000 (data is often chronological)
  for (let i = Math.max(1, lines.length - 1000); i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (parseInt(values[seasonIdx] || "0") === targetSeason) {
      return true;
    }
  }

  return false;
}

async function processSeason(
  db: ReturnType<typeof drizzle>,
  season: number,
  gsisIdMap: Map<string, string>,
  namePositionMap: Map<string, string>
) {
  // nflverse has SEPARATE files for offense and defense stats!
  // We need to fetch both and merge them

  // 1. Fetch OFFENSE stats with fallback strategy
  console.log(`\nFetching OFFENSE stats for ${season}:`);
  const offenseResult = await fetchWithFallback(PLAYER_STATS_URLS(season), "offense");

  let offenseText: string | null = null;
  let offenseFilterBySeason = false;
  let offenseSource = "";

  if (offenseResult.response) {
    offenseText = await offenseResult.response.text();
    offenseFilterBySeason = offenseResult.filterBySeason;
    offenseSource = offenseResult.source;

    // Check if consolidated file actually has data for this season
    if (offenseFilterBySeason && !hasSeasonData(offenseText, season)) {
      console.log(`  ⚠️  Consolidated file doesn't contain ${season} data`);
      offenseText = null; // Reset to trigger PBP fallback
    } else {
      console.log(`  Source: ${offenseSource}`);
    }
  }

  // Try PBP aggregation if no data found
  if (!offenseText) {
    const pbpData = await aggregateFromPBP(season);
    if (pbpData.offense) {
      offenseText = pbpData.offense;
      offenseFilterBySeason = false;
      offenseSource = "PBP aggregation";
      console.log(`  Source: ${offenseSource}`);
    }
  }

  if (!offenseText) {
    console.error(`\n❌ No offense stats available for season ${season}`);
    console.error(`   Tried: Season-specific file, consolidated file, PBP aggregation`);
    console.error(`   The ${season} season data may not yet be available in nflverse.`);
    return;
  }

  // 2. Fetch DEFENSE stats with fallback strategy
  console.log(`\nFetching DEFENSE stats for ${season}:`);
  const defenseResult = await fetchWithFallback(PLAYER_STATS_DEF_URLS(season), "defense");

  let defenseText: string | null = null;
  let defenseFilterBySeason = false;

  if (defenseResult.response) {
    defenseText = await defenseResult.response.text();
    defenseFilterBySeason = defenseResult.filterBySeason;

    // Check if consolidated file actually has data for this season
    if (defenseFilterBySeason && !hasSeasonData(defenseText, season)) {
      console.log(`  ⚠️  Consolidated defense file doesn't contain ${season} data`);
      defenseText = null;
    } else {
      console.log(`  Source: ${defenseResult.source}`);
    }
  }

  if (!defenseText) {
    console.warn(`  ⚠️  No defense stats available for ${season} - proceeding with offense only`);
  }

  await processBothCSVsText(
    db,
    offenseText,
    defenseText,
    season,
    offenseFilterBySeason,
    defenseFilterBySeason,
    gsisIdMap,
    namePositionMap
  );
}

/**
 * Process offense and defense CSV text data
 * Handles filterBySeason to extract only the target season from consolidated files
 */
async function processBothCSVsText(
  db: ReturnType<typeof drizzle>,
  offenseText: string,
  defenseText: string | null,
  targetSeason: number,
  offenseFilterBySeason: boolean,
  defenseFilterBySeason: boolean,
  gsisIdMap: Map<string, string>,
  namePositionMap: Map<string, string>
) {
  // Player stats map: playerId -> aggregated stats
  const playerStats = new Map<
    string,
    {
      playerId: string;
      name: string;
      position: string;
      team: string;
      gamesPlayed: Set<number>; // Track unique weeks to avoid double-counting
      stats: Record<string, number>;
      gameLogs: Record<number, Record<string, number>>;
    }
  >();

  // 1. Process OFFENSE stats
  console.log(`Processing OFFENSE CSV (${(offenseText.length / 1024).toFixed(0)} KB)`);

  const offenseLines = offenseText.split("\n");
  if (offenseLines.length < 2) {
    console.error("Offense CSV has no data rows");
    return;
  }

  const offenseHeaders = parseCSVLine(offenseLines[0]);
  const offenseMapping = buildOffenseColumnMapping(offenseHeaders);

  console.log(`Mapped ${Object.keys(offenseMapping.mapping).length} offense columns`);
  if (offenseMapping.warnings.length > 0) {
    console.log("Offense column warnings:");
    offenseMapping.warnings.slice(0, 5).forEach((w) => console.warn(`  ⚠️  ${w}`));
  }

  const offenseRows = parseCSVRows(offenseLines, offenseHeaders);

  // Filter by season if needed (consolidated file contains multiple seasons)
  let regularOffenseRows = offenseRows.filter((row) => row.season_type === "REG");
  if (offenseFilterBySeason) {
    const beforeCount = regularOffenseRows.length;
    regularOffenseRows = regularOffenseRows.filter(
      (row) => parseInt(row.season || "0") === targetSeason
    );
    console.log(`Filtered offense by season ${targetSeason}: ${beforeCount} → ${regularOffenseRows.length} rows`);
  }
  console.log(`Parsed ${regularOffenseRows.length} regular season offense rows for ${targetSeason}`);

  // Check if data has explicit games_played column (PBP-aggregated data)
  const hasGamesPlayedColumn = offenseHeaders.some(h => h.toLowerCase() === "games_played");
  if (hasGamesPlayedColumn) {
    console.log(`  Found games_played column (PBP-aggregated data)`);
  }

  // Aggregate offense stats
  for (const row of regularOffenseRows) {
    const playerId = row.player_id || "";
    const playerName = row.player_display_name || row.player_name || "";
    const position = row.position || "";
    const team = row.recent_team || row.team || "";

    if (!playerId || !playerName) continue;

    if (!playerStats.has(playerId)) {
      playerStats.set(playerId, {
        playerId,
        name: playerName,
        position,
        team,
        gamesPlayed: new Set(),
        stats: {},
        gameLogs: {},
      });
    }

    const player = playerStats.get(playerId)!;

    // Handle games_played: PBP-aggregated data has explicit column, weekly data uses week number
    if (hasGamesPlayedColumn) {
      // PBP-aggregated: use the games_played column directly
      const gamesPlayed = parseInt(row.games_played || "0");
      if (gamesPlayed > 0) {
        // Add placeholder weeks 1..N to represent the game count
        for (let w = 1; w <= gamesPlayed; w++) {
          player.gamesPlayed.add(w);
        }
      }
      // PBP-aggregated data has no weekly granularity — gameLogs stays empty
    } else {
      // Weekly data: add actual week number and capture per-game stats
      const week = parseInt(row.week || "0");
      if (week > 0) {
        player.gamesPlayed.add(week);
        if (!player.gameLogs[week]) player.gameLogs[week] = {};
        for (const [nflverseCol, ourCol] of Object.entries(
          offenseMapping.mapping,
        )) {
          const value = parseFloat(row[nflverseCol] || "0");
          if (!isNaN(value) && value !== 0) {
            player.gameLogs[week][ourCol] =
              (player.gameLogs[week][ourCol] || 0) + value;
          }
        }
      }
    }

    player.team = team;

    for (const [nflverseCol, ourCol] of Object.entries(offenseMapping.mapping)) {
      const value = parseFloat(row[nflverseCol] || "0");
      if (!isNaN(value)) {
        player.stats[ourCol] = (player.stats[ourCol] || 0) + value;
      }
    }
  }

  console.log(`Aggregated offense stats for ${playerStats.size} players`);

  // 2. Process DEFENSE stats (if available)
  let defensePlayerCount = 0;
  if (defenseText) {
    console.log(`\nProcessing DEFENSE CSV (${(defenseText.length / 1024).toFixed(0)} KB)`);

    const defenseLines = defenseText.split("\n");
    if (defenseLines.length >= 2) {
      const defenseHeaders = parseCSVLine(defenseLines[0]);
      const defenseMapping = buildDefenseColumnMapping(defenseHeaders);

      console.log(`Mapped ${Object.keys(defenseMapping.mapping).length} defense columns`);
      if (defenseMapping.warnings.length > 0) {
        console.log("Defense column warnings:");
        defenseMapping.warnings.slice(0, 5).forEach((w) => console.warn(`  ⚠️  ${w}`));
      }

      const defenseRows = parseCSVRows(defenseLines, defenseHeaders);

      // Filter by season if needed
      let regularDefenseRows = defenseRows.filter((row) => row.season_type === "REG");
      if (defenseFilterBySeason) {
        const beforeCount = regularDefenseRows.length;
        regularDefenseRows = regularDefenseRows.filter(
          (row) => parseInt(row.season || "0") === targetSeason
        );
        console.log(`Filtered defense by season ${targetSeason}: ${beforeCount} → ${regularDefenseRows.length} rows`);
      }
      console.log(`Parsed ${regularDefenseRows.length} regular season defense rows for ${targetSeason}`);

      // Track unique defensive players
      const defensePlayersSet = new Set<string>();

      // Aggregate defense stats
      for (const row of regularDefenseRows) {
        const playerId = row.player_id || "";
        const playerName = row.player_display_name || row.player_name || "";
        const position = row.position || "";
        const team = row.recent_team || row.team || "";

        if (!playerId || !playerName) continue;

        defensePlayersSet.add(playerId);

        if (!playerStats.has(playerId)) {
          // New defensive player not in offense file
          playerStats.set(playerId, {
            playerId,
            name: playerName,
            position,
            team,
            gamesPlayed: new Set(),
            stats: {},
            gameLogs: {},
          });
        }

        const player = playerStats.get(playerId)!;
        // Track games played by week number to avoid double-counting
        const week = parseInt(row.week || "0");
        if (week > 0) {
          player.gamesPlayed.add(week);
          // Capture per-game defense stats
          if (!player.gameLogs[week]) player.gameLogs[week] = {};
          for (const [nflverseCol, ourCol] of Object.entries(
            defenseMapping.mapping,
          )) {
            const value = parseFloat(row[nflverseCol] || "0");
            if (!isNaN(value) && value !== 0) {
              player.gameLogs[week][ourCol] =
                (player.gameLogs[week][ourCol] || 0) + value;
            }
          }
        }
        // Update position if it's more specific
        if (isDefensivePosition(position) && !isDefensivePosition(player.position)) {
          player.position = position;
        }
        player.team = team;

        for (const [nflverseCol, ourCol] of Object.entries(defenseMapping.mapping)) {
          const value = parseFloat(row[nflverseCol] || "0");
          if (!isNaN(value)) {
            player.stats[ourCol] = (player.stats[ourCol] || 0) + value;
          }
        }
      }

      defensePlayerCount = defensePlayersSet.size;
      console.log(`Found ${defensePlayerCount} unique defensive players`);
    }
  }

  console.log(`\nTotal aggregated: ${playerStats.size} unique players`);

  // Count players by position
  const byPosition: Record<string, number> = {};
  for (const player of playerStats.values()) {
    byPosition[player.position] = (byPosition[player.position] || 0) + 1;
  }

  console.log("\nPlayers by nflverse position:");
  Object.entries(byPosition)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  // Match players to canonical IDs and prepare inserts
  const toInsert: Array<{
    canonicalPlayerId: string;
    season: number;
    gamesPlayed: number;
    stats: Record<string, number>;
    gameLogs: Record<number, Record<string, number>> | null;
    source: string;
  }> = [];

  const matchStats: MatchStats = { gsis_id: 0, name_position: 0, unmatched: 0 };
  const nameMatchLog: string[] = [];
  const unmatchedDefensive: string[] = [];

  for (const player of playerStats.values()) {
    const canonicalId = matchPlayer(
      player.playerId,
      player.name,
      player.position,
      gsisIdMap,
      namePositionMap,
      matchStats,
      nameMatchLog
    );

    if (canonicalId) {
      const hasStats = Object.values(player.stats).some((v) => v > 0);
      if (hasStats) {
        toInsert.push({
          canonicalPlayerId: canonicalId,
          season: targetSeason,
          gamesPlayed: player.gamesPlayed.size,
          stats: player.stats,
          gameLogs: Object.keys(player.gameLogs).length > 0
            ? player.gameLogs
            : null,
          source: "nflverse",
        });
      }
    } else if (isDefensivePosition(player.position)) {
      unmatchedDefensive.push(`${player.name} (${player.position})`);
    }
  }

  // Log match summary
  console.log("\n=== MATCH SUMMARY ===");
  console.log(`  ✓ GSIS ID:        ${matchStats.gsis_id}`);
  console.log(`  ⚠️  Name/Position: ${matchStats.name_position}`);
  console.log(`  ❌ Unmatched:      ${matchStats.unmatched}`);
  console.log(`  📊 Total to insert: ${toInsert.length}`);

  if (nameMatchLog.length > 0) {
    console.log(`\n⚠️  NAME MATCH EXAMPLES (${nameMatchLog.length} total):`);
    nameMatchLog.slice(0, 10).forEach((m) => console.log(`    - ${m}`));
    if (nameMatchLog.length > 10) {
      console.log(`    ... and ${nameMatchLog.length - 10} more`);
    }
  }

  if (unmatchedDefensive.length > 0) {
    console.log(`\n❌ UNMATCHED DEFENSIVE PLAYERS (${unmatchedDefensive.length} total):`);
    unmatchedDefensive.slice(0, 20).forEach((p) => console.log(`    - ${p}`));
    if (unmatchedDefensive.length > 20) {
      console.log(`    ... and ${unmatchedDefensive.length - 20} more`);
    }
  }

  // Count matched by position
  const matchedByPosition: Record<string, number> = {};
  for (const player of playerStats.values()) {
    const matched = gsisIdMap.has(player.playerId) ||
      nameMatchLog.some((m) => m.includes(player.name));
    if (matched) {
      const hasStats = Object.values(player.stats).some((v) => v > 0);
      if (hasStats) {
        matchedByPosition[player.position] =
          (matchedByPosition[player.position] || 0) + 1;
      }
    }
  }

  console.log("\nMatched players by nflverse position:");
  Object.entries(matchedByPosition)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  // Delete existing stats for this season
  console.log(`\nDeleting existing stats for season ${targetSeason}...`);
  await db
    .delete(schema.historicalStats)
    .where(eq(schema.historicalStats.season, targetSeason));

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await db.insert(schema.historicalStats).values(batch);
    inserted += batch.length;
    if (i % 500 === 0 || i + BATCH_SIZE >= toInsert.length) {
      console.log(`Inserted ${inserted}/${toInsert.length} player stats...`);
    }
  }

  console.log(`\n✓ Inserted ${inserted} player stats for season ${targetSeason}`);
}

// Legacy function kept for reference - now using processBothCSVsText
async function processBothCSVs(
  db: ReturnType<typeof drizzle>,
  offenseResponse: Response,
  defenseResponse: Response | null,
  targetSeason: number,
  gsisIdMap: Map<string, string>,
  namePositionMap: Map<string, string>
) {
  // Player stats map: playerId -> aggregated stats
  const playerStats = new Map<
    string,
    {
      playerId: string;
      name: string;
      position: string;
      team: string;
      gamesPlayed: Set<number>; // Track unique weeks to avoid double-counting
      stats: Record<string, number>;
    }
  >();

  // 1. Process OFFENSE stats
  const offenseText = await offenseResponse.text();
  console.log(`Downloaded OFFENSE CSV (${(offenseText.length / 1024).toFixed(0)} KB)`);

  const offenseLines = offenseText.split("\n");
  if (offenseLines.length < 2) {
    console.error("Offense CSV has no data rows");
    return;
  }

  const offenseHeaders = parseCSVLine(offenseLines[0]);
  const offenseMapping = buildOffenseColumnMapping(offenseHeaders);

  console.log(`Mapped ${Object.keys(offenseMapping.mapping).length} offense columns`);
  if (offenseMapping.warnings.length > 0) {
    console.log("Offense column warnings:");
    offenseMapping.warnings.slice(0, 5).forEach((w) => console.warn(`  ⚠️  ${w}`));
  }

  const offenseRows = parseCSVRows(offenseLines, offenseHeaders);
  const regularOffenseRows = offenseRows.filter(
    (row) => row.season_type === "REG"
  );
  console.log(`Parsed ${regularOffenseRows.length} regular season offense rows`);

  // Aggregate offense stats
  for (const row of regularOffenseRows) {
    const playerId = row.player_id || "";
    const playerName = row.player_display_name || row.player_name || "";
    const position = row.position || "";
    const team = row.recent_team || row.team || "";

    if (!playerId || !playerName) continue;

    if (!playerStats.has(playerId)) {
      playerStats.set(playerId, {
        playerId,
        name: playerName,
        position,
        team,
        gamesPlayed: new Set(),
        stats: {},
      });
    }

    const player = playerStats.get(playerId)!;
    const week = parseInt(row.week || "0");
    if (week > 0) player.gamesPlayed.add(week);
    player.team = team;

    for (const [nflverseCol, ourCol] of Object.entries(offenseMapping.mapping)) {
      const value = parseFloat(row[nflverseCol] || "0");
      if (!isNaN(value)) {
        player.stats[ourCol] = (player.stats[ourCol] || 0) + value;
      }
    }
  }

  console.log(`Aggregated offense stats for ${playerStats.size} players`);

  // 2. Process DEFENSE stats (if available)
  let defensePlayerCount = 0;
  if (defenseResponse) {
    const defenseText = await defenseResponse.text();
    console.log(`\nDownloaded DEFENSE CSV (${(defenseText.length / 1024).toFixed(0)} KB)`);

    const defenseLines = defenseText.split("\n");
    if (defenseLines.length >= 2) {
      const defenseHeaders = parseCSVLine(defenseLines[0]);
      const defenseMapping = buildDefenseColumnMapping(defenseHeaders);

      console.log(`Mapped ${Object.keys(defenseMapping.mapping).length} defense columns`);
      if (defenseMapping.warnings.length > 0) {
        console.log("Defense column warnings:");
        defenseMapping.warnings.slice(0, 5).forEach((w) => console.warn(`  ⚠️  ${w}`));
      }

      const defenseRows = parseCSVRows(defenseLines, defenseHeaders);
      const regularDefenseRows = defenseRows.filter(
        (row) => row.season_type === "REG"
      );
      console.log(`Parsed ${regularDefenseRows.length} regular season defense rows`);

      // Track unique defensive players
      const defensePlayersSet = new Set<string>();

      // Aggregate defense stats
      for (const row of regularDefenseRows) {
        const playerId = row.player_id || "";
        const playerName = row.player_display_name || row.player_name || "";
        const position = row.position || "";
        const team = row.recent_team || row.team || "";

        if (!playerId || !playerName) continue;

        defensePlayersSet.add(playerId);

        if (!playerStats.has(playerId)) {
          // New defensive player not in offense file
          playerStats.set(playerId, {
            playerId,
            name: playerName,
            position,
            team,
            gamesPlayed: new Set(),
            stats: {},
          });
        }

        const player = playerStats.get(playerId)!;
        // Track games played by week number to avoid double-counting
        const week = parseInt(row.week || "0");
        if (week > 0) player.gamesPlayed.add(week);
        // Update position if it's more specific
        if (isDefensivePosition(position) && !isDefensivePosition(player.position)) {
          player.position = position;
        }
        player.team = team;

        for (const [nflverseCol, ourCol] of Object.entries(defenseMapping.mapping)) {
          const value = parseFloat(row[nflverseCol] || "0");
          if (!isNaN(value)) {
            player.stats[ourCol] = (player.stats[ourCol] || 0) + value;
          }
        }
      }

      defensePlayerCount = defensePlayersSet.size;
      console.log(`Found ${defensePlayerCount} unique defensive players`);
    }
  }

  console.log(`\nTotal aggregated: ${playerStats.size} unique players`);

  // Count players by position
  const byPosition: Record<string, number> = {};
  for (const player of playerStats.values()) {
    byPosition[player.position] = (byPosition[player.position] || 0) + 1;
  }

  console.log("\nPlayers by nflverse position:");
  Object.entries(byPosition)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  // Match players to canonical IDs and prepare inserts
  const toInsert: Array<{
    canonicalPlayerId: string;
    season: number;
    gamesPlayed: number;
    stats: Record<string, number>;
    source: string;
  }> = [];

  const matchStats: MatchStats = { gsis_id: 0, name_position: 0, unmatched: 0 };
  const nameMatchLog: string[] = [];
  const unmatchedDefensive: string[] = [];

  for (const player of playerStats.values()) {
    const canonicalId = matchPlayer(
      player.playerId,
      player.name,
      player.position,
      gsisIdMap,
      namePositionMap,
      matchStats,
      nameMatchLog
    );

    if (canonicalId) {
      const hasStats = Object.values(player.stats).some((v) => v > 0);
      if (hasStats) {
        toInsert.push({
          canonicalPlayerId: canonicalId,
          season: targetSeason,
          gamesPlayed: player.gamesPlayed.size,
          stats: player.stats,
          source: "nflverse",
        });
      }
    } else if (isDefensivePosition(player.position)) {
      unmatchedDefensive.push(`${player.name} (${player.position})`);
    }
  }

  // Log match summary
  console.log("\n=== MATCH SUMMARY ===");
  console.log(`  ✓ GSIS ID:        ${matchStats.gsis_id}`);
  console.log(`  ⚠️  Name/Position: ${matchStats.name_position}`);
  console.log(`  ❌ Unmatched:      ${matchStats.unmatched}`);
  console.log(`  📊 Total to insert: ${toInsert.length}`);

  if (nameMatchLog.length > 0) {
    console.log(`\n⚠️  NAME MATCH EXAMPLES (${nameMatchLog.length} total):`);
    nameMatchLog.slice(0, 10).forEach((m) => console.log(`    - ${m}`));
    if (nameMatchLog.length > 10) {
      console.log(`    ... and ${nameMatchLog.length - 10} more`);
    }
  }

  if (unmatchedDefensive.length > 0) {
    console.log(`\n❌ UNMATCHED DEFENSIVE PLAYERS (${unmatchedDefensive.length} total):`);
    unmatchedDefensive.slice(0, 20).forEach((p) => console.log(`    - ${p}`));
    if (unmatchedDefensive.length > 20) {
      console.log(`    ... and ${unmatchedDefensive.length - 20} more`);
    }
  }

  // Count matched by position
  const matchedByPosition: Record<string, number> = {};
  for (const player of playerStats.values()) {
    const matched = gsisIdMap.has(player.playerId) ||
      nameMatchLog.some((m) => m.includes(player.name));
    if (matched) {
      const hasStats = Object.values(player.stats).some((v) => v > 0);
      if (hasStats) {
        matchedByPosition[player.position] =
          (matchedByPosition[player.position] || 0) + 1;
      }
    }
  }

  console.log("\nMatched players by nflverse position:");
  Object.entries(matchedByPosition)
    .sort(([, a], [, b]) => b - a)
    .forEach(([pos, count]) => {
      console.log(`  ${pos}: ${count}`);
    });

  // Delete existing stats for this season
  console.log(`\nDeleting existing stats for season ${targetSeason}...`);
  await db
    .delete(schema.historicalStats)
    .where(eq(schema.historicalStats.season, targetSeason));

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await db.insert(schema.historicalStats).values(batch);
    inserted += batch.length;
    if (i % 500 === 0 || i + BATCH_SIZE >= toInsert.length) {
      console.log(`Inserted ${inserted}/${toInsert.length} player stats...`);
    }
  }

  console.log(`\n✓ Inserted ${inserted} player stats for season ${targetSeason}`);
}

/**
 * Build offense column mapping from CSV headers
 */
function buildOffenseColumnMapping(csvHeaders: string[]): {
  mapping: Record<string, string>;
  warnings: string[];
} {
  const headerSet = new Set(csvHeaders.map((h) => h.toLowerCase().trim()));
  const mapping: Record<string, string> = {};
  const warnings: string[] = [];

  for (const [expected, ourKey] of Object.entries(EXPECTED_OFFENSE_COLUMNS)) {
    if (headerSet.has(expected)) {
      mapping[expected] = ourKey;
    } else {
      warnings.push(`Missing offense column: ${expected}`);
    }
  }

  return { mapping, warnings };
}

/**
 * Build defense column mapping from CSV headers
 */
function buildDefenseColumnMapping(csvHeaders: string[]): {
  mapping: Record<string, string>;
  warnings: string[];
} {
  const headerSet = new Set(csvHeaders.map((h) => h.toLowerCase().trim()));
  const mapping: Record<string, string> = {};
  const warnings: string[] = [];

  for (const [expected, ourKey] of Object.entries(EXPECTED_DEFENSE_COLUMNS)) {
    if (headerSet.has(expected)) {
      mapping[expected] = ourKey;
    } else {
      warnings.push(`Missing defense column: ${expected}`);
    }
  }

  return { mapping, warnings };
}

/**
 * Parse CSV data rows into array of objects
 */
function parseCSVRows(lines: string[], headers: string[]): NFLVerseRow[] {
  const rows: NFLVerseRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: NFLVerseRow = {};

    for (let j = 0; j < headers.length; j++) {
      const key = headers[j].toLowerCase().trim();
      const value = values[j] || "";

      // Only set non-empty values
      if (value && value !== "NA" && value !== "N/A" && value !== "nan") {
        row[key] = value;
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
