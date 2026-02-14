"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Team {
  id: string;
  name: string | null;
  owner: string | null;
}

interface TeamSelectorProps {
  leagueId: string;
  teams: Team[];
  currentTeamId: string | null;
}

export function TeamSelector({
  leagueId,
  teams,
  currentTeamId,
}: TeamSelectorProps) {
  const router = useRouter();
  const [selectedTeamId, setSelectedTeamId] = useState(currentTeamId || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (!selectedTeamId || selectedTeamId === currentTeamId) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(`/api/leagues/${leagueId}/select-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeamId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save team");
      }

      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save team");
    } finally {
      setLoading(false);
    }
  }

  const hasChanged = selectedTeamId && selectedTeamId !== currentTeamId;

  return (
    <div className="space-y-4">
      <select
        value={selectedTeamId}
        onChange={(e) => {
          setSelectedTeamId(e.target.value);
          setSuccess(false);
        }}
        className="w-full max-w-md rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <option value="">Select your team...</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name || "Unnamed Team"} ({team.owner || "Unknown"})
          </option>
        ))}
      </select>

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}

      {success && (
        <div className="text-green-400 text-sm">Team saved successfully!</div>
      )}

      <button
        onClick={handleSave}
        disabled={loading || !hasChanged}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
