/**
 * BFS crawler for Sleeper IDP league configurations.
 *
 * Starting from synced leagues in the DB, crawls through league
 * members' other leagues to build a large sample of IDP roster
 * and scoring settings. Outputs pre-aggregated JSON for the
 * /idp-trends page.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs)
 *   npx tsx scripts/crawl-sleeper-idp.ts [options]
 *
 * Options:
 *   --depth N        BFS depth (default: 2)
 *   --max-leagues N  Stop after N unique leagues (default: 5000)
 *   --delay N        ms between API calls (default: 150)
 */

import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { IdpTrendsData } from "../lib/types/idp-trends";

// --------------- Sleeper API types ---------------

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  settings: {
    type: number; // 0=redraft, 1=keeper, 2=dynasty
    num_teams: number;
    taxi_slots?: number;
    reserve_slots?: number;
  };
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  previous_league_id: string | null;
}

interface SleeperRoster {
  owner_id: string | null;
  co_owners: string[] | null;
}

interface IDPLeagueRecord {
  leagueId: string;
  name: string;
  teamCount: number;
  isDynasty: boolean;
  rosterPositionCounts: Record<string, number>;
  idpSlots: number;
  idpStructure: "consolidated" | "granular" | "mixed";
  hasIdpFlex: boolean;
  idpFlexCount: number;
  hasSuperFlex: boolean;
  hasTEP: boolean;
  offensiveStarters: number;
  benchSlots: number;
  taxiSlots: number;
  scoringSettings: Record<string, number>;
  idpScoring: Record<string, number>;
  discoveredAtDepth: number;
}

// --------------- Constants ---------------

const IDP_POSITIONS = new Set([
  "DL", "LB", "DB", "IDP_FLEX",
  "DE", "DT", "CB", "S", "EDR", "IL",
]);

const OFFENSIVE_POSITIONS = new Set([
  "QB", "RB", "WR", "TE", "K",
  "FLEX", "SUPER_FLEX", "REC_FLEX", "WRRB_FLEX",
]);

// Sleeper uses idp_ prefix for IDP scoring keys
const IDP_SCORING_KEYS: Record<string, string> = {
  idp_tkl_solo: "Solo Tackle",
  idp_tkl_ast: "Assisted Tackle",
  idp_tkl: "Total Tackle",
  idp_sack: "Sack",
  idp_int: "Interception",
  idp_ff: "Forced Fumble",
  idp_fum_rec: "Fumble Recovery",
  idp_pass_def: "Pass Defended",
  idp_safe: "Safety",
  idp_def_td: "Defensive TD",
  idp_blk_kick: "Blocked Kick",
  idp_tkl_loss: "Tackle for Loss",
  idp_qb_hit: "QB Hit",
};

// --------------- CLI args ---------------

function parseArgs(): {
  depth: number;
  maxLeagues: number;
  delay: number;
} {
  const args = process.argv.slice(2);
  let depth = 2;
  let maxLeagues = 5000;
  let delay = 150;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--depth" && args[i + 1]) {
      depth = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--max-leagues" && args[i + 1]) {
      maxLeagues = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--delay" && args[i + 1]) {
      delay = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { depth, maxLeagues, delay };
}

// --------------- Fetch with rate limiting ---------------

let lastFetch = 0;
let delayMs = 150;
let requestCount = 0;

