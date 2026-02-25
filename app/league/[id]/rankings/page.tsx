export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import Link from "next/link";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  playerValues,
  canonicalPlayers,
  rosters,
  teams,
  historicalStats,
  aggregatedValues,
} from "@/lib/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { normalizeStatKeys } from "@/lib/stats/canonical-keys";
import {
  computeUnifiedValues,
  ENGINE_VERSION,
} from "@/lib/value-engine";
import { RankingsTable } from "@/components/rankings/rankings-table";
import { StaleEngineRecompute } from "@/components/rankings/stale-engine-recompute";
import { SearchInput } from "@/components/rankings/search-input";
import { ExportCsvButton } from "@/components/rankings/export-csv-button";
import { PositionDropdown } from "@/components/rankings/position-dropdown";
import { ValuationEmphasisControl } from "@/components/rankings/valuation-emphasis-control";

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

/**
 * Build a reverse mapping from granular positions to consolidated.
 *
 * Given `{"DL": ["EDR", "IL"], "DB": ["CB", "S"]}`, returns
 * `{"EDR": "DL", "IL": "DL", "CB": "DB", "S": "DB"}`.
 */
function buildReverseMapping(
  positionMappings: Record<string, string[]> | null | undefined,
): Record<string, string> {
  const reverse: Record<string, string> = {};
  for (const [consolidated, granularList] of
    Object.entries(positionMappings || {})) {
    for (const g of granularList) {
      reverse[g] = consolidated;
    }
  }
  return reverse;
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

  // Parallel fetch: settings, values, teams, rosters, history, consensus
  const [
    settingsResult,
    valuesResult,
    leagueTeams,
    rosterData,
    historyRows,
    consensusRows,
  ] = await Promise.all([
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
    db
      .select()
      .from(historicalStats)
      .where(inArray(historicalStats.season, [2025, 2024, 2023])),
    db
      .select({
        canonicalPlayerId: aggregatedValues.canonicalPlayerId,
        aggregatedValue: aggregatedValues.aggregatedValue,
      })
      .from(aggregatedValues)
      .where(eq(aggregatedValues.leagueId, league.id)),
  ]);

  const [settings] = settingsResult;
  let values = valuesResult;

  // Build scoring rules for historical stats
  const scoringRules = (settings?.scoringRules ?? {}) as Record<string, number>;

  // Build history map: playerId -> season lines
  const historyMap = new Map<
    string,
    Array<{ season: number; points: number; gamesPlayed: number }>
  >();
  for (const row of historyRows) {
    const stats = normalizeStatKeys(
      row.stats as Record<string, number>,
    );
    let points = 0;
    for (const [key, val] of Object.entries(stats)) {
      if (scoringRules[key]) points += val * scoringRules[key];
    }
    const entry = {
      season: row.season,
      points,
      gamesPlayed: row.gamesPlayed ?? 0,
    };
    const existing = historyMap.get(row.canonicalPlayerId);
    if (existing) {
      existing.push(entry);
    } else {
      historyMap.set(row.canonicalPlayerId, [entry]);
    }
  }

  // Build consensus map: playerId -> aggregatedValue
  const consensusMap = new Map<string, number>();
  for (const row of consensusRows) {
    consensusMap.set(row.canonicalPlayerId, row.aggregatedValue);
  }

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

  // Check if stored values were computed by a different engine version
  const storedVersion = values.length > 0
    ? values[0].value.engineVersion
    : null;
  const staleEngine = storedVersion !== null
    && storedVersion !== ENGINE_VERSION;

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

  // Exclude IDP players from non-IDP leagues
  const hasIdp = settings?.idpStructure
    && settings.idpStructure !== "none";
  if (!hasIdp) {
    filteredValues = filteredValues.filter(
      (v) => v.player.positionGroup !== "defense",
    );
  }

  // Check if position filter matches a flex slot
  const flexSlotNames = new Set(
    (settings?.flexRules ?? []).map((r) => r.slot),
  );
  const activeFlexRule = searchParams.position
    ? (settings?.flexRules ?? []).find(
        (r) => r.slot === searchParams.position!.toUpperCase(),
      )
    : null;

  if (searchParams.position) {
    if (activeFlexRule) {
      // Flex slot filter: show all players eligible for this slot
      const eligibleSet = new Set(
        activeFlexRule.eligible.map((p) => p.toUpperCase()),
      );
      filteredValues = filteredValues.filter((v) =>
        eligibleSet.has(v.player.position.toUpperCase()),
      );
    } else {
      // Expand consolidated positions (e.g. "DL" → ["EDR", "IL", "DE", "DT"])
      // so granular player positions match the filter.
      const filterPos = searchParams.position.toUpperCase();
      const granularSet = new Set(
        settings?.positionMappings?.[filterPos]?.map((p) => p.toUpperCase())
          ?? [filterPos],
      );
      // Always include the filter position itself (handles identity
      // mappings like LB→LB and non-IDP positions).
      granularSet.add(filterPos);

      filteredValues = filteredValues.filter((v) =>
        granularSet.has(v.player.position.toUpperCase()),
      );
    }
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

  // Capture position-eligible pool (after IDP filter, before user filters)
  // so the dropdown only shows positions that exist in this league type.
  const positionPool = hasIdp
    ? values
    : values.filter((v) => v.player.positionGroup !== "defense");

  // Get unique positions for filter, mapping granular → consolidated
  // when the league uses consolidated IDP (DL/LB/DB instead of
  // EDR/IL/CB/S).
  const reverseMapping =
    settings?.idpStructure === "consolidated"
      ? buildReverseMapping(settings.positionMappings)
      : {};
  const positions = [
    ...new Set(
      positionPool.map(
        (v) => reverseMapping[v.player.position] ?? v.player.position,
      ),
    ),
  ].sort();

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

  // Compute group rank maps (offense / IDP) from full sorted values
  const offenseRankMap = new Map<string, number>();
  const idpRankMap = new Map<string, number>();
  let offenseCounter = 0;
  let idpCounter = 0;
  for (const v of values) {
    if (v.player.positionGroup === "offense") {
      offenseCounter++;
      offenseRankMap.set(v.value.id, offenseCounter);
    } else if (v.player.positionGroup === "defense") {
      idpCounter++;
      idpRankMap.set(v.value.id, idpCounter);
    }
  }

  // Compute flex rank maps from full sorted values
  const flexRankMaps = new Map<string, Map<string, number>>();
  for (const rule of settings?.flexRules ?? []) {
    const eligibleSet = new Set(rule.eligible);
    const rankMap = new Map<string, number>();
    let counter = 0;
    for (const v of values) {
      if (eligibleSet.has(v.player.position)) {
        counter++;
        rankMap.set(v.value.id, counter);
      }
    }
    flexRankMaps.set(rule.slot, rankMap);
  }

  // Extract current valuation mode from settings metadata
  const currentValuationMode =
    ((settings?.metadata as Record<string, unknown> | null)
      ?.valuationMode as string) ?? "auto";

  // Transform values with ownership info for table
  const valuesWithOwnership = sortedValues.map((v) => {
    const ownership = ownershipMap.get(v.player.id);
    return {
      ...v.value,
      player: v.player,
      owner: ownership ? ownership.teamName : null,
      ownerName: ownership ? ownership.ownerName : null,
      isOwnedByCurrentUser: ownership?.teamId === league.userTeamId,
      isFreeAgent: !ownership,
      offenseRank: offenseRankMap.get(v.value.id) ?? null,
      idpRank: idpRankMap.get(v.value.id) ?? null,
      seasonLines: historyMap.get(v.player.id) ?? [],
      consensusAggValue: consensusMap.get(v.player.id) ?? null,
      flexEligibility: (settings?.flexRules ?? [])
        .filter((r) => r.eligible.includes(v.player.position))
        .map((r) => r.slot),
      flexRanks: Object.fromEntries(
        (settings?.flexRules ?? [])
          .filter((r) => r.eligible.includes(v.player.position))
          .map((r): [string, number] => [
            r.slot,
            flexRankMaps.get(r.slot)?.get(v.value.id) ?? 0,
          ])
          .filter(([, rank]) => rank > 0),
      ),
    };
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-3 sm:mb-6">
        <h1 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2">
          Player Rankings
          <HelpTooltip
            text="Players ranked by dynasty value for your league. Values combine market consensus, your league's scoring, age curves, and positional scarcity."
            learnMoreHref="/how-it-works#value-pipeline"
          />
        </h1>
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

      {staleEngine && (
        <StaleEngineRecompute leagueId={league.id} />
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-3 sm:mb-6">
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
            flexRules={settings?.flexRules}
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

        {/* Valuation Emphasis */}
        <ValuationEmphasisControl
          leagueId={league.id}
          currentMode={currentValuationMode}
        />
      </div>

      {/* Rankings Table */}
      <RankingsTable
        values={valuesWithOwnership}
        positionFilter={searchParams.position}
        groupFilter={searchParams.group}
        sortMode={sortMode}
        userTeamId={league.userTeamId}
        flexFilter={activeFlexRule?.slot ?? null}
      />
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
