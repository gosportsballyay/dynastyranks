"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface LeagueCardProps {
  league: {
    id: string;
    name: string;
    provider: string;
    season: number;
    totalTeams: number;
    syncStatus: string;
    lastSyncedAt: Date | null;
    syncError?: string | null;
  };
}

export function LeagueCard({ league }: LeagueCardProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete "${league.name}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/leagues/${league.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete league");
      }

      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete league");
      setDeleting(false);
    }
  }

  return (
    <div className="relative rounded-xl bg-slate-800/50 p-6 ring-1 ring-slate-700 hover:ring-blue-500 transition-all">
      <Link href={`/league/${league.id}/summary`} className="block">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{league.name}</h3>
            <p className="text-sm text-slate-400 mt-1">
              {league.provider.charAt(0).toUpperCase() + league.provider.slice(1)}{" "}
              &bull; {league.season} &bull; {league.totalTeams} teams
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              league.syncStatus === "success"
                ? "bg-green-500/10 text-green-400"
                : league.syncStatus === "syncing"
                  ? "bg-yellow-500/10 text-yellow-400"
                  : league.syncStatus === "failed"
                    ? "bg-red-500/10 text-red-400"
                    : "bg-slate-500/10 text-slate-400"
            }`}
          >
            {league.syncStatus === "success"
              ? "Synced"
              : league.syncStatus === "syncing"
                ? "Syncing..."
                : league.syncStatus === "failed"
                  ? "Sync Failed"
                  : "Pending"}
          </span>
        </div>
        {league.syncError && (
          <p className="text-xs text-red-400 mt-2 truncate" title={league.syncError}>
            Error: {league.syncError}
          </p>
        )}
        {league.lastSyncedAt && (
          <p className="text-xs text-slate-500 mt-4">
            Last synced: {new Date(league.lastSyncedAt).toLocaleDateString()}
          </p>
        )}
      </Link>

      {/* Menu button */}
      <div className="absolute top-4 right-4">
        <button
          onClick={(e) => {
            e.preventDefault();
            setShowMenu(!showMenu);
          }}
          className="p-1 text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {showMenu && (
          <div className="absolute right-0 mt-1 w-32 rounded-lg bg-slate-700 shadow-lg ring-1 ring-slate-600 z-10">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-600 rounded-lg disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
