"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  leagueId: string;
}

/**
 * Auto-fires a recompute when the engine version is stale.
 *
 * Renders a small banner while recomputing, then refreshes the page
 * to show updated values. Only triggers once per mount.
 */
export function StaleEngineRecompute({ leagueId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<
    "recomputing" | "done" | "error"
  >("recomputing");

  useEffect(() => {
    let cancelled = false;

    async function recompute() {
      try {
        const res = await fetch(
          `/api/leagues/${leagueId}/recompute`,
          { method: "POST" },
        );

        if (cancelled) return;

        if (res.ok) {
          setStatus("done");
          router.refresh();
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    recompute();
    return () => { cancelled = true; };
  }, [leagueId, router]);

  if (status === "done") return null;

  return (
    <div
      className={`mb-4 px-4 py-2 rounded-lg text-sm ${
        status === "error"
          ? "bg-red-900/40 text-red-300"
          : "bg-blue-900/40 text-blue-300"
      }`}
    >
      {status === "recomputing" && (
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          Updating values with latest engine...
        </span>
      )}
      {status === "error" && (
        <span>
          Failed to recompute values. Try refreshing or re-syncing
          from league settings.
        </span>
      )}
    </div>
  );
}
