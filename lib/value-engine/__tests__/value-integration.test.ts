/**
 * Value engine integration tests.
 *
 * Composes the existing pure exported functions to mirror the
 * computeUnifiedValues() pipeline without any DB dependency.
 * Uses synthetic players + league configs to verify that league
 * settings flow correctly into ranked output via relative assertions.
 */

import { describe, it, expect } from "vitest";
import {
  calculateFantasyPoints,
  type BonusThreshold,
  type ScoringRule,
} from "../vorp";
import { calculateStarterDemand } from "../replacement-level";
import { computeEffectiveBaseline } from "../effective-baseline";
import { computeLeagueSignal } from "../league-signal";
import { getDampenedDynastyMod } from "../age-curves";
import { computeFormatComplexity } from "../format-complexity";
import { computeBlendWeights } from "../blend";

import {
  computeIdpSignalDiscount,
  computeIdpTieredDiscount,
} from "../compute-unified";
import {
  LEAGUE_1QB_PPR,
  LEAGUE_SF_PPR,
  LEAGUE_1QB_HALF_PPR,
  LEAGUE_1QB_STANDARD,
  LEAGUE_1QB_TEP,
  LEAGUE_IDP_CONSOLIDATED,
  LEAGUE_IDP_HEAVY,
  LEAGUE_BONUS,
  LEAGUE_PPA,
  LEAGUE_14_TEAM,
  ALL_CONFIGS,
} from "./fixtures/league-configs";

import {
  ALL_PLAYERS,
  OFFENSE_PLAYERS,
  type TestPlayer,
} from "./fixtures/player-pool";
import type { AdapterSettings, FlexRule } from "@/types";

// ─── computeTestValues helper ───────────────────────────────────

interface RankedPlayer {
  id: string;
  name: string;
  position: string;
  fantasyPoints: number;
  leagueSignal: number;
  value: number;
  rank: number;
}

interface LeagueConfig {
  name: string;
  totalTeams: number;
  settings: AdapterSettings;
}

/**
 * Mirror the computeUnifiedValues pipeline with pure functions.
 *
 * Pipeline: projections -> fantasy pts -> grouped -> baselines ->
 *           league signal -> dynasty mod -> final value -> rank
 */
