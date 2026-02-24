export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  teams,
  rosters,
  playerValues,
  canonicalPlayers,
  historicalStats,
  aggregatedValues,
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { normalizeStatKeys } from "@/lib/stats/canonical-keys";
import {
  TeamRosterView,
  type RosterPlayer,
} from "@/components/team/team-roster-view";

interface PageProps {
  params: { id: string };
  searchParams: { team?: string; teamId?: string };
}

export default async function MyTeamPage({
  params,
  searchParams,
}: PageProps) {
  const session = await auth();
  if (!session?.user) {
    notFound();
  }

  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(
        eq(leagues.id, params.id),
        eq(leagues.userId, session!.user.id)
      )
    )
    .limit(1);

  if (!league) {
    notFound();
  }

  const viewTeamId = searchParams.teamId || searchParams.team || league.userTeamId;

  // No team param and no userTeamId — prompt user to pick a team
  if (!viewTeamId) {
    const teamResults = await db
      .select()
      .from(teams)
      .where(eq(teams.leagueId, league.id));

    if (teamResults.length > 0) {
      return (
        <div>
          <h1 className="text-2xl font-bold text-white mb-6">
            My Team
          </h1>
          <div className="bg-slate-800/50 rounded-lg p-12 text-center">
            <p className="text-slate-300 text-lg mb-4">
              Please select your team to view your roster.
            </p>
            <a
              href={`/league/${params.id}/settings`}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Select Your Team
            </a>
          </div>
        </div>
      );
    }

    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">
          My Team
        </h1>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>No team data available yet.</p>
          <p className="text-sm mt-2">
            Your roster will appear after your league syncs.
          </p>
          {league.syncStatus === "syncing" && (
            <p className="text-sm mt-2 text-blue-400">
              League is currently syncing...
            </p>
          )}
          {league.syncStatus === "failed" && (
            <p className="text-sm mt-2 text-red-400">
              League sync failed:{" "}
              {league.syncError || "Unknown error"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Fetch viewed team + all league teams in parallel
  let viewedTeam;
  let allTeams;
  try {
    const [viewedTeamResults, allTeamResults] = await Promise.all([
      db
        .select()
        .from(teams)
        .where(
          and(
            eq(teams.id, viewTeamId),
            eq(teams.leagueId, league.id)
          )
        )
        .limit(1),
      db
        .select()
        .from(teams)
        .where(eq(teams.leagueId, league.id)),
    ]);
    viewedTeam = viewedTeamResults[0];
    allTeams = allTeamResults;
  } catch (error) {
    console.error("Failed to fetch team:", error);
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">
          My Team
        </h1>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>Failed to load team data.</p>
          <p className="text-sm mt-2">
            There was an error connecting to the database. Please
            try refreshing the page.
          </p>
          {league.syncStatus === "failed" && (
            <p className="text-sm mt-2 text-red-400">
              League sync failed:{" "}
              {league.syncError || "Unknown error"}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!viewedTeam) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">
          My Team
        </h1>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>Team not found.</p>
          <p className="text-sm mt-2">
            The selected team does not exist in this league.
          </p>
        </div>
      </div>
    );
  }

  // Fetch roster, settings, history, and consensus in parallel
  const [rosterData, settingsResult, historyRows, consensusRows] =
    await Promise.all([
      db
        .select({
          roster: rosters,
          player: canonicalPlayers,
          value: playerValues,
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
            eq(playerValues.leagueId, league.id),
          ),
        )
        .where(eq(rosters.teamId, viewedTeam.id)),
      db
        .select()
        .from(leagueSettings)
        .where(eq(leagueSettings.leagueId, league.id))
        .limit(1),
      db
        .select()
        .from(historicalStats)
        .where(inArray(historicalStats.season, [2025, 2024, 2023])),
      db
        .select({
          canonicalPlayerId: aggregatedValues.canonicalPlayerId,
          aggregatedValue: aggregatedValues.aggregatedValue,
        })
        .from(aggregatedValues)
        .where(eq(aggregatedValues.leagueId, league.id)),
    ]);

  const [settings] = settingsResult;
  const scoringRules = (settings?.scoringRules ?? {}) as Record<
    string,
    number
  >;

  // Build history map: playerId -> season lines
  const historyMap = new Map<
    string,
    Array<{ season: number; points: number; gamesPlayed: number }>
  >();
  for (const row of historyRows) {
    const stats = normalizeStatKeys(
      row.stats as Record<string, number>,
    );
    let points = 0;
    for (const [key, val] of Object.entries(stats)) {
      if (scoringRules[key]) points += val * scoringRules[key];
    }
    const entry = {
      season: row.season,
      points,
      gamesPlayed: row.gamesPlayed ?? 0,
    };
    const existing = historyMap.get(row.canonicalPlayerId);
    if (existing) {
      existing.push(entry);
    } else {
      historyMap.set(row.canonicalPlayerId, [entry]);
    }
  }

  // Build consensus map: playerId -> aggregatedValue
  const consensusMap = new Map<string, number>();
  for (const row of consensusRows) {
    consensusMap.set(row.canonicalPlayerId, row.aggregatedValue);
  }

  const roster: RosterPlayer[] = rosterData.map((r) => ({
    playerId: r.player.id,
    playerName: r.player.name,
    position: r.player.position,
    nflTeam: r.player.nflTeam,
    age: r.player.age,
    value: r.value?.value || 0,
    rankInPosition: r.value?.rankInPosition ?? null,
    slot: r.roster.slotPosition || "BN",
    injuryStatus: r.player.injuryStatus,
    draftRound: r.player.draftRound,
    draftPick: r.player.draftPick,
    rookieYear: r.player.rookieYear,
    yearsExperience: r.player.yearsExperience,
    seasonLines: historyMap.get(r.player.id) ?? [],
    projectedPoints: r.value?.projectedPoints ?? 0,
    rank: r.value?.rank ?? 0,
    vorp: r.value?.vorp ?? 0,
    consensusValue: consensusMap.get(r.player.id) ?? null,
    tier: r.value?.tier ?? 10,
    lastSeasonPoints: r.value?.lastSeasonPoints ?? null,
  }));

  return (
    <TeamRosterView
      leagueId={league.id}
      currentTeamId={viewedTeam.id}
      userTeamId={league.userTeamId}
      allTeams={allTeams.map((t) => ({
        id: t.id,
        name: t.teamName || "Unknown Team",
        owner: t.ownerName || "Unknown",
      }))}
      roster={roster}
      teamName={viewedTeam.teamName || "Unknown Team"}
      ownerName={viewedTeam.ownerName || "Unknown"}
    />
  );
}
