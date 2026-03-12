/**
 * Player Mapping Service
 * Maps provider player IDs to canonical player IDs using DynastyProcess data
 */

import { db } from "@/lib/db/client";
import { canonicalPlayers } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { Provider } from "@/types";

/**
 * Get canonical player by provider ID
 */
export async function getPlayerByProviderId(
  provider: Provider,
  externalId: string
): Promise<typeof canonicalPlayers.$inferSelect | null> {
  const providerIdColumn = getProviderIdColumn(provider);

  const [player] = await db
    .select()
    .from(canonicalPlayers)
    .where(eq(providerIdColumn, externalId))
    .limit(1);

  return player ?? null;
}

/**
 * Get multiple canonical players by provider IDs with name fallback.
 * Self-improving: When matched by name, updates the canonical player record
 * with the provider ID for faster future lookups.
 */
export async function getPlayersByProviderIds(
  provider: Provider,
  externalIds: string[],
  playerInfo?: Map<string, { name: string; position: string }>
): Promise<Map<string, typeof canonicalPlayers.$inferSelect>> {
  if (externalIds.length === 0) {
    return new Map();
  }

  const result = new Map<string, typeof canonicalPlayers.$inferSelect>();
  const providerIdColumn = getProviderIdColumn(provider);

  // First pass: batch query by provider ID using inArray()
  // Filter out empty IDs since inArray can't handle them
  const validIds = externalIds.filter((id) => id && id.trim() !== "");
  if (validIds.length > 0) {
    const matchedPlayers = await db
      .select()
      .from(canonicalPlayers)
      .where(inArray(providerIdColumn, validIds));

    for (const player of matchedPlayers) {
      const providerId = getProviderIdFromPlayer(player, provider);
      if (providerId) {
        result.set(providerId, player);
      }
    }
  }

  // Second pass: match unmatched players by name+position (only if needed)
  // Track matches for provider ID updates
  const nameMatchedPlayers: Array<{ playerId: string; providerId: string }> = [];

  if (playerInfo) {
    const unmatchedIds = externalIds.filter((id) => !result.has(id));
    if (unmatchedIds.length > 0) {
      // Only fetch all players if we have unmatched IDs needing name lookup
      const allPlayers = await db.select().from(canonicalPlayers);

      for (const externalId of unmatchedIds) {
        const info = playerInfo.get(externalId);
        if (!info) continue;

        const match = findPlayerByNamePosition(allPlayers, info.name, info.position);
        if (match) {
          result.set(externalId, match);
          // Track for provider ID update (only if player doesn't already have this provider ID)
          const existingProviderId = getProviderIdFromPlayer(match, provider);
          if (!existingProviderId && externalId) {
            nameMatchedPlayers.push({ playerId: match.id, providerId: externalId });
          }
        }
      }
    }
  }

  // Update canonical players with newly discovered provider IDs (fire-and-forget)
  if (nameMatchedPlayers.length > 0) {
    updateProviderIds(provider, nameMatchedPlayers).catch((err) => {
      console.error("Failed to update provider IDs:", err);
    });
  }

  return result;
}

/**
 * Update canonical players with provider IDs discovered through name matching.
 * This improves future sync performance by enabling direct ID lookups.
 */
async function updateProviderIds(
  provider: Provider,
  updates: Array<{ playerId: string; providerId: string }>
): Promise<void> {
  if (updates.length === 0) return;

  const fieldName = getProviderIdFieldName(provider);
  if (!fieldName) return;

  // Update in batches to avoid overwhelming the database
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    // Update each player individually (Drizzle doesn't support bulk conditional updates easily)
    await Promise.all(
      batch.map(({ playerId, providerId }) =>
        db
          .update(canonicalPlayers)
          .set({ [fieldName]: providerId, updatedAt: new Date() })
          .where(eq(canonicalPlayers.id, playerId))
      )
    );
  }

  console.log(`Updated ${updates.length} canonical players with ${provider} IDs`);
}

/**
 * Get the field name for a provider's ID column
 */
function getProviderIdFieldName(provider: Provider): string | null {
  switch (provider) {
    case "sleeper":
      return "sleeperId";
    case "fleaflicker":
      return "fleaflickerId";
    case "espn":
      return "espnId";
    case "yahoo":
      return "yahooId";
    case "mfl":
      return "mflId";
    default:
      return null;
  }
}

/**
 * Find a player by name and position from a list
 */
function findPlayerByNamePosition(
  players: Array<typeof canonicalPlayers.$inferSelect>,
  name: string,
  position: string
): typeof canonicalPlayers.$inferSelect | null {
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

  // Try without suffix variations (e.g., "Marvin Harrison Jr" matches "Marvin Harrison")
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
 * Get position variants for matching (handles IDP position mapping differences)
 */
function getPositionVariants(position: string): string[] {
  const variants: Record<string, string[]> = {
    // IDP positions can have various mappings
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

  return variants[position] || [position];
}

/**
 * Get provider ID column from schema
 */
function getProviderIdColumn(provider: Provider) {
  switch (provider) {
    case "sleeper":
      return canonicalPlayers.sleeperId;
    case "fleaflicker":
      return canonicalPlayers.fleaflickerId;
    case "espn":
      return canonicalPlayers.espnId;
    case "yahoo":
      return canonicalPlayers.yahooId;
    case "mfl":
      return canonicalPlayers.mflId;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get provider ID from player object
 */
function getProviderIdFromPlayer(
  player: typeof canonicalPlayers.$inferSelect,
  provider: Provider
): string | null {
  switch (provider) {
    case "sleeper":
      return player.sleeperId;
    case "fleaflicker":
      return player.fleaflickerId;
    case "espn":
      return player.espnId;
    case "yahoo":
      return player.yahooId;
    case "mfl":
      return player.mflId;
    default:
      return null;
  }
}

/**
 * Search for player by name and position (fuzzy match fallback)
 */
export async function searchPlayerByNamePosition(
  name: string,
  position: string
): Promise<typeof canonicalPlayers.$inferSelect | null> {
  // Normalize the search name
  const normalizedName = name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
    .trim();

  // Get all players with matching position
  const players = await db
    .select()
    .from(canonicalPlayers)
    .where(eq(canonicalPlayers.position, position.toUpperCase()));

  // Find best match
  for (const player of players) {
    const playerNormalizedName = player.name
      .toLowerCase()
      .replace(/[.']/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "")
      .trim();

    if (playerNormalizedName === normalizedName) {
      return player;
    }
  }

  // Try partial match (last name only)
  const searchLastName = normalizedName.split(" ").pop();
  if (searchLastName && searchLastName.length > 2) {
    for (const player of players) {
      const playerLastName = player.name
        .toLowerCase()
        .replace(/[.']/g, "")
        .split(" ")
        .pop();

      if (playerLastName === searchLastName) {
        return player;
      }
    }
  }

  return null;
}

/**
 * Get all players for a specific position
 */
export async function getPlayersByPosition(
  position: string
): Promise<Array<typeof canonicalPlayers.$inferSelect>> {
  return db
    .select()
    .from(canonicalPlayers)
    .where(eq(canonicalPlayers.position, position.toUpperCase()));
}

/**
 * Get all active players
 */
export async function getAllActivePlayers(): Promise<
  Array<typeof canonicalPlayers.$inferSelect>
> {
  return db
    .select()
    .from(canonicalPlayers)
    .where(eq(canonicalPlayers.isActive, true));
}