async function fetchJson<T>(url: string): Promise<T | null> {
  const now = Date.now();
  const wait = Math.max(0, delayMs - (now - lastFetch));
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; attempt < 4; attempt++) {
    lastFetch = Date.now();
    requestCount++;

    try {
      const res = await fetch(url);

      if (res.status === 404) return null;

      if (res.status === 429 || res.status >= 500) {
        const backoff = 1000 * Math.pow(2, attempt);
        console.warn(
          `  [${res.status}] ${url} — retrying in ${backoff}ms`
        );
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        console.warn(`  [${res.status}] ${url} — skipping`);
        return null;
      }

      return (await res.json()) as T;
    } catch (err) {
      const backoff = 1000 * Math.pow(2, attempt);
      console.warn(
        `  Fetch error: ${(err as Error).message} — retrying in ${backoff}ms`
      );
      await sleep(backoff);
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --------------- IDP classification ---------------

function classifyIdp(
  positions: string[]
): {
  isIdp: boolean;
  idpSlots: number;
  structure: "consolidated" | "granular" | "mixed";
  hasIdpFlex: boolean;
  idpFlexCount: number;
} {
  const counts: Record<string, number> = {};
  for (const p of positions) {
    if (IDP_POSITIONS.has(p)) {
      counts[p] = (counts[p] ?? 0) + 1;
    }
  }

  const idpSlots = Object.values(counts).reduce(
    (a, b) => a + b,
    0
  );
  if (idpSlots === 0) {
    return {
      isIdp: false,
      idpSlots: 0,
      structure: "consolidated",
      hasIdpFlex: false,
      idpFlexCount: 0,
    };
  }

  const hasConsolidated =
    (counts["DL"] ?? 0) > 0 ||
    (counts["LB"] ?? 0) > 0 ||
    (counts["DB"] ?? 0) > 0;
  const hasGranular =
    (counts["DE"] ?? 0) > 0 ||
    (counts["DT"] ?? 0) > 0 ||
    (counts["CB"] ?? 0) > 0 ||
    (counts["S"] ?? 0) > 0 ||
    (counts["EDR"] ?? 0) > 0 ||
    (counts["IL"] ?? 0) > 0;

  let structure: "consolidated" | "granular" | "mixed" =
    "consolidated";
  if (hasConsolidated && hasGranular) structure = "mixed";
  else if (hasGranular) structure = "granular";

  return {
    isIdp: true,
    idpSlots,
    structure,
    hasIdpFlex: (counts["IDP_FLEX"] ?? 0) > 0,
    idpFlexCount: counts["IDP_FLEX"] ?? 0,
  };
}

function extractIdpScoring(
  scoring: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(IDP_SCORING_KEYS)) {
    if (scoring[key] !== undefined) {
      result[key] = scoring[key];
    }
  }
  // Also check common Sleeper variants
  if (scoring["tkl_solo"] === undefined && scoring["tackle_solo"] !== undefined) {
    result["tkl_solo"] = scoring["tackle_solo"];
  }
  if (scoring["tkl_ast"] === undefined && scoring["tackle_ast"] !== undefined) {
    result["tkl_ast"] = scoring["tackle_ast"];
  }
  return result;
}

// --------------- Seed loader ---------------

async function loadSeedLeagues(): Promise<string[]> {
  const rows = await db
    .select({ externalId: leagues.externalLeagueId })
    .from(leagues)
    .where(eq(leagues.provider, "sleeper"));

  const ids = [...new Set(rows.map((r) => r.externalId))];
  console.log(`Loaded ${ids.length} seed leagues from DB`);
  return ids;
}

// --------------- BFS crawler ---------------

async function crawlBFS(
  seeds: string[],
  opts: { depth: number; maxLeagues: number }
): Promise<{ records: IDPLeagueRecord[]; totalSeen: number }> {
  const seenLeagues = new Set<string>(); // leagues we've recorded data for
  const rostersFetched = new Set<string>(); // leagues we've fetched rosters from
  const seenUsers = new Set<string>();
  const records: IDPLeagueRecord[] = [];

  // Queue: league IDs per depth level
  let currentQueue = [...seeds];

  for (let d = 0; d <= opts.depth; d++) {
    if (currentQueue.length === 0) break;
    if (records.length >= opts.maxLeagues) break;

    console.log(
      `\n--- Depth ${d}: ${currentQueue.length} leagues to process ---`
    );

    const nextQueue: string[] = [];
    const newUsersThisDepth: string[] = [];

    // Step 1: Get owners from all leagues at this depth
    for (const leagueId of currentQueue) {
      if (rostersFetched.has(leagueId)) continue;
      rostersFetched.add(leagueId);

      const rosters = await fetchJson<SleeperRoster[]>(
        `https://api.sleeper.app/v1/league/${leagueId}/rosters`
      );
      if (!rosters) continue;

      for (const r of rosters) {
        if (r.owner_id && !seenUsers.has(r.owner_id)) {
          seenUsers.add(r.owner_id);
          newUsersThisDepth.push(r.owner_id);
        }
        if (r.co_owners) {
          for (const co of r.co_owners) {
            if (!seenUsers.has(co)) {
              seenUsers.add(co);
              newUsersThisDepth.push(co);
            }
          }
        }
      }
    }

    console.log(
      `  Found ${newUsersThisDepth.length} new users at depth ${d}`
    );

    // Step 2: Fetch leagues for each new user
    let userIdx = 0;
    for (const userId of newUsersThisDepth) {
      if (records.length >= opts.maxLeagues) break;
      userIdx++;

      if (userIdx % 50 === 0) {
        console.log(
          `  Processing user ${userIdx}/${newUsersThisDepth.length}` +
            ` | ${records.length} IDP leagues found` +
            ` | ${seenLeagues.size} total seen` +
            ` | ${requestCount} API calls`
        );
      }

      const userLeagues = await fetchJson<SleeperLeagueRaw[]>(
        `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/2025`
      );
      if (!userLeagues) continue;

      for (const league of userLeagues) {
        if (seenLeagues.has(league.league_id)) continue;
        seenLeagues.add(league.league_id);

        if (!league.roster_positions) continue;

        const idpInfo = classifyIdp(league.roster_positions);

        if (idpInfo.isIdp) {
          const posCounts: Record<string, number> = {};
          for (const p of league.roster_positions) {
            posCounts[p] = (posCounts[p] ?? 0) + 1;
          }

          const offStarters = league.roster_positions.filter(
            (p) => OFFENSIVE_POSITIONS.has(p)
          ).length;

          const benchSlots = posCounts["BN"] ?? 0;
          const isDynasty = league.settings.type === 2;
          const hasSuperFlex =
            (posCounts["SUPER_FLEX"] ?? 0) > 0;
          const hasTEP =
            (league.scoring_settings?.bonus_rec_te ?? 0) > 0 ||
            (league.scoring_settings?.rec_te ?? 0) >
              (league.scoring_settings?.rec ?? 0);

          records.push({
            leagueId: league.league_id,
            name: league.name,
            teamCount: league.settings.num_teams,
            isDynasty,
            rosterPositionCounts: posCounts,
            idpSlots: idpInfo.idpSlots,
            idpStructure: idpInfo.structure,
            hasIdpFlex: idpInfo.hasIdpFlex,
            idpFlexCount: idpInfo.idpFlexCount,
            hasSuperFlex,
            hasTEP,
            offensiveStarters: offStarters,
            benchSlots,
            taxiSlots: league.settings.taxi_slots ?? 0,
            scoringSettings: league.scoring_settings ?? {},
            idpScoring: extractIdpScoring(
              league.scoring_settings ?? {}
            ),
            discoveredAtDepth: d,
          });

          // Only dynasty leagues expand the BFS
          if (isDynasty) {
            nextQueue.push(league.league_id);
          }
        }
      }
    }

    console.log(
      `  Depth ${d} complete: ${records.length} IDP leagues total`
    );
    currentQueue = nextQueue;
  }

  return { records, totalSeen: seenLeagues.size };
}

// --------------- Aggregation ---------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mode(values: number[]): number {
  const freq = new Map<number, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of freq) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function aggregateToTrends(
  records: IDPLeagueRecord[],
  totalSeen: number
): IdpTrendsData {
  const n = records.length;
  const dynastyCount = records.filter((r) => r.isDynasty).length;
  const redraftRecords = records.filter((r) => !r.isDynasty);

  // Starter distribution
  const idpSlotValues = records.map((r) => r.idpSlots).sort(
    (a, b) => a - b
  );
  const slotFreq = new Map<number, number>();
  for (const s of idpSlotValues) {
    slotFreq.set(s, (slotFreq.get(s) ?? 0) + 1);
  }
  const starterDistribution = [...slotFreq.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idpSlots, count]) => ({
      idpSlots,
      count,
      pct: round1((count / n) * 100),
    }));

  // Scoring distributions
  const scoringDistributions = buildScoringDistributions(records);

  // Top roster configs
  const configFreq = new Map<string, { idpSlots: number; count: number }>();
  for (const r of records) {
    const idpParts: string[] = [];
    const sorted = Object.entries(r.rosterPositionCounts)
      .filter(([pos]) => IDP_POSITIONS.has(pos))
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [pos, cnt] of sorted) {
      idpParts.push(`${pos}:${cnt}`);
    }
    const config = idpParts.join(" ");
    const existing = configFreq.get(config);
    if (existing) {
      existing.count++;
    } else {
      configFreq.set(config, { idpSlots: r.idpSlots, count: 1 });
    }
  }
  const topRosterConfigs = [...configFreq.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([config, { idpSlots, count }]) => ({
      config,
      idpSlots,
      count,
      pct: round1((count / n) * 100),
    }));

  // Cross-tabs: by league size
  const sizeGroups = new Map<
    number,
    { idpStarters: number[] }
  >();
  for (const r of records) {
    const g = sizeGroups.get(r.teamCount) ?? {
      idpStarters: [],
    };
    g.idpStarters.push(r.idpSlots);
    sizeGroups.set(r.teamCount, g);
  }
  const byLeagueSize = [...sizeGroups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamCount, g]) => {
      const sorted = [...g.idpStarters].sort((a, b) => a - b);
      return {
        teamCount,
        leagueCount: g.idpStarters.length,
        avgIdpStarters: round1(avg(g.idpStarters)),
        medianIdpStarters: percentile(sorted, 50),
      };
    });

  // Dynasty vs redraft
  const dynastyRecords = records.filter((r) => r.isDynasty);
  const dynastyVsRedraft = {
    dynasty: {
      count: dynastyRecords.length,
      avgIdpStarters: round1(
        avg(dynastyRecords.map((r) => r.idpSlots))
      ),
      pctWithIdpFlex: round1(
        (dynastyRecords.filter((r) => r.hasIdpFlex).length /
          Math.max(dynastyRecords.length, 1)) *
          100
      ),
    },
    redraft: {
      count: redraftRecords.length,
      avgIdpStarters: round1(
        avg(redraftRecords.map((r) => r.idpSlots))
      ),
      pctWithIdpFlex: round1(
        (redraftRecords.filter((r) => r.hasIdpFlex).length /
          Math.max(redraftRecords.length, 1)) *
          100
      ),
    },
  };

  // SuperFlex correlation
  const sfRecords = records.filter((r) => r.hasSuperFlex);
  const nonSfRecords = records.filter((r) => !r.hasSuperFlex);
  const superFlexCorrelation = {
    superFlex: {
      count: sfRecords.length,
      avgIdpStarters: round1(
        avg(sfRecords.map((r) => r.idpSlots))
      ),
    },
    nonSuperFlex: {
      count: nonSfRecords.length,
      avgIdpStarters: round1(
        avg(nonSfRecords.map((r) => r.idpSlots))
      ),
    },
  };

  // TEP correlation
  const tepRecords = records.filter((r) => r.hasTEP);
  const nonTepRecords = records.filter((r) => !r.hasTEP);
  const tepCorrelation = {
    tep: {
      count: tepRecords.length,
      avgIdpStarters: round1(
        avg(tepRecords.map((r) => r.idpSlots))
      ),
    },
    nonTep: {
      count: nonTepRecords.length,
      avgIdpStarters: round1(
        avg(nonTepRecords.map((r) => r.idpSlots))
      ),
    },
  };

  const totalStarters = records.map(
    (r) => r.offensiveStarters + r.idpSlots
  );
  const sortedTotalStarters = [...totalStarters].sort(
    (a, b) => a - b
  );

  const flexCount = records.filter((r) => r.hasIdpFlex).length;

  return {
    meta: {
      lastUpdated: new Date().toISOString().split("T")[0],
      totalLeaguesCrawled: totalSeen,
      idpLeaguesFound: n,
      idpPct: round1((n / Math.max(totalSeen, 1)) * 100),
      dynastyPct: round1(
        (dynastyCount / Math.max(n, 1)) * 100
      ),
      season: 2025,
    },
    highlights: {
      medianIdpStarters: percentile(idpSlotValues, 50),
      mostCommonIdpCount: mode(idpSlotValues),
      pctWithIdpFlex: round1((flexCount / Math.max(n, 1)) * 100),
      medianTotalStarters: percentile(sortedTotalStarters, 50),
      avgBenchSlots: round1(
        avg(records.map((r) => r.benchSlots))
      ),
      pctSuperFlex: round1(
        (sfRecords.length / Math.max(n, 1)) * 100
      ),
    },
    starterDistribution,
    scoringDistributions,
    topRosterConfigs,
    crossTabs: {
      byLeagueSize,
      dynastyVsRedraft,
      superFlexCorrelation,
      tepCorrelation,
    },
  };
}

