"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { PlayerDetailDropdown } from "@/components/player-detail-dropdown";
import { HelpTooltip } from "@/components/ui/help-tooltip";

export interface RosterPlayer {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  age: number | null;
  value: number;
  rankInPosition: number | null;
  slot: string;
  injuryStatus: string | null;
  draftRound: number | null;
  draftPick: number | null;
  rookieYear: number | null;
  yearsExperience: number | null;
  seasonLines: Array<{
    season: number;
    points: number;
    gamesPlayed: number;
  }>;
  projectedPoints: number;
  rank: number;
  vorp: number;
  consensusValue: number | null;
  tier: number;
  lastSeasonPoints: number | null;
  flexEligibility?: string[];
  flexRanks?: Record<string, number>;
}

export interface TeamDraftPick {
  pickId: string;
  season: number;
  round: number;
  pickNumber: number | null;
  projectedPickNumber: number | null;
  value: number;
  originalTeamName: string | null;
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
  draftPicks: TeamDraftPick[];
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
  draftPicks,
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

  const totalPickValue = useMemo(
    () => draftPicks.reduce((sum, p) => sum + p.value, 0),
    [draftPicks]
  );

  const totalValue = useMemo(
    () =>
      roster.reduce((sum, p) => sum + p.value, 0) + totalPickValue,
    [roster, totalPickValue]
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 sm:mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
            <h1 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
              Team Roster
              <HelpTooltip text="Roster organized by slot. Values reflect your league's scoring rules and positional scarcity." />
            </h1>
            <select
              value={currentTeamId}
              onChange={(e) => handleTeamChange(e.target.value)}
              className="bg-slate-700 text-white text-sm rounded-lg
                px-3 py-1.5 border border-slate-600
                hover:border-slate-500 focus:border-blue-500
                focus:outline-none transition-colors cursor-pointer
                max-w-[200px] sm:max-w-none"
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
          <p className="text-slate-400 mt-1 text-sm sm:text-base">
            {teamName} &bull; {ownerName}
          </p>
        </div>
        <div className="text-left sm:text-right shrink-0">
          <div className="text-xl sm:text-2xl font-bold text-white">
            {totalValue.toLocaleString()}
          </div>
          <div className="text-sm text-slate-400">Total Value</div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {sections.map((s) => (
          <SummaryCard
            key={s.key}
            label={s.title}
            value={s.players.reduce((sum, p) => sum + p.value, 0)}
            count={s.players.length}
            countLabel="players"
          />
        ))}
        {draftPicks.length > 0 && (
          <SummaryCard
            label="Draft Picks"
            value={totalPickValue}
            count={draftPicks.length}
            countLabel="picks"
          />
        )}
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
        {draftPicks.length > 0 && (
          <DraftPicksSection picks={draftPicks} />
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
  countLabel = "players",
}: {
  label: string;
  value: number;
  count: number;
  countLabel?: string;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="text-xl font-bold text-white mt-1">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {count} {countLabel}
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
    DEFAULT_SORT,
  );
  const [expandedRow, setExpandedRow] = useState<string | null>(
    null,
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
      scope="col"
      tabIndex={0}
      onClick={() => handleSort(column)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSort(column); } }}
      aria-sort={sortState.column === column ? (sortState.direction === "asc" ? "ascending" : "descending") : undefined}
      className={`px-2 py-2 sm:px-6 text-[10px] sm:text-xs font-medium text-slate-400
        uppercase tracking-wider cursor-pointer hover:text-white
        focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset
        transition-colors select-none bg-slate-900 ${className}`}
    >
      {children}
      <SortIndicator column={column} />
    </th>
  );

