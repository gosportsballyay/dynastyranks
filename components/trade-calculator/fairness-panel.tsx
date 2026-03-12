"use client";

import type { FairnessResult } from "@/lib/trade-engine";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface FairnessPanelProps {
  fairness: FairnessResult;
  team1Name: string;
  team2Name: string;
}

export function FairnessPanel({
  fairness,
  team1Name,
  team2Name,
}: FairnessPanelProps) {
  const {
    side1Total,
    side2Total,
    adjustedDelta,
    adjustedPctDiff,
    waiverAdjustment,
    studAdjustment,
    totalAdjustmentValue,
    adjustedSide,
    verdict,
  } = fairness;
  const absPct = Math.abs(adjustedPctDiff);

  // Team that sends LESS value receives MORE — they're favored
  const favoredTeam = adjustedDelta > 0 ? team2Name : team1Name;

  // Color based on verdict
  const verdictStyles = {
    balanced: {
      bar: "bg-green-500",
      text: "text-green-400",
      bg: "bg-green-500/20",
      label: "Balanced trade",
    },
    "slight-edge": {
      bar: "bg-yellow-500",
      text: "text-yellow-400",
      bg: "bg-yellow-500/20",
      label: `Slight edge to ${favoredTeam}`,
    },
    imbalanced: {
      bar: "bg-red-500",
      text: "text-red-400",
      bg: "bg-red-500/20",
      label: `${favoredTeam} wins significantly`,
    },
  };

  const style = verdictStyles[verdict];

  const hasAdjustment = totalAdjustmentValue > 0 && adjustedSide !== null;

  // Display totals include the adjustment on the fewer-asset side
  // adjustedSide = MORE-asset side, so the opposite side gets the bump
  const display1Total =
    hasAdjustment && adjustedSide === 2
      ? side1Total + totalAdjustmentValue
      : side1Total;
  const display2Total =
    hasAdjustment && adjustedSide === 1
      ? side2Total + totalAdjustmentValue
      : side2Total;

  // Bar widths: proportional to each side's displayed total
  const maxTotal = Math.max(display1Total, display2Total, 1);
  const side1Pct = (display1Total / maxTotal) * 100;
  const side2Pct = (display2Total / maxTotal) * 100;

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-5">
      <h3 className="text-sm font-medium text-slate-400 tracking-wider mb-4 flex items-center gap-1">
        Structural Fairness
        <HelpTooltip
          text="Evaluates whether the total dynasty value exchanged is balanced, accounting for roster slot cost and the premium of consolidating value into fewer players."
          learnMoreHref="/how-it-works#trade-analysis"
        />
      </h3>

      {/* Value totals */}
      <div className="grid grid-cols-3 gap-4 text-center mb-4">
        <div>
          <div className="text-xs text-slate-400 mb-1 truncate">
            {team1Name}
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {display1Total.toLocaleString()}
          </div>
        </div>
        <div className="flex items-center justify-center">
          <div
            className={`px-3 py-1.5 rounded-lg font-mono text-sm font-bold ${style.bg} ${style.text}`}
          >
            {adjustedDelta > 0 ? "+" : ""}
            {adjustedDelta.toLocaleString()} ({absPct.toFixed(1)}%)
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1 truncate">
            {team2Name}
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {display2Total.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Value bar */}
      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-slate-900 mb-3">
        <div
          className={`${style.bar} rounded-l-full transition-all duration-300`}
          style={{ width: `${side1Pct}%` }}
        />
        <div
          className={`${style.bar} rounded-r-full transition-all duration-300`}
          style={{ width: `${side2Pct}%` }}
        />
      </div>

      {/* Verdict */}
      <div className={`text-center text-sm ${style.text}`}>
        {style.label}
      </div>

      {/* Adjustment annotation */}
      {hasAdjustment && (
        <div className="text-center text-xs text-slate-500 mt-2">
          Includes roster cost
          {waiverAdjustment > 0 &&
            ` (-${waiverAdjustment.toLocaleString()})`}
          {studAdjustment > 0 &&
            ` and stud premium (-${studAdjustment.toLocaleString()})`}
        </div>
      )}
    </div>
  );
}
