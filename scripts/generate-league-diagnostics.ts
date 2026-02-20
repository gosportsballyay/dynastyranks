#!/usr/bin/env tsx
/**
 * League Diagnostics Generator
 *
 * Compares ranking behavior across all Test02-2026 leagues.
 * Outputs JSON + console summary for internal validation.
 */

import { db } from "../lib/db/client";
import {
  leagues,
  leagueSettings,
  playerValues,
  canonicalPlayers,
} from "../lib/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { writeFileSync } from "fs";
import { resolve } from "path";

const TEST_USER_ID = "1a1786c0-6792-4c92-8cc6-57af880cb424";

const ANCHOR_PLAYERS = [
  { name: "Josh Allen", idpOnly: false },
  { name: "CeeDee Lamb", idpOnly: false },
  { name: "Christian McCaffrey", idpOnly: false },
  { name: "Nico Collins", idpOnly: false },
  { name: "Travis Kelce", idpOnly: false },
  { name: "Micah Parsons", idpOnly: true },
  { name: "Roquan Smith", idpOnly: true },
];

const POSITION_GROUPS = [
  "QB", "RB", "WR", "TE", "LB", "DL", "EDR", "DB", "CB", "S",
];

interface AnchorEntry {
  name: string;
  position: string;
  rank: number | null;
  rankInPosition: number | null;
  value: number | null;
  leagueId: string;
  leagueName: string;
  idpOnly: boolean;
}

interface LeagueDiagnostics {
  leagueId: string;
  leagueName: string;
  format: {
    teams: number;
    superFlex: boolean;
    idpStructure: string | null;
    idpSlots: number;
    rosterPositions: Record<string, number>;
  };
  top10Overall: Array<{
    name: string;
    position: string;
    rank: number;
    value: number;
  }>;
  top5ByPosition: Record<
    string,
    Array<{ name: string; rank: number; value: number }>
  >;
  metrics: {
    maxValue: number;
    valueAtRank10: number | null;
    valueAtRank25: number | null;
    valueAtRank50: number | null;
    replacementTierCutoff: number;
    countOfIDPInTop50: number;
    countOfQBInTop25: number;
    totalPlayersValued: number;
  };
  anchors: AnchorEntry[];
}

interface DiagnosticsOutput {
  generated: string;
  engineVersion: string | null;
  leagueCount: number;
  leagues: LeagueDiagnostics[];
  anchorComparison: Record<string, AnchorEntry[]>;
}

/** Detect SF from roster positions JSON. */
function isSuperFlex(
  rosterPositions: Record<string, number>,
): boolean {
  return (
    (rosterPositions["SUPER_FLEX"] ?? 0) > 0 ||
    (rosterPositions["QB"] ?? 0) >= 2
  );
}

/** Count IDP starter slots. */
function countIdpSlots(
  rosterPositions: Record<string, number>,
): number {
  const idpKeys = [
    "IDP_FLEX", "DB", "DL", "LB", "CB", "S",
    "DE", "DT", "EDR", "IL",
  ];
  return idpKeys.reduce(
    (sum, k) => sum + (rosterPositions[k] ?? 0),
    0,
  );
}

/** Estimate starter count for replacement tier. */
function starterCount(
  rosterPositions: Record<string, number>,
  teams: number,
): number {
  const nonBenchKeys = Object.entries(rosterPositions)
    .filter(([k]) => !["BN", "IR", "TAXI"].includes(k))
    .reduce((sum, [, v]) => sum + v, 0);
  return nonBenchKeys * teams;
}

