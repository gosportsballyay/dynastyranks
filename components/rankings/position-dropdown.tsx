"use client";

import { useRouter } from "next/navigation";

interface PositionDropdownProps {
  leagueId: string;
  currentPosition?: string;
  currentGroup?: string;
  currentParams: Record<string, string | undefined>;
  availablePositions: string[];
  idpStructure?: "none" | "consolidated" | "granular" | "mixed";
}

// Group positions into categories
const OFFENSE_POSITIONS = ["QB", "RB", "WR", "TE", "K"];
const IDP_CONSOLIDATED = ["DL", "LB", "DB"];
const IDP_GRANULAR = ["EDR", "IL", "LB", "CB", "S"];

export function PositionDropdown({
  leagueId,
  currentPosition,
  currentGroup,
  currentParams,
  availablePositions,
  idpStructure = "none",
}: PositionDropdownProps) {
  const router = useRouter();

  // Build the URL with new params
  const buildUrl = (params: Record<string, string | undefined>) => {
    const url = new URLSearchParams();
    // Preserve existing params
    if (currentParams.search) url.set("search", currentParams.search);
    if (currentParams.ownership) url.set("ownership", currentParams.ownership);
    // Set new params
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.set(key, value);
    });
    const queryString = url.toString();
    return `/league/${leagueId}/rankings${queryString ? `?${queryString}` : ""}`;
  };

  // Handle dropdown change
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;

    let url: string;
    if (value === "") {
      // All players
      url = buildUrl({});
    } else if (value === "offense") {
      url = buildUrl({ group: "offense" });
    } else if (value === "defense") {
      url = buildUrl({ group: "defense" });
    } else {
      url = buildUrl({ position: value });
    }

    router.push(url);
  };

  // Determine current value
  let currentValue = "";
  if (currentPosition) {
    currentValue = currentPosition;
  } else if (currentGroup) {
    currentValue = currentGroup;
  }

  // Filter positions to only show available ones
  const offenseOptions = OFFENSE_POSITIONS.filter((p) =>
    availablePositions.includes(p)
  );

  // IDP positions based on structure
  let idpOptions: string[] = [];
  if (idpStructure === "consolidated") {
    idpOptions = IDP_CONSOLIDATED.filter((p) => availablePositions.includes(p));
  } else if (idpStructure === "granular" || idpStructure === "mixed") {
    idpOptions = IDP_GRANULAR.filter((p) => availablePositions.includes(p));
  } else {
    // Just show whatever IDP positions are available
    idpOptions = availablePositions.filter(
      (p) => !OFFENSE_POSITIONS.includes(p)
    );
  }

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    >
      <option value="">All Positions</option>

      <optgroup label="Groups">
        <option value="offense">Offense</option>
        {idpOptions.length > 0 && <option value="defense">IDP</option>}
      </optgroup>

      <optgroup label="Offense">
        {offenseOptions.map((pos) => (
          <option key={pos} value={pos}>
            {pos}
          </option>
        ))}
      </optgroup>

      {idpOptions.length > 0 && (
        <optgroup label="IDP">
          {idpOptions.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
