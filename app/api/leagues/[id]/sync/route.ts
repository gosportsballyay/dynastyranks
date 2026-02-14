import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  teams,
  rosters,
  draftPicks,
  playerValues,
  rawPayloads,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createSleeperAdapter, createFleaflickerAdapter } from "@/lib/adapters";
import { getPlayersByProviderIds } from "@/lib/player-mapping";
import type { Provider } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leagueId = params.id;

    // Verify ownership and get league details
    const [league] = await db
      .select()
      .from(leagues)
      .where(and(eq(leagues.id, leagueId), eq(leagues.userId, session.user.id)))
      .limit(1);

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Mark as syncing
    await db
      .update(leagues)
      .set({ syncStatus: "syncing", syncError: null })
      .where(eq(leagues.id, leagueId));

    try {
      // Clear existing data (except the league record itself)
      await db.delete(playerValues).where(eq(playerValues.leagueId, leagueId));
      await db.delete(draftPicks).where(eq(draftPicks.leagueId, leagueId));

      const leagueTeams = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.leagueId, leagueId));
      for (const team of leagueTeams) {
        await db.delete(rosters).where(eq(rosters.teamId, team.id));
      }

      await db.delete(teams).where(eq(teams.leagueId, leagueId));
      await db.delete(leagueSettings).where(eq(leagueSettings.leagueId, leagueId));
      await db.delete(rawPayloads).where(eq(rawPayloads.leagueId, leagueId));

      // Re-sync
      await syncLeagueData(
        leagueId,
        league.provider as Provider,
        league.externalLeagueId,
        league.externalLeagueId // For Fleaflicker, identifier is the league ID
      );

      // Update sync status
      await db
        .update(leagues)
        .set({ syncStatus: "success", lastSyncedAt: new Date() })
        .where(eq(leagues.id, leagueId));

      // Fetch teams for response
      const newTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.leagueId, leagueId));

      return NextResponse.json({
        success: true,
        message: "League synced successfully",
        teams: newTeams.map((t) => ({
          id: t.id,
          name: t.teamName,
          owner: t.ownerName,
        })),
      });
    } catch (syncError) {
      console.error("Sync error:", syncError);

      await db
        .update(leagues)
        .set({
          syncStatus: "failed",
          syncError: syncError instanceof Error ? syncError.message : "Sync failed",
        })
        .where(eq(leagues.id, leagueId));

      return NextResponse.json(
        { error: syncError instanceof Error ? syncError.message : "Sync failed" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Sync league error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Sync league data from provider
 */
async function syncLeagueData(
  leagueId: string,
  provider: Provider,
  externalLeagueId: string,
  identifier: string
): Promise<void> {
  // Create adapter
  const adapter =
    provider === "sleeper"
      ? createSleeperAdapter(identifier)
      : createFleaflickerAdapter();

  // Fetch settings
  const settings = await adapter.getLeagueSettings(externalLeagueId);

  // Store settings
  await db.insert(leagueSettings).values({
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
  });

  // Fetch teams
  const adapterTeams = await adapter.getTeams(externalLeagueId);

  // Store teams
  const insertedTeams = await db
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
      }))
    )
    .returning();

  // Create team ID mapping
  const teamIdMap = new Map<string, string>();
  for (const team of insertedTeams) {
    teamIdMap.set(team.externalTeamId, team.id);
  }

  // Fetch rosters
  const adapterPlayers = await adapter.getRosters(externalLeagueId);

  // Get player IDs for mapping
  const externalPlayerIds = adapterPlayers.map((p) => p.externalPlayerId);
  const playerInfoMap = new Map<string, { name: string; position: string }>();
  for (const p of adapterPlayers) {
    playerInfoMap.set(p.externalPlayerId, {
      name: p.playerName || "",
      position: p.playerPosition || "",
    });
  }
  const playerMap = await getPlayersByProviderIds(provider, externalPlayerIds, playerInfoMap);

  // Store rosters
  if (adapterPlayers.length > 0) {
    await db.insert(rosters).values(
      adapterPlayers.map((p) => {
        const teamId = teamIdMap.get(p.teamExternalId);
        const canonicalPlayer = playerMap.get(p.externalPlayerId);

        return {
          teamId: teamId!,
          canonicalPlayerId: canonicalPlayer?.id || null,
          externalPlayerId: p.externalPlayerId,
          slotPosition: p.slotPosition,
          playerName: p.playerName,
          playerPosition: p.playerPosition,
        };
      })
    );
  }

  // Fetch draft picks
  const adapterPicks = await adapter.getDraftPicks(externalLeagueId);

  // Store draft picks
  if (adapterPicks.length > 0) {
    await db.insert(draftPicks).values(
      adapterPicks.map((p) => ({
        leagueId,
        ownerTeamId: teamIdMap.get(p.ownerTeamExternalId)!,
        originalTeamId: p.originalTeamExternalId
          ? teamIdMap.get(p.originalTeamExternalId)
          : null,
        season: p.season,
        round: p.round,
        pickNumber: p.pickNumber,
      }))
    );
  }

  // Store raw payloads for audit
  const payloads = adapter.getRawPayloads();
  if (payloads.length > 0) {
    await db.insert(rawPayloads).values(
      payloads.map((p) => ({
        leagueId,
        provider,
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
}
