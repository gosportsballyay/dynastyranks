"use client";

import { useState } from "react";
import type { TradeDivergenceResult } from "@/lib/trade-engine";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface MarketPanelProps {
  divergence: TradeDivergenceResult;
  team1Name: string;
  team2Name: string;
}

export function MarketPanel({
  divergence,
  team1Name,
  team2Name,
}: MarketPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const significantDivergences = divergence.assetDivergences.filter(
    (d) => d.significant,
  );

  const structuralDelta = divergence.structuralDeltaPct;
  const consensusDelta = divergence.consensusDeltaPct;
  const gapDiff = Math.abs(structuralDelta - consensusDelta);

  // Skip if no consensus data
  const hasConsensus = divergence.assetDivergences.some(
    (d) => d.consensusValue !== d.structuralValue,
  );

  if (!hasConsensus) return null;

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
          Market Comparison
          <HelpTooltip
            text="How your league values this trade vs. market consensus. Large gaps may indicate league-specific advantages."
            learnMoreHref="/how-it-works#consensus"
          />
        </h3>
        <span className="text-slate-500 text-xs">
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {/* Summary always visible */}
      <div className="mt-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Your league sees:</span>
          <span
            className={`font-mono ${
              Math.abs(structuralDelta) < 5
                ? "text-green-400"
                : "text-yellow-400"
            }`}
          >
            {structuralDelta > 0 ? "+" : ""}
            {structuralDelta.toFixed(1)}% toward {team1Name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-slate-400">Market sees:</span>
          <span
            className={`font-mono ${
              Math.abs(consensusDelta) < 5
                ? "text-green-400"
                : "text-yellow-400"
            }`}
          >
            {consensusDelta > 0 ? "+" : ""}
            {consensusDelta.toFixed(1)}% toward {team1Name}
          </span>
        </div>
        {gapDiff > 10 && (
          <div className="mt-2 text-xs text-amber-400">
            Significant gap between league and market valuation
            ({gapDiff.toFixed(0)}% difference)
          </div>
        )}
      </div>

      {/* Expanded: per-asset divergences */}
      {expanded && significantDivergences.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700 space-y-2">
          <div className="text-xs text-slate-500 mb-2">
            Significant divergences (&gt;30%):
          </div>
          {significantDivergences.map((d) => (
            <div
              key={d.playerId}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-slate-300 truncate mr-2">
                {d.playerName}
              </span>
              <span
                className={`text-xs flex-shrink-0 ${
                  d.direction === "league-higher"
                    ? "text-green-400"
                    : "text-amber-400"
                }`}
              >
                {d.direction === "league-higher"
                  ? "League values higher"
                  : "Market values higher"}
                {" "}
                ({(d.divergencePct * 100).toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && significantDivergences.length === 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700 text-sm text-slate-500">
          No significant per-asset divergences
        </div>
      )}
    </div>
  );
}
