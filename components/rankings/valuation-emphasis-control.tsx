"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MODE_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "market_anchored", label: "Market" },
  { value: "balanced", label: "Balanced" },
  { value: "league_driven", label: "League" },
];

interface ValuationEmphasisControlProps {
  leagueId: string;
  currentMode: string;
}

/**
 * Compact inline control for switching valuation emphasis mode.
 *
 * Triggers a PATCH to the valuation-mode API, which recomputes
 * all player values server-side, then refreshes the RSC data.
 */
export function ValuationEmphasisControl({
  leagueId,
  currentMode,
}: ValuationEmphasisControlProps) {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState(currentMode);
  const [loading, setLoading] = useState(false);

  async function handleSelect(mode: string) {
    if (mode === activeMode) return;

    const prevMode = activeMode;
    setActiveMode(mode);
    setLoading(true);

    try {
      const res = await fetch(
        `/api/leagues/${leagueId}/valuation-mode`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valuationMode: mode }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }

      router.refresh();
    } catch {
      setActiveMode(prevMode);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 uppercase tracking-wider">
        Emphasis:
      </span>
      {MODE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleSelect(opt.value)}
          disabled={loading}
          className={`px-3 py-1 rounded-full text-sm transition-colors ${
            activeMode === opt.value
              ? "bg-blue-600 text-white"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          } disabled:opacity-50`}
        >
          {opt.label}
          {loading && activeMode === opt.value && (
            <span className="ml-1 inline-block animate-spin">&#8987;</span>
          )}
        </button>
      ))}
    </div>
  );
}
