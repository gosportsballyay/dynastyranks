/**
 * IDP Show Impact Simulation
 *
 * Dry-run script that simulates adding IDP Show as a consensus
 * source (~20% weight) without modifying the database. Parses the
 * IDP Show CSV, matches players to canonical DB, re-blends
 * consensus with proposed weights, and outputs before/after
 * comparison for each synced league.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs)
 *   npx tsx scripts/simulate-idpshow-impact.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, like, and, inArray } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { computeBlendWeights } from "../lib/value-engine/blend";
import { computeFormatComplexity } from
  "../lib/value-engine/format-complexity";
import {
  computeIdpSignalDiscount,
  computeIdpTieredDiscount,
  computeIdpLiquidityPenalty,
} from "../lib/value-engine/compute-unified";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ── Position mapping (IDP Show → canonical) ──────────────────────
const POSITION_MAP: Record<string, string> = {
  ED: "EDR",
  IDL: "IL",
  LB: "LB",
  CB: "CB",
  S: "S",
};

// ── IDP position set ─────────────────────────────────────────────
const IDP_POSITIONS = new Set([
  "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
]);

// ── IDP position groups for cross-source matching ────────────────
const IDP_POSITION_GROUPS: Record<string, string> = {
  cb: "db", s: "db", db: "db",
  edr: "dl", il: "dl", de: "dl", dt: "dl", dl: "dl",
  lb: "lb",
};

// ── Current weights ──────────────────────────────────────────────
const CURRENT_IDP_WEIGHTS = {
  ktc: 0.20,
  fantasycalc: 0.20,
  dynastyprocess: 0.10,
  fantasypros: 0.50,
};

// ── Proposed weights (with IDP Show) ─────────────────────────────
const PROPOSED_IDP_WEIGHTS = {
  ktc: 0.15,
  fantasycalc: 0.15,
  dynastyprocess: 0.15,
  fantasypros: 0.35,
  idpshow: 0.20,
};

const IDP_CONSENSUS_DISCOUNT = 0.55;

// ── Rank-to-value (same formula as FantasyPros scraper) ──────────
function rankToValue(rank: number): number {
  const raw = 10000 * Math.exp(-0.012 * (rank - 1));
  return Math.max(100, Math.round(raw));
}

// ── CSV parser ───────────────────────────────────────────────────
interface IdpShowPlayer {
  ovrRank: number;
  name: string;
  team: string;
  position: string;
  positionRank: string;
}

function parseIdpShowCsv(csvPath: string): IdpShowPlayer[] {
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  // Skip header
  const players: IdpShowPlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 5) continue;

    const ovrStr = cols[0].replace(/\uFEFF/g, "").trim();
    const ovr = parseInt(ovrStr, 10);
    if (isNaN(ovr)) continue;

    const name = cols[1].trim();
    const team = cols[2].trim();
    const posRaw = cols[3].trim();
    const posRk = cols[4].trim();

    const position = POSITION_MAP[posRaw];
    if (!position) {
      console.warn(`  Unknown position "${posRaw}" for ${name}`);
      continue;
    }

    players.push({
      ovrRank: ovr,
      name,
      team,
      position,
      positionRank: posRk,
    });
  }

  return players;
}

/**
 * Parse a CSV line handling quoted fields with commas.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Player matching ──────────────────────────────────────────────
interface MatchResult {
  idpShowPlayer: IdpShowPlayer;
  canonicalId: string | null;
  canonicalName: string | null;
  matchStrategy: string;
}

async function matchToCanonical(
  players: IdpShowPlayer[],
): Promise<MatchResult[]> {
  const allCanonical = await db
    .select({
      id: schema.canonicalPlayers.id,
      name: schema.canonicalPlayers.name,
      position: schema.canonicalPlayers.position,
      nflTeam: schema.canonicalPlayers.nflTeam,
      isActive: schema.canonicalPlayers.isActive,
    })
    .from(schema.canonicalPlayers);

  // Build lookup indexes
  const byNamePos = new Map<string, typeof allCanonical>();
  const byLastNameTeamPos = new Map<string, typeof allCanonical>();

  for (const cp of allCanonical) {
    // Exact name+position group
    const key = normalizeKey(cp.name, cp.position);
    if (!byNamePos.has(key)) byNamePos.set(key, []);
    byNamePos.get(key)!.push(cp);

    // Last name + team + position group
    if (cp.nflTeam) {
      const lastName = cp.name.split(" ").pop()?.toLowerCase() ?? "";
      const teamKey =
        `${lastName}:${cp.nflTeam.toLowerCase()}:` +
        `${posGroup(cp.position)}`;
      if (!byLastNameTeamPos.has(teamKey)) {
        byLastNameTeamPos.set(teamKey, []);
      }
      byLastNameTeamPos.get(teamKey)!.push(cp);
    }
  }

  const results: MatchResult[] = [];

  for (const p of players) {
    // Strategy 1: exact name+position group
    const key1 = normalizeKey(p.name, p.position);
    let candidates = byNamePos.get(key1);
    if (candidates && candidates.length > 0) {
      const best = pickBest(candidates);
      results.push({
        idpShowPlayer: p,
        canonicalId: best.id,
        canonicalName: best.name,
        matchStrategy: "exact",
      });
      continue;
    }

    // Strategy 2: strip suffix + position group
    const stripped = p.name
      .replace(/\s+(II|III|IV|Jr\.?|Sr\.?)$/i, "")
      .trim();
    const nameVariants = [
      stripped,
      `${stripped} Jr.`,
      `${stripped} Jr`,
      `${stripped} II`,
      `${stripped} III`,
    ];
    let found = false;
    for (const variant of nameVariants) {
      const key2 = normalizeKey(variant, p.position);
      candidates = byNamePos.get(key2);
      if (candidates && candidates.length > 0) {
        const best = pickBest(candidates);
        results.push({
          idpShowPlayer: p,
          canonicalId: best.id,
          canonicalName: best.name,
          matchStrategy: "suffix_strip",
        });
        found = true;
        break;
      }
    }
    if (found) continue;

    // Strategy 3: last name + team + position group
    if (p.team) {
      const lastName = p.name.split(" ").pop()?.toLowerCase() ?? "";
      // Normalize team: remove trailing spaces, handle abbrevs
      const teamNorm = p.team.replace(/\s+/g, "").toUpperCase();
      const teamKey =
        `${lastName}:${teamNorm.toLowerCase()}:` +
        `${posGroup(p.position)}`;
      candidates = byLastNameTeamPos.get(teamKey);
      if (candidates && candidates.length > 0) {
        const best = pickBest(candidates);
        results.push({
          idpShowPlayer: p,
          canonicalId: best.id,
          canonicalName: best.name,
          matchStrategy: "team_lastname",
        });
        continue;
      }
    }

    // No match
    results.push({
      idpShowPlayer: p,
      canonicalId: null,
      canonicalName: null,
      matchStrategy: "none",
    });
  }

  return results;
}

function normalizeKey(name: string, position: string): string {
  const norm = name
    .toLowerCase()
    .replace(/\s+(ii|iii|iv|jr\.?|sr\.?)$/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return `${norm}:${posGroup(position)}`;
}

function posGroup(position: string): string {
  return IDP_POSITION_GROUPS[position.toLowerCase()] ??
    position.toLowerCase();
}

function pickBest<
  T extends { isActive: boolean; nflTeam: string | null },
>(candidates: T[]): T {
  if (candidates.length === 1) return candidates[0];
  const active = candidates.filter(
    (c) => c.isActive && c.nflTeam && !c.nflTeam.includes("FA"),
  );
  if (active.length >= 1) return active[0];
  const anyActive = candidates.filter((c) => c.isActive);
  if (anyActive.length > 0) return anyActive[0];
  return candidates[0];
}

// ── Consensus re-blend simulation ────────────────────────────────
interface SourceValues {
  ktc: number | null;
  fc: number | null;
  dp: number | null;
  fp: number | null;
  idpshow: number | null;
}

interface PlayerBlendResult {
  canonicalPlayerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  oldConsensus: number;
  newConsensus: number;
  sources: SourceValues;
  oldFinalValue: number;
  newFinalValue: number;
}

/**
 * Compute weighted average using given weights, normalizing
 * by actual available sources.
 */
