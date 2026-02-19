/**
 * IDP Position Normalization Layer
 *
 * Resolves defensive sub-positions (CB, S, EDR, IL, DE, DT) to their
 * consolidated parent (DB, DL) when the league uses consolidated roster
 * slots. Prevents scarcity/baseline distortion from platform mislabels
 * and ensures correct position pooling per league context.
 *
 * No scoring math changes. VORP logic untouched.
 */

import { db } from "@/lib/db/client";
import { playerPositionOverrides } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Consolidated IDP groups and their child positions. */
const CONSOLIDATED_GROUPS: Record<
  string,
  { parent: string; children: Set<string> }
> = {
  DB: { parent: "DB", children: new Set(["CB", "S"]) },
  DL: { parent: "DL", children: new Set(["EDR", "IL", "DE", "DT"]) },
};

/** Reverse map: child position → consolidated parent. */
const CHILD_TO_PARENT = new Map<string, string>();
for (const group of Object.values(CONSOLIDATED_GROUPS)) {
  for (const child of group.children) {
    CHILD_TO_PARENT.set(child, group.parent);
  }
}

/**
 * Resolve a defensive position to the correct grouping for a league.
 *
 * Priority:
 * 1. Manual/external override exists → return canonicalPosition
 * 2. Not a defensive sub-position → return platformPosition unchanged
 * 3. League uses consolidated parent slot (e.g. DB > 0) →
 *    return parent ("DB")
 * 4. League uses granular slots (e.g. CB > 0) →
 *    return canonicalPosition if available, else platformPosition
 * 5. Fallback → return platformPosition
 *
 * @param platformPosition - Position from the fantasy platform
 * @param canonicalPosition - Override from player_position_overrides
 * @param leagueRosterConfig - Roster slots keyed by position
 * @returns Resolved position string
 */
export function resolveDefensivePosition(
  platformPosition: string,
  canonicalPosition: string | null,
  leagueRosterConfig: Record<string, number>,
): string {
  // 1. Override wins
  if (canonicalPosition) return canonicalPosition;

  // 2. Not a defensive sub-position — pass through
  const parent = CHILD_TO_PARENT.get(platformPosition);
  if (!parent) return platformPosition;

  // 3. League uses consolidated parent slot
  if ((leagueRosterConfig[parent] ?? 0) > 0) {
    return parent;
  }

  // 4. League uses granular slots — keep platform position
  if ((leagueRosterConfig[platformPosition] ?? 0) > 0) {
    return platformPosition;
  }

  // 5. Fallback
  return platformPosition;
}

/**
 * Upsert a position override for a player.
 *
 * @param playerId - canonical_players.id
 * @param canonicalPosition - Corrected position string
 * @param source - "manual" or "external"
 */
export async function setPositionOverride(
  playerId: string,
  canonicalPosition: string,
  source: "manual" | "external" = "manual",
): Promise<void> {
  await db
    .insert(playerPositionOverrides)
    .values({
      playerId,
      canonicalPosition,
      source,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: playerPositionOverrides.playerId,
      set: {
        canonicalPosition,
        source,
        updatedAt: new Date(),
      },
    });
}

/**
 * Build a position resolver closure for a single engine run.
 *
 * Loads all overrides once, returns a fast sync lookup function.
 * Called once at engine startup — no per-player DB queries.
 *
 * @param leagueRosterConfig - Roster slots keyed by position
 * @returns Sync function: (playerId, platformPosition) → resolved position
 */
export async function buildPositionResolver(
  leagueRosterConfig: Record<string, number>,
): Promise<(playerId: string, platformPosition: string) => string> {
  const rows = await db
    .select()
    .from(playerPositionOverrides);

  const overrideMap = new Map<string, string>();
  for (const row of rows) {
    overrideMap.set(row.playerId, row.canonicalPosition);
  }

  return (playerId: string, platformPosition: string): string => {
    const override = overrideMap.get(playerId) ?? null;
    return resolveDefensivePosition(
      platformPosition,
      override,
      leagueRosterConfig,
    );
  };
}
