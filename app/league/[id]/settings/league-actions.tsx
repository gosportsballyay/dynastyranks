"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LeagueActionsProps {
  leagueId: string;
  leagueName: string;
  syncStatus: string;
  onTeamsUpdated?: (teams: Array<{ id: string; name: string | null; owner: string | null }>) => void;
}

export function LeagueActions({ leagueId, leagueName, syncStatus, onTeamsUpdated }: LeagueActionsProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/leagues/${leagueId}/sync`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync");
      }

      setSuccess("League synced successfully!");

      // Notify parent of new teams if callback provided
      if (onTeamsUpdated && data.teams) {
        onTeamsUpdated(data.teams);
      }

      // Refresh the page to show updated data
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync league");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/leagues/${leagueId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete");
      }

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete league");
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Messages */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-900/50 border border-green-700 text-green-300 text-sm">
          {success}
        </div>
      )}

      {/* Sync Section */}
      <div className="bg-slate-800/50 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-2">Sync League Data</h2>
        <p className="text-slate-400 text-sm mb-4">
          Re-fetch all league data from {leagueName}. This will update teams, rosters, and settings.
        </p>
        {syncStatus === "failed" && (
          <p className="text-red-400 text-sm mb-4">
            Last sync failed. Try syncing again.
          </p>
        )}
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSyncing ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Syncing...
            </span>
          ) : (
            "Force Re-sync"
          )}
        </button>
      </div>

      {/* Delete Section */}
      <div className="bg-slate-800/50 rounded-lg p-6 border border-red-900/50">
        <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
        <p className="text-slate-400 text-sm mb-4">
          Permanently delete this league and all associated data. This action cannot be undone.
        </p>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 rounded-lg bg-red-900/50 text-red-400 border border-red-700 hover:bg-red-900 transition-colors"
          >
            Delete League
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-red-300 text-sm font-medium">
              Are you sure you want to delete &quot;{leagueName}&quot;?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDeleting ? "Deleting..." : "Yes, Delete"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
