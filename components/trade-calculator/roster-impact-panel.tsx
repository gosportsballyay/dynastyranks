"use client";

import { useState } from "react";
import type { RosterImpactResult } from "@/lib/trade-engine";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { LineupComparison } from "./lineup-comparison";

interface RosterImpactPanelProps {
  impact: RosterImpactResult;
  loading: boolean;
}

export function RosterImpactPanel({ impact, loading }: RosterImpactPanelProps) {
  const [showLineup, setShowLineup] = useState(false);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-5">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-1">
          Roster Impact (Your Team)
          <HelpTooltip text="Projects how this trade changes your optimal lineup. 1-Year and 3-Year show dynasty value trajectory." />
        </h3>
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="ml-2 text-sm text-slate-400">Analyzing...</span>
        </div>
      </div>
    );
  }

  const { lineupDelta, oneYearDelta, threeYearDelta, efficiency } = impact;

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-5">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
        Roster Impact (Your Team)
      </h3>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Lineup"
          value={lineupDelta}
          suffix="pts/wk"
          format="decimal"
        />
        <MetricCard
          label="1-Year"
          value={oneYearDelta}
          suffix=""
          format="integer"
        />
        <MetricCard
          label="3-Year"
          value={threeYearDelta}
          suffix=""
          format="integer"
        />
        <MetricCard
          label="Spots"
          value={efficiency.spotDelta}
          suffix={efficiency.spotDelta > 0 ? "freed" : "used"}
          format="integer"
          invertColor
        />
      </div>

      {/* Thin position warnings */}
      {efficiency.thinPositions.length > 0 && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-amber-400">Thin at:</span>
          <div className="flex gap-1">
            {efficiency.thinPositions.map((pos) => (
              <span
                key={pos}
                className="px-2 py-0.5 rounded text-xs bg-amber-900/70 text-amber-300"
              >
                {pos}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Consolidation note */}
      {efficiency.consolidation && efficiency.thinPositions.length === 0 && (
        <div className="mb-3 text-sm text-green-400">
          Consolidation trade: frees {efficiency.spotDelta} roster spot
          {efficiency.spotDelta !== 1 ? "s" : ""}
        </div>
      )}

      {/* Lineup comparison toggle */}
      <button
        onClick={() => setShowLineup(!showLineup)}
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        {showLineup ? "▼" : "▶"} View lineup comparison
      </button>

      {showLineup && (
        <div className="mt-3">
          <LineupComparison
            before={impact.lineupBefore}
            after={impact.lineupAfter}
          />
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  format,
  invertColor,
}: {
  label: string;
  value: number;
  suffix: string;
  format: "decimal" | "integer";
  invertColor?: boolean;
}) {
  const isPositive = invertColor ? value > 0 : value > 0;
  const isNeutral = value === 0;
  const colorClass = isNeutral
    ? "text-slate-400"
    : isPositive
      ? "text-green-400"
      : "text-red-400";

  const formatted =
    format === "decimal" ? value.toFixed(1) : Math.round(value).toLocaleString();
  const sign = value > 0 ? "+" : "";

  return (
    <div className="bg-slate-900/50 rounded-lg px-3 py-2.5 text-center">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-sm font-mono font-bold ${colorClass}`}>
        {sign}
        {formatted}
      </div>
      {suffix && (
        <div className="text-xs text-slate-500 mt-0.5">{suffix}</div>
      )}
    </div>
  );
}