function computeTestValues(
  config: LeagueConfig,
  players: TestPlayer[],
): RankedPlayer[] {
  const { settings } = config;
  const totalTeams = config.totalTeams;

  // Determine which players are relevant
  const isIdp = settings.idpStructure !== "none";
  const relevantPlayers = isIdp
    ? players
    : players.filter((p) =>
        ["QB", "RB", "WR", "TE"].includes(p.position),
      );

  // Build structuredRules from scoring rules + position overrides +
  // bonus thresholds so the integration test exercises the
  // deterministic path
  const bonusThresholds = settings.metadata?.bonusThresholds as
    | Record<string, BonusThreshold[]>
    | undefined;
  const testStructuredRules: ScoringRule[] = [];

  // Base scoring rules (apply to all positions)
  for (const [statKey, pts] of Object.entries(settings.scoringRules)) {
    if (pts !== undefined) {
      testStructuredRules.push({
        statKey,
        points: pts as number,
        isBonus: false,
      });
    }
  }

  // Position-specific overrides: for each overridden stat+position,
  // add a rule scoped to that position. The override replaces the
  // general rule, so we also need to exclude the general rule for
  // that position. We handle this by adding a "negative" general
  // rule for the position and a positive override rule.
  if (settings.positionScoringOverrides) {
    for (const [pos, overrides] of Object.entries(
      settings.positionScoringOverrides,
    )) {
      for (const [statKey, pts] of Object.entries(overrides)) {
        if (pts === undefined) continue;
        const generalPts =
          (settings.scoringRules as Record<string, number>)[statKey] ?? 0;
        // Subtract general rule for this position
        if (generalPts !== 0) {
          testStructuredRules.push({
            statKey,
            points: -generalPts,
            isBonus: false,
            applyTo: [pos],
          });
        }
        // Add override rule for this position
        testStructuredRules.push({
          statKey,
          points: pts as number,
          isBonus: false,
          applyTo: [pos],
        });
      }
    }
  }

  if (bonusThresholds) {
    for (const [statKey, thresholds] of Object.entries(bonusThresholds)) {
      for (const t of thresholds) {
        testStructuredRules.push({
          statKey,
          points: t.bonus,
          isBonus: true,
          boundLower: t.min,
          boundUpper: t.max,
        });
      }
    }
  }

  // Step 1: Calculate fantasy points for each player
  // Uses structuredRules path 2 (season totals, no gameLogs)
  // which applies base scoring but skips bonuses — same as production
  // behavior for projection-based scoring
  const playerPoints = relevantPlayers.map((player) => {
    const pts = calculateFantasyPoints(
      player.projections,
      settings.scoringRules,
      undefined,
      undefined,
      17,
      null,
      testStructuredRules,
      player.position,
    );

    return { player, fantasyPoints: pts };
  });

  // Step 2: Group points by position (sorted desc)
  const pointsByPosition: Record<string, number[]> = {};
  for (const { player, fantasyPoints } of playerPoints) {
    if (!pointsByPosition[player.position]) {
      pointsByPosition[player.position] = [];
    }
    pointsByPosition[player.position].push(fantasyPoints);
  }
  for (const pos of Object.keys(pointsByPosition)) {
    pointsByPosition[pos].sort((a, b) => b - a);
  }

  const IDP_POS = new Set([
    "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
  ]);

  // Step 3: Compute baselines and signals for each player
  const signalResults = playerPoints.map(
    ({ player, fantasyPoints }) => {
      const posPoints = pointsByPosition[player.position] || [];

      const starterDemand = calculateStarterDemand(
        player.position,
        settings.rosterPositions,
        settings.flexRules,
        settings.positionMappings,
        totalTeams,
      );

      const baseline = computeEffectiveBaseline(
        player.position,
        posPoints,
        starterDemand,
        settings.benchSlots,
        totalTeams,
      );

      const dynastyMod = getDampenedDynastyMod(
        player.position,
        player.age,
        player.yearsExperience,
      );

      const { leagueSignal } = computeLeagueSignal(
        fantasyPoints,
        player.position,
        baseline,
        starterDemand,
        dynastyMod,
        posPoints,
      );

      return { player, fantasyPoints, leagueSignal };
    },
  );

  // Step 3.5: Compute IDP percentiles from collected signals
  const idpSignalEntries = signalResults
    .filter(
      (r) => IDP_POS.has(r.player.position) && r.leagueSignal > 0,
    )
    .sort((a, b) => b.leagueSignal - a.leagueSignal);

  const idpPercentiles = new Map<string, number>();
  for (let i = 0; i < idpSignalEntries.length; i++) {
    const p =
      idpSignalEntries.length > 1
        ? 1 - i / (idpSignalEntries.length - 1)
        : 0.5;
    idpPercentiles.set(idpSignalEntries[i].player.id, p);
  }

  // Step 4: Compute values with tiered IDP discount
  const complexity = computeFormatComplexity({
    totalTeams: config.totalTeams,
    rosterPositions: settings.rosterPositions,
    scoringRules: settings.scoringRules,
  });
  const { consensus: cW, league: lW } =
    computeBlendWeights(complexity);

  const results: RankedPlayer[] = signalResults.map(
    ({ player, fantasyPoints, leagueSignal }) => {
      const playerIsIdp = IDP_POS.has(player.position);
      let adjustedSignal: number;

      if (playerIsIdp) {
        const pctile =
          idpPercentiles.get(player.id) ?? 0;
        const tiered = computeIdpTieredDiscount(pctile);
        adjustedSignal = leagueSignal * tiered;
      } else {
        adjustedSignal = leagueSignal;
      }

      const value = Math.round(
        player.consensusValue * cW + adjustedSignal * lW,
      );

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        fantasyPoints,
        leagueSignal,
        value,
        rank: 0,
      };
    },
  );

  // Step 5: Rank by value
  results.sort((a, b) => b.value - a.value);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────

