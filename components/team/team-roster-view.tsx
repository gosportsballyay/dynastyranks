"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface RosterPlayer {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  value: number;
  rankInPosition: number | null;
  slot: string;
}

export interface TeamOption {
  id: string;
  name: string;
  owner: string;
}

interface TeamRosterViewProps {
  leagueId: string;
  currentTeamId: string;
  userTeamId: string | null;
  allTeams: TeamOption[];
  roster: RosterPlayer[];
  teamName: string;
  ownerName: string;
}

type SortColumn = "name" | "position" | "team" | "age" | "value";
type SortDirection = "asc" | "desc";

interface SectionSortState {
  column: SortColumn;
  direction: SortDirection;
}

const DEFAULT_SORT: SectionSortState = {
  column: "value",
  direction: "desc",
};

/**
 * Client component for viewing a team roster with
 * team dropdown navigation and sortable column headers.
 */
export function TeamRosterView({
  leagueId,
  currentTeamId,
  userTeamId,
  allTeams,
  roster,
  teamName,
  ownerName,
}: TeamRosterViewProps) {
  const router = useRouter();

  const starters = useMemo(
    () => roster.filter((p) => p.slot === "START"),
    [roster]
  );
  const bench = useMemo(
    () => roster.filter((p) => p.slot === "BN"),
    [roster]
  );
  const ir = useMemo(
    () => roster.filter((p) => p.slot === "IR"),
    [roster]
  );
  const taxi = useMemo(
    () => roster.filter((p) => p.slot === "TAXI"),
    [roster]
  );

  const totalValue = useMemo(
    () => roster.reduce((sum, p) => sum + p.value, 0),
    [roster]
  );

  function handleTeamChange(teamId: string) {
    router.push(`/league/${leagueId}/team?team=${teamId}`);
  }

  const sections: Array<{
    key: string;
    title: string;
    players: RosterPlayer[];
  }> = [
    { key: "starters", title: "Starters", players: starters },
    { key: "bench", title: "Bench", players: bench },
    { key: "ir", title: "Injured Reserve", players: ir },
    { key: "taxi", title: "Taxi Squad", players: taxi },
  ];

  return (
    <div>
      {/* Header with dropdown */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">
              Team Roster
            </h1>
            <select
              value={currentTeamId}
              onChange={(e) => handleTeamChange(e.target.value)}
              className="bg-slate-700 text-white text-sm rounded-lg
                px-3 py-1.5 border border-slate-600
                hover:border-slate-500 focus:border-blue-500
                focus:outline-none transition-colors cursor-pointer"
            >
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === userTeamId ? " (My Team)" : ""}
                  {t.owner ? ` — ${t.owner}` : ""}
                </option>
              ))}
            </select>
          </div>
          <p className="text-slate-400 mt-1">
            {teamName} &bull; {ownerName}
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
        {sections.map((s) => (
          <SummaryCard
            key={s.key}
            label={s.title}
            value={s.players.reduce((sum, p) => sum + p.value, 0)}
            count={s.players.length}
          />
        ))}
      </div>

      {/* Roster Sections */}
      <div className="space-y-6">
        {sections.map(
          (s) =>
            s.players.length > 0 && (
              <RosterSection
                key={s.key}
                title={s.title}
                players={s.players}
              />
            )
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
      <div className="text-xs text-slate-500 mt-1">
        {count} players
      </div>
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
  const [sortState, setSortState] = useState<SectionSortState>(
    DEFAULT_SORT
  );

  const handleSort = (column: SortColumn) => {
    if (sortState.column === column) {
      setSortState({
        column,
        direction: sortState.direction === "asc" ? "desc" : "asc",
      });
    } else {
      setSortState({
        column,
        direction: column === "value" ? "desc" : "asc",
      });
    }
  };

  const sorted = useMemo(() => {
    const list = [...players];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortState.column) {
        case "name":
          cmp = a.playerName.localeCompare(b.playerName);
          break;
        case "position":
          cmp = a.position.localeCompare(b.position);
          break;
        case "team":
          cmp = (a.nflTeam || "ZZZ").localeCompare(
            b.nflTeam || "ZZZ"
          );
          break;
        case "age":
          cmp = (a.age || 99) - (b.age || 99);
          break;
        case "value":
          cmp = a.value - b.value;
          break;
      }
      return sortState.direction === "asc" ? cmp : -cmp;
    });
    return list;
  }, [players, sortState]);

  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortState.column !== column) return null;
    return (
      <span className="ml-1">
        {sortState.direction === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const SortableHeader = ({
    column,
    children,
    className = "",
  }: {
    column: SortColumn;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th
      onClick={() => handleSort(column)}
      className={`px-6 py-2 text-xs font-medium text-slate-400
        uppercase tracking-wider cursor-pointer hover:text-white
        transition-colors select-none ${className}`}
    >
      {children}
      <SortIndicator column={column} />
    </th>
  );

  return (
    <div className="bg-slate-800/50 rounded-lg overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-semibold text-white">{title}</h2>
        <span className="text-sm text-slate-400">
          {players.length} players
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-900/50">
            <tr>
              <SortableHeader column="name" className="text-left">
                Player
              </SortableHeader>
              <SortableHeader
                column="position"
                className="text-left"
              >
                Pos
              </SortableHeader>
              <SortableHeader column="team" className="text-left">
                Team
              </SortableHeader>
              <SortableHeader column="age" className="text-center">
                Age
              </SortableHeader>
              <SortableHeader column="value" className="text-right">
                Value
              </SortableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {sorted.map((player) => (
              <tr
                key={player.playerId}
                className="hover:bg-slate-700/30 transition-colors"
              >
                <td className="px-6 py-3">
                  <span className="font-medium text-white">
                    {player.playerName}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <PositionBadge
                    position={player.position}
                    rankInPosition={player.rankInPosition}
                  />
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

const POSITION_COLORS: Record<string, string> = {
  QB: "bg-red-900/50 text-red-400",
  RB: "bg-green-900/50 text-green-400",
  WR: "bg-blue-900/50 text-blue-400",
  TE: "bg-yellow-900/50 text-yellow-400",
  K: "bg-slate-700 text-slate-300",
  DL: "bg-purple-900/50 text-purple-400",
  LB: "bg-purple-900/50 text-purple-400",
  DB: "bg-purple-900/50 text-purple-400",
  EDR: "bg-purple-900/50 text-purple-400",
  IL: "bg-purple-900/50 text-purple-400",
  CB: "bg-purple-900/50 text-purple-400",
  S: "bg-purple-900/50 text-purple-400",
};

function PositionBadge({
  position,
  rankInPosition,
}: {
  position: string;
  rankInPosition: number | null;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2
        py-0.5 rounded text-xs font-medium ${
          POSITION_COLORS[position] || "bg-slate-700 text-slate-300"
        }`}
    >
      {position}
      {rankInPosition ?? ""}
    </span>
  );
}
