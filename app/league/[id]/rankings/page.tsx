export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import Link from "next/link";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  playerValues,
  canonicalPlayers,
  rosters,
  teams,
} from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { computeUnifiedValues } from "@/lib/value-engine";
import { RankingsTable } from "@/components/rankings/rankings-table";
import { SearchInput } from "@/components/rankings/search-input";
import { ExportCsvButton } from "@/components/rankings/export-csv-button";
import { PositionDropdown } from "@/components/rankings/position-dropdown";

interface PageProps {
  params: { id: string };
  searchParams: {
    position?: string;
    group?: string;
    ownership?: string;
    search?: string;
    sort?: "value" | "projected" | "last_season";
  };
}

export default async function RankingsPage({ params, searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user) {
    notFound();
  }

  // Fetch league (auth already checked by layout)
  const [league] = await db
    .select()
    .from(leagues)
    .where(
      and(eq(leagues.id, params.id), eq(leagues.userId, session!.user.id))
    )
    .limit(1);

  if (!league) {
    notFound();
  }

  // Parallel fetch: settings, values, teams, and rosters
  const [settingsResult, valuesResult, leagueTeams, rosterData] = await Promise.all([
    db.select().from(leagueSettings).where(eq(leagueSettings.leagueId, league.id)).limit(1),
    db
      .select({ value: playerValues, player: canonicalPlayers })
      .from(playerValues)
      .innerJoin(canonicalPlayers, eq(playerValues.canonicalPlayerId, canonicalPlayers.id))
      .where(eq(playerValues.leagueId, league.id))
      .orderBy(desc(playerValues.value)),
    db
      .select({ id: teams.id, name: teams.teamName, ownerName: teams.ownerName })
      .from(teams)
      .where(eq(teams.leagueId, league.id)),
    db
      .select({ canonicalPlayerId: rosters.canonicalPlayerId, teamId: rosters.teamId })
      .from(rosters)
      .innerJoin(teams, eq(rosters.teamId, teams.id))
      .where(eq(teams.leagueId, league.id)),
  ]);

  const [settings] = settingsResult;
  let values = valuesResult;

  // If no values yet, compute them with unified engine
  if (values.length === 0 && settings) {
    const result = await computeUnifiedValues(league.id);

    if (result.success) {
      values = await db
        .select({
          value: playerValues,
          player: canonicalPlayers,
        })
        .from(playerValues)
        .innerJoin(
          canonicalPlayers,
          eq(playerValues.canonicalPlayerId, canonicalPlayers.id)
        )
        .where(eq(playerValues.leagueId, league.id))
        .orderBy(desc(playerValues.value));
    }
  }

  // Create ownership map: playerId -> { teamId, teamName, ownerName }
  const ownershipMap = new Map<string, { teamId: string; teamName: string; ownerName: string }>();
  for (const roster of rosterData) {
    if (roster.canonicalPlayerId) {
      const team = leagueTeams.find((t) => t.id === roster.teamId);
      if (team) {
        ownershipMap.set(roster.canonicalPlayerId, {
          teamId: team.id,
          teamName: team.name || "Unknown",
          ownerName: team.ownerName || "Unknown",
        });
      }
    }
  }

  // Apply filters
  let filteredValues = values;

  if (searchParams.position) {
    filteredValues = filteredValues.filter(
      (v) =>
        v.player.position.toUpperCase() ===
        searchParams.position?.toUpperCase()
    );
  }

  if (searchParams.group) {
    filteredValues = filteredValues.filter(
      (v) => v.player.positionGroup === searchParams.group
    );
  }

  // Apply search filter
  if (searchParams.search) {
    const searchLower = searchParams.search.toLowerCase();
    filteredValues = filteredValues.filter(
      (v) =>
        v.player.name.toLowerCase().includes(searchLower) ||
        (v.player.nflTeam && v.player.nflTeam.toLowerCase().includes(searchLower))
    );
  }

  // Apply ownership filter
  if (searchParams.ownership === "owned") {
    filteredValues = filteredValues.filter((v) =>
      ownershipMap.has(v.player.id)
    );
  } else if (searchParams.ownership === "fa") {
    filteredValues = filteredValues.filter((v) =>
      !ownershipMap.has(v.player.id)
    );
  }

  // Get unique positions for filter
  const positions = [...new Set(values.map((v) => v.player.position))].sort();

  // Determine sort mode (default: value for overall, projected for position-specific)
  const sortMode = searchParams.sort || (searchParams.position ? "projected" : "value");

  // Sort filtered values based on mode
  const sortedValues = [...filteredValues].sort((a, b) => {
    switch (sortMode) {
      case "last_season":
        return (b.value.lastSeasonPoints ?? 0) - (a.value.lastSeasonPoints ?? 0);
      case "projected":
        return b.value.projectedPoints - a.value.projectedPoints;
      case "value":
      default:
        return b.value.value - a.value.value;
    }
  });

  // Build base URL for filters, preserving existing params
  const buildFilterUrl = (params: Record<string, string | undefined>) => {
    const url = new URLSearchParams();
    // Preserve search
    if (searchParams.search) url.set("search", searchParams.search);
    // Preserve ownership when changing position/group (unless explicitly set)
    if (searchParams.ownership && !("ownership" in params)) {
      url.set("ownership", searchParams.ownership);
    }
    // Preserve sort when changing other params (unless explicitly set)
    if (searchParams.sort && !("sort" in params)) {
      url.set("sort", searchParams.sort);
    }
    // Set new params
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.set(key, value);
    });
    const queryString = url.toString();
    return `/league/${league.id}/rankings${queryString ? `?${queryString}` : ""}`;
  };

  // Transform values with ownership info for table
  const valuesWithOwnership = sortedValues.map((v) => {
    const ownership = ownershipMap.get(v.player.id);
    return {
      ...v.value,
      player: v.player,
      owner: ownership ? ownership.ownerName : null,
      teamName: ownership ? ownership.teamName : null,
    };
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white">Player Rankings</h1>
        <div className="flex items-center gap-4">
          {/* Search Box */}
          <SearchInput
            leagueId={league.id}
            currentSearch={searchParams.search}
            currentParams={searchParams}
          />
          <ExportCsvButton values={valuesWithOwnership} leagueName={league.name} />
          <span className="text-sm text-slate-400">
            {filteredValues.length} players
          </span>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Position Dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Position:
          </span>
          <PositionDropdown
            leagueId={league.id}
            currentPosition={searchParams.position}
            currentGroup={searchParams.group}
            currentParams={searchParams}
            availablePositions={positions}
            idpStructure={settings?.idpStructure}
          />
        </div>

        {/* Ownership Filters */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Ownership:
          </span>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: undefined,
            })}
            active={!searchParams.ownership}
          >
            All
          </FilterChip>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: "owned",
            })}
            active={searchParams.ownership === "owned"}
          >
            Owned
          </FilterChip>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: "fa",
            })}
            active={searchParams.ownership === "fa"}
          >
            Free Agents
          </FilterChip>
        </div>

        {/* Sort Mode Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Sort by:
          </span>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: searchParams.ownership,
              sort: "value",
            })}
            active={sortMode === "value"}
          >
            Value
          </FilterChip>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: searchParams.ownership,
              sort: "projected",
            })}
            active={sortMode === "projected"}
          >
            Projected
          </FilterChip>
          <FilterChip
            href={buildFilterUrl({
              position: searchParams.position,
              group: searchParams.group,
              ownership: searchParams.ownership,
              sort: "last_season",
            })}
            active={sortMode === "last_season"}
          >
            Last Season
          </FilterChip>
        </div>
      </div>

      {/* Rankings Table */}
      <div className="bg-slate-800/50 rounded-lg overflow-hidden">
        <RankingsTable
          values={valuesWithOwnership}
          positionFilter={searchParams.position}
        />
      </div>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-full text-sm transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      {children}
    </Link>
  );
}
