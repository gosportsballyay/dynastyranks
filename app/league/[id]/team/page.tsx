export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
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

interface PageProps {
  params: { id: string };
}

interface RosterPlayer {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  value: number;
  slot: string;
}

export default async function MyTeamPage({ params }: PageProps) {
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

  // Get the user's selected team
  let userTeam;
  try {
    if (league.userTeamId) {
      // User has selected their team
      const teamResults = await db
        .select()
        .from(teams)
        .where(and(eq(teams.id, league.userTeamId), eq(teams.leagueId, league.id)))
        .limit(1);
      userTeam = teamResults[0];
    } else {
      // No team selected - show prompt to select team
      const teamResults = await db
        .select()
        .from(teams)
        .where(eq(teams.leagueId, league.id));

      if (teamResults.length > 0) {
        return (
          <div>
            <h1 className="text-2xl font-bold text-white mb-6">My Team</h1>
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
      userTeam = undefined;
    }
  } catch (error) {
    console.error("Failed to fetch team:", error);
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">My Team</h1>
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>Failed to load team data.</p>
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

  if (!userTeam) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">My Team</h1>
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
              League sync failed: {league.syncError || "Unknown error"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Fetch roster with player values
  const rosterData = await db
    .select({
      roster: rosters,
      player: canonicalPlayers,
      value: playerValues,
    })
    .from(rosters)
    .innerJoin(canonicalPlayers, eq(rosters.canonicalPlayerId, canonicalPlayers.id))
    .leftJoin(
      playerValues,
      and(
        eq(playerValues.canonicalPlayerId, canonicalPlayers.id),
        eq(playerValues.leagueId, league.id)
      )
    )
    .where(eq(rosters.teamId, userTeam.id));

  // Transform and organize roster
  const roster: RosterPlayer[] = rosterData.map((r) => ({
    playerId: r.player.id,
    playerName: r.player.name,
    position: r.player.position,
    nflTeam: r.player.nflTeam,
    age: r.player.age,
    value: r.value?.value || 0,
    slot: r.roster.slotPosition || "BN",
  }));

  // Group by slot type
  const starters = roster.filter((p) => p.slot === "START").sort((a, b) => b.value - a.value);
  const bench = roster.filter((p) => p.slot === "BN").sort((a, b) => b.value - a.value);
  const ir = roster.filter((p) => p.slot === "IR").sort((a, b) => b.value - a.value);
  const taxi = roster.filter((p) => p.slot === "TAXI").sort((a, b) => b.value - a.value);

  // Calculate totals
  const totalValue = roster.reduce((sum, p) => sum + p.value, 0);
  const starterValue = starters.reduce((sum, p) => sum + p.value, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Team</h1>
          <p className="text-slate-400 mt-1">
            {userTeam.teamName || "Unknown Team"} &bull; {userTeam.ownerName || "Unknown"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white">
            {totalValue.toLocaleString()}
          </div>
          <div className="text-sm text-slate-400">Total Value</div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          label="Starters"
          value={starterValue}
          count={starters.length}
        />
        <SummaryCard
          label="Bench"
          value={bench.reduce((sum, p) => sum + p.value, 0)}
          count={bench.length}
        />
        <SummaryCard
          label="IR"
          value={ir.reduce((sum, p) => sum + p.value, 0)}
          count={ir.length}
        />
        <SummaryCard
          label="Taxi"
          value={taxi.reduce((sum, p) => sum + p.value, 0)}
          count={taxi.length}
        />
      </div>

      {/* Roster Sections */}
      <div className="space-y-6">
        {starters.length > 0 && (
          <RosterSection title="Starters" players={starters} />
        )}
        {bench.length > 0 && (
          <RosterSection title="Bench" players={bench} />
        )}
        {ir.length > 0 && (
          <RosterSection title="Injured Reserve" players={ir} />
        )}
        {taxi.length > 0 && (
          <RosterSection title="Taxi Squad" players={taxi} />
        )}
      </div>

      {roster.length === 0 && (
        <div className="bg-slate-800/50 rounded-lg p-12 text-center text-slate-400">
          <p>No players on roster.</p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  count,
}: {
  label: string;
  value: number;
  count: number;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-xl font-bold text-white mt-1">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-500 mt-1">{count} players</div>
    </div>
  );
}

function RosterSection({
  title,
  players,
}: {
  title: string;
  players: RosterPlayer[];
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-semibold text-white">{title}</h2>
        <span className="text-sm text-slate-400">{players.length} players</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/50">
            <tr>
              <th className="px-6 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Player
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Pos
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Team
              </th>
              <th className="px-6 py-2 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
                Age
              </th>
              <th className="px-6 py-2 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {players.map((player) => (
              <tr
                key={player.playerId}
                className="hover:bg-slate-700/30 transition-colors"
              >
                <td className="px-6 py-3">
                  <span className="font-medium text-white">{player.playerName}</span>
                </td>
                <td className="px-6 py-3">
                  <PositionBadge position={player.position} />
                </td>
                <td className="px-6 py-3 text-slate-400">
                  {player.nflTeam || "-"}
                </td>
                <td className="px-6 py-3 text-center text-slate-400">
                  {player.age || "-"}
                </td>
                <td className="px-6 py-3 text-right">
                  <span className="font-mono text-slate-300">
                    {player.value.toLocaleString()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionBadge({ position }: { position: string }) {
  const colorMap: Record<string, string> = {
    QB: "bg-red-900/50 text-red-400",
    RB: "bg-green-900/50 text-green-400",
    WR: "bg-blue-900/50 text-blue-400",
    TE: "bg-yellow-900/50 text-yellow-400",
    K: "bg-slate-700 text-slate-300",
    // IDP
    DL: "bg-purple-900/50 text-purple-400",
    LB: "bg-purple-900/50 text-purple-400",
    DB: "bg-purple-900/50 text-purple-400",
    EDR: "bg-purple-900/50 text-purple-400",
    IL: "bg-purple-900/50 text-purple-400",
    CB: "bg-purple-900/50 text-purple-400",
    S: "bg-purple-900/50 text-purple-400",
  };

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${
        colorMap[position] || "bg-slate-700 text-slate-300"
      }`}
    >
      {position}
    </span>
  );
}