  return (
    <div className="bg-slate-800/50 rounded-lg overflow-clip">
      <div className="px-3 py-2 sm:px-6 sm:py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-semibold text-white text-sm sm:text-base">{title}</h2>
        <span className="text-xs sm:text-sm text-slate-400">
          {players.length} players
        </span>
      </div>

      <div className="overflow-x-auto sm:overflow-x-visible">
        <table className="w-full text-xs sm:text-sm">
          <caption className="sr-only">{title} roster</caption>
          <thead className="sm:sticky sm:top-16 sm:z-20">
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
              <Fragment key={player.playerId}>
                <tr
                  onClick={() =>
                    setExpandedRow(
                      expandedRow === player.playerId
                        ? null
                        : player.playerId,
                    )
                  }
                  className="hover:bg-slate-700/30 transition-colors cursor-pointer"
                >
                  <td className="px-2 py-2 sm:px-6 sm:py-3">
                    <span className="font-medium text-white text-xs sm:text-sm">
                      {player.playerName}
                    </span>
                  </td>
                  <td className="px-2 py-2 sm:px-6 sm:py-3">
                    <PositionBadge
                      position={player.position}
                      rankInPosition={player.rankInPosition}
                    />
                  </td>
                  <td className="px-2 py-2 sm:px-6 sm:py-3 text-slate-400 whitespace-nowrap">
                    {player.nflTeam || "-"}
                  </td>
                  <td className="px-2 py-2 sm:px-6 sm:py-3 text-center text-slate-400 whitespace-nowrap">
                    {player.age || "-"}
                  </td>
                  <td className="px-2 py-2 sm:px-6 sm:py-3 text-right">
                    <span className="font-mono text-slate-300 text-xs sm:text-sm">
                      {player.value.toLocaleString()}
                    </span>
                  </td>
                </tr>
                {expandedRow === player.playerId && (
                  <tr className="bg-slate-900/50">
                    <td colSpan={5} className="py-4 px-2 sm:px-6">
                      <PlayerDetailDropdown
                        injuryStatus={player.injuryStatus}
                        draftRound={player.draftRound}
                        draftPick={player.draftPick}
                        rookieYear={player.rookieYear}
                        yearsExperience={player.yearsExperience}
                        position={player.position}
                        age={player.age}
                        seasonLines={player.seasonLines}
                        projectedPoints={player.projectedPoints}
                        rank={player.rank}
                        rankInPosition={player.rankInPosition ?? 0}
                        positionLabel={`${player.position}${player.rankInPosition ?? ""}`}
                        vorp={player.vorp}
                        consensusValue={player.consensusValue}
                        leagueValue={player.value}
                        tier={player.tier}
                        lastSeasonPoints={player.lastSeasonPoints}
                        flexEligibility={player.flexEligibility}
                        flexRanks={player.flexRanks}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatPickLabel(pick: TeamDraftPick): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (pick.pickNumber != null) {
    return `${pick.season} Rd ${pick.round}.${pad(pick.pickNumber)}`;
  }
  if (pick.projectedPickNumber != null) {
    return `${pick.season} Rd ${pick.round}.${pad(pick.projectedPickNumber)}~`;
  }
  return `${pick.season} Round ${pick.round}`;
}

function DraftPicksSection({ picks }: { picks: TeamDraftPick[] }) {
  const sorted = useMemo(() => {
    return [...picks].sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.round !== b.round) return a.round - b.round;
      const aNum = a.pickNumber ?? a.projectedPickNumber ?? 99;
      const bNum = b.pickNumber ?? b.projectedPickNumber ?? 99;
      return aNum - bNum;
    });
  }, [picks]);

  // Group by season for visual separation
  const seasons = useMemo(() => {
    const map = new Map<number, TeamDraftPick[]>();
    for (const pick of sorted) {
      const list = map.get(pick.season);
      if (list) list.push(pick);
      else map.set(pick.season, [pick]);
    }
    return Array.from(map.entries());
  }, [sorted]);

  return (
    <div className="bg-slate-800/50 rounded-lg overflow-clip">
      <div className="px-3 py-2 sm:px-6 sm:py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 className="font-semibold text-white text-sm sm:text-base">
          Draft Picks
        </h2>
        <span className="text-xs sm:text-sm text-slate-400">
          {picks.length} {picks.length === 1 ? "pick" : "picks"}
        </span>
      </div>

      <div className="overflow-x-auto sm:overflow-x-visible">
        <table className="w-full text-xs sm:text-sm">
          <caption className="sr-only">Draft picks</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="px-2 py-2 sm:px-6 text-[10px] sm:text-xs
                  font-medium text-slate-400 uppercase tracking-wider
                  text-left bg-slate-900"
              >
                Pick
              </th>
              <th
                scope="col"
                className="px-2 py-2 sm:px-6 text-[10px] sm:text-xs
                  font-medium text-slate-400 uppercase tracking-wider
                  text-left bg-slate-900"
              >
                Origin
              </th>
              <th
                scope="col"
                className="px-2 py-2 sm:px-6 text-[10px] sm:text-xs
                  font-medium text-slate-400 uppercase tracking-wider
                  text-right bg-slate-900"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {seasons.map(([season, seasonPicks]) => (
              <Fragment key={season}>
                {seasonPicks.map((pick) => (
                  <tr
                    key={pick.pickId}
                    className="hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="px-2 py-2 sm:px-6 sm:py-3">
                      <span className="font-medium text-white text-xs sm:text-sm">
                        {formatPickLabel(pick)}
                      </span>
                    </td>
                    <td className="px-2 py-2 sm:px-6 sm:py-3 text-slate-400">
                      {pick.originalTeamName
                        ? `via ${pick.originalTeamName}`
                        : "Own pick"}
                    </td>
                    <td className="px-2 py-2 sm:px-6 sm:py-3 text-right">
                      <span className="font-mono text-slate-300 text-xs sm:text-sm">
                        {pick.value.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </Fragment>
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
