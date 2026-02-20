#!/usr/bin/env tsx
/**
 * Trade calculator validation across extreme formats.
 *
 * Dynamically selects leagues from the DB matching 4 format buckets:
 *   A) Small non-SF (6–8 teams, no SUPERFLEX, QB<2)
 *   B) Mid non-SF (10–16 teams, no SUPERFLEX, QB<2)
 *   C) Large IDP (>=24 teams, IDP)
 *   D) Mid SF/2QB (10–12 teams, SUPERFLEX or QB>=2)
 *
 * Runs 4 trade scenarios per league and flags anomalies.
 * Validation only — no engine modifications.
 */

import { db } from "../lib/db/client";
import {
  leagues,
  leagueSettings,
  playerValues,
  canonicalPlayers,
} from "../lib/db/schema";
import { eq } from "drizzle-orm";
import {
  computeFairness,
  computePickValue,
  getLeagueValueStats,
  type PlayerAsset,
  type DraftPickAsset,
  type TradeAsset,
  type FairnessResult,
} from "../lib/trade-engine";

// ── SF detection ────────────────────────────────────────
function detectSF(
  rosterPositions: Record<string, number>,
): boolean {
  if ((rosterPositions["SUPERFLEX"] ?? 0) > 0) return true;
  if ((rosterPositions["SUPER_FLEX"] ?? 0) > 0) return true;
  if ((rosterPositions["SF"] ?? 0) > 0) return true;
  if ((rosterPositions["QB"] ?? 0) >= 2) return true;
  return false;
}

// ── Types ───────────────────────────────────────────────
interface LeagueBucket {
  label: string;
  id: string;
  name: string;
  totalTeams: number;
  isSF: boolean;
  hasIdp: boolean;
}

interface TradeScenario {
  name: string;
  side1: TradeAsset[];
  side2: TradeAsset[];
  intentionalImbalance?: boolean;
}

interface ScenarioResult {
  scenario: string;
  side1Label: string;
  side2Label: string;
  side1Total: number;
  side2Total: number;
  absDiff: number;
  pctDiff: number;
  adjustedPctDiff: number;
  verdict: string;
  flags: string[];
}

// ── Helpers ─────────────────────────────────────────────

function makePlayerAsset(row: {
  id: string;
  name: string;
  position: string;
  positionGroup: string;
  age: number | null;
  nflTeam: string | null;
  value: number;
  projectedPoints: number;
  consensusValue: number | null;
  consensusComponent: number | null;
  leagueSignalComponent: number | null;
  rank: number;
  rankInPosition: number;
  tier: number;
  scarcityMultiplier: number | null;
  ageCurveMultiplier: number | null;
  dynastyPremium: number | null;
}): PlayerAsset {
  return {
    playerId: row.id,
    playerName: row.name,
    position: row.position,
    positionGroup: row.positionGroup as "offense" | "defense",
    age: row.age,
    nflTeam: row.nflTeam,
    value: row.value,
    projectedPoints: row.projectedPoints,
    consensusValue: row.consensusValue,
    consensusComponent: row.consensusComponent,
    leagueSignalComponent: row.leagueSignalComponent,
    rank: row.rank,
    rankInPosition: row.rankInPosition,
    tier: row.tier,
    scarcityMultiplier: row.scarcityMultiplier ?? 1,
    ageCurveMultiplier: row.ageCurveMultiplier ?? 1,
    dynastyPremium: row.dynastyPremium ?? 0,
  };
}

function makePickAsset(
  round: number,
  slot: number,
  totalTeams: number,
  stats: ReturnType<typeof getLeagueValueStats>,
  yearsOut: number,
  label: string,
): DraftPickAsset {
  const value = computePickValue(
    round, slot, totalTeams, stats, yearsOut,
  );
  return {
    pickId: `${2026 + yearsOut}-${round}-${slot}`,
    season: 2026 + yearsOut,
    round,
    pickNumber: (round - 1) * totalTeams + slot,
    projectedPickNumber: null,
    originalTeamId: null,
    originalTeamName: label,
    ownerTeamId: "validation",
    value,
  };
}

function assetLabel(a: TradeAsset): string {
  if (a.type === "player") {
    return `${a.asset.playerName} (${a.asset.position}, ` +
      `val=${a.asset.value})`;
  }
  const pick = a.asset.pickNumber!;
  const rd = a.asset.round;
  const slot = pick - (rd - 1) * 100;
  return `${a.asset.season} Rd${rd}.` +
    `${String(pick).padStart(2, "0")} (val=${a.asset.value})`;
}

function sideLabel(assets: TradeAsset[]): string {
  return assets.map(assetLabel).join(" + ");
}

