import { describe, test, expect } from "vitest";
import {
  calculateVORP,
  calculateFantasyPoints,
  getPercentilePoints,
  scoreGame,
  type ScoringRule,
} from "../vorp";

describe("calculateVORP", () => {
  const createPointsArray = (count: number, startPoints: number, decrementPerPlayer: number) => {
    return Array.from({ length: count }, (_, i) => startPoints - i * decrementPerPlayer);
  };

  test("calculates basic VORP correctly", () => {
    const qbPoints = createPointsArray(50, 400, 6);

    const result = calculateVORP({
      playerPoints: 400,
      position: "QB",
      allPlayerPoints: { QB: qbPoints },
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
    });

    // Replacement rank with buffer: round(12 * 1.15) = 14
    expect(result.replacementRank).toBe(14);
    // Replacement points = qbPoints[13] = 400 - 13*6 = 322
    expect(result.replacementPoints).toBeCloseTo(322, 0);
    expect(result.vorp).toBeCloseTo(78, 0);
    expect(result.rankInPosition).toBe(1);
    expect(result.liquidityMultiplier).toBe(1.0);
  });

  test("VORP is 0 for below-replacement players", () => {
    const qbPoints = createPointsArray(50, 400, 6);

    const result = calculateVORP({
      playerPoints: 100,
      position: "QB",
      allPlayerPoints: { QB: qbPoints },
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
    });

    expect(result.vorp).toBe(0);
    expect(result.rankInPosition).toBeGreaterThan(12);
  });

  test("scarcity multiplier is higher for elite players", () => {
    const rbPoints = createPointsArray(100, 350, 3);

    const elite = calculateVORP({
      playerPoints: 350,
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
    });

    const starter = calculateVORP({
      playerPoints: 300,
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
    });

    expect(elite.scarcityMultiplier).toBeGreaterThan(starter.scarcityMultiplier);
  });

  test("handles position with no players gracefully", () => {
    const result = calculateVORP({
      playerPoints: 100,
      position: "QB",
      allPlayerPoints: { QB: [] },
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
    });

    expect(result.vorp).toBe(100);
    expect(result.replacementPoints).toBe(0);
  });

  test("normalized VORP accounts for positional demand", () => {
    const qbPoints = createPointsArray(50, 400, 4);
    const rbPoints = createPointsArray(100, 350, 2);

    const qb = calculateVORP({
      playerPoints: 380,
      position: "QB",
      allPlayerPoints: { QB: qbPoints, RB: rbPoints },
      rosterPositions: { QB: 1, RB: 2, FLEX: 1 },
      flexRules: [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      totalTeams: 12,
    });

    const rb = calculateVORP({
      playerPoints: 300,
      position: "RB",
      allPlayerPoints: { QB: qbPoints, RB: rbPoints },
      rosterPositions: { QB: 1, RB: 2, FLEX: 1 },
      flexRules: [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      totalTeams: 12,
    });

    expect(rb.normalizedVorp).toBeDefined();
    expect(qb.normalizedVorp).toBeDefined();
  });

  test("liquidityMultiplier scales normalizedVorp", () => {
    const rbPoints = createPointsArray(80, 350, 3);

    const base = calculateVORP({
      playerPoints: 350,
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
    });

    const boosted = calculateVORP({
      playerPoints: 350,
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      liquidityMultiplier: 1.2,
    });

    expect(boosted.liquidityMultiplier).toBe(1.2);
    expect(boosted.normalizedVorp).toBeCloseTo(
      base.normalizedVorp * 1.2,
      1,
    );
  });
});

describe("calculateFantasyPoints", () => {
  test("calculates basic fantasy points", () => {
    const projections = {
      pass_yd: 4000,
      pass_td: 30,
      int: 10,
    };

    const scoringRules = {
      pass_yd: 0.04,
      pass_td: 6,
      int: -3,
    };

    const points = calculateFantasyPoints(projections, scoringRules);

    expect(points).toBeCloseTo(4000 * 0.04 + 30 * 6 + 10 * -3, 1);
    expect(points).toBeCloseTo(310, 1); // 160 + 180 - 30
  });

  test("applies position overrides correctly", () => {
    const projections = {
      tackle_solo: 100,
      sack: 10,
    };

    const scoringRules = {
      tackle_solo: 1,
      sack: 2,
    };

    const positionOverrides = {
      tackle_solo: 2,
      sack: 6,
    };

    const pointsWithoutOverride = calculateFantasyPoints(projections, scoringRules);
    const pointsWithOverride = calculateFantasyPoints(projections, scoringRules, positionOverrides);

    expect(pointsWithoutOverride).toBe(100 * 1 + 10 * 2); // 120
    expect(pointsWithOverride).toBe(100 * 2 + 10 * 6); // 260
  });

  test("handles empty projections", () => {
    const points = calculateFantasyPoints({}, { pass_yd: 0.04 });
    expect(points).toBe(0);
  });

  test("handles missing scoring rules", () => {
    // rec_yd has no scoring rule — should contribute 0 points
    const projections = { rush_yd: 1000, rec_yd: 50 };
    const scoringRules = { rush_yd: 0.1 };

    const points = calculateFantasyPoints(projections, scoringRules);

    expect(points).toBe(100);
  });

  test("rejects non-canonical projection keys", () => {
    const projections = { rush_yd: 1000, mystery_stat: 50 };
    const scoringRules = { rush_yd: 0.1 };

    expect(() =>
      calculateFantasyPoints(
        projections as Record<string, number>,
        scoringRules,
      ),
    ).toThrow("Non-canonical projection stat keys: mystery_stat");
  });

  test("rejects non-canonical scoring rule keys", () => {
    const projections = { rush_yd: 1000 };
    const scoringRules = { rush_yd: 0.1, bad_key: 2.0 };

    expect(() =>
      calculateFantasyPoints(
        projections,
        scoringRules as Record<string, number>,
      ),
    ).toThrow("Non-canonical scoring rule keys: bad_key");
  });

  test("no bonuses without gameLogs (fallback path)", () => {
    const projections = { rush_yd: 1400 };
    const scoringRules = { rush_yd: 0.1 };
    const bonusThresholds = {
      rush_yd: [{ min: 100, max: 149, bonus: 3 }],
    };
    const pts = calculateFantasyPoints(
      projections,
      scoringRules,
      undefined,
      bonusThresholds,
      17,
    );
    // Fallback path: base scoring only, bonuses skipped
    expect(pts).toBeCloseTo(140, 1);
  });

  test("deterministic bonus from gameLogs + structuredRules", () => {
    const rules: ScoringRule[] = [
      { statKey: "rush_yd", points: 0.1, isBonus: false },
      { statKey: "rush_yd", points: 3, isBonus: true,
        boundLower: 100 },
    ];
    const gameLogs = {
      1: { rush_yd: 120 },  // hits bonus
      2: { rush_yd: 80 },   // misses
      3: { rush_yd: 150 },  // hits bonus
    };
    // Per-game: (120*0.1+3) + (80*0.1) + (150*0.1+3) = 41
    const pts = calculateFantasyPoints(
      { rush_yd: 350 }, {}, undefined, undefined, 3,
      gameLogs, rules, "RB",
    );
    expect(pts).toBeCloseTo(41, 1);
  });

  test("structuredRules without gameLogs skips bonuses", () => {
    const rules: ScoringRule[] = [
      { statKey: "rush_yd", points: 0.1, isBonus: false },
      { statKey: "rush_yd", points: 3, isBonus: true,
        boundLower: 100 },
    ];
    const pts = calculateFantasyPoints(
      { rush_yd: 1400 }, {}, undefined, undefined, 17,
      null, rules, "RB",
    );
    // Base scoring only (bonus rules filtered out): 1400 * 0.1 = 140
    expect(pts).toBeCloseTo(140, 1);
  });
});

describe("getPercentilePoints", () => {
  test("returns correct percentile", () => {
    const points = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

    expect(getPercentilePoints(points, 0)).toBe(100);
    expect(getPercentilePoints(points, 50)).toBe(50);
    expect(getPercentilePoints(points, 100)).toBe(10);
  });

  test("handles empty array", () => {
    expect(getPercentilePoints([], 50)).toBe(0);
  });

  test("handles single element", () => {
    expect(getPercentilePoints([100], 50)).toBe(100);
  });
});

describe("invariants", () => {
  test("VORP is never negative", () => {
    const points = [400, 380, 360, 340, 320, 300, 280, 260, 240, 220, 200, 180, 160];

    for (let p = 0; p <= 500; p += 50) {
      const result = calculateVORP({
        playerPoints: p,
        position: "QB",
        allPlayerPoints: { QB: points },
        rosterPositions: { QB: 1 },
        flexRules: [],
        totalTeams: 12,
      });

      expect(result.vorp).toBeGreaterThanOrEqual(0);
    }
  });

  test("scarcity multiplier is always >= 1", () => {
    const points = Array.from({ length: 100 }, (_, i) => 400 - i * 3);

    for (let rank = 1; rank <= 100; rank++) {
      const result = calculateVORP({
        playerPoints: points[rank - 1],
        position: "RB",
        allPlayerPoints: { RB: points },
        rosterPositions: { RB: 2 },
        flexRules: [],
        totalTeams: 12,
      });

      expect(result.scarcityMultiplier).toBeGreaterThanOrEqual(1);
    }
  });

  test("normalized VORP is always finite", () => {
    const configs = [
      { totalTeams: 4 },
      { totalTeams: 40 },
      { totalTeams: 12 },
    ];

    const points = [350, 340, 330, 320, 310, 300];

    for (const config of configs) {
      const result = calculateVORP({
        playerPoints: 350,
        position: "RB",
        allPlayerPoints: { RB: points },
        rosterPositions: { RB: 2 },
        flexRules: [],
        ...config,
      });

      expect(Number.isFinite(result.normalizedVorp)).toBe(true);
      expect(Number.isFinite(result.vorp)).toBe(true);
      expect(Number.isFinite(result.scarcityMultiplier)).toBe(true);
    }
  });

  test("fantasy points calculation produces finite numbers", () => {
    const projections = {
      pass_yd: 5000,
      pass_td: 50,
      rush_yd: 500,
      rush_td: 5,
      int: 15,
      fum: 3,
    };

    const scoringRules = {
      pass_yd: 0.04,
      pass_td: 6,
      rush_yd: 0.1,
      rush_td: 6,
      int: -3,
      fum: -2,
    };

    const points = calculateFantasyPoints(projections, scoringRules);

    expect(Number.isFinite(points)).toBe(true);
    expect(points).toBeGreaterThan(0);
  });
});

describe("scoreGame", () => {
  test("base scoring: stat * points", () => {
    const rules: ScoringRule[] = [
      { statKey: "pass_yd", points: 0.04, isBonus: false },
      { statKey: "pass_td", points: 4, isBonus: false },
    ];
    const pts = scoreGame(
      { pass_yd: 300, pass_td: 3 }, rules, "QB",
    );
    expect(pts).toBeCloseTo(24, 1); // 300*0.04 + 3*4
  });

  test("forEvery: floor division", () => {
    const rules: ScoringRule[] = [
      { statKey: "pass_cmp", points: 1, forEvery: 4,
        isBonus: false },
    ];
    expect(scoreGame({ pass_cmp: 23 }, rules, "QB")).toBe(5);
  });

  test("applyTo filters by position", () => {
    const rules: ScoringRule[] = [
      { statKey: "tackle_solo", points: 2, isBonus: false,
        applyTo: ["LB", "DL", "DB"] },
    ];
    expect(scoreGame({ tackle_solo: 5 }, rules, "LB")).toBe(10);
    expect(scoreGame({ tackle_solo: 5 }, rules, "WR")).toBe(0);
  });

  test("bonus awarded when stat in range", () => {
    const rules: ScoringRule[] = [
      { statKey: "tackle_solo", points: 2, isBonus: true,
        boundLower: 6, boundUpper: 8 },
    ];
    expect(scoreGame({ tackle_solo: 7 }, rules, "LB")).toBe(2);
  });

  test("bonus skipped below threshold", () => {
    const rules: ScoringRule[] = [
      { statKey: "tackle_solo", points: 2, isBonus: true,
        boundLower: 6 },
    ];
    expect(scoreGame({ tackle_solo: 4 }, rules, "LB")).toBe(0);
  });

  test("bonus with upper bound - above max = 0", () => {
    const rules: ScoringRule[] = [
      { statKey: "rush_yd", points: 3, isBonus: true,
        boundLower: 100, boundUpper: 149 },
    ];
    expect(scoreGame({ rush_yd: 160 }, rules, "RB")).toBe(0);
  });

  test("empty stats returns 0", () => {
    const rules: ScoringRule[] = [
      { statKey: "pass_yd", points: 0.04, isBonus: false },
    ];
    expect(scoreGame({}, rules, "QB")).toBe(0);
  });
});
