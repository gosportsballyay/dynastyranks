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
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { TeamRankingsTable } from "@/components/summary/team-rankings-table";

interface PageProps {
  params: { id: string };
}

interface RosterPlayer {
  name: string;
  position: string;
  value: number;
  age: number | null;
  slot: string;
}

interface TeamRanking {
  teamId: string;
  teamName: string | null;
  ownerName: string | null;
  isCurrentUser: boolean;
  overallValue: number;
  overallRank: number;
  starterValue: number;
  starterRank: number;
  offenseValue: number;
  offenseRank: number;
  idpValue: number;
  idpRank: number;
  roster: RosterPlayer[];
}

export default async function LeagueSummaryPage({ params }: PageProps) {
  const session = await auth();

  if (!session?.user) {
    notFound();
  }

  // Fetch league (auth already checked by layout)
  const [league] = await db
    .select()
    .from(leagues)
    .where(and(eq(leagues.id, params.id), eq(leagues.userId, session!.user.id)))
    .limit(1);

  if (!league) {
    notFound();
  }

  // Parallel fetch: settings, teams, and rosters
  let leagueTeams;
  let rosterData;
  let settings;
  try {
    const [settingsResult, teamsResult, rostersResult] = await Promise.all([
      db.select().from(leagueSettings).where(eq(leagueSettings.leagueId, league.id)).limit(1),
      db.select().from(teams).where(eq(teams.leagueId, league.id)),
      db
        .select({
          roster: rosters,
          player: canonicalPlayers,
          value: playerValues,
        })
        .from(rosters)
        .innerJoin(teams, eq(rosters.teamId, teams.id))
        .innerJoin(canonicalPlayers, eq(rosters.canonicalPlayerId, canonicalPlayers.id))
        .leftJoin(
          playerValues,
          and(
            eq(playerValues.canonicalPlayerId, canonicalPlayers.id),
            eq(playerValues.leagueId, league.id)
          )
        )
        .where(eq(teams.leagueId, league.id)),
    ]);

    [settings] = settingsResult;
    leagueTeams = teamsResult;
    rosterData = rostersResult;
  } catch (error) {
    console.error("Failed to fetch league data:", error);
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">League Summary</h1>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>Failed to load league data.</p>
          <p className="text-sm mt-2">
            There was an error connecting to the database. Please try refreshing the page.
          </p>
          {league.syncStatus === "failed" && (
            <p className="text-sm mt-2 text-red-400">
              League sync failed: {league.syncError || "Unknown error"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Handle case where no teams have been synced
  if (leagueTeams.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">League Summary</h1>
            <p className="text-slate-400 mt-1">
              {league.name} &bull; {league.totalTeams} teams &bull;{" "}
              {league.provider.charAt(0).toUpperCase() + league.provider.slice(1)}
            </p>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>No team data available yet.</p>
          <p className="text-sm mt-2">
            Team rankings will appear after your league syncs.
          </p>
          {league.syncStatus === "syncing" && (
            <p className="text-sm mt-2 text-blue-400">
              League is currently syncing...
            </p>
          )}
          {league.syncStatus === "failed" && (
            <p className="text-sm mt-2 text-red-400">
              League sync failed: {league.syncError || "Unknown error"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Calculate team rankings
  const teamRankings: TeamRanking[] = leagueTeams.map((team) => {
    const teamRoster = rosterData.filter((r) => r.roster.teamId === team.id);

    // Calculate values by category
    const starterRoster = teamRoster.filter((r) => r.roster.slotPosition === "START");
    const offenseRoster = teamRoster.filter(
      (r) => r.player.positionGroup === "offense"
    );
    const idpRoster = teamRoster.filter(
      (r) => r.player.positionGroup === "defense"
    );

    const overallValue = teamRoster.reduce(
      (sum, r) => sum + (r.value?.value || 0),
      0
    );
    const starterValue = starterRoster.reduce(
      (sum, r) => sum + (r.value?.value || 0),
      0
    );
    const offenseValue = offenseRoster.reduce(
      (sum, r) => sum + (r.value?.value || 0),
      0
    );
    const idpValue = idpRoster.reduce(
      (sum, r) => sum + (r.value?.value || 0),
      0
    );

    // Build roster player list for expanded details
    const roster: RosterPlayer[] = teamRoster.map((r) => ({
      name: r.player.name,
      position: r.player.position,
      value: r.value?.value || 0,
      age: r.player.age,
      slot: r.roster.slotPosition || "BN",
    }));

    return {
      teamId: team.id,
      teamName: team.teamName,
      ownerName: team.ownerName,
      isCurrentUser: team.id === league.userTeamId,
      overallValue,
      overallRank: 0, // Will be calculated after sorting
      starterValue,
      starterRank: 0,
      offenseValue,
      offenseRank: 0,
      idpValue,
      idpRank: 0,
      roster,
    };
  });

  // Calculate ranks
  const sortByOverall = [...teamRankings].sort(
    (a, b) => b.overallValue - a.overallValue
  );
  const sortByStarter = [...teamRankings].sort(
    (a, b) => b.starterValue - a.starterValue
  );
  const sortByOffense = [...teamRankings].sort(
    (a, b) => b.offenseValue - a.offenseValue
  );
  const sortByIdp = [...teamRankings].sort((a, b) => b.idpValue - a.idpValue);

  teamRankings.forEach((team) => {
    team.overallRank = sortByOverall.findIndex((t) => t.teamId === team.teamId) + 1;
    team.starterRank = sortByStarter.findIndex((t) => t.teamId === team.teamId) + 1;
    team.offenseRank = sortByOffense.findIndex((t) => t.teamId === team.teamId) + 1;
    team.idpRank = sortByIdp.findIndex((t) => t.teamId === team.teamId) + 1;
  });

  // Sort by overall rank for display
  teamRankings.sort((a, b) => a.overallRank - b.overallRank);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">League Summary</h1>
          <p className="text-slate-400 mt-1">
            {league.name} &bull; {league.totalTeams} teams &bull;{" "}
            {league.provider.charAt(0).toUpperCase() + league.provider.slice(1)}
          </p>
        </div>
        <div className="text-sm text-slate-400">
          {league.lastSyncedAt && (
            <span>
              Last synced:{" "}
              {new Date(league.lastSyncedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Team Rankings Table */}
      <div className="bg-slate-800/50 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Team Power Rankings</h2>
          <p className="text-sm text-slate-400 mt-1">
            Ranked by total roster value. Click a team to see details.
          </p>
        </div>

        {teamRankings.length > 0 ? (
          <TeamRankingsTable rankings={teamRankings} />
        ) : (
          <div className="px-6 py-12 text-center text-slate-400">
            <p>No roster data available yet.</p>
            <p className="text-sm mt-2">
              Data will appear after your league syncs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
