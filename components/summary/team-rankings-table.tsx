"use client";

import { useState, Fragment } from "react";

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

interface TeamRankingsTableProps {
  rankings: TeamRanking[];
}

export function TeamRankingsTable({ rankings }: TeamRankingsTableProps) {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-900/50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
              Team
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
              Overall
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
              Starters
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
              Offense
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">
              IDP
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
              Total Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {rankings.map((team) => (
            <Fragment key={team.teamId}>
              <tr
                onClick={() =>
                  setExpandedTeam(expandedTeam === team.teamId ? null : team.teamId)
                }
                className={`cursor-pointer hover:bg-slate-700/50 transition-colors ${
                  team.isCurrentUser ? "bg-blue-900/20" : ""
                } ${expandedTeam === team.teamId ? "bg-slate-700/30" : ""}`}
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-slate-500 w-6">
                      {team.overallRank}
                    </span>
                    <div>
                      <div className="font-medium text-white flex items-center gap-2">
                        {team.teamName}
                        {team.isCurrentUser && (
                          <span className="text-xs text-blue-400">(You)</span>
                        )}
                        <span className="text-slate-500 text-sm">
                          {expandedTeam === team.teamId ? "▼" : "▶"}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400">{team.ownerName}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <RankBadge rank={team.overallRank} total={rankings.length} />
                </td>
                <td className="px-6 py-4 text-center">
                  <RankBadge rank={team.starterRank} total={rankings.length} />
                </td>
                <td className="px-6 py-4 text-center">
                  <RankBadge rank={team.offenseRank} total={rankings.length} />
                </td>
                <td className="px-6 py-4 text-center">
                  <RankBadge rank={team.idpRank} total={rankings.length} />
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="font-mono text-slate-300">
                    {team.overallValue.toLocaleString()}
                  </span>
                </td>
              </tr>

              {/* Expanded Details */}
              {expandedTeam === team.teamId && (
                <tr className="bg-slate-900/30">
                  <td colSpan={6} className="px-6 py-4">
                    <TeamDetails team={team} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamDetails({ team }: { team: TeamRanking }) {
  const starters = team.roster.filter((p) => p.slot === "START");
  const bench = team.roster.filter((p) => p.slot === "BN");

  // Calculate average age
  const playersWithAge = team.roster.filter((p) => p.age !== null);
  const avgAge = playersWithAge.length > 0
    ? playersWithAge.reduce((sum, p) => sum + (p.age || 0), 0) / playersWithAge.length
    : null;

  // Calculate position breakdown
  const positionGroups: Record<string, { count: number; value: number }> = {};
  for (const player of team.roster) {
    const pos = player.position;
    if (!positionGroups[pos]) {
      positionGroups[pos] = { count: 0, value: 0 };
    }
    positionGroups[pos].count++;
    positionGroups[pos].value += player.value;
  }

  // Sort positions by value
  const sortedPositions = Object.entries(positionGroups)
    .sort((a, b) => b[1].value - a[1].value);

  // Identify team needs (positions with low value relative to others)
  const avgValuePerPosition = team.overallValue / Object.keys(positionGroups).length;
  const needs = sortedPositions
    .filter(([, data]) => data.value < avgValuePerPosition * 0.5)
    .map(([pos]) => pos);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Team Overview */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Overview</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Average Age</span>
            <span className="text-white font-mono">
              {avgAge ? avgAge.toFixed(1) : "-"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Starters Value</span>
            <span className="text-white font-mono">
              {team.starterValue.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Bench Value</span>
            <span className="text-white font-mono">
              {(team.overallValue - team.starterValue).toLocaleString()}
            </span>
          </div>
          {needs.length > 0 && (
            <div className="pt-2 mt-2 border-t border-slate-700">
              <span className="text-slate-400">Needs:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {needs.map((pos) => (
                  <span
                    key={pos}
                    className="px-2 py-0.5 rounded text-xs bg-red-900/50 text-red-400"
                  >
                    {pos}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Position Breakdown */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Position Value</h4>
        <div className="space-y-1 text-sm">
          {sortedPositions.slice(0, 6).map(([pos, data]) => (
            <div key={pos} className="flex justify-between items-center">
              <span className="text-slate-300">
                {pos} ({data.count})
              </span>
              <span className="text-white font-mono">
                {data.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Starters */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 mb-3">Top Starters</h4>
        <div className="space-y-1 text-sm">
          {starters
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
            .map((player, i) => (
              <div key={i} className="flex justify-between items-center">
                <span className="text-slate-300 truncate flex-1 mr-2">
                  <span className="text-slate-500 text-xs">{player.position}</span>{" "}
                  {player.name}
                </span>
                <span className="text-white font-mono text-xs">
                  {player.value.toLocaleString()}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function RankBadge({ rank, total }: { rank: number; total: number }) {
  const percentile = ((total - rank + 1) / total) * 100;

  let colorClass = "bg-slate-700 text-slate-300";
  if (percentile >= 80) colorClass = "bg-green-900/50 text-green-400";
  else if (percentile >= 60) colorClass = "bg-blue-900/50 text-blue-400";
  else if (percentile >= 40) colorClass = "bg-slate-700 text-slate-300";
  else if (percentile >= 20) colorClass = "bg-yellow-900/50 text-yellow-400";
  else colorClass = "bg-red-900/50 text-red-400";

  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${colorClass}`}
    >
      {rank}
    </span>
  );
}