function buildScoringDistributions(
  records: IDPLeagueRecord[]
): IdpTrendsData["scoringDistributions"] {
  const statValues = new Map<string, number[]>();

  for (const r of records) {
    for (const [key, val] of Object.entries(r.idpScoring)) {
      const arr = statValues.get(key) ?? [];
      arr.push(val);
      statValues.set(key, arr);
    }
  }

  // Only include stats present in >10% of leagues
  const minCount = Math.max(records.length * 0.1, 5);

  return [...statValues.entries()]
    .filter(([, vals]) => vals.length >= minCount)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([stat, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const modeVal = mode(vals);
      const modeCount = vals.filter((v) => v === modeVal).length;

      return {
        stat,
        label: IDP_SCORING_KEYS[stat] ?? stat,
        min: sorted[0],
        p25: round2(percentile(sorted, 25)),
        median: round2(percentile(sorted, 50)),
        p75: round2(percentile(sorted, 75)),
        max: sorted[sorted.length - 1],
        mostCommon: modeVal,
        mostCommonPct: round1(
          (modeCount / vals.length) * 100
        ),
      };
    });
}

// --------------- Console summary ---------------

function printSummary(data: IdpTrendsData): void {
  console.log("\n========================================");
  console.log("  IDP League Trends — Summary");
  console.log("========================================\n");
  console.log(
    `Total crawled: ${data.meta.totalLeaguesCrawled}`
  );
  console.log(
    `IDP leagues:   ${data.meta.idpLeaguesFound} (${data.meta.idpPct}%)`
  );
  console.log(
    `Dynasty:       ${data.meta.dynastyPct}% of IDP leagues`
  );
  console.log(
    `Median IDP starters: ${data.highlights.medianIdpStarters}`
  );
  console.log(
    `Most common:   ${data.highlights.mostCommonIdpCount} IDP slots`
  );
  console.log(
    `IDP_FLEX:      ${data.highlights.pctWithIdpFlex}%`
  );
  console.log(
    `SuperFlex+IDP: ${data.highlights.pctSuperFlex}%`
  );

  console.log("\n--- Starter Distribution ---");
  for (const d of data.starterDistribution) {
    const bar = "#".repeat(
      Math.round(d.pct / 2)
    );
    console.log(
      `  ${String(d.idpSlots).padStart(2)} slots: ${bar} ${d.count} (${d.pct}%)`
    );
  }

  console.log("\n--- Top Roster Configs ---");
  for (const c of data.topRosterConfigs.slice(0, 10)) {
    console.log(
      `  ${c.config.padEnd(35)} ${c.count} (${c.pct}%)`
    );
  }

  if (data.scoringDistributions.length > 0) {
    console.log("\n--- Scoring Settings ---");
    for (const s of data.scoringDistributions) {
      console.log(
        `  ${s.label.padEnd(20)} median=${s.median} mode=${s.mostCommon} range=[${s.min}, ${s.max}]`
      );
    }
  }
}

// --------------- Main ---------------

async function main(): Promise<void> {
  const opts = parseArgs();
  delayMs = opts.delay;

  console.log(
    `Crawl config: depth=${opts.depth}, max=${opts.maxLeagues}, delay=${opts.delay}ms`
  );

  const seeds = await loadSeedLeagues();
  if (seeds.length === 0) {
    console.error(
      "No Sleeper leagues found in DB. Connect some leagues first."
    );
    process.exit(1);
  }

  const { records, totalSeen } = await crawlBFS(seeds, opts);

  console.log(
    `\nCrawl complete: ${records.length} IDP leagues from ` +
    `${totalSeen} total leagues, ${requestCount} API calls`
  );

  // Write raw data
  const rawPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../data/idp-research-raw.json"
  );
  writeFileSync(rawPath, JSON.stringify(records, null, 2));
  console.log(`Raw data written to ${rawPath}`);

  const trends = aggregateToTrends(records, totalSeen);
  const trendsPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../data/idp-trends.json"
  );
  writeFileSync(trendsPath, JSON.stringify(trends, null, 2));
  console.log(`Trends data written to ${trendsPath}`);

  printSummary(trends);

  process.exit(0);
}

main();
