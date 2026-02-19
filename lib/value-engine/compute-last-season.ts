/**
 * Compute Last Season Points
 *
 * Calculates fantasy points from actual historical stats using league-specific
 * scoring rules. This proves the scoring engine works and provides a baseline
 * for rankings even when projections are unavailable.
 */

import { db } from "@/lib/db/client";
import { historicalStats, canonicalPlayers } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { calculateFantasyPoints } from "./vorp";
import { normalizeStatKeys } from "@/lib/stats/canonical-keys";

export interface LastSeasonResult {
  canonicalPlayerId: string;
  points: number;
  gamesPlayed: number;
  rankOverall: number;
  rankPosition: number;
  position: string;
}

export interface ComputeLastSeasonOptions {
  scoringRules: Record<string, number>;
  positionScoringOverrides?: Record<string, Record<string, number>>;
  bonusThresholds?: Record<string, Array<{ min: number; max?: number; bonus: number }>>;
  season?: number;
}

/**
 * Get the most recently fully completed NFL season.
 *
 * NFL Calendar:
 * - Season N runs Sept Year N → early Feb Year N+1
 * - Super Bowl is in early February
 * - After Super Bowl (Feb onwards), Season N is complete
 *
 * Returns the year of the most recently finished season.
 */
export function getMostRecentCompletedSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // Super Bowl is typically first Sunday in February
  // So after mid-February, the previous year's season is fully complete
  if (month >= 2) {
    // Feb-Dec: Season (year-1) is complete
    return year - 1;
  }
  // January: Season (year-1) playoffs still in progress, but regular season complete
  // We consider year-1 as "complete" even in January for stats purposes
  return year - 1;
}

/**
 * Get the target season for value/ranking calculations.
 *
 * This determines what season's data to use:
 * - January through August: Use the most recent completed season actuals
 *   (e.g., in Jan-Aug 2026, use 2025 season stats)
 * - September through December: Use current season (for projections or partial stats)
 *   (e.g., in Sept-Dec 2026, use 2026 projections)
 *
 * This is UNIVERSAL for all leagues/adapters - the value engine auto-detects
 * which season's data to use based on calendar, not database configuration.
 */
export function getTargetSeasonForRankings(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  if (month >= 9) {
    // September-December: In-season, use current year for projections/partial stats
    return year;
  }
  // January-August: Offseason, use most recent completed season
  return year - 1;
}

/**
 * Determine if we're in offseason (should use actuals) vs in-season (use projections)
 */
export function isOffseason(): boolean {
  const month = new Date().getMonth() + 1;
  // Offseason: February through August
  // January is tricky - playoffs ongoing but we have full regular season data
  return month >= 1 && month <= 8;
}

/**
 * Compute last season fantasy points for all players using league scoring rules
 */
export async function computeLastSeasonPoints(
  options: ComputeLastSeasonOptions
): Promise<Map<string, LastSeasonResult>> {
  const { scoringRules, positionScoringOverrides, bonusThresholds } = options;
  const season = options.season ?? getMostRecentCompletedSeason();

  // Fetch all historical stats for the season joined with player info
  const statsWithPlayers = await db
    .select({
      stat: historicalStats,
      player: canonicalPlayers,
    })
    .from(historicalStats)
    .innerJoin(
      canonicalPlayers,
      eq(historicalStats.canonicalPlayerId, canonicalPlayers.id)
    )
    .where(eq(historicalStats.season, season));

  if (statsWithPlayers.length === 0) {
    console.warn(`No historical stats found for season ${season}`);
    return new Map();
  }

  console.log(
    `Computing last season points for ${statsWithPlayers.length} players (season ${season})`
  );

  // Calculate fantasy points for each player
  const playerResults: Array<{
    canonicalPlayerId: string;
    points: number;
    gamesPlayed: number;
    position: string;
  }> = [];

  for (const { stat, player } of statsWithPlayers) {
    // Get position-specific overrides if they exist
    const overrides = positionScoringOverrides?.[player.position] ?? undefined;
    const gamesPlayed = stat.gamesPlayed ?? 17;

    // Calculate fantasy points using the same function as projections
    // Note: For historical data, bonus thresholds use the actual games played
    const points = calculateFantasyPoints(
      normalizeStatKeys(stat.stats as Record<string, number>),
      scoringRules,
      overrides,
      bonusThresholds,
      gamesPlayed
    );

    playerResults.push({
      canonicalPlayerId: player.id,
      points,
      gamesPlayed,
      position: player.position,
    });
  }

  // Sort by points descending for overall ranking
  playerResults.sort((a, b) => b.points - a.points);

  // Assign overall ranks
  const results = new Map<string, LastSeasonResult>();

  let overallRank = 1;
  for (const player of playerResults) {
    results.set(player.canonicalPlayerId, {
      ...player,
      rankOverall: overallRank,
      rankPosition: 0, // Will be set below
    });
    overallRank++;
  }

  // Calculate position ranks
  const positionGroups = new Map<string, string[]>();
  for (const player of playerResults) {
    const existing = positionGroups.get(player.position) ?? [];
    existing.push(player.canonicalPlayerId);
    positionGroups.set(player.position, existing);
  }

  for (const [position, playerIds] of positionGroups) {
    // Players are already sorted by points, so order in array is position rank
    let posRank = 1;
    for (const playerId of playerIds) {
      const result = results.get(playerId);
      if (result) {
        result.rankPosition = posRank;
        posRank++;
      }
    }
  }

  return results;
}

