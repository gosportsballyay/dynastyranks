"use client";

import { useState, useMemo, Fragment } from "react";
import Link from "next/link";

interface RosterPlayer {
  name: string;
  position: string;
  value: number;
  age: number | null;
  slot: string;
}

interface PositionStrength {
  position: string;
  score: number;
  starterScore: number;
  depthModifier: number;
  tradeableDepthCount: number;
  tradeableDepthValue: number;
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
  teamTier?: "contender" | "middling" | "rebuilder";
  teamCompetitivePercentile?: number;
  averageAge: number | null;
  under26ValueShare: number;
  over28ValueShare: number;
  draftPickValue: number;
  teamCompetitiveScore: number;
  gapToLeader: number;
  gapToContenderMedian: number;
  strongestUnit: string | null;
  weakestUnit: string | null;
  benchValue: number;
  taxiValue: number;
  irValue: number;
  positionRanks: Record<string, { value: number; rank: number }>;
}

type SortColumn =
  | "overall"
  | "starters"
  | "offense"
  | "idp"
  | "qb"
  | "rb"
  | "wr"
  | "te"
  | "dl"
  | "lb"
  | "db";

type ViewMode = "overall" | "detailed";

interface TeamRankingsTableProps {
  rankings: TeamRanking[];
  hasIdp?: boolean;
  leagueId: string;
}

