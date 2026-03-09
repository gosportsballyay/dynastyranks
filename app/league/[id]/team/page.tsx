export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getLeagueForUser } from "@/lib/auth/get-league";
import { db } from "@/lib/db/client";
import {
  leagueSettings,
  teams,
  rosters,
  playerValues,
  canonicalPlayers,
  historicalStats,
  aggregatedValues,
  draftPicks,
} from "@/lib/db/schema";
import { eq, and, desc, inArray, asc, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { normalizeStatKeys } from "@/lib/stats/canonical-keys";
import { computeAllPickValues } from "@/lib/trade-engine/draft-pick-values";
import {
  TeamRosterView,
  type RosterPlayer,
  type TeamDraftPick,
} from "@/components/team/team-roster-view";
import { computeOptimalStarters } from "@/lib/utils/compute-optimal-lineup";

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

  const league = await getLeagueForUser(
    params.id, session.user.id, session.user.email,
  );
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

  // Fetch roster, settings, history, consensus, league values, and draft picks
  const originalTeams = alias(teams, "originalTeams");
  const [
    rosterData,
    settingsResult,
    historyRows,
    consensusRows,
    allValues,
    draftPickRows,
  ] = await Promise.all([
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
      db
        .select({
          id: playerValues.id,
          position: canonicalPlayers.position,
          canonicalPlayerId: playerValues.canonicalPlayerId,
          value: playerValues.value,
          rank: playerValues.rank,
        })
        .from(playerValues)
        .innerJoin(
          canonicalPlayers,
          eq(playerValues.canonicalPlayerId, canonicalPlayers.id),
        )
        .where(eq(playerValues.leagueId, league.id))
        .orderBy(desc(playerValues.value)),
      db
        .select({
          id: draftPicks.id,
          season: draftPicks.season,
          round: draftPicks.round,
          pickNumber: draftPicks.pickNumber,
          projectedPickNumber: draftPicks.projectedPickNumber,
          originalTeamName: originalTeams.teamName,
          ownerTeamId: draftPicks.ownerTeamId,
          originalTeamId: draftPicks.originalTeamId,
        })
        .from(draftPicks)
        .leftJoin(
          originalTeams,
          eq(draftPicks.originalTeamId, originalTeams.id),
        )
        .where(
          and(
            eq(draftPicks.ownerTeamId, viewedTeam.id),
            eq(draftPicks.leagueId, league.id),
            gte(draftPicks.season, new Date().getFullYear()),
          ),
        )
        .orderBy(
          asc(draftPicks.season),
          asc(draftPicks.round),
          asc(draftPicks.pickNumber),
        ),
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

  // Build flex rank maps from league-wide values
  const flexRankMaps = new Map<string, Map<string, number>>();
  for (const rule of settings?.flexRules ?? []) {
    const eligibleSet = new Set(rule.eligible);
    const rankMap = new Map<string, number>();
    let counter = 0;
    for (const v of allValues) {
      if (eligibleSet.has(v.position)) {
        counter++;
        rankMap.set(v.id, counter);
      }
    }
    flexRankMaps.set(rule.slot, rankMap);
  }

  // Compute draft pick values on the fly (DB column is not populated)
  const allPlayerValues = allValues
    .filter((v) => v.value != null && v.rank != null)
    .map((v) => ({ value: v.value!, rank: v.rank! }));
  const pickValueMap = computeAllPickValues(
    draftPickRows.map((p) => ({
      id: p.id,
      season: p.season,
      round: p.round,
      pickNumber: p.pickNumber,
      projectedPickNumber: p.projectedPickNumber,
    })),
    allPlayerValues,
    league.season,
    league.totalTeams,
  );

  const teamDraftPicks: TeamDraftPick[] = draftPickRows.map((p) => ({
    pickId: p.id,
    season: p.season,
    round: p.round,
    pickNumber: p.pickNumber,
    projectedPickNumber: p.projectedPickNumber,
    value: pickValueMap.get(p.id) ?? 0,
    originalTeamName:
      p.originalTeamId && p.originalTeamId !== viewedTeam.id
        ? (p.originalTeamName || "Unknown")
        : null,
  }));

  const roster: RosterPlayer[] = rosterData.map((r) => {
    const resolvedPos =
      r.value?.eligibilityPosition ?? r.player.position;
    return {
      playerId: r.player.id,
      playerName: r.player.name,
      position: resolvedPos,
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
      flexEligibility: (settings?.flexRules ?? [])
        .filter((rule) => rule.eligible.includes(resolvedPos))
        .map((rule) => rule.slot),
      flexRanks: Object.fromEntries(
        (settings?.flexRules ?? [])
          .filter((rule) => rule.eligible.includes(resolvedPos))
          .map((rule): [string, number] => [
            rule.slot,
            flexRankMaps.get(rule.slot)?.get(r.value?.id ?? "") ?? 0,
          ])
          .filter(([, rank]) => rank > 0),
      ),
    };
  });

  // Compute optimal starters from league settings so display is
  // correct even when owners haven't set their lineup
  if (settings) {
    const optimalStarterIds = computeOptimalStarters(
      roster.map((p) => ({
        id: p.playerId,
        position: p.position,
        positionGroup: ["QB", "RB", "WR", "TE", "K"].includes(
          p.position,
        )
          ? "offense"
          : "defense",
        value: p.value,
        slot: p.slot,
      })),
      settings.rosterPositions,
      settings.flexRules,
      settings.positionMappings,
    );

    for (const player of roster) {
      if (player.slot === "IR" || player.slot === "TAXI") continue;
      player.slot = optimalStarterIds.has(player.playerId)
        ? "START"
        : "BN";
    }
  }

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
      draftPicks={teamDraftPicks}
      teamName={viewedTeam.teamName || "Unknown Team"}
      ownerName={viewedTeam.ownerName || "Unknown"}
    />
  );
}
