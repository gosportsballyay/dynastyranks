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
  draftPicks,
} from "@/lib/db/schema";
import { eq, and, desc, sum } from "drizzle-orm";
import { TeamRankingsTable } from "@/components/summary/team-rankings-table";
import {
  calculateAllReplacementLevels,
  calculateStarterDemand,
} from "@/lib/value-engine/replacement-level";
import {
  computeTeamNeeds,
  classifyTeams,
  computeUpgradeTargets,
  type PositionStrength,
  type TeamNeedInput,
  type TeamTier,
  type TeamNeedsResult,
} from "@/lib/value-engine/team-needs";
import { computeOptimalStarters } from "@/lib/utils/compute-optimal-lineup";
import { leagueFormatString } from "@/lib/utils/league-format";
import { HelpTooltip } from "@/components/ui/help-tooltip";

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
  needs?: PositionStrength[];
  surplus?: PositionStrength[];
  upgradeTargets?: PositionStrength[];
  teamTier?: TeamTier;
  teamCompetitivePercentile?: number;
  // Team Profile
  averageAge: number | null;
  under26ValueShare: number;
  over28ValueShare: number;
  draftPickValue: number;
  // Competitive Snapshot
  teamCompetitiveScore: number;
  gapToLeader: number;
  gapToContenderMedian: number;
  strongestUnit: string | null;
  weakestUnit: string | null;
  // Slot splits
  benchValue: number;
  taxiValue: number;
  irValue: number;
  // Position ranks
  positionRanks: Record<string, { value: number; rank: number }>;
}

