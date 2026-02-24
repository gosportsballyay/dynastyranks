"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
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
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-slate-400 mb-4">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white
            hover:bg-blue-500 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
