"use client";

import { useState, useMemo, Fragment } from "react";
import { PlayerDetailDropdown } from "@/components/player-detail-dropdown";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface PlayerValue {
  id: string;
  value: number;
  rank: number;
  rankInPosition: number;
  tier: number;
  projectedPoints: number;
  replacementPoints: number;
  vorp: number;
  normalizedVorp: number;
  scarcityMultiplier: number;
  ageCurveMultiplier: number;
  dynastyPremium: number | null;
  positionGroup: string;
  projectionSource: string;
  uncertainty: string;
  lastSeasonPoints?: number | null;
  lastSeasonRankOverall?: number | null;
  lastSeasonRankPosition?: number | null;
  dataSource?: string | null;
  consensusValue?: number | null;
  lowConfidence?: boolean | null;
  valueSource?: string | null;
  player: {
    id: string;
    name: string;
    position: string;
    positionGroup: string;
    nflTeam: string | null;
    age: number | null;
    injuryStatus: string | null;
    draftRound: number | null;
    draftPick: number | null;
    rookieYear: number | null;
    yearsExperience: number | null;
  };
  owner?: string | null;
  ownerName?: string | null;
  isOwnedByCurrentUser: boolean;
  isFreeAgent: boolean;
  offenseRank?: number | null;
  idpRank?: number | null;
  seasonLines: Array<{
    season: number;
    points: number;
    gamesPlayed: number;
  }>;
  consensusAggValue: number | null;
  flexEligibility?: string[];
  flexRanks?: Record<string, number>;
}

type SortColumn = "rank" | "name" | "position" | "team" | "age" | "value" | "vorp" | "tier" | "owner" | "lastSeason";
type SortDirection = "asc" | "desc";

/** Maps server-side sort modes to table columns. */
const SORT_MODE_MAP: Record<string, { column: SortColumn; direction: SortDirection }> = {
  value: { column: "value", direction: "desc" },
  projected: { column: "rank", direction: "asc" }, // server pre-sorts by projected
  last_season: { column: "lastSeason", direction: "desc" },
};

interface RankingsTableProps {
  values: PlayerValue[];
  positionFilter?: string;
  groupFilter?: string;
  sortMode?: string;
  userTeamId?: string | null;
  flexFilter?: string | null;
}

