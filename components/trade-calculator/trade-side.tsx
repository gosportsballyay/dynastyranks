"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type {
  PlayerAsset,
  DraftPickAsset,
  TradeAsset,
} from "@/lib/trade-engine";

/** Position badge color mapping. */
const POS_COLORS: Record<string, string> = {
  QB: "bg-red-900/70 text-red-300",
  RB: "bg-green-900/70 text-green-300",
  WR: "bg-blue-900/70 text-blue-300",
  TE: "bg-orange-900/70 text-orange-300",
  K: "bg-slate-600/80 text-slate-200",
  DL: "bg-purple-900/70 text-purple-300",
  LB: "bg-yellow-900/70 text-yellow-300",
  DB: "bg-cyan-900/70 text-cyan-300",
  EDR: "bg-purple-900/70 text-purple-300",
  IL: "bg-purple-900/70 text-purple-300",
  CB: "bg-cyan-900/70 text-cyan-300",
  S: "bg-cyan-900/70 text-cyan-300",
};

/** Early/Mid/Late/Projected pick position tier. */
type PickTier = "early" | "mid" | "late" | "projected";

interface TeamRosterData {
  id: string;
  name: string;
  roster: PlayerAsset[];
  picks: DraftPickAsset[];
}

interface TradeSideProps {
  teamId: string;
  teamName: string;
  allTeamsData: TeamRosterData[];
  genericPicks: DraftPickAsset[];
  selectedPlayers: PlayerAsset[];
  selectedPicks: DraftPickAsset[];
  onSelectTeam: (teamId: string, keepSelections?: boolean) => void;
  onAddPlayer: (player: PlayerAsset) => void;
  onRemovePlayer: (playerId: string) => void;
  onAddPick: (pick: DraftPickAsset) => void;
  onRemovePick: (pickId: string) => void;
  onUpdatePickValue: (pickId: string, value: number) => void;
  otherTeamId: string;
  totalValue: number;
  /** Value adjustment added to the fewer-asset side (0 = none). */
  valueAdjustment?: number;
  /** 0-based side index for labeling (0 = Team 1, 1 = Team 2). */
  sideIndex: number;
}