async function main() {
  console.log("=== League Diagnostics Generator ===\n");

  // Load all test leagues with settings
  const testLeagues = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      totalTeams: leagues.totalTeams,
      idpStructure: leagueSettings.idpStructure,
      rosterPositions: leagueSettings.rosterPositions,
    })
    .from(leagues)
    .innerJoin(
      leagueSettings,
      eq(leagues.id, leagueSettings.leagueId),
    )
    .where(eq(leagues.userId, TEST_USER_ID));

  console.log(`Found ${testLeagues.length} test leagues\n`);

  // Resolve anchor player IDs
  const anchorNames = ANCHOR_PLAYERS.map((a) => a.name);
  const anchorIdpMap = new Map(
    ANCHOR_PLAYERS.map((a) => [a.name, a.idpOnly]),
  );

  const anchorRows = await db
    .select({
      id: canonicalPlayers.id,
      name: canonicalPlayers.name,
      position: canonicalPlayers.position,
    })
    .from(canonicalPlayers)
    .where(inArray(canonicalPlayers.name, anchorNames));

  const anchorMap = new Map(
    anchorRows.map((r) => [r.name, r]),
  );

  let engineVersion: string | null = null;
  const allDiagnostics: LeagueDiagnostics[] = [];
  const anchorComparison: Record<string, AnchorEntry[]> = {};

  for (const anchor of ANCHOR_PLAYERS) {
    anchorComparison[anchor.name] = [];
  }

  for (const league of testLeagues) {
    const rp = (league.rosterPositions ?? {}) as Record<
      string,
      number
    >;
    const sf = isSuperFlex(rp);
    const idpSlots = countIdpSlots(rp);
    const starters = starterCount(
      rp,
      league.totalTeams ?? 12,
    );

    // Load top 100 player values with player info
    const values = await db
      .select({
        rank: playerValues.rank,
        rankInPosition: playerValues.rankInPosition,
        value: playerValues.value,
        projectedPoints: playerValues.projectedPoints,
        engineVersion: playerValues.engineVersion,
        playerName: canonicalPlayers.name,
        playerPosition: canonicalPlayers.position,
        canonicalPlayerId: playerValues.canonicalPlayerId,
      })
      .from(playerValues)
      .innerJoin(
        canonicalPlayers,
        eq(
          playerValues.canonicalPlayerId,
          canonicalPlayers.id,
        ),
      )
      .where(eq(playerValues.leagueId, league.id))
      .orderBy(asc(playerValues.rank))
      .limit(100);

    if (values.length > 0 && !engineVersion) {
      engineVersion = values[0].engineVersion;
    }

    // Total count for this league
    const allValues = await db
      .select({ rank: playerValues.rank })
      .from(playerValues)
      .where(eq(playerValues.leagueId, league.id));

    // Top 10 overall
    const top10 = values.slice(0, 10).map((v) => ({
      name: v.playerName ?? "Unknown",
      position: v.playerPosition ?? "?",
      rank: v.rank ?? 0,
      value: Math.round(v.value ?? 0),
    }));

    // Top 5 by position
    const top5ByPosition: Record<
      string,
      Array<{ name: string; rank: number; value: number }>
    > = {};

    for (const pos of POSITION_GROUPS) {
      const posPlayers = values
        .filter((v) => v.playerPosition === pos)
        .slice(0, 5)
        .map((v) => ({
          name: v.playerName ?? "Unknown",
          rank: v.rank ?? 0,
          value: Math.round(v.value ?? 0),
        }));
      if (posPlayers.length > 0) {
        top5ByPosition[pos] = posPlayers;
      }
    }

    // Metrics
    const maxValue = values.length > 0
      ? Math.round(values[0].value ?? 0)
      : 0;
    const atRank = (r: number) => {
      const v = values.find((val) => val.rank === r);
      return v ? Math.round(v.value ?? 0) : null;
    };

    const idpPositions = new Set([
      "LB", "DL", "EDR", "IL", "DB", "CB", "S", "DE", "DT",
    ]);
    const top50 = values.slice(0, 50);
    const top25 = values.slice(0, 25);

    const countIDP = top50.filter((v) =>
      idpPositions.has(v.playerPosition ?? ""),
    ).length;
    const countQB = top25.filter(
      (v) => v.playerPosition === "QB",
    ).length;

    // Anchors for this league (skip IDP anchors for non-IDP leagues)
    const leagueHasIdp = idpSlots > 0;
    const leagueAnchors: AnchorEntry[] = [];
    for (const anchor of ANCHOR_PLAYERS) {
      if (anchor.idpOnly && !leagueHasIdp) continue;

      const anchorName = anchor.name;
      const player = anchorMap.get(anchorName);
      if (!player) {
        leagueAnchors.push({
          name: anchorName,
          position: "?",
          rank: null,
          rankInPosition: null,
          value: null,
          leagueId: league.id,
          leagueName: league.name ?? "",
          idpOnly: anchor.idpOnly,
        });
        continue;
      }

      const pv = values.find(
        (v) => v.canonicalPlayerId === player.id,
      );

      // If not in top 100, check full table
      let anchorRank = pv?.rank ?? null;
      let anchorRankPos = pv?.rankInPosition ?? null;
      let anchorValue = pv ? Math.round(pv.value ?? 0) : null;

      if (!pv) {
        const [full] = await db
          .select({
            rank: playerValues.rank,
            rankInPosition: playerValues.rankInPosition,
            value: playerValues.value,
          })
          .from(playerValues)
          .where(
            and(
              eq(playerValues.leagueId, league.id),
              eq(
                playerValues.canonicalPlayerId,
                player.id,
              ),
            ),
          )
          .limit(1);

        if (full) {
          anchorRank = full.rank;
          anchorRankPos = full.rankInPosition;
          anchorValue = Math.round(full.value ?? 0);
        }
      }

      const entry: AnchorEntry = {
        name: anchorName,
        position: player.position ?? "?",
        rank: anchorRank,
        rankInPosition: anchorRankPos,
        value: anchorValue,
        leagueId: league.id,
        leagueName: league.name ?? "",
        idpOnly: anchor.idpOnly,
      };
      leagueAnchors.push(entry);
      anchorComparison[anchorName].push(entry);
    }

    const diag: LeagueDiagnostics = {
      leagueId: league.id,
      leagueName: league.name ?? "",
      format: {
        teams: league.totalTeams ?? 0,
        superFlex: sf,
        idpStructure: league.idpStructure,
        idpSlots,
        rosterPositions: rp,
      },
      top10Overall: top10,
      top5ByPosition,
      metrics: {
        maxValue: maxValue,
        valueAtRank10: atRank(10),
        valueAtRank25: atRank(25),
        valueAtRank50: atRank(50),
        replacementTierCutoff: starters,
        countOfIDPInTop50: countIDP,
        countOfQBInTop25: countQB,
        totalPlayersValued: allValues.length,
      },
      anchors: leagueAnchors,
    };

    allDiagnostics.push(diag);
  }

  // Sort by team count for readable output
  allDiagnostics.sort(
    (a, b) => a.format.teams - b.format.teams,
  );

  const output: DiagnosticsOutput = {
    generated: new Date().toISOString(),
    engineVersion,
    leagueCount: allDiagnostics.length,
    leagues: allDiagnostics,
    anchorComparison,
  };

  // Write JSON
  const outPath = resolve(
    __dirname,
    "../test-data/league-diagnostics.json",
  );
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}\n`);

  // Console summary
  console.log(
    "=".repeat(90),
  );
  console.log(
    "LEAGUE".padEnd(32) +
      "FMT".padEnd(10) +
      "SF".padEnd(5) +
      "IDP".padEnd(6) +
      "MAX".padEnd(8) +
      "R10".padEnd(8) +
      "R50".padEnd(8) +
      "QB25".padEnd(6) +
      "IDP50".padEnd(6),
  );
  console.log(
    "=".repeat(90),
  );

  for (const d of allDiagnostics) {
    const fmt = `${d.format.teams}t`;
    const sf = d.format.superFlex ? "Y" : "N";
    const idp = d.format.idpSlots > 0
      ? `${d.format.idpSlots}sl`
      : "N";
    console.log(
      d.leagueName.slice(0, 30).padEnd(32) +
        fmt.padEnd(10) +
        sf.padEnd(5) +
        idp.padEnd(6) +
        String(d.metrics.maxValue).padEnd(8) +
        String(d.metrics.valueAtRank10 ?? "-").padEnd(8) +
        String(d.metrics.valueAtRank50 ?? "-").padEnd(8) +
        String(d.metrics.countOfQBInTop25).padEnd(6) +
        String(d.metrics.countOfIDPInTop50).padEnd(6),
    );

    // Top 3 overall
    for (const p of d.top10Overall.slice(0, 3)) {
      console.log(
        `  ${p.rank}. ${p.name} (${p.position}) ${p.value}`,
      );
    }
    console.log();
  }

  // Anchor comparison
  console.log(
    "\n" + "=".repeat(90),
  );
  console.log("ANCHOR PLAYER COMPARISON");
  console.log(
    "=".repeat(90),
  );

  for (const [name, entries] of Object.entries(
    anchorComparison,
  )) {
    const isIdp = anchorIdpMap.get(name) ?? false;
    const tag = isIdp ? " [IDP only]" : "";
    console.log(`\n${name}${tag}:`);
    const sorted = [...entries].sort(
      (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
    );
    for (const e of sorted) {
      const fmt = `${allDiagnostics.find((d) => d.leagueId === e.leagueId)?.format.teams ?? "?"}t`;
      console.log(
        `  ${e.leagueName.slice(0, 28).padEnd(30)} ${fmt.padEnd(5)} ` +
          `rank=${String(e.rank ?? "-").padEnd(5)} ` +
          `val=${String(e.value ?? "-").padEnd(7)} ` +
          `pos=${e.position}${e.rankInPosition ? "#" + e.rankInPosition : ""}`,
      );
    }
  }

  console.log("\n=== Done ===");
}

main();
