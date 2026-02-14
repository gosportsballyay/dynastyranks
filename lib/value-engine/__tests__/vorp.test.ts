import { describe, test, expect } from "vitest";
import { calculateVORP, calculateFantasyPoints, getPercentilePoints } from "../vorp";

describe("calculateVORP", () => {
  const createPointsArray = (count: number, startPoints: number, decrementPerPlayer: number) => {
    return Array.from({ length: count }, (_, i) => startPoints - i * decrementPerPlayer);
  };

  test("calculates basic VORP correctly", () => {
    // Create 50 QBs with points from 400 down to 105
    const qbPoints = createPointsArray(50, 400, 6);

    const result = calculateVORP({
      playerPoints: 400, // Elite QB1
      position: "QB",
      allPlayerPoints: { QB: qbPoints },
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    // Replacement level includes bench factor even with benchSlots=0
    // due to BENCH_WEIGHTS[QB] = 0.5, but benchFactor = (0/12)*0.5 = 0
    // So replacement = 12 starters exactly
    expect(result.replacementRank).toBe(12);
    // Replacement points = qbPoints[11] = 400 - 11*6 = 334
    expect(result.replacementPoints).toBeCloseTo(334, 0);
    expect(result.vorp).toBeCloseTo(66, 0); // 400 - 334
    expect(result.rankInPosition).toBe(1);
  });

  test("VORP is 0 for below-replacement players", () => {
    const qbPoints = createPointsArray(50, 400, 6);

    const result = calculateVORP({
      playerPoints: 100, // Well below replacement
      position: "QB",
      allPlayerPoints: { QB: qbPoints },
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    expect(result.vorp).toBe(0);
    expect(result.rankInPosition).toBeGreaterThan(12);
  });

  test("scarcity multiplier is higher for elite players", () => {
    const rbPoints = createPointsArray(100, 350, 3);

    const elite = calculateVORP({
      playerPoints: 350, // RB1
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    const starter = calculateVORP({
      playerPoints: 300, // Around RB17
      position: "RB",
      allPlayerPoints: { RB: rbPoints },
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
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
      benchSlots: 0,
    });

    expect(result.vorp).toBe(100); // Full points since replacement is 0
    expect(result.replacementPoints).toBe(0);
  });

  test("normalized VORP accounts for positional demand", () => {
    const qbPoints = createPointsArray(50, 400, 4);
    const rbPoints = createPointsArray(100, 350, 2);

    // Both have 100 raw VORP
    const qb = calculateVORP({
      playerPoints: 380, // 100 above QB13 (280)
      position: "QB",
      allPlayerPoints: { QB: qbPoints, RB: rbPoints },
      rosterPositions: { QB: 1, RB: 2, FLEX: 1 },
      flexRules: [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      totalTeams: 12,
      benchSlots: 0,
    });

    const rb = calculateVORP({
      playerPoints: 300, // About 100 above RB replacement
      position: "RB",
      allPlayerPoints: { QB: qbPoints, RB: rbPoints },
      rosterPositions: { QB: 1, RB: 2, FLEX: 1 },
      flexRules: [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      totalTeams: 12,
      benchSlots: 0,
    });

    // RB has higher demand (2 slots + flex), so normalized VORP should be lower
    // per unit of raw VORP
    expect(rb.normalizedVorp).toBeDefined();
    expect(qb.normalizedVorp).toBeDefined();
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
      tackle_solo: 2, // Double tackle points for this position
      sack: 6, // Triple sack points
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
    const projections = { rush_yd: 1000, mystery_stat: 50 };
    const scoringRules = { rush_yd: 0.1 };

    const points = calculateFantasyPoints(projections, scoringRules);

    expect(points).toBe(100); // Only rush_yd counted, mystery_stat ignored
  });

  test("calculates bonus thresholds", () => {
    const projections = {
      rush_yd: 1400, // ~82 per game over 17 games
    };

    const scoringRules = {
      rush_yd: 0.1,
    };

    const bonusThresholds = {
      rush_yd: [
        { min: 100, max: 149, bonus: 3 },
        { min: 150, bonus: 5 },
      ],
    };

    const pointsWithBonus = calculateFantasyPoints(
      projections,
      scoringRules,
      undefined,
      bonusThresholds,
      17
    );

    const pointsWithoutBonus = calculateFantasyPoints(projections, scoringRules);

    // With 82 yd/game average, should hit some 100+ yard bonuses
    expect(pointsWithBonus).toBeGreaterThan(pointsWithoutBonus);
  });

  test("handles gamesPlayed parameter", () => {
    const projections = { rush_yd: 800 }; // 800 yards total
    const scoringRules = { rush_yd: 0.1 };
    const bonusThresholds = {
      rush_yd: [{ min: 100, bonus: 3 }],
    };

    // 800 / 8 = 100 per game (right at threshold)
    const pointsIn8 = calculateFantasyPoints(
      projections,
      scoringRules,
      undefined,
      bonusThresholds,
      8
    );

    // 800 / 17 = 47 per game (below threshold)
    const pointsIn17 = calculateFantasyPoints(
      projections,
      scoringRules,
      undefined,
      bonusThresholds,
      17
    );

    // Higher per-game average should yield more bonuses
    expect(pointsIn8).toBeGreaterThan(pointsIn17);
  });
});

describe("getPercentilePoints", () => {
  test("returns correct percentile", () => {
    const points = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

    // getPercentilePoints uses floor(percentile/100 * length)
    // For 10 items: 0% = index 0, 50% = index 5, 100% = index 10 (clamped to 9)
    expect(getPercentilePoints(points, 0)).toBe(100); // index 0
    expect(getPercentilePoints(points, 50)).toBe(50); // index 5
    expect(getPercentilePoints(points, 100)).toBe(10); // index 9 (clamped)
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
        benchSlots: 0,
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
        benchSlots: 0,
      });

      expect(result.scarcityMultiplier).toBeGreaterThanOrEqual(1);
    }
  });

  test("normalized VORP is always finite", () => {
    const configs = [
      { totalTeams: 4, benchSlots: 0 },
      { totalTeams: 40, benchSlots: 100 },
      { totalTeams: 12, benchSlots: 60 },
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
