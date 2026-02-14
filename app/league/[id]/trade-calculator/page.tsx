export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  leagues,
  teams,
  rosters,
  playerValues,
  canonicalPlayers,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { TradeCalculator } from "@/components/trade-calculator/trade-calculator";

interface PageProps {
  params: { id: string };
}

export default async function TradeCalculatorPage({ params }: PageProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Fetch league
  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(eq(leagues.id, params.id), eq(leagues.userId, session.user.id))
    )
    .limit(1);

  if (!league) {
    notFound();
  }

  // Fetch teams
  const leagueTeams = await db
    .select()
    .from(teams)
    .where(eq(teams.leagueId, league.id));

  // Fetch all player values with player info
  const values = await db
    .select({
      value: playerValues,
      player: canonicalPlayers,
    })
    .from(playerValues)
    .innerJoin(
      canonicalPlayers,
      eq(playerValues.canonicalPlayerId, canonicalPlayers.id)
    )
    .where(eq(playerValues.leagueId, league.id));

  // Fetch rosters with player mappings
  const rosterData = await db
    .select({
      roster: rosters,
      team: teams,
    })
    .from(rosters)
    .innerJoin(teams, eq(rosters.teamId, teams.id))
    .where(eq(teams.leagueId, league.id));

  // Create player lookup by canonical ID
  const playerValueMap = new Map(
    values.map((v) => [
      v.player.id,
      {
        ...v.value,
        player: v.player,
      },
    ])
  );

  // Create roster lookup by team
  const teamRosters = new Map<
    string,
    Array<{
      playerId: string;
      playerName: string;
      position: string;
      value: number;
    }>
  >();

  for (const { roster, team } of rosterData) {
    if (!teamRosters.has(team.id)) {
      teamRosters.set(team.id, []);
    }

    const playerValue = roster.canonicalPlayerId
      ? playerValueMap.get(roster.canonicalPlayerId)
      : null;

    teamRosters.get(team.id)!.push({
      playerId: roster.canonicalPlayerId || roster.externalPlayerId,
      playerName: playerValue?.player.name || roster.playerName || "Unknown",
      position: playerValue?.player.position || roster.playerPosition || "?",
      value: playerValue?.value || 0,
    });
  }

  // Sort each roster by value
  for (const roster of teamRosters.values()) {
    roster.sort((a, b) => b.value - a.value);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-xl font-bold text-white hover:text-blue-400 transition-colors"
              >
                DynastyRanks
              </Link>
              <span className="text-slate-500">/</span>
              <Link
                href={`/league/${league.id}/rankings`}
                className="text-slate-300 hover:text-white transition-colors"
              >
                {league.name}
              </Link>
              <span className="text-slate-500">/</span>
              <span className="text-white">Trade Calculator</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-white mb-8">Trade Calculator</h1>

        <TradeCalculator
          teams={leagueTeams.map((t) => ({
            id: t.id,
            name: t.teamName || t.ownerName || `Team ${t.externalTeamId}`,
            roster: teamRosters.get(t.id) || [],
          }))}
        />
      </main>
    </div>
  );
}
