"use client";

import { useState } from "react";
import type { DiagnosticsData } from "./page";

const POS_COLORS: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
  LB: "text-purple-400",
  EDR: "text-orange-400",
  DL: "text-orange-400",
  DB: "text-cyan-400",
  CB: "text-cyan-400",
  S: "text-teal-400",
};

function posColor(pos: string): string {
  return POS_COLORS[pos] ?? "text-slate-300";
}

function fmtVal(v: number | null): string {
  if (v === null) return "-";
  return v.toLocaleString();
}

export function DiagnosticsView({
  data,
}: {
  data: DiagnosticsData;
}) {
  const [expandedLeague, setExpandedLeague] = useState<
    string | null
  >(null);
  const [expandedAnchor, setExpandedAnchor] = useState<
    string | null
  >(null);

  return (
    <div className="space-y-8">
      {/* Summary Table */}
      <div className="bg-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h2 className="text-lg font-semibold">
            League Comparison
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="px-4 py-3">League</th>
                <th className="px-3 py-3">Format</th>
                <th className="px-3 py-3">SF</th>
                <th className="px-3 py-3">IDP</th>
                <th className="px-3 py-3 text-right">
                  Max
                </th>
                <th className="px-3 py-3 text-right">
                  R10
                </th>
                <th className="px-3 py-3 text-right">
                  R25
                </th>
                <th className="px-3 py-3 text-right">
                  R50
                </th>
                <th className="px-3 py-3 text-right">
                  QB/25
                </th>
                <th className="px-3 py-3 text-right">
                  IDP/50
                </th>
                <th className="px-3 py-3 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.leagues.map((league) => {
                const isExpanded =
                  expandedLeague === league.leagueId;
                return (
                  <LeagueRow
                    key={league.leagueId}
                    league={league}
                    isExpanded={isExpanded}
                    onToggle={() =>
                      setExpandedLeague(
                        isExpanded
                          ? null
                          : league.leagueId,
                      )
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Anchor Comparison */}
      <div className="bg-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h2 className="text-lg font-semibold">
            Anchor Player Comparison
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Same player across all league formats
          </p>
        </div>
        <div className="divide-y divide-slate-700">
          {Object.entries(data.anchorComparison).map(
            ([name, entries]) => {
              const isExpanded = expandedAnchor === name;
              const sorted = [...entries].sort(
                (a, b) =>
                  (a.rank ?? 999) - (b.rank ?? 999),
              );
              const best = sorted[0];
              const worst = sorted[sorted.length - 1];
              const rankSpread =
                (worst?.rank ?? 0) - (best?.rank ?? 0);

              return (
                <div key={name}>
                  <button
                    onClick={() =>
                      setExpandedAnchor(
                        isExpanded ? null : name,
                      )
                    }
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {name}
                      </span>
                      <span
                        className={`text-xs ${posColor(best?.position ?? "")}`}
                      >
                        {best?.position}
                      </span>
                      {best?.idpOnly && (
                        <span className="text-xs bg-orange-900/50 text-orange-400 px-1.5 py-0.5 rounded">
                          IDP only
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-400">
                      <span>
                        Rank{" "}
                        {fmtVal(best?.rank ?? null)}
                        &ndash;
                        {fmtVal(worst?.rank ?? null)}
                      </span>
                      <span
                        className={
                          rankSpread > 200
                            ? "text-red-400"
                            : rankSpread > 100
                              ? "text-yellow-400"
                              : "text-green-400"
                        }
                      >
                        {rankSpread} spread
                      </span>
                      <span className="text-slate-500">
                        {isExpanded ? "v" : ">"}
                      </span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-1">
                              League
                            </th>
                            <th className="py-1">
                              Format
                            </th>
                            <th className="py-1 text-right">
                              Rank
                            </th>
                            <th className="py-1 text-right">
                              Pos Rank
                            </th>
                            <th className="py-1 text-right">
                              Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((e) => {
                            const lg =
                              data.leagues.find(
                                (l) =>
                                  l.leagueId ===
                                  e.leagueId,
                              );
                            return (
                              <tr
                                key={e.leagueId}
                                className="text-slate-300 border-t border-slate-700/50"
                              >
                                <td className="py-1.5">
                                  {e.leagueName}
                                </td>
                                <td className="py-1.5 text-slate-400">
                                  {lg?.format.teams}t{" "}
                                  {lg?.format.superFlex
                                    ? "SF"
                                    : "1QB"}{" "}
                                  {(lg?.format
                                    .idpSlots ?? 0) >
                                  0
                                    ? `IDP${lg?.format.idpSlots}`
                                    : ""}
                                </td>
                                <td className="py-1.5 text-right font-mono">
                                  {fmtVal(e.rank)}
                                </td>
                                <td className="py-1.5 text-right font-mono">
                                  {e.rankInPosition
                                    ? `${e.position}${e.rankInPosition}`
                                    : "-"}
                                </td>
                                <td className="py-1.5 text-right font-mono">
                                  {fmtVal(e.value)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}

function LeagueRow({
  league,
  isExpanded,
  onToggle,
}: {
  league: DiagnosticsData["leagues"][number];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const m = league.metrics;
  const f = league.format;

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-slate-700/50 hover:bg-slate-700/30 cursor-pointer"
      >
        <td className="px-4 py-3 font-medium">
          {league.leagueName}
        </td>
        <td className="px-3 py-3 text-slate-400">
          {f.teams}t
        </td>
        <td className="px-3 py-3">
          <span
            className={
              f.superFlex
                ? "text-green-400"
                : "text-slate-500"
            }
          >
            {f.superFlex ? "Y" : "N"}
          </span>
        </td>
        <td className="px-3 py-3">
          {f.idpSlots > 0 ? (
            <span className="text-orange-400">
              {f.idpSlots}
            </span>
          ) : (
            <span className="text-slate-500">-</span>
          )}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {fmtVal(m.maxValue)}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {fmtVal(m.valueAtRank10)}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {fmtVal(m.valueAtRank25)}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {fmtVal(m.valueAtRank50)}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {m.countOfQBInTop25}
        </td>
        <td className="px-3 py-3 text-right font-mono">
          {m.countOfIDPInTop50}
        </td>
        <td className="px-3 py-3 text-right font-mono text-slate-400">
          {fmtVal(m.totalPlayersValued)}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={11} className="px-4 pb-4 pt-0">
            <div className="bg-slate-900/50 rounded-lg p-4 mt-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top 10 Overall */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-2">
                    Top 10 Overall
                  </h3>
                  <div className="space-y-1">
                    {league.top10Overall.map((p) => (
                      <div
                        key={p.rank}
                        className="flex justify-between text-sm"
                      >
                        <span>
                          <span className="text-slate-500 font-mono w-6 inline-block">
                            {p.rank}.
                          </span>{" "}
                          <span
                            className={posColor(
                              p.position,
                            )}
                          >
                            {p.position}
                          </span>{" "}
                          {p.name}
                        </span>
                        <span className="font-mono">
                          {fmtVal(p.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top 5 by Position */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-2">
                    Top 5 by Position
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(
                      league.top5ByPosition,
                    ).map(([pos, players]) => (
                      <div key={pos}>
                        <div
                          className={`text-xs font-semibold mb-1 ${posColor(pos)}`}
                        >
                          {pos}
                        </div>
                        {players.map((p, i) => (
                          <div
                            key={i}
                            className="text-xs text-slate-400 truncate"
                          >
                            {p.name}{" "}
                            <span className="font-mono text-slate-500">
                              {fmtVal(p.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Anchors */}
              <div className="mt-4 pt-3 border-t border-slate-700">
                <h3 className="text-sm font-semibold text-slate-400 mb-2">
                  Anchor Players
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {league.anchors.map((a) => (
                    <div
                      key={a.name}
                      className="bg-slate-800 rounded px-3 py-2"
                    >
                      <div className="text-xs text-slate-400 truncate">
                        {a.name}
                      </div>
                      <div className="font-mono text-sm">
                        {a.rank !== null ? (
                          <>
                            #{a.rank}{" "}
                            <span className="text-slate-500">
                              {fmtVal(a.value)}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-600">
                            unranked
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