function flagTrade(
  result: FairnessResult,
  side1: TradeAsset[],
  side2: TradeAsset[],
  intentionalImbalance: boolean,
): string[] {
  const flags: string[] = [];

  if (
    Math.abs(result.pctDiff) > 10 &&
    !intentionalImbalance
  ) {
    flags.push(
      `IMBALANCE: ${Math.abs(result.pctDiff).toFixed(1)}% ` +
        `raw diff exceeds 10% threshold`,
    );
  }

  for (const a of [...side1, ...side2]) {
    const val = a.type === "player"
      ? a.asset.value
      : a.asset.value;
    if (val < 0) {
      const name = a.type === "player"
        ? a.asset.playerName
        : `Pick ${a.asset.pickId}`;
      flags.push(`NEGATIVE VALUE: ${name} has value ${val}`);
    }
  }

  const checkSide = (assets: TradeAsset[], label: string) => {
    if (assets.length < 2) return;
    for (const asset of assets) {
      const assetVal = asset.type === "player"
        ? asset.asset.value
        : asset.asset.value;
      if (assetVal <= 0) {
        const name = asset.type === "player"
          ? asset.asset.playerName
          : `Pick ${asset.asset.pickId}`;
        flags.push(
          `DEAD WEIGHT on ${label}: ${name} ` +
            `(val=${assetVal}) does not increase side total`,
        );
      }
    }
  };
  checkSide(side1, "Side1");
  checkSide(side2, "Side2");

  return flags;
}

// ── Dynamic league selection ────────────────────────────

async function selectLeagues(): Promise<LeagueBucket[]> {
  const TEST_USER = "1a1786c0-6792-4c92-8cc6-57af880cb424";

  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      totalTeams: leagues.totalTeams,
      rosterPositions: leagueSettings.rosterPositions,
      idpStructure: leagueSettings.idpStructure,
    })
    .from(leagues)
    .innerJoin(
      leagueSettings,
      eq(leagueSettings.leagueId, leagues.id),
    )
    .where(eq(leagues.userId, TEST_USER));

  const candidates = rows.map((r) => {
    const rp = r.rosterPositions as Record<string, number>;
    return {
      id: r.id,
      name: r.name,
      totalTeams: r.totalTeams,
      isSF: detectSF(rp),
      hasIdp: r.idpStructure !== "none",
      rp,
    };
  });

  console.log("League catalog (all connected):");
  for (const c of candidates) {
    console.log(
      `  ${c.name.padEnd(35)} ${String(c.totalTeams).padStart(2)}t  ` +
        `SF=${String(c.isSF).padEnd(5)}  ` +
        `IDP=${String(c.hasIdp).padEnd(5)}  ${c.id}`,
    );
  }

  const buckets: LeagueBucket[] = [];

  // A) Small non-SF (6–8 teams, no SF)
  const smallNonSF = candidates.find(
    (c) => c.totalTeams <= 8 && !c.isSF,
  );
  // A-fallback) Smallest non-SF of any size
  const anyNonSF = candidates
    .filter((c) => !c.isSF)
    .sort((a, b) => a.totalTeams - b.totalTeams)[0];
  const bucketA = smallNonSF ?? anyNonSF;
  if (bucketA) {
    const note = !smallNonSF
      ? ` (fallback: no 6-8t non-SF, using ${bucketA.totalTeams}t)`
      : "";
    buckets.push({
      label: `A: NON-SF (${bucketA.totalTeams}-team)${note}`,
      ...bucketA,
    });
  }

  // B) Mid non-SF (10–16 teams, no SF) — distinct from A
  const midNonSF = candidates.find(
    (c) =>
      c.totalTeams >= 10 &&
      c.totalTeams <= 16 &&
      !c.isSF &&
      c.id !== bucketA?.id,
  );
  if (midNonSF) {
    buckets.push({
      label: `B: MID NON-SF (${midNonSF.totalTeams}-team)`,
      ...midNonSF,
    });
  }

  // C) Large IDP (>=24 teams)
  const largeIdp = candidates
    .filter((c) => c.totalTeams >= 24 && c.hasIdp)
    .sort((a, b) => b.totalTeams - a.totalTeams)[0];
  if (largeIdp) {
    buckets.push({
      label: `C: LARGE IDP${largeIdp.isSF ? " SF" : ""} ` +
        `(${largeIdp.totalTeams}-team)`,
      ...largeIdp,
    });
  }

  // D) Mid SF/2QB (10–12 teams, SF=true)
  const midSF = candidates.find(
    (c) => c.totalTeams >= 10 && c.totalTeams <= 12 && c.isSF,
  );
  if (midSF) {
    buckets.push({
      label: `D: MID SF (${midSF.totalTeams}-team` +
        `${midSF.hasIdp ? " IDP" : ""})`,
      ...midSF,
    });
  }

  return buckets;
}

// ── Build scenarios per league ──────────────────────────

