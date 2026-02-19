"use server";

import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  teams,
  rosters,
  playerValues,
  canonicalPlayers,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  analyzeRosterImpact,
  type PlayerAsset,
  type TradeAsset,
  type LeagueConfig,
  type RosterImpactResult,
} from "@/lib/trade-engine";

/**
 * Server action: analyze roster impact for the user's team.
 *
 * @param leagueId - League UUID
 * @param teamId - User's team UUID
 * @param assetsOut - Assets the user's team sends away
 * @param assetsIn - Assets the user's team receives
 * @returns Roster impact result or null on error
 */
export async function analyzeRosterImpactAction(
  leagueId: string,
  teamId: string,
  assetsOut: TradeAsset[],
  assetsIn: TradeAsset[],
): Promise<RosterImpactResult | null> {
  const session = await auth();
  if (!session?.user) return null;

  // Verify league ownership
  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(eq(leagues.id, leagueId), eq(leagues.userId, session.user.id)),
    )
    .limit(1);

  if (!league) return null;

  // Fetch settings and full roster
  const [settingsResult, rosterData] = await Promise.all([
    db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, leagueId))
      .limit(1),
    db
      .select({
        roster: rosters,
        player: canonicalPlayers,
        pv: playerValues,
      })
      .from(rosters)
      .innerJoin(
        canonicalPlayers,
        eq(rosters.canonicalPlayerId, canonicalPlayers.id),
      )
      .leftJoin(
        playerValues,
        and(
          eq(playerValues.canonicalPlayerId, canonicalPlayers.id),
          eq(playerValues.leagueId, leagueId),
        ),
      )
      .where(eq(rosters.teamId, teamId)),
  ]);

  const [settings] = settingsResult;
  const config: LeagueConfig = {
    totalTeams: league.totalTeams,
    rosterPositions: settings?.rosterPositions ?? { QB: 1, RB: 2, WR: 3, TE: 1 },
    flexRules: settings?.flexRules ?? [],
    positionMappings: settings?.positionMappings ?? undefined,
    benchSlots: settings?.benchSlots ?? 6,
    taxiSlots: settings?.taxiSlots ?? 0,
    irSlots: settings?.irSlots ?? 0,
  };

  // Build full roster as PlayerAsset[]
  const myRoster: PlayerAsset[] = rosterData.map(({ player, pv }) => ({
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    positionGroup: player.positionGroup,
    age: player.age,
    nflTeam: player.nflTeam,
    value: pv?.value ?? 0,
    projectedPoints: pv?.projectedPoints ?? 0,
    consensusValue: pv?.consensusValue ?? null,
    consensusComponent: pv?.consensusComponent ?? null,
    leagueSignalComponent: pv?.leagueSignalComponent ?? null,
    rank: pv?.rank ?? 999,
    rankInPosition: pv?.rankInPosition ?? 999,
    tier: pv?.tier ?? 10,
    scarcityMultiplier: pv?.scarcityMultiplier ?? 1,
    ageCurveMultiplier: pv?.ageCurveMultiplier ?? 1,
    dynastyPremium: pv?.dynastyPremium ?? 0,
  }));

  return analyzeRosterImpact({
    myRoster,
    assetsOut,
    assetsIn,
    config,
  });
}
