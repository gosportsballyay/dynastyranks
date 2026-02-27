"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

export default function LeagueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex items-center justify-center py-24 px-4">
      <div className="text-center max-w-md">
        <h1 className="text-xl font-bold text-white mb-2">
          Something went wrong
        </h1>
        <p className="text-slate-400 mb-6">
          {error.message || "Failed to load this page."}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white
              text-sm font-medium hover:bg-blue-500 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg text-slate-300 text-sm
              font-medium ring-1 ring-slate-600 hover:text-white
              hover:ring-slate-500 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
