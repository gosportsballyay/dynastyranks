"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface SearchInputProps {
  leagueId: string;
  currentSearch?: string;
  currentParams: Record<string, string | undefined>;
}

export function SearchInput({ leagueId, currentSearch, currentParams }: SearchInputProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentSearch || "");

  const handleSearch = (searchValue: string) => {
    const params = new URLSearchParams();

    // Preserve other filters
    if (currentParams.position) params.set("position", currentParams.position);
    if (currentParams.group) params.set("group", currentParams.group);
    if (currentParams.ownership) params.set("ownership", currentParams.ownership);

    // Add search if not empty
    if (searchValue.trim()) {
      params.set("search", searchValue.trim());
    }

    const queryString = params.toString();
    startTransition(() => {
      router.push(`/league/${leagueId}/rankings${queryString ? `?${queryString}` : ""}`);
    });
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search players..."
        aria-label="Search players"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSearch(value);
          }
        }}
        className={`w-40 sm:w-56 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded
          text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500
          focus:border-transparent transition-all ${isPending ? "opacity-50" : ""}`}
      />
      {value && (
        <button
          onClick={() => {
            setValue("");
            handleSearch("");
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