export function RankingsTable({
  values,
  positionFilter,
  groupFilter,
  sortMode,
  userTeamId,
  flexFilter,
}: RankingsTableProps) {
  const initial = SORT_MODE_MAP[sortMode ?? ""] ?? { column: "rank" as SortColumn, direction: "asc" as SortDirection };
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>(initial.column);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initial.direction);
  const [activeHighlights, setActiveHighlights] = useState<Set<string>>(new Set());

  function toggleHighlight(mode: string) {
    setActiveHighlights((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }

  /** Returns a color class for the rank number based on active highlights. */
  function getRankHighlightColor(v: PlayerValue): string | null {
    if (activeHighlights.has("mine") && v.isOwnedByCurrentUser) {
      return "text-blue-400";
    }
    if (activeHighlights.has("other") && !v.isFreeAgent && !v.isOwnedByCurrentUser) {
      return "text-amber-400";
    }
    if (activeHighlights.has("fa") && v.isFreeAgent) {
      return "text-emerald-400";
    }
    return null;
  }

  // Handle column header click
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // New column, default to descending for value/vorp/lastSeason, ascending for others
      setSortColumn(column);
      setSortDirection(column === "value" || column === "vorp" || column === "lastSeason" ? "desc" : "asc");
    }
  };

  // Sort values
  const sortedValues = useMemo(() => {
    const sorted = [...values].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case "rank":
          // Sort by flex rank when flex filter active,
          // position rank when position is filtered,
          // overall rank otherwise
          if (flexFilter) {
            const aFlex = a.flexRanks?.[flexFilter] ?? 9999;
            const bFlex = b.flexRanks?.[flexFilter] ?? 9999;
            comparison = aFlex - bFlex;
          } else if (positionFilter) {
            comparison = a.rankInPosition - b.rankInPosition;
          } else {
            comparison = a.rank - b.rank;
          }
          break;
        case "name":
          comparison = a.player.name.localeCompare(b.player.name);
          break;
        case "position":
          comparison = a.player.position.localeCompare(b.player.position);
          break;
        case "team":
          comparison = (a.player.nflTeam || "ZZZ").localeCompare(b.player.nflTeam || "ZZZ");
          break;
        case "age":
          comparison = (a.player.age || 99) - (b.player.age || 99);
          break;
        case "value":
          comparison = a.value - b.value;
          break;
        case "vorp":
          comparison = a.vorp - b.vorp;
          break;
        case "tier":
          comparison = a.tier - b.tier;
          break;
        case "owner":
          const ownerA = a.owner || "ZZZZ"; // FA sorts last
          const ownerB = b.owner || "ZZZZ";
          comparison = ownerA.localeCompare(ownerB);
          break;
        case "lastSeason":
          comparison = (a.lastSeasonPoints || 0) - (b.lastSeasonPoints || 0);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [values, sortColumn, sortDirection]);

  if (values.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        No players found. Try adjusting your filters.
      </div>
    );
  }

  // Sort indicator component
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return (
      <span className="ml-1">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // Sortable header component
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
      role="columnheader"
      tabIndex={0}
      onClick={() => handleSort(column)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSort(column); } }}
      aria-sort={sortColumn === column ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
      className={`py-3 px-2 sm:px-4 font-medium text-slate-400 cursor-pointer hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset transition-colors select-none bg-slate-900 ${className}`}
    >
      {children}
      <SortIndicator column={column} />
    </th>
  );

  const highlightOptions: Array<{ mode: string; label: string; activeClass: string }> = [
    ...(userTeamId ? [{ mode: "mine", label: "Mine", activeClass: "bg-blue-600 text-white" }] : []),
    { mode: "other", label: "Owned", activeClass: "bg-amber-600 text-white" },
    { mode: "fa", label: "FA", activeClass: "bg-emerald-600 text-white" },
  ];

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50">
        <span className="text-xs text-slate-400 uppercase tracking-wider shrink-0">
          Highlight:
        </span>
        {highlightOptions.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => toggleHighlight(opt.mode)}
            className={`px-3 py-1 rounded-full text-xs sm:text-sm transition-colors ${
              activeHighlights.has(opt.mode)
                ? opt.activeClass
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm table-fixed">
          <caption className="sr-only">
            Player dynasty rankings sorted by {sortColumn} {sortDirection === "asc" ? "ascending" : "descending"}
          </caption>
          <thead className="sm:sticky sm:top-16 sm:z-20">
            <tr className="border-b border-slate-700 text-left">
              <SortableHeader column="rank" className="w-[7%]">Rank</SortableHeader>
              <SortableHeader column="name" className="w-[18%]">Player</SortableHeader>
              <SortableHeader column="position" className="w-[8%]">Pos</SortableHeader>
              <SortableHeader column="team" className="w-[7%]">Team</SortableHeader>
              <SortableHeader column="age" className="w-[6%]">Age</SortableHeader>
              <SortableHeader column="lastSeason" className="text-right w-[9%]">
                Last Szn
              </SortableHeader>
              <SortableHeader column="value" className="text-right w-[11%]">
                <span className="inline-flex items-center gap-1">
                  Value
                  <HelpTooltip
                    text="Composite dynasty value blending market consensus with your league's signal. Higher = more valuable."
                    learnMoreHref="/how-it-works#value-pipeline"
                  />
                </span>
              </SortableHeader>
              <SortableHeader column="vorp" className="text-right w-[10%]">
                <span className="inline-flex items-center gap-1">
                  VORP
                  <HelpTooltip
                    text="Value Over Replacement Player — how much better than the best freely available player at this position."
                    learnMoreHref="/how-it-works#vorp"
                  />
                </span>
              </SortableHeader>
              <SortableHeader column="tier" className="w-[7%]">
                <span className="inline-flex items-center gap-1">
                  Tier
                  <HelpTooltip text="Players grouped into value tiers. Tier 1 = elite. Helps identify fair trade partners." />
                </span>
              </SortableHeader>
              <SortableHeader column="owner" className="w-[17%]">Owner</SortableHeader>
            </tr>
          </thead>
          <tbody>
            {sortedValues.map((v, index) => (
              <Fragment key={v.id}>
                <tr
                  tabIndex={0}
                  onClick={() =>
                    setExpandedRow(expandedRow === v.id ? null : v.id)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedRow(expandedRow === v.id ? null : v.id);
                    }
                  }}
                  aria-expanded={expandedRow === v.id}
                  className={`border-b border-slate-700/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${
                    index % 2 === 0 ? "bg-slate-800/30" : ""
                  } hover:bg-slate-700/50`}
                >
                  <td className={`py-3 px-2 sm:px-4 ${getRankHighlightColor(v) || "text-slate-300"}`}>
                    {flexFilter && v.flexRanks?.[flexFilter] ? (
                      <>
                        <span className="font-medium">
                          #{v.flexRanks[flexFilter]}
                        </span>
                        <span className="text-xs opacity-60 ml-1.5">
                          (#{v.rank})
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">#{v.rank}</span>
                        {groupFilter === "offense" && v.offenseRank != null && (
                          <span className="text-xs opacity-60 ml-2">OFF{v.offenseRank}</span>
                        )}
                        {groupFilter === "defense" && v.idpRank != null && (
                          <span className="text-xs opacity-60 ml-2">IDP{v.idpRank}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-3 px-2 sm:px-4">
                    <div className="font-medium text-white truncate">{v.player.name}</div>
                  </td>
                  <td className="py-3 px-2 sm:px-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getPositionColor(v.player.position)}`}
                    >
                      {v.player.position}{v.rankInPosition}
                    </span>
                  </td>
                  <td className="py-3 px-2 sm:px-4 text-slate-400 whitespace-nowrap">
                    {v.player.nflTeam || "-"}
                  </td>
                  <td className="py-3 px-2 sm:px-4 text-slate-400 whitespace-nowrap">
                    {v.player.age || "-"}
                  </td>
                  <td className="py-3 px-2 sm:px-4 text-right font-mono text-amber-400">
                    {v.lastSeasonPoints ? v.lastSeasonPoints.toFixed(1) : "-"}
                  </td>
                  <td className="py-3 px-2 sm:px-4 text-right font-mono text-green-400">
                    {v.value.toFixed(1)}
                  </td>
                  <td className="py-3 px-2 sm:px-4 text-right font-mono text-slate-300 whitespace-nowrap">
                    +{v.vorp.toFixed(1)}
                  </td>
                  <td className="py-3 px-2 sm:px-4">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${getTierColor(v.tier)}`}
                    >
                      {v.tier}
                    </span>
                  </td>
                  <td className="py-3 px-2 sm:px-4">
                    {v.owner ? (
                      <span
                        className="text-slate-300 block truncate"
                        title={v.ownerName || v.owner}
                      >
                        {v.owner}
                      </span>
                    ) : (
                      <span className="text-emerald-500 font-medium">FA</span>
                    )}
                  </td>
                </tr>
                {expandedRow === v.id && (
                  <tr className="bg-slate-900/50">
                    <td colSpan={10} className="py-4 px-2 sm:px-4 overflow-hidden">
                      <PlayerDetailDropdown
                        injuryStatus={v.player.injuryStatus}
                        draftRound={v.player.draftRound}
                        draftPick={v.player.draftPick}
                        rookieYear={v.player.rookieYear}
                        yearsExperience={v.player.yearsExperience}
                        position={v.player.position}
                        age={v.player.age}
                        seasonLines={v.seasonLines}
                        projectedPoints={v.projectedPoints}
                        rank={v.rank}
                        rankInPosition={v.rankInPosition}
                        positionLabel={`${v.player.position}${v.rankInPosition}`}
                        vorp={v.vorp}
                        consensusValue={v.consensusAggValue}
                        leagueValue={v.value}
                        tier={v.tier}
                        lastSeasonPoints={v.lastSeasonPoints ?? null}
                        flexEligibility={v.flexEligibility}
                        flexRanks={v.flexRanks}
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

function getPositionColor(position: string): string {
  const colors: Record<string, string> = {
    QB: "bg-red-500/20 text-red-400",
    RB: "bg-green-500/20 text-green-400",
    WR: "bg-blue-500/20 text-blue-400",
    TE: "bg-orange-500/20 text-orange-400",
    K: "bg-purple-500/20 text-purple-400",
    // IDP
    DL: "bg-yellow-500/20 text-yellow-400",
    LB: "bg-cyan-500/20 text-cyan-400",
    DB: "bg-pink-500/20 text-pink-400",
    EDR: "bg-yellow-500/20 text-yellow-400",
    IL: "bg-yellow-500/20 text-yellow-400",
    CB: "bg-pink-500/20 text-pink-400",
    S: "bg-pink-500/20 text-pink-400",
  };
  return colors[position] || "bg-slate-500/20 text-slate-400";
}

function getTierColor(tier: number): string {
  if (tier <= 1) return "bg-yellow-500/20 text-yellow-400";
  if (tier <= 3) return "bg-green-500/20 text-green-400";
  if (tier <= 6) return "bg-blue-500/20 text-blue-400";
  if (tier <= 10) return "bg-slate-500/20 text-slate-400";
  return "bg-slate-700/50 text-slate-500";
}
