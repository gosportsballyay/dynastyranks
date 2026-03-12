/**
 * Shared league data sync logic.
 *
 * Fetches all data from the platform adapter, then deletes old
 * data and inserts new data inside a single transaction so a
 * failed fetch never leaves the league in a zero-data state.
 */

import { db } from "@/lib/db/client";
import {
  leagueSettings,
  teams,
  rosters,
  draftPicks,
  playerValues,
  rawPayloads,
  userTokens,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  createSleeperAdapter,
  createFleaflickerAdapter,
  createESPNAdapter,
  createYahooAdapter,
  createMFLAdapter,
} from "@/lib/adapters";
import { getPlayersByProviderIds } from "@/lib/player-mapping";
import type { Provider } from "@/types";

interface SyncLeagueDataOptions {
  leagueId: string;
  provider: Provider;
  externalLeagueId: string;
  identifier: string;
  userId: string;
  espnS2?: string;
  swid?: string;
  mflApiKey?: string;
  season?: number;
  /** Whether to delete existing data first (re-sync vs initial) */
  isResync?: boolean;
}

/**
 * Sync league data from a platform adapter into the database.
 *
 * Fetches all adapter data first, then writes inside a
 * transaction. If any fetch throws, existing data stays intact.
 */
export async function syncLeagueData(
  opts: SyncLeagueDataOptions,
): Promise<void> {
  const {
    leagueId,
    provider,
    externalLeagueId,
    identifier,
    userId,
    espnS2,
    swid,
    mflApiKey,
    season,
    isResync = false,
  } = opts;

  const adapter = await createAdapterForSync(
    provider, identifier, externalLeagueId,
    userId, espnS2, swid, mflApiKey, season,
  );

  // ── Fetch all data from adapter BEFORE touching DB ──
  const settings = await adapter.getLeagueSettings(externalLeagueId);

  const validation = adapter.validateSettings(settings);
  if (!validation.valid) {
    console.warn("League settings validation errors:", validation.errors);
  }
  if (validation.warnings.length > 0) {
    console.warn("League settings warnings:", validation.warnings);
  }

  const adapterTeams = await adapter.getTeams(externalLeagueId);
  const adapterPlayers = await adapter.getRosters(externalLeagueId);
  const adapterPicks = await adapter.getDraftPicks(externalLeagueId);
  const payloads = adapter.getRawPayloads();

  // Build player mapping
  const externalPlayerIds = adapterPlayers.map((p) => p.externalPlayerId);
  const playerInfoMap = new Map<
    string,
    { name: string; position: string }
  >();
  for (const p of adapterPlayers) {
    playerInfoMap.set(p.externalPlayerId, {
      name: p.playerName || "",
      position: p.playerPosition || "",
    });
  }
  const playerMap = await getPlayersByProviderIds(
    provider, externalPlayerIds, playerInfoMap,
  );

  // Extract structuredRules from metadata
  const metadataObj =
    settings.metadata as Record<string, unknown> | undefined;
  const structuredRules = metadataObj?.structuredRules ?? null;

  // ── Transactional write: delete old + insert new ──
  await db.transaction(async (tx) => {
    if (isResync) {
      await tx
        .delete(playerValues)
        .where(eq(playerValues.leagueId, leagueId));
      await tx
        .delete(draftPicks)
        .where(eq(draftPicks.leagueId, leagueId));

      const existingTeams = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.leagueId, leagueId));
      for (const team of existingTeams) {
        await tx.delete(rosters).where(eq(rosters.teamId, team.id));
      }

      await tx.delete(teams).where(eq(teams.leagueId, leagueId));
      await tx
        .delete(leagueSettings)
        .where(eq(leagueSettings.leagueId, leagueId));
      await tx
        .delete(rawPayloads)
        .where(eq(rawPayloads.leagueId, leagueId));
    }

    // Insert settings
    await tx.insert(leagueSettings).values({
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
      structuredRules:
        structuredRules as typeof leagueSettings.$inferInsert.structuredRules,
    });

    // Insert teams
    const insertedTeams = await tx
      .insert(teams)
      .values(
        adapterTeams.map((t) => ({
          leagueId,
          externalTeamId: t.externalTeamId,
          ownerName: t.ownerName,
          teamName: t.teamName,
          standingRank: t.standingRank,
          totalPoints: t.totalPoints,
          wins: t.wins,
          losses: t.losses,
          ties: t.ties,
        })),
      )
      .returning();

    // Build team ID mapping
    const teamIdMap = new Map<string, string>();
    for (const team of insertedTeams) {
      teamIdMap.set(team.externalTeamId, team.id);
    }

    // Insert rosters (filter out players with unmapped teams)
    const mappedPlayers = adapterPlayers.filter((p) => {
      const teamId = teamIdMap.get(p.teamExternalId);
      if (!teamId) {
        console.warn(
          `Skipping player ${p.playerName} — unmapped team ` +
          `${p.teamExternalId}`,
        );
        return false;
      }
      return true;
    });

    if (mappedPlayers.length > 0) {
      await tx.insert(rosters).values(
        mappedPlayers.map((p) => {
          const canonicalPlayer = playerMap.get(p.externalPlayerId);
          return {
            teamId: teamIdMap.get(p.teamExternalId)!,
            canonicalPlayerId: canonicalPlayer?.id || null,
            externalPlayerId: p.externalPlayerId,
            slotPosition: p.slotPosition,
            playerName: p.playerName,
            playerPosition: p.playerPosition,
          };
        }),
      );
    }

    // Insert draft picks (filter out picks with unmapped teams)
    const mappedPicks = adapterPicks.filter((p) => {
      const ownerId = teamIdMap.get(p.ownerTeamExternalId);
      if (!ownerId) {
        console.warn(
          `Skipping draft pick round ${p.round} — unmapped owner ` +
          `team ${p.ownerTeamExternalId}`,
        );
        return false;
      }
      return true;
    });

    if (mappedPicks.length > 0) {
      await tx.insert(draftPicks).values(
        mappedPicks.map((p) => ({
          leagueId,
          ownerTeamId: teamIdMap.get(p.ownerTeamExternalId)!,
          originalTeamId: p.originalTeamExternalId
            ? teamIdMap.get(p.originalTeamExternalId)
            : null,
          season: p.season,
          round: p.round,
          pickNumber: p.pickNumber,
          projectedPickNumber: p.projectedPickNumber,
        })),
      );
    }

    // Insert raw payloads
    if (payloads.length > 0) {
      await tx.insert(rawPayloads).values(
        payloads.map((p) => ({
          leagueId,
          provider,
          endpoint: p.endpoint,
          requestParams: p.requestParams,
          payload: p.payload,
          status: p.status,
          errorMessage: p.errorMessage,
          fetchedAt: p.fetchedAt,
        })),
      );
    }
  });

  adapter.clearRawPayloads();
}

