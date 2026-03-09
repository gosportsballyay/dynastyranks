/**
 * Re-sync draft picks and team names for all leagues (or a specific provider).
 *
 * Use after deploying changes to adapter getDraftPicks() or getTeams() logic.
 * Refreshes team names, deletes existing picks, re-fetches via the updated
 * adapter, and recomputes values.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && \
 *     npx tsx scripts/resync-draft-picks.ts [--provider sleeper]
 */

import { db } from "../lib/db/client";
import { leagues, teams, draftPicks } from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  createSleeperAdapter,
  createFleaflickerAdapter,
  createESPNAdapter,
} from "../lib/adapters";
import { computeUnifiedValues } from "../lib/value-engine/compute-unified";
import type { Provider, LeagueProviderAdapter } from "../types";

async function main() {
  const providerFilter = process.argv.includes("--provider")
    ? process.argv[process.argv.indexOf("--provider") + 1]
    : null;

  const allLeagues = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      provider: leagues.provider,
      externalLeagueId: leagues.externalLeagueId,
      season: leagues.season,
    })
    .from(leagues);

  const filtered = providerFilter
    ? allLeagues.filter((l) => l.provider === providerFilter)
    : allLeagues;

  console.log(
    `Re-syncing draft picks for ${filtered.length} leagues` +
      (providerFilter ? ` (${providerFilter} only)` : "") +
      "...\n",
  );

  let success = 0;
  let failed = 0;

  for (const league of filtered) {
    const label = `${league.name} (${league.provider})`;
    try {
      // Create adapter
      const adapter = createAdapter(
        league.provider as Provider,
        league.season,
      );
      if (!adapter) {
        console.log(`  SKIP ${label} — no adapter`);
        continue;
      }

      // Build team ID mapping (external → internal)
      const leagueTeams = await db
        .select({
          id: teams.id,
          externalTeamId: teams.externalTeamId,
        })
        .from(teams)
        .where(eq(teams.leagueId, league.id));

      const teamIdMap = new Map<string, string>();
      for (const t of leagueTeams) {
        teamIdMap.set(t.externalTeamId, t.id);
      }

      // Refresh team names from the provider
      const freshTeams = await adapter.getTeams(
        league.externalLeagueId,
      );
      for (const ft of freshTeams) {
        const internalId = teamIdMap.get(ft.externalTeamId);
        if (internalId) {
          await db
            .update(teams)
            .set({
              teamName: ft.teamName,
              ownerName: ft.ownerName,
              wins: ft.wins,
              losses: ft.losses,
              ties: ft.ties,
              totalPoints: ft.totalPoints,
            })
            .where(
              and(
                eq(teams.id, internalId),
                eq(teams.leagueId, league.id),
              ),
            );
        }
      }

      // Delete existing picks
      await db
        .delete(draftPicks)
        .where(eq(draftPicks.leagueId, league.id));

      // Fetch new picks via updated adapter
      const adapterPicks = await adapter.getDraftPicks(
        league.externalLeagueId,
      );

      // Insert new picks
      if (adapterPicks.length > 0) {
        const validPicks = adapterPicks.filter((p) => {
          const teamId = teamIdMap.get(p.ownerTeamExternalId);
          if (!teamId) {
            console.warn(
              `    WARN: unknown team ${p.ownerTeamExternalId}`,
            );
            return false;
          }
          return true;
        });

        if (validPicks.length > 0) {
          await db.insert(draftPicks).values(
            validPicks.map((p) => ({
              leagueId: league.id,
              ownerTeamId: teamIdMap.get(p.ownerTeamExternalId)!,
              originalTeamId: p.originalTeamExternalId
                ? teamIdMap.get(p.originalTeamExternalId) ?? null
                : null,
              season: p.season,
              round: p.round,
              pickNumber: p.pickNumber,
              projectedPickNumber: p.projectedPickNumber,
            })),
          );
        }
      }

      // Recompute values (pick values are computed on-the-fly
      // on team page, but recompute ensures consistency)
      await computeUnifiedValues(league.id);

      console.log(
        `  OK  ${label} — ${adapterPicks.length} picks`,
      );
      success++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ERR ${label} — ${msg}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${success} succeeded, ${failed} failed ` +
      `out of ${filtered.length} leagues.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

function createAdapter(
  provider: Provider,
  season?: number,
): LeagueProviderAdapter | null {
  switch (provider) {
    case "sleeper":
      // Username is only needed for getUserLeagues(), not
      // getDraftPicks(). Pass placeholder since we already
      // have the league ID.
      return createSleeperAdapter("_resync");
    case "fleaflicker":
      return createFleaflickerAdapter();
    case "espn":
      return createESPNAdapter({ season });
    case "yahoo":
      // Yahoo needs OAuth — skip in batch script
      return null;
    default:
      return null;
  }
}

main();