function buildScenarios(
  isSF: boolean,
  qbs: PlayerAsset[],
  rbs: PlayerAsset[],
  wrs: PlayerAsset[],
  tes: PlayerAsset[],
  earlyFirst: DraftPickAsset,
  lateFirst: DraftPickAsset,
  earlySecond: DraftPickAsset,
): TradeScenario[] {
  const scenarios: TradeScenario[] = [];

  // Scenario A: Player-for-player (similar tier WRs)
  if (wrs[0] && wrs[1]) {
    scenarios.push({
      name: "A. Player-for-player (WR1 vs WR2)",
      side1: [{ type: "player", asset: wrs[0] }],
      side2: [{ type: "player", asset: wrs[1] }],
    });
  }

  // Scenario B: Format-appropriate player+pick trade
  if (isSF) {
    // SF: QB1 vs QB2 + 2nd — should be near-balanced since
    // both QBs are elite in SF, and a 2nd balances the gap
    if (qbs[0] && qbs[1]) {
      scenarios.push({
        name: "B. SF trade: QB1 vs QB2 + early 2nd",
        side1: [{ type: "player", asset: qbs[0] }],
        side2: [
          { type: "player", asset: qbs[1] },
          { type: "pick", asset: earlySecond },
        ],
      });
    }
  } else {
    // Non-SF: WR1 vs RB1 + early 2nd — positions with
    // comparable value in non-SF formats
    if (wrs[0] && rbs[0]) {
      scenarios.push({
        name: "B. Non-SF trade: WR1 vs RB1 + early 2nd",
        side1: [{ type: "player", asset: wrs[0] }],
        side2: [
          { type: "player", asset: rbs[0] },
          { type: "pick", asset: earlySecond },
        ],
      });
    }
  }

  // Scenario C: Pick-for-pick (early vs late 1st)
  scenarios.push({
    name: "C. Pick-for-pick (early 1st vs late 1st)",
    side1: [{ type: "pick", asset: earlyFirst }],
    side2: [{ type: "pick", asset: lateFirst }],
    intentionalImbalance: true,
  });

  // Scenario D: 3-for-1 consolidation
  if (wrs[0] && rbs[1] && wrs[2] && tes[0]) {
    scenarios.push({
      name: "D. 3-for-1 consolidation (WR1 vs RB2+WR3+TE1)",
      side1: [{ type: "player", asset: wrs[0] }],
      side2: [
        { type: "player", asset: rbs[1] },
        { type: "player", asset: wrs[2] },
        { type: "player", asset: tes[0] },
      ],
    });
  }

  return scenarios;
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const allFlags: string[] = [];

  console.log("=".repeat(80));
  console.log("TRADE CALCULATOR VALIDATION — EXTREME FORMATS (v2)");
  console.log("=".repeat(80));

  const selectedLeagues = await selectLeagues();

  if (selectedLeagues.length === 0) {
    console.log("\nERROR: No leagues found in DB.");
    process.exit(1);
  }

  console.log(
    `\nSelected ${selectedLeagues.length} leagues for validation:`,
  );
  for (const l of selectedLeagues) {
    console.log(
      `  ${l.label}: ${l.name} ` +
        `(SF=${l.isSF}, IDP=${l.hasIdp})`,
    );
  }

  let totalScenarios = 0;

  for (const target of selectedLeagues) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`LEAGUE: ${target.label}`);
    console.log(`  Name: ${target.name}`);
    console.log(`  ID: ${target.id}`);
    console.log(
      `  Teams: ${target.totalTeams}  SF: ${target.isSF}  ` +
        `IDP: ${target.hasIdp}`,
    );
    console.log(`${"─".repeat(80)}`);

    // Fetch player values
    const pvRows = await db
      .select({
        id: canonicalPlayers.id,
        name: canonicalPlayers.name,
        position: canonicalPlayers.position,
        positionGroup: canonicalPlayers.positionGroup,
        age: canonicalPlayers.age,
        nflTeam: canonicalPlayers.nflTeam,
        value: playerValues.value,
        projectedPoints: playerValues.projectedPoints,
        consensusValue: playerValues.consensusValue,
        consensusComponent: playerValues.consensusComponent,
        leagueSignalComponent: playerValues.leagueSignalComponent,
        rank: playerValues.rank,
        rankInPosition: playerValues.rankInPosition,
        tier: playerValues.tier,
        scarcityMultiplier: playerValues.scarcityMultiplier,
        ageCurveMultiplier: playerValues.ageCurveMultiplier,
        dynastyPremium: playerValues.dynastyPremium,
      })
      .from(playerValues)
      .innerJoin(
        canonicalPlayers,
        eq(playerValues.canonicalPlayerId, canonicalPlayers.id),
      )
      .where(eq(playerValues.leagueId, target.id))
      .orderBy(playerValues.rank);

    console.log(`  Player values loaded: ${pvRows.length}`);

    if (pvRows.length === 0) {
      console.log("  SKIP: no player values computed");
      continue;
    }

    const valStats = getLeagueValueStats(
      pvRows.map((r) => ({
        value: r.value ?? 0,
        rank: r.rank ?? 999,
      })),
    );

    console.log(
      `  Stats: avgStarter=${Math.round(valStats.avgStarterValue)} ` +
        `avgBench=${Math.round(valStats.avgBenchValue)} ` +
        `replacement=${Math.round(valStats.replacementValue)}`,
    );

    // Build position lists
    const toAsset = (
      r: (typeof pvRows)[0],
    ): PlayerAsset =>
      makePlayerAsset({
        ...r,
        value: r.value ?? 0,
        projectedPoints: r.projectedPoints ?? 0,
        rank: r.rank ?? 999,
        rankInPosition: r.rankInPosition ?? 999,
        tier: r.tier ?? 10,
      });

    const byPos = (pos: string) =>
      pvRows.filter((r) => r.position === pos).map(toAsset);

    const qbs = byPos("QB");
    const rbs = byPos("RB");
    const wrs = byPos("WR");
    const tes = byPos("TE");

    // Print top-3 at key positions for context
    console.log("\n  Top-3 by position:");
    for (const [label, list] of [
      ["QB", qbs], ["RB", rbs], ["WR", wrs], ["TE", tes],
    ] as const) {
      const top3 = (list as PlayerAsset[]).slice(0, 3);
      console.log(
        `    ${label}: ` +
          top3
            .map(
              (p) => `${p.playerName}(${p.value})`,
            )
            .join(", "),
      );
    }

    // Build picks
    const earlyFirst = makePickAsset(
      1, 2, target.totalTeams, valStats, 0, "early 1st",
    );
    const lateFirst = makePickAsset(
      1,
      target.totalTeams - 1,
      target.totalTeams,
      valStats,
      0,
      "late 1st",
    );
    const earlySecond = makePickAsset(
      2, 2, target.totalTeams, valStats, 0, "early 2nd",
    );

    // Build and run scenarios
    const scenarios = buildScenarios(
      target.isSF,
      qbs, rbs, wrs, tes,
      earlyFirst, lateFirst, earlySecond,
    );

    totalScenarios += scenarios.length;

    for (const sc of scenarios) {
      const fairness = computeFairness(
        sc.side1, sc.side2, valStats.replacementValue,
      );
      const flags = flagTrade(
        fairness, sc.side1, sc.side2,
        sc.intentionalImbalance ?? false,
      );

      if (flags.length > 0) {
        for (const f of flags) {
          allFlags.push(`[${target.label}] ${sc.name}: ${f}`);
        }
      }

      console.log(`\n  ${sc.name}`);
      console.log(`    Side A: ${sideLabel(sc.side1)}`);
      console.log(`    Side B: ${sideLabel(sc.side2)}`);
      console.log(
        `    Value A: ${fairness.side1Total}  |  ` +
          `Value B: ${fairness.side2Total}`,
      );
      console.log(
        `    Abs diff: ${Math.abs(fairness.delta)}  |  ` +
          `Raw %: ${fairness.pctDiff.toFixed(1)}%  |  ` +
          `Adj %: ${fairness.adjustedPctDiff.toFixed(1)}%`,
      );
      console.log(`    Verdict: ${fairness.verdict}`);
      if (flags.length > 0) {
        for (const f of flags) {
          console.log(`    ** ${f}`);
        }
      } else {
        console.log(`    OK`);
      }
    }

    // Pick value curve
    console.log(
      `\n  Draft pick value curve (${target.totalTeams}-team):`,
    );
    for (const rd of [1, 2, 3, 4, 5]) {
      const early = computePickValue(
        rd, 1, target.totalTeams, valStats, 0,
      );
      const mid = computePickValue(
        rd,
        Math.ceil(target.totalTeams / 2),
        target.totalTeams,
        valStats,
        0,
      );
      const late = computePickValue(
        rd, target.totalTeams, target.totalTeams, valStats, 0,
      );
      console.log(
        `    Rd${rd}: early=${early}  mid=${mid}  late=${late}`,
      );
    }
  }

  // ── Summary ─────────────────────────────────────────
  console.log(`\n${"=".repeat(80)}`);
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Leagues tested: ${selectedLeagues.length}`);
  console.log(`Total scenarios: ${totalScenarios}`);
  console.log(`Total flags: ${allFlags.length}`);
  if (allFlags.length > 0) {
    console.log("\nAll flags:");
    for (const f of allFlags) {
      console.log(`  ** ${f}`);
    }
  } else {
    console.log("\nAll scenarios passed without flags.");
  }
  console.log("=".repeat(80));

  process.exit(allFlags.length > 0 ? 1 : 0);
}

main();
