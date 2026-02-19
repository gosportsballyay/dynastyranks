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
  draftPicks,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  computeAllPickValues,
  computePickValue,
  getLeagueValueStats,
  type PlayerAsset,
  type DraftPickAsset,
  type LeagueConfig,
} from "@/lib/trade-engine";
import { TradeCalculator } from "@/components/trade-calculator/trade-calculator";

interface PageProps {
  params: { id: string };
}

/** Roster player with full value engine fields for trade analysis. */
interface TeamData {
  id: string;
  name: string;
  roster: PlayerAsset[];
  picks: DraftPickAsset[];
}

export default async function TradeCalculatorPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) {
    notFound();
  }

  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(eq(leagues.id, params.id), eq(leagues.userId, session.user.id)),
    )
    .limit(1);

  if (!league) {
    notFound();
  }

  // Parallel fetch: settings, teams, rosters+values, draft picks
  const [settingsResult, leagueTeams, rosterValueData, leaguePicks] =
    await Promise.all([
      db
        .select()
        .from(leagueSettings)
        .where(eq(leagueSettings.leagueId, league.id))
        .limit(1),
      db.select().from(teams).where(eq(teams.leagueId, league.id)),
      db
        .select({
          roster: rosters,
          player: canonicalPlayers,
          pv: playerValues,
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
      db
        .select()
        .from(draftPicks)
        .where(eq(draftPicks.leagueId, league.id)),
    ]);

  const [settings] = settingsResult;

  // Build league config
  const leagueConfig: LeagueConfig = {
    totalTeams: league.totalTeams,
    rosterPositions: settings?.rosterPositions ?? { QB: 1, RB: 2, WR: 3, TE: 1 },
    flexRules: settings?.flexRules ?? [],
    positionMappings: settings?.positionMappings ?? undefined,
    benchSlots: settings?.benchSlots ?? 6,
    taxiSlots: settings?.taxiSlots ?? 0,
    irSlots: settings?.irSlots ?? 0,
  };

  // Compute draft pick values
  const allPlayerValues = rosterValueData
    .filter((r) => r.pv !== null)
    .map((r) => ({ value: r.pv!.value, rank: r.pv!.rank }));

  const currentSeason = league.season;
  const pickValueMap = computeAllPickValues(
    leaguePicks.map((p) => ({
      id: p.id,
      season: p.season,
      round: p.round,
      pickNumber: p.pickNumber,
      projectedPickNumber: p.projectedPickNumber,
    })),
    allPlayerValues,
    currentSeason,
    league.totalTeams,
  );

  // Build team data
  const teamDataMap = new Map<string, TeamData>();

  for (const t of leagueTeams) {
    teamDataMap.set(t.id, {
      id: t.id,
      name: t.teamName || t.ownerName || `Team ${t.externalTeamId}`,
      roster: [],
      picks: [],
    });
  }

  // Populate rosters
  for (const { roster, player, pv } of rosterValueData) {
    const team = teamDataMap.get(roster.teamId);
    if (!team) continue;

    team.roster.push({
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
    });
  }

  // Sort rosters by value descending
  for (const team of teamDataMap.values()) {
    team.roster.sort((a, b) => b.value - a.value);
  }

  // Populate draft picks
  const teamNameMap = new Map(
    leagueTeams.map((t) => [
      t.id,
      t.teamName || t.ownerName || `Team ${t.externalTeamId}`,
    ]),
  );

  // Pre-compute E/M/L values for picks without a known position
  const leagueStats = getLeagueValueStats(allPlayerValues);
  const earlySlot = Math.ceil(league.totalTeams * 0.25);
  const midSlot = Math.ceil(league.totalTeams * 0.50);
  const lateSlot = Math.ceil(league.totalTeams * 0.75);

  for (const pick of leaguePicks) {
    const team = teamDataMap.get(pick.ownerTeamId);
    if (!team) continue;

    const yearsOut = Math.max(0, pick.season - currentSeason);
    const hasKnownPosition =
      pick.projectedPickNumber !== null || pick.pickNumber !== null;

    const pickAsset: DraftPickAsset = {
      pickId: pick.id,
      season: pick.season,
      round: pick.round,
      pickNumber: pick.pickNumber,
      projectedPickNumber: pick.projectedPickNumber,
      originalTeamId: pick.originalTeamId,
      originalTeamName: pick.originalTeamId
        ? (teamNameMap.get(pick.originalTeamId) ?? null)
        : null,
      ownerTeamId: pick.ownerTeamId,
      value: pickValueMap.get(pick.id) ?? 0,
    };

    if (!hasKnownPosition || pick.round <= 3) {
      pickAsset.earlyValue = computePickValue(
        pick.round, earlySlot, league.totalTeams, leagueStats, yearsOut,
      );
      pickAsset.midValue = computePickValue(
        pick.round, midSlot, league.totalTeams, leagueStats, yearsOut,
      );
      pickAsset.lateValue = computePickValue(
        pick.round, lateSlot, league.totalTeams, leagueStats, yearsOut,
      );
      if (hasKnownPosition) {
        pickAsset.projectedValue = pickAsset.value;
      }
    }

    team.picks.push(pickAsset);
  }

  // Sort picks by season, then round, then projected pick
  for (const team of teamDataMap.values()) {
    team.picks.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.round !== b.round) return a.round - b.round;
      return (a.projectedPickNumber ?? 99) - (b.projectedPickNumber ?? 99);
    });
  }

  // Generate generic picks for "No Team" mode
  const draftRounds =
    (settings?.metadata as Record<string, unknown> | null)
      ?.draftRounds as number | undefined ?? 4;
  const genericPicks: DraftPickAsset[] = [];
  for (let seasonOffset = 0; seasonOffset < 3; seasonOffset++) {
    const season = currentSeason + seasonOffset;
    const yearsOut = seasonOffset;
    for (let round = 1; round <= draftRounds; round++) {
      const tiers = [
        { key: "early", slot: earlySlot },
        { key: "mid", slot: midSlot },
        { key: "late", slot: lateSlot },
      ] as const;
      for (const { key, slot } of tiers) {
        const val = computePickValue(
          round, slot, league.totalTeams, leagueStats, yearsOut,
        );
        genericPicks.push({
          pickId: `generic-${season}-${round}-${key}`,
          season,
          round,
          pickNumber: null,
          projectedPickNumber: null,
          originalTeamId: null,
          originalTeamName: null,
          ownerTeamId: "__no_team__",
          value: val,
        });
      }
    }
  }

  const teamsData = Array.from(teamDataMap.values());

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Trade Calculator</h1>
        <p className="text-slate-400 mt-1">
          {league.name} &bull; {league.totalTeams} teams
        </p>
      </div>

      <TradeCalculator
        teams={teamsData}
        genericPicks={genericPicks}
        leagueConfig={leagueConfig}
        userTeamId={league.userTeamId ?? null}
        leagueId={league.id}
        replacementValue={leagueStats.replacementValue}
      />
    </div>
  );
}