export function TradeSide({
  teamId,
  teamName,
  allTeamsData,
  genericPicks,
  selectedPlayers,
  selectedPicks,
  onSelectTeam,
  onAddPlayer,
  onRemovePlayer,
  onAddPick,
  onRemovePick,
  onUpdatePickValue,
  otherTeamId,
  totalValue,
  valueAdjustment = 0,
  sideIndex,
}: TradeSideProps) {
  const [search, setSearch] = useState("");
  const [pickSearch, setPickSearch] = useState("");
  const [showPicks, setShowPicks] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [pickTiers, setPickTiers] = useState<Record<string, PickTier>>(
    {},
  );
  /** Counter for generating unique IDs when adding duplicate generic picks. */
  const genericCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedIds = new Set(selectedPlayers.map((p) => p.playerId));
  const selectedPickIds = new Set(selectedPicks.map((p) => p.pickId));

  const isNoTeam = teamId === "__no_team__";

  // Build searchable player list from all teams or selected team
  const searchableTeams =
    teamId && !isNoTeam
      ? allTeamsData.filter((t) => t.id === teamId)
      : allTeamsData.filter((t) => t.id !== otherTeamId);

  const searchResults: Array<PlayerAsset & { ownerTeamId: string; ownerTeamName: string }> = [];
  for (const team of searchableTeams) {
    for (const p of team.roster) {
      if (selectedIds.has(p.playerId)) continue;
      if (
        search !== "" &&
        !p.playerName.toLowerCase().includes(search.toLowerCase())
      ) {
        continue;
      }
      searchResults.push({
        ...p,
        ownerTeamId: team.id,
        ownerTeamName: team.name,
      });
    }
  }
  // Sort by value descending, limit to 15
  searchResults.sort((a, b) => b.value - a.value);

  // Draft picks: team-specific or generic for no-team mode
  const currentTeam = allTeamsData.find((t) => t.id === teamId);
  const rawPicks = (isNoTeam || !teamId)
    ? genericPicks
    : (currentTeam?.picks ?? []);
  // Generic picks are never filtered out (user can add multiples).
  // Team picks are filtered by what's already selected.
  const availablePicksUnfiltered = (isNoTeam || !teamId)
    ? rawPicks
    : rawPicks.filter((p) => !selectedPickIds.has(p.pickId));

  // Apply pick search filter
  const availablePicks = pickSearch
    ? availablePicksUnfiltered.filter((p) => {
        const label = formatPickLabel(p).toLowerCase();
        return label.includes(pickSearch.toLowerCase());
      })
    : availablePicksUnfiltered;

  // Group picks by season
  const picksBySeason = new Map<number, DraftPickAsset[]>();
  for (const pick of availablePicks) {
    const arr = picksBySeason.get(pick.season) ?? [];
    arr.push(pick);
    picksBySeason.set(pick.season, arr);
  }

  /** Handle E/M/L/P toggle on a selected pick. */
  function handlePickTierChange(pick: DraftPickAsset, tier: PickTier) {
    setPickTiers((prev) => ({ ...prev, [pick.pickId]: tier }));
    let valueForTier: number | undefined;
    if (tier === "projected") {
      valueForTier = pick.projectedValue;
    } else if (tier === "early") {
      valueForTier = pick.earlyValue;
    } else if (tier === "late") {
      valueForTier = pick.lateValue;
    } else {
      valueForTier = pick.midValue;
    }
    if (valueForTier !== undefined) {
      onUpdatePickValue(pick.pickId, valueForTier);
    }
  }

  /** Whether a pick has pre-computed E/M/L values (unknown position). */
  function hasEml(pick: DraftPickAsset): boolean {
    return (
      pick.earlyValue !== undefined &&
      pick.midValue !== undefined &&
      pick.lateValue !== undefined
    );
  }

  const allTeams = allTeamsData
    .filter((t) => t.id !== otherTeamId)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-4">
      {/* Team selector */}
      <div className="mb-4">
        <label
          className="block text-xs font-medium text-slate-400 mb-1"
        >
          Select Team {sideIndex + 1}
        </label>
        <select
          value={teamId || "__no_team__"}
          onChange={(e) => onSelectTeam(e.target.value)}
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="__no_team__">No Team (all players)</option>
          {allTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Header with team name and value */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white text-sm">
          {teamName || `Team ${sideIndex + 1}`} sends
        </h3>
        {(totalValue > 0 || valueAdjustment > 0) && (
          <span className="text-sm font-mono text-green-400">
            {(totalValue + valueAdjustment).toLocaleString()}
          </span>
        )}
      </div>

      {/* Selected assets */}
      <div className="space-y-1.5 mb-4 min-h-[48px]">
        {selectedPlayers.length === 0 && selectedPicks.length === 0 ? (
          <div className="text-slate-400 text-sm py-3 text-center">
            Add players or picks below
          </div>
        ) : (
          <>
            {selectedPlayers.map((player) => (
              <div
                key={player.playerId}
                className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      POS_COLORS[player.position] ??
                      "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {player.position}
                  </span>
                  <span className="text-white text-sm truncate">
                    {player.playerName}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-mono text-green-400">
                    {player.value.toLocaleString()}
                  </span>
                  <button
                    onClick={() => onRemovePlayer(player.playerId)}
                    className="text-slate-400 hover:text-red-400 transition-colors p-0.5"
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
            {selectedPicks.map((pick) => (
              <div
                key={pick.pickId}
                className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-900/70 text-amber-300">
                    PICK
                  </span>
                  <span className="text-white text-sm">
                    {pick.season} {formatPickLabel(pick)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Tier toggle for picks with E/M/L values */}
                  {hasEml(pick) && (
                    <div className="flex gap-0.5">
                      {pick.projectedValue !== undefined && (
                        <button
                          onClick={() =>
                            handlePickTierChange(pick, "projected")
                          }
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                            (pickTiers[pick.pickId] ?? "projected") ===
                            "projected"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-700 text-slate-400 hover:text-white"
                          }`}
                          title="Use projected pick position from standings"
                        >
                          Proj
                        </button>
                      )}
                      {(
                        [
                          ["early", "Early"],
                          ["mid", "Mid"],
                          ["late", "Late"],
                        ] as const
                      ).map(([tier, label]) => (
                        <button
                          key={tier}
                          onClick={() => handlePickTierChange(pick, tier)}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                            (pickTiers[pick.pickId] ??
                              (pick.projectedValue !== undefined
                                ? "projected"
                                : "mid")) === tier
                              ? "bg-blue-600 text-white"
                              : "bg-slate-700 text-slate-400 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="text-xs font-mono text-green-400">
                    {pick.value.toLocaleString()}
                  </span>
                  <button
                    onClick={() => onRemovePick(pick.pickId)}
                    className="text-slate-400 hover:text-red-400 transition-colors p-0.5"
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            ))}
            {valueAdjustment > 0 && (
              <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-indigo-900/70 text-indigo-300">
                    ADJ
                  </span>
                  <span className="text-slate-300 text-sm">
                    Value Adjustment
                  </span>
                </div>
                <span className="text-xs font-mono text-green-400 flex-shrink-0">
                  +{valueAdjustment.toLocaleString()}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Player search + add — always visible */}
      <div className="border-t border-slate-700 pt-3">
        {/* Toggle: Players / Picks */}
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setShowPicks(false)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              !showPicks
                ? "bg-blue-600/30 text-blue-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Players
          </button>
          <button
            onClick={() => setShowPicks(true)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              showPicks
                ? "bg-blue-600/30 text-blue-400"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Draft Picks
          </button>
        </div>

        {!showPicks ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setDropdownOpen(true);
                setHighlightedIndex(-1);
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={(e) => {
                const items = searchResults.slice(0, 15);
                if (!dropdownOpen || items.length === 0) {
                  if (e.key === "ArrowDown") {
                    setDropdownOpen(true);
                    setHighlightedIndex(0);
                    e.preventDefault();
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightedIndex((i) =>
                    i < items.length - 1 ? i + 1 : 0,
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightedIndex((i) =>
                    i > 0 ? i - 1 : items.length - 1,
                  );
                } else if (e.key === "Enter" && highlightedIndex >= 0) {
                  e.preventDefault();
                  const player = items[highlightedIndex];
                  if (player) {
                    if (!teamId) onSelectTeam(player.ownerTeamId, true);
                    onAddPlayer(player);
                    setSearch("");
                    setDropdownOpen(false);
                    setHighlightedIndex(-1);
                  }
                } else if (e.key === "Escape") {
                  setDropdownOpen(false);
                  setHighlightedIndex(-1);
                }
              }}
              placeholder={
                teamId && !isNoTeam
                  ? "Search players..."
                  : "Search all players..."
              }
              aria-label="Search players"
              aria-expanded={dropdownOpen}
              aria-autocomplete="list"
              role="combobox"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {dropdownOpen && (
              <div
                ref={dropdownRef}
                role="listbox"
                className="absolute z-20 w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg max-h-48 overflow-y-auto"
              >
                {searchResults.slice(0, 15).map((player, idx) => (
                  <button
                    key={player.playerId}
                    role="option"
                    aria-selected={idx === highlightedIndex}
                    onClick={() => {
                      if (!teamId) {
                        onSelectTeam(player.ownerTeamId, true);
                      }
                      onAddPlayer(player);
                      setSearch("");
                      setDropdownOpen(false);
                      setHighlightedIndex(-1);
                    }}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2 transition-colors text-left ${
                      idx === highlightedIndex
                        ? "bg-slate-700/70"
                        : "hover:bg-slate-700/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                          POS_COLORS[player.position] ??
                          "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {player.position}
                      </span>
                      <span className="text-slate-300 text-sm truncate">
                        {player.playerName}
                      </span>
                      {(!teamId || isNoTeam) && (
                        <span className="text-slate-600 text-xs flex-shrink-0">
                          {player.ownerTeamName}
                        </span>
                      )}
                      {player.nflTeam && (
                        <span className="text-slate-500 text-xs flex-shrink-0">
                          {player.nflTeam}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-mono text-slate-400 flex-shrink-0 ml-2">
                      {player.value.toLocaleString()}
                    </span>
                  </button>
                ))}
                {searchResults.length === 0 && (
                  <div className="px-3 py-2 text-sm text-slate-400">
                    No players found
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <input
              type="text"
              value={pickSearch}
              onChange={(e) => setPickSearch(e.target.value)}
              placeholder="Search picks (e.g. Early 1st)..."
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 mb-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="max-h-48 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-slate-800 [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-slate-500">
              {availablePicks.length === 0 ? (
                <div className="text-sm text-slate-400 py-2 text-center">
                  No draft picks found
                </div>
              ) : (
                Array.from(picksBySeason.entries()).map(
                  ([season, seasonPicks]) => (
                    <div key={season}>
                      <div className="text-xs text-slate-500 font-medium mb-1">
                        {season}
                      </div>
                      <div className="space-y-0.5">
                        {seasonPicks.map((pick) => (
                          <button
                            key={pick.pickId}
                            onClick={() => {
                              if (isNoTeam || (!teamId)) {
                                genericCounterRef.current += 1;
                                onAddPick({
                                  ...pick,
                                  pickId: `${pick.pickId}-${genericCounterRef.current}`,
                                });
                              } else {
                                onAddPick(pick);
                              }
                            }}
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-slate-700/50 transition-colors text-left"
                          >
                            <span className="text-slate-300 text-sm">
                              {formatPickLabel(pick)}
                            </span>
                            <span className="text-xs font-mono text-slate-400">
                              {pick.value.toLocaleString()}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ROUND_ORDINALS: Record<number, string> = {
  1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th",
};

/** Format a pick label — generic picks show "Early 1st", team picks show "Rd 1.03". */
function formatPickLabel(pick: DraftPickAsset): string {
  if (pick.pickId.startsWith("generic-")) {
    // pickId format: generic-{season}-{round}-{tier} or generic-{season}-{round}-{tier}-{counter}
    const parts = pick.pickId.split("-");
    const tier = parts[3] ?? "mid";
    const tierLabel =
      tier === "early" ? "Early" : tier === "late" ? "Late" : "Mid";
    const rd = ROUND_ORDINALS[pick.round] ?? `Rd ${pick.round}`;
    return `${tierLabel} ${rd}`;
  }
  let label = `Rd ${pick.round}`;
  const slot = pick.projectedPickNumber ?? pick.pickNumber;
  if (slot) {
    label += `.${String(slot).padStart(2, "0")}`;
  }
  if (
    pick.originalTeamName &&
    pick.originalTeamId !== pick.ownerTeamId
  ) {
    label += ` (via ${pick.originalTeamName})`;
  }
  return label;
}

function XIcon() {
  return (
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
  );
}
