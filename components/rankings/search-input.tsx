"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";

interface SearchInputProps {
  leagueId: string;
  currentSearch?: string;
  currentParams: Record<string, string | undefined>;
  players: Array<{ name: string; nflTeam: string | null }>;
}

export function SearchInput({
  leagueId,
  currentSearch,
  currentParams,
  players,
}: SearchInputProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentSearch || "");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(
    (searchValue: string) => {
      const params = new URLSearchParams();
      if (currentParams.position)
        params.set("position", currentParams.position);
      if (currentParams.group)
        params.set("group", currentParams.group);
      if (currentParams.ownership)
        params.set("ownership", currentParams.ownership);
      if (searchValue.trim()) {
        params.set("search", searchValue.trim());
      }
      const queryString = params.toString();
      startTransition(() => {
        router.push(
          `/league/${leagueId}/rankings${queryString ? `?${queryString}` : ""}`,
        );
      });
    },
    [currentParams, leagueId, router],
  );

  // Filter suggestions
  const suggestions =
    value.trim().length > 0
      ? players
          .filter((p) =>
            p.name.toLowerCase().includes(value.trim().toLowerCase()),
          )
          .slice(0, 10)
      : [];

  // Click-outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && dropdownRef.current) {
      const item = dropdownRef.current.children[
        highlightedIndex
      ] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!dropdownOpen && suggestions.length > 0) {
        setDropdownOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((i) =>
          i < suggestions.length - 1 ? i + 1 : i,
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i > 0 ? i - 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (dropdownOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        const name = suggestions[highlightedIndex].name;
        setValue(name);
        setDropdownOpen(false);
        setHighlightedIndex(-1);
        handleSearch(name);
      } else {
        setDropdownOpen(false);
        handleSearch(value);
      }
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const selectSuggestion = (name: string) => {
    setValue(name);
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    handleSearch(name);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search players..."
        role="combobox"
        aria-label="Search players"
        aria-expanded={dropdownOpen && suggestions.length > 0}
        aria-controls="player-search-listbox"
        aria-activedescendant={
          highlightedIndex >= 0
            ? `player-option-${highlightedIndex}`
            : undefined
        }
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHighlightedIndex(-1);
          setDropdownOpen(e.target.value.trim().length > 0);
        }}
        onKeyDown={handleKeyDown}
        className={`w-48 sm:w-64 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded
          text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500
          focus:border-transparent transition-all ${isPending ? "opacity-50" : ""}`}
      />
      {value && (
        <button
          onClick={() => {
            setValue("");
            setDropdownOpen(false);
            setHighlightedIndex(-1);
            handleSearch("");
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
      {dropdownOpen && suggestions.length > 0 && (
        <ul
          ref={dropdownRef}
          id="player-search-listbox"
          role="listbox"
          className="absolute z-20 w-full mt-1 bg-slate-900 border border-slate-700
            rounded-lg max-h-48 overflow-y-auto"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.name}-${s.nflTeam}`}
              id={`player-option-${i}`}
              role="option"
              aria-selected={i === highlightedIndex}
              onMouseDown={() => selectSuggestion(s.name)}
              onMouseEnter={() => setHighlightedIndex(i)}
              className={`px-3 py-1.5 cursor-pointer flex items-center justify-between ${
                i === highlightedIndex
                  ? "bg-slate-700/70"
                  : "hover:bg-slate-800"
              }`}
            >
              <span className="text-slate-300 text-sm truncate">
                {s.name}
              </span>
              {s.nflTeam && (
                <span className="text-slate-500 text-xs ml-2 shrink-0">
                  {s.nflTeam}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