export function TeamRankingsTable({ rankings, hasIdp = true, leagueId }: TeamRankingsTableProps) {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: SortColumn;
    direction: "asc" | "desc";
  }>({ column: "overall", direction: "asc" });
  const [viewMode, setViewMode] = useState<ViewMode>("overall");

  const sortedRankings = useMemo(() => {
    const sorted = [...rankings];
    const { column, direction } = sortConfig;

    sorted.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      const posGroups = ["qb", "rb", "wr", "te", "dl", "lb", "db"];
      if (posGroups.includes(column)) {
        const key = column.toUpperCase();
        aVal = a.positionRanks[key]?.rank || 999;
        bVal = b.positionRanks[key]?.rank || 999;
      } else {
        const rankExtractors: Record<string, (t: TeamRanking) => number> = {
          overall: (t) => t.overallRank,
          starters: (t) => t.starterRank,
          offense: (t) => t.offenseRank,
          idp: (t) => t.idpRank,
        };
        const extractor = rankExtractors[column];
        aVal = extractor ? extractor(a) : a.overallRank;
        bVal = extractor ? extractor(b) : b.overallRank;
      }

      const diff = aVal - bVal;
      return direction === "asc" ? diff : -diff;
    });
    return sorted;
  }, [rankings, sortConfig]);

  function handleSort(column: SortColumn) {
    setSortConfig((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  }

  const overallCols: { key: SortColumn; label: string }[] = [
    { key: "overall", label: "Overall" },
    { key: "starters", label: "Starters" },
    { key: "offense", label: "Offense" },
    ...(hasIdp ? [{ key: "idp" as SortColumn, label: "IDP" }] : []),
  ];

  const idpDetailCols: { key: SortColumn; label: string }[] = hasIdp
    ? [
        { key: "dl", label: "DL" },
        { key: "lb", label: "LB" },
        { key: "db", label: "DB" },
      ]
    : [];

  const detailedCols: { key: SortColumn; label: string }[] = [
    { key: "overall", label: "Overall" },
    { key: "starters", label: "Starters" },
    { key: "qb", label: "QB" },
    { key: "rb", label: "RB" },
    { key: "wr", label: "WR" },
    { key: "te", label: "TE" },
    ...idpDetailCols,
  ];

  const cols = viewMode === "overall" ? overallCols : detailedCols;
  const colSpan = cols.length + 3; // Team + cols + Total Value + action

  return (
    <div>
      {/* View mode selector */}
      <div className="px-6 py-3 border-b border-slate-700 flex items-center gap-2">
        <span className="text-sm text-slate-400">League View:</span>
        <select
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as ViewMode)}
          className="bg-slate-700 text-slate-200 text-sm rounded px-2 py-1 border border-slate-600"
        >
          <option value="overall">Overall</option>
          <option value="detailed">Detailed</option>
        </select>
      </div>

      <div className="overflow-x-auto sm:overflow-x-visible">
        <table className="w-full text-xs sm:text-sm">
          <thead className="sm:sticky sm:top-16 sm:z-20">
            <tr>
              <th className="px-2 py-2 sm:px-6 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider bg-slate-900">
                Team
              </th>
              {cols.map((col) => (
                <SortableHeader
                  key={col.key}
                  label={col.label}
                  column={col.key}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                />
              ))}
              <th className="px-2 py-2 sm:px-6 sm:py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider bg-slate-900">
                Total Value
              </th>
              <th className="w-8 sm:w-10 py-2 sm:py-3 bg-slate-900" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {sortedRankings.map((team) => (
              <Fragment key={team.teamId}>
                <tr
                  onClick={() =>
                    setExpandedTeam(
                      expandedTeam === team.teamId ? null : team.teamId,
                    )
                  }
                  className={`cursor-pointer hover:bg-slate-700/50 transition-colors ${
                    team.isCurrentUser ? "bg-blue-900/20" : ""
                  } ${expandedTeam === team.teamId ? "bg-slate-700/30" : ""}`}
                >
                  <td className="px-2 py-2 sm:px-6 sm:py-4">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="text-sm sm:text-lg font-bold text-slate-500 w-5 sm:w-6 shrink-0">
                        {team.overallRank}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-white flex items-center gap-1 sm:gap-2 flex-wrap">
                          <span className="truncate">{team.teamName}</span>
                          {team.isCurrentUser && (
                            <span className="text-[10px] sm:text-xs text-blue-400">
                              (You)
                            </span>
                          )}
                          {team.teamTier && (
                            <TierBadge tier={team.teamTier} />
                          )}
                          <span className="text-slate-500 text-xs sm:text-sm">
                            {expandedTeam === team.teamId ? "▼" : "▶"}
                          </span>
                        </div>
                        <div className="text-xs sm:text-sm text-slate-400 truncate">
                          {team.ownerName}
                        </div>
                      </div>
                    </div>
                  </td>
                  {cols.map((col) => (
                    <td key={col.key} className="px-1 py-2 sm:px-6 sm:py-4 text-center">
                      <RankCell
                        team={team}
                        column={col.key}
                        total={rankings.length}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2 sm:px-6 sm:py-4 text-right whitespace-nowrap">
                    <span className="font-mono text-slate-300">
                      {team.overallValue.toLocaleString()}
                    </span>
                  </td>
                  <td className="pr-2 sm:pr-4 py-2 sm:py-4">
                    <Link
                      href={`/league/${leagueId}/team?teamId=${team.teamId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600 transition-colors"
                      title="View team"
                    >
                      <svg
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        className="w-4 h-4"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </Link>
                  </td>
                </tr>

                {expandedTeam === team.teamId && (
                  <tr className="bg-slate-900/30">
                    <td colSpan={colSpan} className="px-6 py-4">
                      <TeamDetailsV2
                        team={team}
                        totalTeams={rankings.length}
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

function RankCell({
  team,
  column,
  total,
}: {
  team: TeamRanking;
  column: SortColumn;
  total: number;
}) {
  const posGroups = ["qb", "rb", "wr", "te", "dl", "lb", "db"];
  if (posGroups.includes(column)) {
    const key = column.toUpperCase();
    const pr = team.positionRanks[key];
    if (!pr || pr.rank === 0) {
      return <span className="text-slate-500">—</span>;
    }
    return <RankBadge rank={pr.rank} total={total} />;
  }
  const rankMap: Record<string, number> = {
    overall: team.overallRank,
    starters: team.starterRank,
    offense: team.offenseRank,
    idp: team.idpRank,
  };
  const rank = rankMap[column];
  if (rank === undefined) return null;
  return <RankBadge rank={rank} total={total} />;
}

function SortableHeader({
  label,
  column,
  sortConfig,
  onSort,
  align = "center",
}: {
  label: string;
  column: SortColumn;
  sortConfig: { column: SortColumn; direction: "asc" | "desc" };
  onSort: (col: SortColumn) => void;
  align?: "center" | "right";
}) {
  const isActive = sortConfig.column === column;
  const arrow = isActive
    ? sortConfig.direction === "asc" ? " ▲" : " ▼"
    : "";
  const alignClass = align === "right" ? "text-right" : "text-center";

  return (
    <th
      onClick={() => onSort(column)}
      className={`px-1 py-2 sm:px-6 sm:py-3 ${alignClass} text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none bg-slate-900`}
    >
      {label}
      {arrow && (
        <span className="text-slate-300">{arrow}</span>
      )}
    </th>
  );
}

function TeamDetailsV2({
  team,
  totalTeams,
}: {
  team: TeamRanking;
  totalTeams: number;
}) {
  const hasSettings = team.teamTier !== undefined;

  const starterDelta = team.starterValue - team.benchValue;
  const starterPct = team.overallValue > 0
    ? ((team.starterValue / team.overallValue) * 100).toFixed(0) : "0";
  const benchPct = team.overallValue > 0
    ? ((team.benchValue / team.overallValue) * 100).toFixed(0) : "0";

  // Top 8 players by value
  const topPlayers = [...team.roster]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Need/surplus/upgrade badges
  const needPositions = (team.needs ?? []).map((n) => n.position);
  const upgradePositions = (team.upgradeTargets ?? []).map(
    (u) => u.position,
  );
  const surplusPositions = (team.surplus ?? []).map((s) => s.position);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {/* Column 1 — Team Profile */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 pb-2 mb-3 border-b border-slate-700">
          Team Profile
        </h4>
        <div className="space-y-2 text-sm">
          <StatRow label="Tier">
            {team.teamTier
              ? <TierBadge tier={team.teamTier} />
              : <span className="text-slate-500">—</span>}
          </StatRow>
          <StatRow label="Competitive Percentile">
            {team.teamCompetitivePercentile != null
              ? `${Math.round(team.teamCompetitivePercentile)}th`
              : "—"}
          </StatRow>
          <StatRow label="Avg Age">
            {team.averageAge !== null
              ? team.averageAge.toFixed(1) : "—"}
          </StatRow>
          <StatRow label="Age Under 26 Share">
            {`${team.under26ValueShare.toFixed(0)}%`}
          </StatRow>
          <StatRow label="Over 28 Share">
            {`${team.over28ValueShare.toFixed(0)}%`}
          </StatRow>
          <StatRow label="Draft Capital">
            {team.draftPickValue > 0
              ? team.draftPickValue.toLocaleString() : "—"}
          </StatRow>
        </div>
      </div>

      {/* Column 2 — Competitive Snapshot */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 pb-2 mb-3 border-b border-slate-700">
          Competitive Snapshot
        </h4>
        <div className="space-y-2 text-sm">
          <StatRow label="Starter Delta">
            <DeltaValue value={starterDelta} />
          </StatRow>
          {hasSettings ? (
            <>
              <StatRow label="Gap to Leader">
                {team.gapToLeader === 0
                  ? <span className="text-green-400 font-mono">—</span>
                  : <DeltaValue value={-team.gapToLeader} />}
              </StatRow>
              <StatRow label="Gap to Contender">
                <DeltaValue value={-team.gapToContenderMedian} />
              </StatRow>
              <StatRow label="Strongest Unit">
                {team.strongestUnit
                  ? <span className="text-green-400">
                      {team.strongestUnit}
                    </span>
                  : "—"}
              </StatRow>
              <StatRow label="Weakest Unit">
                {team.weakestUnit
                  ? <span className="text-red-400">
                      {team.weakestUnit}
                    </span>
                  : "—"}
              </StatRow>
            </>
          ) : (
            <div className="text-slate-500 text-xs">
              Connect league settings for full analysis
            </div>
          )}
        </div>
      </div>

      {/* Column 3 — Team Action */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 pb-2 mb-3 border-b border-slate-700">
          Team Action
        </h4>
        <div className="space-y-2 text-sm">
          {/* Badges */}
          {(() => {
            const needsBadges = needPositions.length > 0 ? (
              <div key="needs" className="flex flex-wrap items-center gap-1">
                <span className="text-slate-400">Needs:</span>
                {needPositions.map((pos) => (
                  <span
                    key={pos}
                    className="px-2 py-0.5 rounded text-xs bg-red-900/50 text-red-400"
                  >
                    {pos}
                  </span>
                ))}
              </div>
            ) : null;

            const upgradeBadges = upgradePositions.length > 0 ? (
              <div key="upgrade" className="flex flex-wrap items-center gap-1">
                <span className="text-slate-400">Upgrade:</span>
                {upgradePositions.map((pos) => (
                  <span
                    key={pos}
                    className="px-1.5 py-0.5 rounded text-[11px] bg-blue-900/30 text-blue-300"
                  >
                    {pos}
                  </span>
                ))}
              </div>
            ) : null;

            const surplusBadges = surplusPositions.length > 0 ? (
              <div key="surplus" className="flex flex-wrap items-center gap-1">
                <span className="text-slate-400">Surplus:</span>
                {surplusPositions.map((pos) => (
                  <span
                    key={pos}
                    className="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400"
                  >
                    {pos}
                  </span>
                ))}
              </div>
            ) : null;

            const sections = team.teamTier === "rebuilder"
              ? [needsBadges, surplusBadges, upgradeBadges]
              : [needsBadges, upgradeBadges, surplusBadges];
            return sections;
          })()}

          <div className="border-t border-slate-700 pt-2 mt-2 space-y-1">
            <StatRow label="Starter Value">
              <span className="font-mono">
                {team.starterValue.toLocaleString()}
                <span className="text-slate-500 ml-1">
                  ({starterPct}%)
                </span>
              </span>
            </StatRow>
            <StatRow label="Bench Value">
              <span className="font-mono">
                {team.benchValue.toLocaleString()}
                <span className="text-slate-500 ml-1">
                  ({benchPct}%)
                </span>
              </span>
            </StatRow>
            {team.taxiValue > 0 && (
              <div className="pl-4">
                <StatRow label="└ Taxi">
                  <span className="font-mono text-xs">
                    {team.taxiValue.toLocaleString()}
                  </span>
                </StatRow>
              </div>
            )}
            {team.irValue > 0 && (
              <div className="pl-4">
                <StatRow label="└ IR">
                  <span className="font-mono text-xs">
                    {team.irValue.toLocaleString()}
                  </span>
                </StatRow>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Column 4 — Top 8 Players */}
      <div>
        <h4 className="text-sm font-medium text-slate-400 pb-2 mb-3 border-b border-slate-700">
          Top 8 Players
        </h4>
        <div className="space-y-0.5 text-xs">
          {topPlayers.map((player, i) => (
            <div
              key={i}
              className="flex justify-between items-center"
            >
              <span className="text-slate-300 truncate flex-1 mr-2">
                <span className="text-slate-500">{player.position}</span>{" "}
                {player.name}
              </span>
              <span className="text-white font-mono">
                {player.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-mono">{children}</span>
    </div>
  );
}

function DeltaValue({ value }: { value: number }) {
  const color = value > 0
    ? "text-green-400"
    : value < 0
      ? "text-red-400"
      : "text-slate-400";
  const prefix = value > 0 ? "+" : "";
  return (
    <span className={`font-mono ${color}`}>
      {prefix}{Math.round(value).toLocaleString()}
    </span>
  );
}

const TIER_STYLES: Record<string, string> = {
  contender: "bg-green-900/40 text-green-400",
  middling: "bg-slate-700/60 text-slate-400",
  rebuilder: "bg-amber-900/40 text-amber-400",
};

const TIER_LABELS: Record<string, string> = {
  contender: "Contender",
  middling: "Middling",
  rebuilder: "Rebuilder",
};

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${TIER_STYLES[tier] ?? TIER_STYLES.middling}`}
    >
      {TIER_LABELS[tier] ?? tier}
    </span>
  );
}

function RankBadge({
  rank,
  total,
}: {
  rank: number;
  total: number;
}) {
  const percentile = ((total - rank + 1) / total) * 100;

  let colorClass = "bg-slate-700 text-slate-300";
  if (percentile >= 80) colorClass = "bg-green-900/50 text-green-400";
  else if (percentile >= 60) colorClass = "bg-blue-900/50 text-blue-400";
  else if (percentile >= 40) colorClass = "bg-slate-700 text-slate-300";
  else if (percentile >= 20)
    colorClass = "bg-yellow-900/50 text-yellow-400";
  else colorClass = "bg-red-900/50 text-red-400";

  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs sm:text-sm font-medium ${colorClass}`}
    >
      {rank}
    </span>
  );
}
