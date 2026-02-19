"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ValuationMode =
  | "auto"
  | "market_anchored"
  | "balanced"
  | "league_driven";

const MODE_OPTIONS: Array<{
  value: ValuationMode;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Auto (Format Adaptive)",
    description:
      "Weights adjust based on league complexity. " +
      "Standard leagues favor consensus; deep IDP " +
      "leagues favor league-specific signals.",
  },
  {
    value: "market_anchored",
    label: "Market Anchored",
    description:
      "65% consensus, 35% league signal. " +
      "Trust market values, minor league adjustments.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description:
      "50/50 split between consensus and league signal. " +
      "Equal weight to market and your league's scoring.",
  },
  {
    value: "league_driven",
    label: "League Driven",
    description:
      "35% consensus, 65% league signal. " +
      "Heavily favor your league's unique scoring system.",
  },
];

interface ValuationModeSelectorProps {
  leagueId: string;
  currentMode: ValuationMode;
}

export function ValuationModeSelector({
  leagueId,
  currentMode,
}: ValuationModeSelectorProps) {
  const router = useRouter();
  const [selectedMode, setSelectedMode] =
    useState<ValuationMode>(currentMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (selectedMode === currentMode) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(
        `/api/leagues/${leagueId}/valuation-mode`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            valuationMode: selectedMode,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save");
      }

      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save",
      );
    } finally {
      setLoading(false);
    }
  }

  const hasChanged = selectedMode !== currentMode;
  const selectedOption = MODE_OPTIONS.find(
    (o) => o.value === selectedMode,
  );

  return (
    <div className="space-y-4">
      <select
        value={selectedMode}
        onChange={(e) => {
          setSelectedMode(e.target.value as ValuationMode);
          setSuccess(false);
        }}
        className="w-full max-w-md rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        {MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {selectedOption && (
        <p className="text-slate-400 text-sm max-w-md">
          {selectedOption.description}
        </p>
      )}

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}

      {success && (
        <div className="text-green-400 text-sm">
          Saved. Values recomputed.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={loading || !hasChanged}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Recomputing values..." : "Save"}
      </button>
    </div>
  );
}