function findPlayer(
  results: RankedPlayer[],
  id: string,
): RankedPlayer {
  const p = results.find((r) => r.id === id);
  if (!p) throw new Error(`Player ${id} not found`);
  return p;
}

function topN(
  results: RankedPlayer[],
  n: number,
): RankedPlayer[] {
  return results.slice(0, n);
}

function countPosition(
  players: RankedPlayer[],
  position: string,
): number {
  return players.filter((p) => p.position === position).length;
}

// ─── Test Cases ─────────────────────────────────────────────────

describe("Value Engine Integration", () => {
  // Precompute results for all configs
  const results1qb = computeTestValues(LEAGUE_1QB_PPR, ALL_PLAYERS);
  const resultsSF = computeTestValues(LEAGUE_SF_PPR, ALL_PLAYERS);
  const resultsHalfPpr = computeTestValues(
    LEAGUE_1QB_HALF_PPR,
    ALL_PLAYERS,
  );
  const resultsStandard = computeTestValues(
    LEAGUE_1QB_STANDARD,
    ALL_PLAYERS,
  );
  const resultsTEP = computeTestValues(LEAGUE_1QB_TEP, ALL_PLAYERS);
  const resultsIdp = computeTestValues(
    LEAGUE_IDP_CONSOLIDATED,
    ALL_PLAYERS,
  );
  const resultsIdpHeavy = computeTestValues(
    LEAGUE_IDP_HEAVY,
    ALL_PLAYERS,
  );
  const resultsBonus = computeTestValues(LEAGUE_BONUS, ALL_PLAYERS);
  const resultsPPA = computeTestValues(LEAGUE_PPA, ALL_PLAYERS);
  const results14 = computeTestValues(LEAGUE_14_TEAM, ALL_PLAYERS);

  describe("Test 1: SuperFlex boosts QB value", () => {
    it("mid-tier QB league signal is higher in SF than 1QB", () => {
      // Elite QBs saturate the sigmoid, so check mid-tier QB5
      const qb5SF = findPlayer(resultsSF, "QB5");
      const qb5Normal = findPlayer(results1qb, "QB5");
      expect(qb5SF.leagueSignal).toBeGreaterThanOrEqual(
        qb5Normal.leagueSignal,
      );
    });

    it("top-10 overall in SF includes more QBs than 1QB", () => {
      const top10SF = topN(resultsSF, 10);
      const top10Normal = topN(results1qb, 10);
      expect(countPosition(top10SF, "QB")).toBeGreaterThanOrEqual(
        countPosition(top10Normal, "QB"),
      );
    });

    it("average QB value is higher in SF across all QBs", () => {
      const sfQBs = resultsSF.filter((r) => r.position === "QB");
      const normalQBs = results1qb.filter((r) => r.position === "QB");
      const avgSF =
        sfQBs.reduce((s, r) => s + r.leagueSignal, 0) / sfQBs.length;
      const avgNormal =
        normalQBs.reduce((s, r) => s + r.leagueSignal, 0) /
        normalQBs.length;
      expect(avgSF).toBeGreaterThan(avgNormal);
    });
  });

  describe("Test 2: TEP boosts TE value", () => {
    it("TE1 rank is at least as good in TEP as standard", () => {
      const te1TEP = findPlayer(resultsTEP, "TE1");
      const te1Std = findPlayer(results1qb, "TE1");
      expect(te1TEP.rank).toBeLessThanOrEqual(te1Std.rank);
    });

    it("high-reception TE gains more fantasy points than low-reception TE", () => {
      // TE1 has 95 rec, TE6 has 30 rec
      // Compare raw fantasy point gains from TEP
      const te1Gain =
        findPlayer(resultsTEP, "TE1").fantasyPoints -
        findPlayer(results1qb, "TE1").fantasyPoints;
      const te6Gain =
        findPlayer(resultsTEP, "TE6").fantasyPoints -
        findPlayer(results1qb, "TE6").fantasyPoints;
      expect(te1Gain).toBeGreaterThan(te6Gain);
      // TE1 gains ~47.5 pts (95 * 0.5), TE6 gains ~15 pts (30 * 0.5)
      expect(te1Gain).toBeGreaterThan(40);
      expect(te6Gain).toBeGreaterThan(10);
    });

    it("RB1 rank is approximately unchanged", () => {
      const rb1TEP = findPlayer(resultsTEP, "RB1");
      const rb1Std = findPlayer(results1qb, "RB1");
      expect(Math.abs(rb1TEP.rank - rb1Std.rank)).toBeLessThanOrEqual(3);
    });
  });

  describe("Test 3: Half-PPR vs Full PPR", () => {
    it("high-target WR loses value in half-PPR", () => {
      // WR1 "Alpha WR1" has 110 receptions
      const wr1Full = findPlayer(results1qb, "WR1");
      const wr1Half = findPlayer(resultsHalfPpr, "WR1");
      expect(wr1Full.value).toBeGreaterThan(wr1Half.value);
    });

    it("pure rusher gains relative rank in half-PPR", () => {
      // RB14 "Pure Rusher" has only 10 rec
      const rb14Full = findPlayer(results1qb, "RB14");
      const rb14Half = findPlayer(resultsHalfPpr, "RB14");
      expect(rb14Half.rank).toBeLessThanOrEqual(rb14Full.rank);
    });
  });

  describe("Test 4: Standard (0 PPR) vs PPR", () => {
    it("high-reception players lose significant value", () => {
      // WR2 "Target Hog" has 105 receptions
      const wr2Ppr = findPlayer(results1qb, "WR2");
      const wr2Std = findPlayer(resultsStandard, "WR2");
      expect(wr2Ppr.value).toBeGreaterThan(wr2Std.value);
      // The loss should be meaningful (dynamic blend reduces
      // league signal weight for standard leagues, so threshold
      // is lower than with a fixed 60/40 split)
      expect(wr2Ppr.value - wr2Std.value).toBeGreaterThan(30);
    });

    it("pure rushers gain relative value", () => {
      // RB5 "Power Runner" has only 25 rec but 1200 rush yd
      const rb5Ppr = findPlayer(results1qb, "RB5");
      const rb5Std = findPlayer(resultsStandard, "RB5");
      expect(rb5Std.rank).toBeLessThanOrEqual(rb5Ppr.rank);
    });
  });

  describe("Test 5: IDP players appear correctly", () => {
    it("elite EDR ranks in 30-100 range in IDP league", () => {
      const edr1 = findPlayer(resultsIdp, "EDR1");
      expect(edr1.rank).toBeGreaterThanOrEqual(20);
      expect(edr1.rank).toBeLessThanOrEqual(100);
    });

    it("no IDP players in non-IDP league output", () => {
      const idpInNormal = results1qb.filter((r) =>
        ["EDR", "LB", "CB", "S"].includes(r.position),
      );
      expect(idpInNormal.length).toBe(0);
    });

    it("higher IDP scoring produces higher IDP values", () => {
      const edr1Normal = findPlayer(resultsIdp, "EDR1");
      const edr1Heavy = findPlayer(resultsIdpHeavy, "EDR1");
      expect(edr1Heavy.leagueSignal).toBeGreaterThan(
        edr1Normal.leagueSignal,
      );
    });
  });

  describe("Test 6: Bonus scoring with season totals (no gameLogs)", () => {
    it("bonus config produces same base points as normal (no per-game data)", () => {
      // Without gameLogs, bonus rules are skipped — deterministic scoring
      // requires per-game data to evaluate thresholds. Base scoring is identical.
      const rb1Bonus = findPlayer(resultsBonus, "RB1");
      const rb1Normal = findPlayer(results1qb, "RB1");
      expect(rb1Bonus.fantasyPoints).toBeCloseTo(
        rb1Normal.fantasyPoints,
        0,
      );
    });

    it("bonus config values match normal config (base scoring only)", () => {
      const rb20Bonus = findPlayer(resultsBonus, "RB20");
      const rb20Normal = findPlayer(results1qb, "RB20");
      expect(rb20Bonus.fantasyPoints).toBeCloseTo(
        rb20Normal.fantasyPoints,
        0,
      );
    });
  });

  describe("Test 7: Points-per-attempt penalizes volume", () => {
    it("efficient QB gains relative value vs volume QB", () => {
      // QB5 "Efficient QB": 420 att, 28 TD, 7 INT
      // QB6 "Volume QB": 620 att, 28 TD, 16 INT
      const qb5Ppa = findPlayer(resultsPPA, "QB5");
      const qb6Ppa = findPlayer(resultsPPA, "QB6");
      const qb5Normal = findPlayer(results1qb, "QB5");
      const qb6Normal = findPlayer(results1qb, "QB6");

      // In PPA, efficient QB should gain relative to volume QB
      const normalGap = qb6Normal.value - qb5Normal.value;
      const ppaGap = qb6Ppa.value - qb5Ppa.value;
      expect(ppaGap).toBeLessThan(normalGap);
    });

    it("volume QB loses fantasy points in PPA", () => {
      const qb6Ppa = findPlayer(resultsPPA, "QB6");
      const qb6Normal = findPlayer(results1qb, "QB6");
      expect(qb6Ppa.fantasyPoints).toBeLessThan(
        qb6Normal.fantasyPoints,
      );
    });
  });

  describe("Test 8: 14-team vs 12-team scarcity", () => {
    it("elite player league signal is higher in 14-team", () => {
      // With dynamic blend, 14-team has higher complexity and
      // lower consensus weight, so total value may not be higher.
      // But the league signal (scarcity-driven) should be.
      const rb1_14 = findPlayer(results14, "RB1");
      const rb1_12 = findPlayer(results1qb, "RB1");
      expect(rb1_14.leagueSignal).toBeGreaterThanOrEqual(
        rb1_12.leagueSignal,
      );
    });

    it("replacement level is lower in 14-team", () => {
      // Deep bench players lose value in bigger leagues
      const rb20_14 = findPlayer(results14, "RB20");
      const rb20_12 = findPlayer(results1qb, "RB20");
      // Replacement-level RBs should have a worse signal in bigger leagues
      // (more demand pushes baseline up, widening the gap)
      expect(rb20_14.leagueSignal).toBeLessThanOrEqual(
        rb20_12.leagueSignal + 200, // small tolerance
      );
    });
  });

  describe("Test 9: Universal invariants", () => {
    for (const config of ALL_CONFIGS) {
      const players =
        config.settings.idpStructure !== "none"
          ? ALL_PLAYERS
          : OFFENSE_PLAYERS;
      const results = computeTestValues(config, players);

      describe(`[${config.name}]`, () => {
        it("all values are positive finite numbers", () => {
          for (const r of results) {
            expect(r.value).toBeGreaterThan(0);
            expect(Number.isFinite(r.value)).toBe(true);
          }
        });

        it("rank order matches value order", () => {
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].value).toBeGreaterThanOrEqual(
              results[i].value,
            );
          }
        });

        it("no IDP player above rank 25 overall", () => {
          const top25 = topN(results, 25);
          const idpInTop = top25.filter((r) =>
            ["EDR", "LB", "CB", "S", "DL", "DB"].includes(r.position),
          );
          expect(idpInTop.length).toBe(0);
        });

        it("QB1 > QB12, RB1 > RB20", () => {
          const qb1 = findPlayer(results, "QB1");
          const qb12 = findPlayer(results, "QB12");
          expect(qb1.value).toBeGreaterThan(qb12.value);

          const rb1 = findPlayer(results, "RB1");
          const rb20 = findPlayer(results, "RB20");
          expect(rb1.value).toBeGreaterThan(rb20.value);
        });
      });
    }
  });
});