export default async function LeagueSummaryPage({ params }: PageProps) {
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

  // Parallel fetch: settings, teams, rosters, and draft picks
  let leagueTeams;
  let rosterData;
  let settings;
  let draftPickSums: Map<string, number>;
  try {
    const [settingsResult, teamsResult, rostersResult, picksResult] =
      await Promise.all([
        db.select().from(leagueSettings)
          .where(eq(leagueSettings.leagueId, league.id)).limit(1),
        db.select().from(teams)
          .where(eq(teams.leagueId, league.id)),
        db
          .select({
            roster: rosters,
            player: canonicalPlayers,
            value: playerValues,
          })
          .from(rosters)
          .innerJoin(teams, eq(rosters.teamId, teams.id))
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
          .where(eq(teams.leagueId, league.id)),
        db.select({
          ownerTeamId: draftPicks.ownerTeamId,
          totalValue: sum(draftPicks.value),
        })
          .from(draftPicks)
          .where(eq(draftPicks.leagueId, league.id))
          .groupBy(draftPicks.ownerTeamId),
      ]);

    [settings] = settingsResult;
    leagueTeams = teamsResult;
    rosterData = rostersResult;
    draftPickSums = new Map(
      picksResult.map((r) => [r.ownerTeamId, Number(r.totalValue) || 0]),
    );
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
              {league.name} &bull;{" "}
              {leagueFormatString({
                totalTeams: league.totalTeams,
                rosterPositions: (settings?.rosterPositions ?? {}) as Record<string, number>,
                idpStructure: settings?.idpStructure ?? null,
                scoringRules: (settings?.scoringRules ?? {}) as Record<string, number>,
              })}{" "}
              &bull;{" "}
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

  // Position-group mapping for detailed view
  const POS_GROUP_MAP: Record<string, string> = {
    QB: "QB", RB: "RB", WR: "WR", TE: "TE",
    DL: "DL", EDR: "DL", IL: "DL",
    LB: "LB",
    DB: "DB", CB: "DB", S: "DB",
  };
  const leagueHasIdp = settings?.idpStructure
    && settings.idpStructure !== "none";
  const POS_GROUPS = leagueHasIdp
    ? ["QB", "RB", "WR", "TE", "DL", "LB", "DB"]
    : ["QB", "RB", "WR", "TE"];

  // Calculate team rankings
  const teamRankings: TeamRanking[] = leagueTeams.map((team) => {
    const teamRoster = rosterData.filter(
      (r) => r.roster.teamId === team.id,
    );

    // Calculate values by category
    const starterIds = settings
      ? computeOptimalStarters(
          teamRoster.map((r) => ({
            id: r.player.id,
            position: r.player.position,
            positionGroup: r.player.positionGroup,
            value: r.value?.value || 0,
            slot: r.roster.slotPosition || "BN",
          })),
          settings.rosterPositions,
          settings.flexRules,
          settings.positionMappings,
        )
      : new Set(
          teamRoster
            .filter((r) => r.roster.slotPosition === "START")
            .map((r) => r.player.id),
        );
    const offenseRoster = teamRoster.filter(
      (r) => r.player.positionGroup === "offense",
    );
    const idpRoster = teamRoster.filter(
      (r) => r.player.positionGroup === "defense",
    );

    // For non-IDP leagues, exclude defense from overall value
    const valuedRoster = leagueHasIdp
      ? teamRoster
      : teamRoster.filter((r) => r.player.positionGroup !== "defense");
    const overallValue = valuedRoster.reduce(
      (s, r) => s + (r.value?.value || 0), 0,
    );
    const starterValue = teamRoster
      .filter((r) => starterIds.has(r.player.id))
      .reduce((s, r) => s + (r.value?.value || 0), 0);
    const offenseValue = offenseRoster.reduce(
      (s, r) => s + (r.value?.value || 0), 0,
    );
    const idpValue = idpRoster.reduce(
      (s, r) => s + (r.value?.value || 0), 0,
    );

    // Build roster player list for expanded details
    const roster: RosterPlayer[] = teamRoster.map((r) => ({
      name: r.player.name,
      position: r.player.position,
      value: r.value?.value || 0,
      age: r.player.age,
      slot: r.roster.slotPosition || "BN",
    }));

    // Age metrics
    const withAge = roster.filter((p) => p.age !== null);
    const averageAge = withAge.length > 0
      ? withAge.reduce((s, p) => s + (p.age ?? 0), 0) / withAge.length
      : null;
    const under26Val = roster
      .filter((p) => p.age !== null && p.age < 26)
      .reduce((s, p) => s + p.value, 0);
    const over28Val = roster
      .filter((p) => p.age !== null && p.age > 28)
      .reduce((s, p) => s + p.value, 0);
    const under26ValueShare = overallValue > 0
      ? (under26Val / overallValue) * 100 : 0;
    const over28ValueShare = overallValue > 0
      ? (over28Val / overallValue) * 100 : 0;

    // Slot-based values
    const slotVal = (slots: string[]) => roster
      .filter((p) => slots.includes(p.slot))
      .reduce((s, p) => s + p.value, 0);
    const benchValue = overallValue - starterValue;
    const taxiValue = slotVal(["TAXI"]);
    const irValue = slotVal(["IR"]);

    // Position-group values (for ranking later)
    const posGroupValues: Record<string, number> = {};
    for (const g of POS_GROUPS) posGroupValues[g] = 0;
    for (const p of roster) {
      const g = POS_GROUP_MAP[p.position];
      if (g) posGroupValues[g] += p.value;
    }

    return {
      teamId: team.id,
      teamName: team.teamName,
      ownerName: team.ownerName,
      isCurrentUser: team.id === league.userTeamId,
      overallValue,
      overallRank: 0,
      starterValue,
      starterRank: 0,
      offenseValue,
      offenseRank: 0,
      idpValue,
      idpRank: 0,
      roster,
      averageAge,
      under26ValueShare,
      over28ValueShare,
      draftPickValue: draftPickSums.get(team.id) ?? 0,
      teamCompetitiveScore: 0,
      gapToLeader: 0,
      gapToContenderMedian: 0,
      strongestUnit: null,
      weakestUnit: null,
      benchValue,
      taxiValue,
      irValue,
      positionRanks: Object.fromEntries(
        POS_GROUPS.map((g) => [g, { value: posGroupValues[g], rank: 0 }]),
      ),
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
    team.overallRank = sortByOverall.findIndex(
      (t) => t.teamId === team.teamId,
    ) + 1;
    team.starterRank = sortByStarter.findIndex(
      (t) => t.teamId === team.teamId,
    ) + 1;
    team.offenseRank = sortByOffense.findIndex(
      (t) => t.teamId === team.teamId,
    ) + 1;
    team.idpRank = sortByIdp.findIndex(
      (t) => t.teamId === team.teamId,
    ) + 1;
  });

  // Position-group ranks
  for (const group of POS_GROUPS) {
    const allZero = teamRankings.every(
      (t) => t.positionRanks[group].value === 0,
    );
    if (allZero) {
      // Leave rank as 0 to signal "no data" for this group
      continue;
    }
    const sorted = [...teamRankings].sort(
      (a, b) =>
        b.positionRanks[group].value - a.positionRanks[group].value,
    );
    teamRankings.forEach((team) => {
      team.positionRanks[group].rank =
        sorted.findIndex((t) => t.teamId === team.teamId) + 1;
    });
  }

  // Sort by overall rank for display
  teamRankings.sort((a, b) => a.overallRank - b.overallRank);

  // --- V2 Team Needs ---
  if (settings) {
    const { rosterPositions, flexRules, positionMappings } =
      settings;

    const repLevels = calculateAllReplacementLevels(
      rosterPositions,
      flexRules,
      positionMappings ?? undefined,
      league.totalTeams,
      {},  // no projections needed for team-needs
    );

    // Build league-wide player lists per position (sorted desc)
    const leagueByPosition: Record<
      string,
      Array<{ value: number }>
    > = {};
    for (const r of rosterData) {
      const pos = r.player.position;
      if (!leagueByPosition[pos]) leagueByPosition[pos] = [];
      leagueByPosition[pos].push({ value: r.value?.value ?? 0 });
    }
    for (const arr of Object.values(leagueByPosition)) {
      arr.sort((a, b) => b.value - a.value);
    }

    // Per-position starter demand (per-team)
    const positions = Object.keys(repLevels);
    const starterDemands: Record<string, number> = {};
    for (const pos of positions) {
      starterDemands[pos] =
        calculateStarterDemand(
          pos,
          rosterPositions,
          flexRules,
          positionMappings ?? undefined,
          league.totalTeams,
        ) / league.totalTeams;
    }

    const allResults: TeamNeedsResult[] = [];

    for (const team of teamRankings) {
      // Group this team's players by position
      const teamByPosition: Record<
        string,
        Array<{ value: number }>
      > = {};
      for (const p of team.roster) {
        if (!teamByPosition[p.position]) {
          teamByPosition[p.position] = [];
        }
        teamByPosition[p.position].push({ value: p.value });
      }
      for (const arr of Object.values(teamByPosition)) {
        arr.sort((a, b) => b.value - a.value);
      }

      const posInputs: Record<string, TeamNeedInput> = {};
      for (const pos of positions) {
        posInputs[pos] = {
          leaguePlayers: leagueByPosition[pos] ?? [],
          teamPlayers: teamByPosition[pos] ?? [],
          starterDemand: starterDemands[pos] ?? 0,
          replacementRank: repLevels[pos] ?? 1,
        };
      }

      const result = computeTeamNeeds(posInputs);
      team.needs = result.needs;
      team.surplus = result.surplus;
      allResults.push(result);
    }

    // Classify teams by competitive tier (mutates results in place)
    classifyTeams(allResults);

    // Split surplus into upgrade targets vs true surplus
    computeUpgradeTargets(allResults);

    // Assign tier, percentile, surplus, upgrade targets, and score
    for (let i = 0; i < teamRankings.length; i++) {
      teamRankings[i].teamTier = allResults[i].teamTier ?? undefined;
      teamRankings[i].teamCompetitivePercentile =
        allResults[i].teamCompetitivePercentile ?? undefined;
      teamRankings[i].surplus = allResults[i].surplus;
      teamRankings[i].upgradeTargets = allResults[i].upgradeTargets;
      teamRankings[i].teamCompetitiveScore =
        allResults[i].teamCompetitiveScore;
    }

    // Competitive snapshot: gaps and strongest/weakest units
    const maxScore = Math.max(
      ...teamRankings.map((t) => t.teamCompetitiveScore),
    );
    const contenderScores = teamRankings
      .filter((t) => t.teamTier === "contender")
      .map((t) => t.teamCompetitiveScore);
    const contenderMedian = contenderScores.length > 0
      ? (() => {
          const s = [...contenderScores].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 !== 0
            ? s[mid] : (s[mid - 1] + s[mid]) / 2;
        })()
      : maxScore;

    for (const team of teamRankings) {
      team.gapToLeader = maxScore - team.teamCompetitiveScore;
      team.gapToContenderMedian =
        contenderMedian - team.teamCompetitiveScore;

      // Strongest / weakest unit by rank (lower = better)
      const ranked = POS_GROUPS
        .filter((g) => team.positionRanks[g].rank > 0);
      if (ranked.length > 0) {
        team.strongestUnit = ranked.reduce((best, g) =>
          team.positionRanks[g].rank < team.positionRanks[best].rank
            ? g : best,
        );
        team.weakestUnit = ranked.reduce((worst, g) =>
          team.positionRanks[g].rank > team.positionRanks[worst].rank
            ? g : worst,
        );
      }
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 mb-3 sm:mb-6">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-white">League Summary</h1>
          <p className="text-slate-400 mt-1">
            {league.name} &bull;{" "}
            {leagueFormatString({
              totalTeams: league.totalTeams,
              rosterPositions: (settings?.rosterPositions ?? {}) as Record<string, number>,
              idpStructure: settings?.idpStructure ?? null,
              scoringRules: (settings?.scoringRules ?? {}) as Record<string, number>,
            })}{" "}
            &bull;{" "}
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
      <div className="bg-slate-800/50 rounded-lg overflow-clip">
        <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">Team Power Rankings</h2>
            <HelpTooltip text="Teams ranked by total roster value based on your league's scoring, roster rules, and player projections." />
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Ranked by total roster value. Click a team to see details.
          </p>
        </div>

        {teamRankings.length > 0 ? (
          <TeamRankingsTable
            rankings={teamRankings}
            hasIdp={settings?.idpStructure !== "none"
              && settings?.idpStructure !== undefined}
            leagueId={league.id}
          />
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