/**
 * Create the appropriate platform adapter.
 *
 * For ESPN, resolves cookies from: body override > stored tokens.
 * Throws a descriptive error if ESPN private league cookies are
 * missing.
 */
async function createAdapterForSync(
  provider: Provider,
  identifier: string,
  externalLeagueId: string,
  userId: string,
  espnS2?: string,
  swid?: string,
  mflApiKey?: string,
  season?: number,
) {
  if (provider === "sleeper") {
    return createSleeperAdapter(identifier);
  }

  if (provider === "fleaflicker") {
    return createFleaflickerAdapter();
  }

  if (provider === "espn") {
    let s2 = espnS2;
    let swidCookie = swid;

    if (!s2 || !swidCookie) {
      const [token] = await db
        .select()
        .from(userTokens)
        .where(
          and(
            eq(userTokens.userId, userId),
            eq(userTokens.provider, "espn"),
          ),
        )
        .limit(1);

      if (token) {
        s2 = s2 || token.accessToken;
        swidCookie = swidCookie || (token.refreshToken ?? undefined);
      }
    }

    // Persist override cookies for future syncs
    if (espnS2 && swid) {
      await db
        .insert(userTokens)
        .values({
          userId,
          provider: "espn",
          accessToken: espnS2,
          refreshToken: swid,
        })
        .onConflictDoUpdate({
          target: [userTokens.userId, userTokens.provider],
          set: {
            accessToken: espnS2,
            refreshToken: swid,
            updatedAt: new Date(),
          },
        });
    }

    return createESPNAdapter({
      espnS2: s2,
      swid: swidCookie,
      leagueId: externalLeagueId,
      season,
    });
  }

  if (provider === "yahoo") {
    const [token] = await db
      .select()
      .from(userTokens)
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.provider, "yahoo"),
        ),
      )
      .limit(1);

    if (!token) {
      throw new Error(
        "Yahoo OAuth token not found. Re-authorize Yahoo.",
      );
    }

    return createYahooAdapter({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || undefined,
      expiresAt: token.expiresAt || undefined,
      onTokenRefresh: async (tokens) => {
        await db
          .update(userTokens)
          .set({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(userTokens.id, token.id));
      },
    });
  }

  if (provider === "mfl") {
    let apiKey = mflApiKey;

    if (!apiKey) {
      const [token] = await db
        .select()
        .from(userTokens)
        .where(
          and(
            eq(userTokens.userId, userId),
            eq(userTokens.provider, "mfl"),
          ),
        )
        .limit(1);

      if (token) {
        apiKey = token.accessToken;
      }
    }

    // Persist API key for future syncs
    if (mflApiKey) {
      await db
        .insert(userTokens)
        .values({
          userId,
          provider: "mfl",
          accessToken: mflApiKey,
          refreshToken: null,
        })
        .onConflictDoUpdate({
          target: [userTokens.userId, userTokens.provider],
          set: {
            accessToken: mflApiKey,
            updatedAt: new Date(),
          },
        });
    }

    return createMFLAdapter({
      apiKey,
      leagueId: externalLeagueId,
      season,
    });
  }

  throw new Error(`Unknown provider: ${provider}`);
}