/**
 * Get last season stats for a single player
 */
export async function getPlayerLastSeasonStats(
  canonicalPlayerId: string,
  season?: number
): Promise<{
  stats: Record<string, number>;
  gamesPlayed: number;
  season: number;
} | null> {
  const targetSeason = season ?? getMostRecentCompletedSeason();

  const [result] = await db
    .select()
    .from(historicalStats)
    .where(
      and(
        eq(historicalStats.canonicalPlayerId, canonicalPlayerId),
        eq(historicalStats.season, targetSeason)
      )
    )
    .limit(1);

  if (!result) return null;

  return {
    stats: result.stats as Record<string, number>,
    gamesPlayed: result.gamesPlayed ?? 0,
    season: result.season,
  };
}

/**
 * Get multiple seasons of historical stats for a player
 * Returns array sorted by season descending (most recent first)
 */
export async function getPlayerHistoricalStats(
  canonicalPlayerId: string,
  numSeasons: number = 3
): Promise<
  Array<{
    stats: Record<string, number>;
    gamesPlayed: number;
    season: number;
  }>
> {
  const results = await db
    .select()
    .from(historicalStats)
    .where(eq(historicalStats.canonicalPlayerId, canonicalPlayerId))
    .orderBy(desc(historicalStats.season))
    .limit(numSeasons);

  return results.map((r) => ({
    stats: r.stats as Record<string, number>,
    gamesPlayed: r.gamesPlayed ?? 0,
    season: r.season,
  }));
}

/**
 * Get all historical stats for a season grouped by player
 * Returns a Map for efficient lookup
 */
export async function getSeasonHistoricalStats(
  season: number
): Promise<
  Map<
    string,
    {
      stats: Record<string, number>;
      gamesPlayed: number;
    }
  >
> {
  const results = await db
    .select()
    .from(historicalStats)
    .where(eq(historicalStats.season, season));

  const statsMap = new Map<
    string,
    { stats: Record<string, number>; gamesPlayed: number }
  >();

  for (const row of results) {
    statsMap.set(row.canonicalPlayerId, {
      stats: row.stats as Record<string, number>,
      gamesPlayed: row.gamesPlayed ?? 0,
    });
  }

  return statsMap;
}

/**
 * Summary stats about available historical data
 */
export async function getHistoricalStatsSummary(): Promise<{
  seasons: number[];
  countBySeason: Record<number, number>;
  countByPosition: Record<string, number>;
  latestSeason: number;
}> {
  const allStats = await db
    .select({
      season: historicalStats.season,
      playerId: historicalStats.canonicalPlayerId,
    })
    .from(historicalStats);

  // Get positions
  const playerIds = [...new Set(allStats.map((s) => s.playerId))];
  const players = await db
    .select({ id: canonicalPlayers.id, position: canonicalPlayers.position })
    .from(canonicalPlayers);

  const positionMap = new Map(players.map((p) => [p.id, p.position]));

  const seasons = [...new Set(allStats.map((s) => s.season))].sort(
    (a, b) => b - a
  );

  const countBySeason: Record<number, number> = {};
  const countByPosition: Record<string, number> = {};

  for (const stat of allStats) {
    countBySeason[stat.season] = (countBySeason[stat.season] || 0) + 1;
    const position = positionMap.get(stat.playerId) || "UNKNOWN";
    countByPosition[position] = (countByPosition[position] || 0) + 1;
  }

  return {
    seasons,
    countBySeason,
    countByPosition,
    latestSeason: seasons[0] || 0,
  };
}
