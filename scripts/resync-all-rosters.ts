/**
 * Re-sync rosters for all leagues (or a specific provider).
 *
 * Use after deploying changes to adapter getRosters() logic that
 * affect slot positions or roster structure.
 *
 * Deletes existing roster rows, re-fetches from provider via the
 * updated adapter, re-maps players, and inserts fresh roster data.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs) && \
 *     npx tsx scripts/resync-all-rosters.ts [--provider sleeper]
 */

import { db } from "../lib/db/client";
import { leagues, teams, rosters } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createSleeperAdapter,
  createFleaflickerAdapter,
  createESPNAdapter,
} from "../lib/adapters";
import { getPlayersByProviderIds } from "../lib/player-mapping";
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
    })
    .from(leagues);

  const filtered = providerFilter
    ? allLeagues.filter((l) => l.provider === providerFilter)
    : allLeagues;

  console.log(
    `Re-syncing rosters for ${filtered.length} leagues` +
      (providerFilter ? ` (${providerFilter} only)` : "") +
      "...\n",
  );

  let success = 0;
  let failed = 0;

  for (const league of filtered) {
    const label = `${league.name} (${league.provider})`;
    try {
      const adapter = createAdapter(league.provider as Provider);
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

      // Re-fetch rosters via updated adapter (before deleting, so
      // a fetch failure doesn't leave the league with no roster data)
      const adapterPlayers = await adapter.getRosters(
        league.externalLeagueId,
      );

      // Map external player IDs to canonical players
      const externalPlayerIds = adapterPlayers.map(
        (p) => p.externalPlayerId,
      );
      const playerInfoMap = new Map<
        string,
        { name: string; position: string }
      >();
      for (const p of adapterPlayers) {
        playerInfoMap.set(p.externalPlayerId, {
          name: p.playerName || "",
          position: p.playerPosition || "",
        });
      }
      const playerMap = await getPlayersByProviderIds(
        league.provider as Provider,
        externalPlayerIds,
        playerInfoMap,
      );

      // Filter out players whose teamExternalId doesn't map to a
      // known team (e.g. free agents or unknown external IDs)
      const mappedPlayers = adapterPlayers.filter((p) => {
        if (!teamIdMap.has(p.teamExternalId)) {
          console.warn(
            `    WARN: player ${p.externalPlayerId} ` +
              `(${p.playerName}) has unmapped team ` +
              `"${p.teamExternalId}" — skipping`,
          );
          return false;
        }
        return true;
      });

      // Delete + insert in a transaction so roster data is never
      // in a half-deleted state
      await db.transaction(async (tx) => {
        for (const t of leagueTeams) {
          await tx.delete(rosters).where(eq(rosters.teamId, t.id));
        }

        if (mappedPlayers.length > 0) {
          await tx.insert(rosters).values(
            mappedPlayers.map((p) => {
              const teamId = teamIdMap.get(p.teamExternalId)!;
              const canonicalPlayer = playerMap.get(
                p.externalPlayerId,
              );
              return {
                teamId,
                canonicalPlayerId: canonicalPlayer?.id || null,
                externalPlayerId: p.externalPlayerId,
                slotPosition: p.slotPosition,
                playerName: p.playerName,
                playerPosition: p.playerPosition,
              };
            }),
          );
        }
      });

      console.log(
        `  OK  ${label} — ${adapterPlayers.length} players`,
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
): LeagueProviderAdapter | null {
  switch (provider) {
    case "sleeper":
      return createSleeperAdapter("_resync");
    case "fleaflicker":
      return createFleaflickerAdapter();
    case "espn":
      // ESPN needs cookies — skip in batch script
      return null;
    case "yahoo":
      // Yahoo needs OAuth — skip in batch script
      return null;
    default:
      return null;
  }
}

main();