function weightedAverage(
  sources: SourceValues,
  weights: Record<string, number>,
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  const entries: Array<[string, number | null]> = [
    ["ktc", sources.ktc],
    ["fantasycalc", sources.fc],
    ["dynastyprocess", sources.dp],
    ["fantasypros", sources.fp],
    ["idpshow", sources.idpshow],
  ];

  for (const [key, value] of entries) {
    const w = weights[key] ?? 0;
    if (value !== null && value > 0 && w > 0) {
      weightedSum += value * w;
      totalWeight += w;
    }
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

// ── Main simulation ──────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log("IDP SHOW IMPACT SIMULATION (DRY RUN)");
  console.log("=".repeat(70));
  console.log();

  // Step 1: Parse CSV
  const csvPath = path.resolve(
    __dirname,
    "../data/IDPShow Dynasty Data 022326.csv",
  );
  console.log("Step 1: Parsing IDP Show CSV...");
  const idpShowPlayers = parseIdpShowCsv(csvPath);
  console.log(`  Parsed ${idpShowPlayers.length} players`);

  const posCounts: Record<string, number> = {};
  for (const p of idpShowPlayers) {
    posCounts[p.position] = (posCounts[p.position] ?? 0) + 1;
  }
  console.log("  Position breakdown:", posCounts);
  console.log();

  // Step 2: Match to canonical players
  console.log("Step 2: Matching to canonical players...");
  const matchResults = await matchToCanonical(idpShowPlayers);

  const matched = matchResults.filter((r) => r.canonicalId !== null);
  const unmatched = matchResults.filter((r) => r.canonicalId === null);

  const matchRate = (
    (matched.length / matchResults.length) * 100
  ).toFixed(1);
  console.log(
    `  Matched: ${matched.length}/${matchResults.length} ` +
    `(${matchRate}%)`,
  );

  const stratCounts: Record<string, number> = {};
  for (const r of matchResults) {
    stratCounts[r.matchStrategy] =
      (stratCounts[r.matchStrategy] ?? 0) + 1;
  }
  console.log("  Match strategies:", stratCounts);

  if (unmatched.length > 0) {
    console.log(
      `\n  Unmatched players (${unmatched.length}):`,
    );
    for (const u of unmatched.slice(0, 30)) {
      console.log(
        `    ${u.idpShowPlayer.ovrRank}. ` +
        `${u.idpShowPlayer.name} ` +
        `(${u.idpShowPlayer.position}, ` +
        `${u.idpShowPlayer.team})`,
      );
    }
    if (unmatched.length > 30) {
      console.log(`    ... and ${unmatched.length - 30} more`);
    }
  }
  console.log();

  // Build IDP Show value map: canonicalPlayerId → value
  const idpShowValues = new Map<string, number>();
  for (const r of matched) {
    idpShowValues.set(
      r.canonicalId!,
      rankToValue(r.idpShowPlayer.ovrRank),
    );
  }

  // Step 3: Simulate re-blend for each league
  console.log("Step 3: Simulating consensus re-blend per league...");
  const allLeagues = await db.select().from(schema.leagues);

  if (allLeagues.length === 0) {
    console.log("  No leagues found. Exiting.");
    return;
  }

  console.log(`  Found ${allLeagues.length} leagues`);
  console.log();

  for (const league of allLeagues) {
    console.log("─".repeat(70));
    console.log(`League: ${league.name} (${league.totalTeams} teams)`);
    console.log("─".repeat(70));

    // Get settings
    const [settings] = await db
      .select()
      .from(schema.leagueSettings)
      .where(eq(schema.leagueSettings.leagueId, league.id))
      .limit(1);

    if (!settings) {
      console.log("  No settings found, skipping.\n");
      continue;
    }

    const rosterPositions =
      settings.rosterPositions as Record<string, number>;
    const scoringRules =
      settings.scoringRules as Record<string, number>;

    // Check if league has IDP
    const hasIdp = Object.keys(rosterPositions).some(
      (pos) => IDP_POSITIONS.has(pos) && rosterPositions[pos] > 0,
    );
    if (!hasIdp) {
      console.log("  Non-IDP league, skipping.\n");
      continue;
    }

    // Compute blend weights
    const complexity = computeFormatComplexity({
      totalTeams: league.totalTeams,
      rosterPositions,
      scoringRules,
    });
    const blendMode = (
      (settings.metadata as Record<string, unknown> | null)
        ?.valuationMode ?? "auto"
    ) as "auto" | "market_anchored" | "balanced" | "league_driven";
    const { consensus: CONSENSUS_W, league: LEAGUE_W } =
      computeBlendWeights(complexity, blendMode);
    const idpDiscount = computeIdpSignalDiscount(rosterPositions);

    console.log(
      `  Blend: complexity=${complexity.toFixed(2)}, ` +
      `consensus=${(CONSENSUS_W * 100).toFixed(0)}%, ` +
      `league=${(LEAGUE_W * 100).toFixed(0)}%, ` +
      `idpDiscount=${idpDiscount.toFixed(3)}`,
    );

    // Load current player values (final values with league signal)
    // This is the primary source — IDP players are signal_primary
    // and have NO rows in aggregatedValues.
    const pvRows = await db
      .select({
        canonicalPlayerId: schema.playerValues.canonicalPlayerId,
        value: schema.playerValues.value,
        leagueSignalComponent:
          schema.playerValues.leagueSignalComponent,
        consensusComponent: schema.playerValues.consensusComponent,
        consensusValue: schema.playerValues.consensusValue,
        ktcValue: schema.playerValues.ktcValue,
        fcValue: schema.playerValues.fcValue,
        dpValue: schema.playerValues.dpValue,
        fpValue: schema.playerValues.fpValue,
        valueSource: schema.playerValues.valueSource,
        eligibilityPosition: schema.playerValues.eligibilityPosition,
      })
      .from(schema.playerValues)
      .where(eq(schema.playerValues.leagueId, league.id));

    // Load player info for all players in playerValues
    const pvPlayerIds = pvRows.map((r) => r.canonicalPlayerId);
    const playerInfos = pvPlayerIds.length > 0
      ? await db
          .select({
            id: schema.canonicalPlayers.id,
            name: schema.canonicalPlayers.name,
            position: schema.canonicalPlayers.position,
            nflTeam: schema.canonicalPlayers.nflTeam,
          })
          .from(schema.canonicalPlayers)
          .where(
            inArray(schema.canonicalPlayers.id, pvPlayerIds),
          )
      : [];

    const playerInfoMap = new Map(
      playerInfos.map((p) => [p.id, p]),
    );

    // Simulate re-blend for IDP players
    const blendResults: PlayerBlendResult[] = [];

    for (const pv of pvRows) {
      const info = playerInfoMap.get(pv.canonicalPlayerId);
      if (!info) continue;

      const pos = info.position;
      if (!IDP_POSITIONS.has(pos)) continue;

      const sources: SourceValues = {
        ktc: pv.ktcValue,
        fc: pv.fcValue,
        dp: pv.dpValue,
        fp: pv.fpValue,
        idpshow: idpShowValues.get(pv.canonicalPlayerId) ?? null,
      };

      // Current consensus (without IDP Show)
      const oldConsensus = weightedAverage(
        { ...sources, idpshow: null },
        CURRENT_IDP_WEIGHTS,
      );
      // Proposed consensus (with IDP Show)
      const newConsensus = weightedAverage(
        sources,
        PROPOSED_IDP_WEIGHTS,
      );

      const leagueSignal = pv.leagueSignalComponent ?? 0;
      const oldValue = pv.value;

      // For signal_primary players (no current consensus), adding
      // IDP Show consensus changes their value source from
      // signal_primary to unified (consensus + signal blend).
      let newFinalValue: number;

      if (newConsensus > 0 && leagueSignal > 0) {
        // Would become "unified" — blend consensus + signal
        const newAdjConsensus =
          newConsensus * IDP_CONSENSUS_DISCOUNT;
        newFinalValue = Math.round(
          newAdjConsensus * CONSENSUS_W +
          leagueSignal,
        );
      } else if (newConsensus > 0) {
        // Consensus only (no league signal)
        const newAdjConsensus =
          newConsensus * IDP_CONSENSUS_DISCOUNT;
        newFinalValue = Math.round(
          newAdjConsensus * CONSENSUS_W,
        );
      } else {
        // No consensus even with IDP Show — stays signal_primary
        newFinalValue = oldValue;
      }

      blendResults.push({
        canonicalPlayerId: pv.canonicalPlayerId,
        playerName: info.name,
        position: pos,
        nflTeam: info.nflTeam,
        oldConsensus,
        newConsensus,
        sources,
        oldFinalValue: oldValue,
        newFinalValue,
      });
    }

    // Sort by new estimated final value desc
    blendResults.sort((a, b) => b.newFinalValue - a.newFinalValue);

    // ── Report ─────────────────────────────────────────────────
    const top30 = blendResults.slice(0, 30);

    // Assign ranks
    const oldSorted = [...blendResults]
      .sort((a, b) => b.oldFinalValue - a.oldFinalValue);
    const oldRanks = new Map<string, number>();
    oldSorted.forEach((r, i) => oldRanks.set(r.canonicalPlayerId, i + 1));

    const newRanks = new Map<string, number>();
    blendResults.forEach(
      (r, i) => newRanks.set(r.canonicalPlayerId, i + 1),
    );

    console.log(
      "\n  Top 30 IDP Before/After:\n",
    );
    console.log(
      "  " +
      "Rk".padStart(3) + " " +
      "Player".padEnd(25) + " " +
      "Pos".padEnd(4) + " " +
      "OldVal".padStart(7) + " " +
      "NewVal".padStart(7) + " " +
      "Δ".padStart(6) + " " +
      "OldRk".padStart(5) + " " +
      "NewRk".padStart(5) + " " +
      "IDPSh".padStart(6) + " " +
      "FP".padStart(6) + " " +
      "KTC".padStart(6),
    );
    console.log("  " + "─".repeat(94));

    for (let i = 0; i < top30.length; i++) {
      const r = top30[i];
      const oldRk = oldRanks.get(r.canonicalPlayerId) ?? 0;
      const newRk = i + 1;
      const delta = r.newFinalValue - r.oldFinalValue;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;

      console.log(
        "  " +
        `${newRk}`.padStart(3) + " " +
        r.playerName.padEnd(25) + " " +
        r.position.padEnd(4) + " " +
        `${r.oldFinalValue}`.padStart(7) + " " +
        `${r.newFinalValue}`.padStart(7) + " " +
        deltaStr.padStart(6) + " " +
        `${oldRk}`.padStart(5) + " " +
        `${newRk}`.padStart(5) + " " +
        `${r.sources.idpshow ?? "-"}`.padStart(6) + " " +
        `${r.sources.fp ?? "-"}`.padStart(6) + " " +
        `${r.sources.ktc ?? "-"}`.padStart(6),
      );
    }

    // ── Test criteria checks ───────────────────────────────────
    if (blendResults.length === 0) {
      console.log(
        "\n  No IDP player values computed for this league, " +
        "skipping test criteria.\n",
      );
      continue;
    }

    console.log("\n  Test Criteria:");

    // 1. Elite anchoring: Anderson, Garrett, Hutchinson, Parsons
    //    should be in top 7-8
    const eliteTargets = [
      "Will Anderson",
      "Myles Garrett",
      "Aidan Hutchinson",
      "Micah Parsons",
    ];
    const eliteRanks: Array<{ name: string; rank: number }> = [];
    for (const target of eliteTargets) {
      const entry = blendResults.find(
        (r) => r.playerName === target,
      );
      eliteRanks.push({
        name: target,
        rank: entry
          ? newRanks.get(entry.canonicalPlayerId) ?? 999
          : 999,
      });
    }
    const elitePass = eliteRanks.every((e) => e.rank <= 8);
    console.log(
      `    Elite anchoring (top 8): ${elitePass ? "PASS ✓" : "FAIL ✗"}`,
    );
    for (const e of eliteRanks) {
      console.log(`      ${e.name}: #${e.rank}`);
    }

    // 2. Star validation: Warner in top 25
    const warnerEntry = blendResults.find(
      (r) => r.playerName === "Fred Warner",
    );
    const warnerRank = warnerEntry
      ? newRanks.get(warnerEntry.canonicalPlayerId) ?? 999
      : 999;
    const warnerPass = warnerRank <= 25;
    console.log(
      `    Warner validation (top 25): ` +
      `${warnerPass ? "PASS ✓" : "FAIL ✗"} (#${warnerRank})`,
    );

    // 3. Anomaly reduction: count players in our top-30 IDP who
    //    are ranked 200+ in IDP Show
    const idpShowRankMap = new Map<string, number>();
    for (const r of matched) {
      idpShowRankMap.set(r.canonicalId!, r.idpShowPlayer.ovrRank);
    }

    let anomaliesOld = 0;
    let anomaliesNew = 0;
    const oldTop30 = [...blendResults]
      .sort((a, b) => b.oldFinalValue - a.oldFinalValue)
      .slice(0, 30);

    for (const r of oldTop30) {
      const showRank = idpShowRankMap.get(r.canonicalPlayerId);
      if (showRank && showRank >= 200) anomaliesOld++;
    }
    for (const r of top30) {
      const showRank = idpShowRankMap.get(r.canonicalPlayerId);
      if (showRank && showRank >= 200) anomaliesNew++;
    }
    console.log(
      `    Anomaly reduction: ${anomaliesOld} → ${anomaliesNew} ` +
      `(IDP Show 200+ in our top 30) ` +
      `${anomaliesNew <= anomaliesOld ? "PASS ✓" : "FAIL ✗"}`,
    );

    // 4. No-name suppression: players with IDP Show rank 150+
    //    should not be in top 20
    let noNameInTop20 = 0;
    const newTop20 = blendResults.slice(0, 20);
    for (const r of newTop20) {
      const showRank = idpShowRankMap.get(r.canonicalPlayerId);
      if (showRank && showRank >= 150) noNameInTop20++;
    }
    console.log(
      `    No-name suppression: ${noNameInTop20} players w/ ` +
      `IDP Show 150+ in our top 20 ` +
      `${noNameInTop20 === 0 ? "PASS ✓" : "WARN ⚠"}`,
    );

    // 5. Format sensitivity: in tackle-heavy leagues, top LBs
    //    should outrank top CBs
    const tackleSolo = scoringRules["tackle_solo"] ?? 0;
    if (tackleSolo >= 1.5) {
      const topLB = blendResults.find((r) => r.position === "LB");
      const topCB = blendResults.find((r) => r.position === "CB");
      if (topLB && topCB) {
        const lbRank =
          newRanks.get(topLB.canonicalPlayerId) ?? 999;
        const cbRank =
          newRanks.get(topCB.canonicalPlayerId) ?? 999;
        const formatPass = lbRank < cbRank;
        console.log(
          `    Format sensitivity (tackle-heavy: LB>CB): ` +
          `${formatPass ? "PASS ✓" : "FAIL ✗"} ` +
          `(top LB #${lbRank} ${topLB.playerName}, ` +
          `top CB #${cbRank} ${topCB.playerName})`,
        );
      }
    } else {
      console.log(
        `    Format sensitivity: N/A ` +
        `(not tackle-heavy, solo_tackle=${tackleSolo})`,
      );
    }

    // 6. Offensive isolation: only IDP players are in blendResults
    const offenseInResults = blendResults.filter(
      (r) => !IDP_POSITIONS.has(r.position),
    ).length;
    const offensePass = offenseInResults === 0;
    console.log(
      `    Offensive isolation: ` +
      `${offensePass ? "PASS ✓" : "FAIL ✗"} ` +
      `(${offenseInResults} offense players affected)`,
    );

    // 7. Value spread: IDP #1 to #50 gap
    const idp1Val = blendResults[0]?.newFinalValue ?? 0;
    const idp50Val =
      blendResults.length >= 50
        ? blendResults[49]?.newFinalValue ?? 0
        : 0;
    const gap = idp1Val - idp50Val;
    console.log(
      `    Value spread (#1 to #50): ${gap} ` +
      `(#1=${idp1Val}, #50=${idp50Val}) ` +
      `${gap > 100 ? "PASS ✓" : "WARN ⚠"}`,
    );

    console.log();
  }

  // ── Global summary ───────────────────────────────────────────
  console.log("=".repeat(70));
  console.log("SIMULATION COMPLETE");
  console.log("=".repeat(70));
  console.log(`IDP Show players parsed: ${idpShowPlayers.length}`);
  console.log(`Matched to canonical: ${matched.length}`);
  console.log(`Match rate: ${matchRate}%`);
  console.log(
    `\nProposed weight changes:`,
  );
  console.log(`  FantasyPros:    0.50 → 0.35`);
  console.log(`  IDP Show:       0.00 → 0.20`);
  console.log(`  KTC:            0.20 → 0.15`);
  console.log(`  FantasyCalc:    0.20 → 0.15`);
  console.log(`  DynastyProcess: 0.10 → 0.15`);
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
