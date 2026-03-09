/**
 * Player ID mapping utilities
 * 
 * Maps external player IDs from various providers to our canonical player records.
 */

import { db } from "@/lib/db/client";
import { canonicalPlayers } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { Provider } from "@/types";

type CanonicalPlayer = typeof canonicalPlayers.$inferSelect;

/**
 * Get canonical players by their provider-specific IDs with optional name fallback
 */
export async function getPlayersByProviderIds(
  provider: Provider,
  externalIds: string[],
  playerInfo?: Map<string, { name: string; position: string }>
): Promise<Map<string, CanonicalPlayer>> {
  if (externalIds.length === 0) {
    return new Map();
  }

  // Remove duplicates and nulls
  const uniqueIds = [...new Set(externalIds.filter(Boolean))];

  // Map provider to column name
  const columnMap: Record<Provider, keyof CanonicalPlayer> = {
    sleeper: "sleeperId",
    fleaflicker: "fleaflickerId",
    espn: "espnId",
    yahoo: "yahooId",
  };

  const column = columnMap[provider];
  if (!column) {
    console.warn(`Unknown provider: ${provider}`);
    return new Map();
  }

  // Query players - need to batch for large lists
  const BATCH_SIZE = 500;
  const allPlayers: CanonicalPlayer[] = [];

  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE);

    // Build the query based on provider
    let players: CanonicalPlayer[];

    if (provider === "sleeper") {
      players = await db
        .select()
        .from(canonicalPlayers)
        .where(inArray(canonicalPlayers.sleeperId, batch));
    } else if (provider === "fleaflicker") {
      players = await db
        .select()
        .from(canonicalPlayers)
        .where(inArray(canonicalPlayers.fleaflickerId, batch));
    } else if (provider === "espn") {
      players = await db
        .select()
        .from(canonicalPlayers)
        .where(inArray(canonicalPlayers.espnId, batch));
    } else {
      players = await db
        .select()
        .from(canonicalPlayers)
        .where(inArray(canonicalPlayers.yahooId, batch));
    }

    allPlayers.push(...players);
  }

  // Create map from external ID to player
  const result = new Map<string, CanonicalPlayer>();

  for (const player of allPlayers) {
    const externalId = player[column] as string | null;
    if (externalId) {
      result.set(externalId, player);
    }
  }

  // If playerInfo provided, do name fallback for unmatched players
  if (playerInfo) {
    // Need to fetch all players for name matching if some are still unmatched
    const unmatchedIds = uniqueIds.filter((id) => !result.has(id));

    if (unmatchedIds.length > 0) {
      // Full table scan (~3000 rows) is acceptable at MVP scale.
      // Called once per sync, not per player lookup.
      const allCanonicalPlayers = await db.select().from(canonicalPlayers);

      for (const externalId of unmatchedIds) {
        const info = playerInfo.get(externalId);
        if (!info) continue;

        const match = findPlayerByNamePosition(allCanonicalPlayers, info.name, info.position);
        if (match) {
          result.set(externalId, match);
        }
      }
    }
  }

  return result;
}

/**
 * Find a player by name and position from a list
 */
function findPlayerByNamePosition(
  players: CanonicalPlayer[],
  name: string,
  position: string
): CanonicalPlayer | null {
  // Normalize the search name
  const normalizedName = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .trim();

  // Map position variations
  const positionVariants = getPositionVariants(position.toUpperCase());

  // Filter players by position variants
  const positionPlayers = players.filter((p) =>
    positionVariants.includes(p.position)
  );

  // Exact name match
  for (const player of positionPlayers) {
    const playerNormalizedName = player.name
      .toLowerCase()
      .replace(/[.']/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
      .trim();

    if (playerNormalizedName === normalizedName) {
      return player;
    }
  }

  // Try without suffix variations
  const nameWithoutSuffix = normalizedName.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "").trim();
  for (const player of positionPlayers) {
    const playerNameWithoutSuffix = player.name
      .toLowerCase()
      .replace(/[.']/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
      .trim();

    if (playerNameWithoutSuffix === nameWithoutSuffix) {
      return player;
    }
  }

  return null;
}

/**
 * Get position variants for matching
 */
function getPositionVariants(position: string): string[] {
  const variants: Record<string, string[]> = {
    DE: ["DE", "EDR", "DL"],
    OLB: ["OLB", "EDR", "LB"],
    DT: ["DT", "IL", "DL"],
    NT: ["NT", "IL", "DL"],
    ILB: ["ILB", "LB"],
    EDR: ["EDR", "DE", "OLB", "DL"],
    IL: ["IL", "DT", "NT", "DL"],
    DL: ["DL", "DE", "DT", "EDR", "IL"],
    DB: ["DB", "CB", "S"],
    CB: ["CB", "DB"],
    S: ["S", "DB"],
  };

  // Handle combo positions like "WR/CB", "TE/QB", "LB/DL"
  if (position.includes("/")) {
    const combined = new Set<string>();
    for (const part of position.split("/")) {
      const trimmed = part.trim();
      for (const v of variants[trimmed] ?? [trimmed]) {
        combined.add(v);
      }
    }
    return [...combined];
  }

  return variants[position] || [position];
}

/**
 * Get a single canonical player by provider ID
 */
export async function getPlayerByProviderId(
  provider: Provider,
  externalId: string
): Promise<CanonicalPlayer | null> {
  const map = await getPlayersByProviderIds(provider, [externalId]);
  return map.get(externalId) || null;
}
