"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "betaBannerDismissed";

export function BetaBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== "true") {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }

  if (!visible) return null;

  return (
    <div className="bg-slate-700/60 border border-slate-600 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
      <p className="text-sm text-slate-300">
        <span className="font-medium text-blue-400">Beta</span>
        {" — "}
        MyDynastyValues is in beta. Values and features may change.
        Found a bug? Use the Feedback button.
      </p>
      <button
        onClick={dismiss}
        className="shrink-0 text-slate-400 hover:text-white transition-colors p-1"
        aria-label="Dismiss banner"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
