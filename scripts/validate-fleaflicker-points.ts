#!/usr/bin/env npx tsx
/**
 * Validate Fleaflicker Points
 *
 * Compares our calculated fantasy points (from Sleeper stats + Fleaflicker
 * scoring rules) against Fleaflicker's own viewingActualPoints.
 *
 * This validates that using Sleeper as the stat source produces accurate
 * fantasy point calculations for Fleaflicker leagues.
 *
 * Usage:
 *   npx tsx scripts/validate-fleaflicker-points.ts [--league-id <id>]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { scoreGame, type ScoringRule } from "../lib/value-engine/vorp";
import { normalizeStatKeys } from "../lib/stats/canonical-keys";

const FLEAFLICKER_API = "https://www.fleaflicker.com/api";
const RATE_LIMIT_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFleaflicker<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  await sleep(RATE_LIMIT_MS);
  const url = new URL(`${FLEAFLICKER_API}/${endpoint}`);
  url.searchParams.set("sport", "NFL");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "MyDynastyValues/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Fleaflicker API ${response.status}: ${url}`,
    );
  }
  return response.json();
}

interface FfTeam {
  id: number;
  name: string;
}

interface FfRosterSlot {
  position: { label: string; group: string };
  leaguePlayer?: {
    proPlayer: {
      id: number;
      nameFull?: string;
      position?: string;
    };
    viewingActualPoints?: {
      value?: number;
      formatted?: string;
    };
  };
}

interface FfRosterResponse {
  groups: Array<{ slots: FfRosterSlot[] }>;
}

interface FfStandings {
  divisions: Array<{ teams: FfTeam[] }>;
}

async function main() {
  const args = process.argv.slice(2);
  const leagueIdArg = args.indexOf("--league-id");
  const targetLeagueId =
    leagueIdArg !== -1 ? args[leagueIdArg + 1] : null;

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  // Get Fleaflicker leagues
  let leagues;
  if (targetLeagueId) {
    leagues = await db
      .select()
      .from(schema.leagues)
      .where(
        and(
          eq(schema.leagues.id, targetLeagueId),
          eq(schema.leagues.provider, "fleaflicker"),
        ),
      );
  } else {
    leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.provider, "fleaflicker"));
  }

  if (leagues.length === 0) {
    console.error("No Fleaflicker leagues found");
    process.exit(1);
  }

  for (const league of leagues) {
    console.log("=".repeat(70));
    console.log(
      `League: ${league.name} ` +
        `(ext: ${league.externalLeagueId})`,
    );
    console.log("=".repeat(70));

    // Get league settings for structuredRules
    const [settings] = await db
      .select()
      .from(schema.leagueSettings)
      .where(
        eq(schema.leagueSettings.leagueId, league.id),
      )
      .limit(1);

    if (!settings) {
      console.log("  No settings found, skipping");
      continue;
    }

    const structuredRules =
      (settings.structuredRules as ScoringRule[] | null) ??
      null;

    if (!structuredRules) {
      console.log("  No structuredRules, skipping");
      continue;
    }

    // Get teams from Fleaflicker API
    const standings =
      await fetchFleaflicker<FfStandings>(
        "FetchLeagueStandings",
        {
          league_id: league.externalLeagueId,
          season: league.season.toString(),
        },
      );

    const teams: FfTeam[] = [];
    for (const div of standings.divisions) {
      teams.push(...div.teams);
    }

    // Build player lookup: fleaflickerId -> canonical (primary),
    // name+position -> canonical (fallback)
    const canonicalPlayers = await db
      .select({
        id: schema.canonicalPlayers.id,
        fleaflickerId:
          schema.canonicalPlayers.fleaflickerId,
        name: schema.canonicalPlayers.name,
        position: schema.canonicalPlayers.position,
      })
      .from(schema.canonicalPlayers);

    const ffIdToCanonical = new Map<
      string,
      {
        id: string;
        name: string;
        position: string;
      }
    >();
    const nameToCanonical = new Map<
      string,
      {
        id: string;
        name: string;
        position: string;
      }
    >();
    for (const p of canonicalPlayers) {
      if (p.fleaflickerId) {
        ffIdToCanonical.set(p.fleaflickerId, {
          id: p.id,
          name: p.name,
          position: p.position,
        });
      }
      // Name-based fallback (normalized lowercase)
      const key = p.name.toLowerCase().trim();
      nameToCanonical.set(key, {
        id: p.id,
        name: p.name,
        position: p.position,
      });
    }

    // Load historical stats with gameLogs.
    // Leagues are set to current season (2026) but the most recent
    // completed season with stats is 2025.
    const statsSeason = league.season - 1;
    console.log(`  Loading stats for season ${statsSeason}`);
    const histStats = await db
      .select()
      .from(schema.historicalStats)
      .where(
        eq(schema.historicalStats.season, statsSeason),
      );

    const statsByCanonicalId = new Map<
      string,
      (typeof histStats)[0]
    >();
    for (const row of histStats) {
      statsByCanonicalId.set(row.canonicalPlayerId, row);
    }

    // Debug: show lookup sizes
    console.log(
      `  Rules: ${structuredRules.length}, ` +
        `ffId map: ${ffIdToCanonical.size}, ` +
        `name map: ${nameToCanonical.size}, ` +
        `hist: ${statsByCanonicalId.size}, ` +
        `teams: ${teams.length}`,
    );
    const withGL = [...statsByCanonicalId.values()]
      .filter((s) => s.gameLogs).length;
    console.log(`  histStats with gameLogs: ${withGL}`);

    // Compare points for weeks 1-18
    let totalComparisons = 0;
    let totalMatches = 0;
    let totalMismatches = 0;
    const discrepancies: Array<{
      name: string;
      pos: string;
      week: number;
      ffPts: number;
      ourPts: number;
      diff: number;
    }> = [];

    const weeksToCheck = [1, 5, 10, 15, 18]; // Sample weeks

    for (const week of weeksToCheck) {
      console.log(`\n  Week ${week}:`);

      for (const team of teams.slice(0, 3)) {
        // Sample 3 teams per week
        let rosterResp: FfRosterResponse;
        try {
          rosterResp =
            await fetchFleaflicker<FfRosterResponse>(
              "FetchRoster",
              {
                league_id: league.externalLeagueId,
                team_id: team.id.toString(),
                scoring_period: week.toString(),
                season: league.season.toString(),
              },
            );
        } catch {
          continue;
        }

        let slotCount = 0;
        let ptsCount = 0;
        let matchCount = 0;
        let glCount = 0;
        for (const group of rosterResp.groups || []) {
          for (const slot of group.slots || []) {
            const lp = slot.leaguePlayer;
            if (!lp?.proPlayer) continue;
            slotCount++;

            const ffPts =
              lp.viewingActualPoints?.value;
            if (ffPts === undefined || ffPts === null)
              continue;
            ptsCount++;

            const ffId =
              lp.proPlayer.id.toString();
            let canonical =
              ffIdToCanonical.get(ffId);
            // Fallback: name-based matching
            if (!canonical && lp.proPlayer.nameFull) {
              const nameKey = lp.proPlayer.nameFull
                .toLowerCase()
                .trim();
              canonical = nameToCanonical.get(nameKey);
            }
            if (!canonical) continue;
            matchCount++;

            const hist = statsByCanonicalId.get(
              canonical.id,
            );
            if (!hist) continue;

            const gameLogs = hist.gameLogs as Record<
              number,
              Record<string, number>
            > | null;
            const weekStats = gameLogs?.[week];
            if (!weekStats) continue;
            glCount++;

            // Score with our engine
            const ourPts = scoreGame(
              weekStats,
              structuredRules,
              canonical.position,
            );
            const diff = Math.abs(ffPts - ourPts);

            totalComparisons++;
            if (diff < 0.5) {
              totalMatches++;
            } else {
              totalMismatches++;
              discrepancies.push({
                name: canonical.name,
                pos: canonical.position,
                week,
                ffPts,
                ourPts,
                diff,
              });
            }
          }
        }
        console.log(
          `    ${team.name}: slots=${slotCount} ` +
            `pts=${ptsCount} match=${matchCount} ` +
            `gl=${glCount}`,
        );
      }
    }

    // Report
    console.log("\n  " + "-".repeat(60));
    console.log("  VALIDATION RESULTS:");
    console.log(
      `  Total comparisons: ${totalComparisons}`,
    );
    console.log(
      `  Matches (<0.5 diff): ${totalMatches}`,
    );
    console.log(
      `  Mismatches (>=0.5):  ${totalMismatches}`,
    );

    if (totalComparisons > 0) {
      const accuracy =
        ((totalMatches / totalComparisons) * 100).toFixed(
          1,
        );
      console.log(`  Accuracy: ${accuracy}%`);
    }

    if (discrepancies.length > 0) {
      console.log("\n  Discrepancies:");
      discrepancies
        .sort((a, b) => b.diff - a.diff)
        .slice(0, 20)
        .forEach((d) => {
          console.log(
            `    ${d.name} (${d.pos}) wk${d.week}: ` +
              `FF=${d.ffPts.toFixed(1)} ` +
              `ours=${d.ourPts.toFixed(1)} ` +
              `diff=${d.diff.toFixed(1)}`,
          );
        });
    }
  }

  console.log("\nDone");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
