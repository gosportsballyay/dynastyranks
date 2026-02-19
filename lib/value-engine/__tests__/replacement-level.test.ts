import { describe, test, expect } from "vitest";
import {
  calculateReplacementLevel,
  calculateAllReplacementLevels,
  calculateStarterDemand,
  calculateLiquidityMultiplier,
} from "../replacement-level";

/**
 * Helper: create a descending points array.
 */
function makePoints(
  count: number,
  start: number,
  decrement: number,
): number[] {
  return Array.from(
    { length: count },
    (_, i) => start - i * decrement,
  );
}

describe("calculateReplacementLevel", () => {
  test("calculates basic replacement with buffer", () => {
    const result = calculateReplacementLevel({
      position: "QB",
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: {},
    });

    // 12 * 1.15 = 13.8 → round = 14
    expect(result).toBe(14);
  });

  test("scales replacement level with team count", () => {
    // Provide enough QBs so production cap doesn't truncate
    const qbPts = makePoints(50, 400, 5);
    const base = {
      position: "QB",
      rosterPositions: { QB: 1 },
      flexRules: [],
      allPlayerPoints: { QB: qbPts },
    };

    const r12 = calculateReplacementLevel({
      ...base,
      totalTeams: 12,
    });
    const r24 = calculateReplacementLevel({
      ...base,
      totalTeams: 24,
    });

    expect(r24).toBeGreaterThan(r12);
    // 12*1.15 = 13.8→14, 24*1.15 = 27.6→28
    expect(r12).toBe(14);
    expect(r24).toBe(28);
  });

  test("handles multiple starter slots", () => {
    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: {},
    });

    // 24 * 1.15 = 27.6 → 28
    expect(result).toBe(28);
  });

  test("includes flex demand with equal-split fallback", () => {
    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2, FLEX: 1 },
      flexRules: [
        { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
      ],
      totalTeams: 12,
      allPlayerPoints: {},
    });

    // direct: 24, flex equal-split: 12/3 = 4, total: 28
    // buffered: 28 * 1.15 = 32.2 → 32
    expect(result).toBe(32);
  });

  test("dynamic flex allocates by surplus production", () => {
    // RB has strong surplus, WR/TE weaker
    const pts = {
      RB: makePoints(60, 300, 3),  // 300, 297, 294, ...
      WR: makePoints(60, 250, 3),  // 250, 247, 244, ...
      TE: makePoints(30, 180, 5),  // 180, 175, 170, ...
    };

    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2, WR: 2, TE: 1, FLEX: 1 },
      flexRules: [
        { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
      ],
      totalTeams: 12,
      allPlayerPoints: pts,
    });

    // RB direct: 24, plus dynamic flex share > equal third
    // With projections, RB surplus should be meaningful
    expect(result).toBeGreaterThan(28);
  });

  test("handles position mappings for consolidated IDP", () => {
    const result = calculateReplacementLevel({
      position: "CB",
      rosterPositions: { DB: 2 },
      flexRules: [],
      positionMappings: { DB: ["CB", "S"] },
      totalTeams: 12,
      allPlayerPoints: {},
    });

    // 12 * 2 / 2 = 12, buffered: 12 * 1.15 = 13.8 → 14
    expect(result).toBe(14);
  });

  test("returns minimum of 1 even with no slots", () => {
    const result = calculateReplacementLevel({
      position: "K",
      rosterPositions: {},
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: {},
    });

    expect(result).toBe(1);
  });
});

describe("production cap", () => {
  test("caps when points drop off sharply", () => {
    // 20 good QBs then a cliff: points drop below 65% avg
    const qbPoints = [
      ...makePoints(20, 400, 5),  // 400 down to 305
      ...makePoints(30, 150, 3),  // cliff to 150, 147, ...
    ];

    const result = calculateReplacementLevel({
      position: "QB",
      rosterPositions: { QB: 2 },
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: { QB: qbPoints },
    });

    // Without cap: 24 * 1.15 = 27.6 → 28
    // With cap: avg of top 28 starters includes cliff players,
    // cap should trigger before 28 since cliff at rank 20
    // Floor for QB is 16, so result should be between 16 and 28
    expect(result).toBeGreaterThanOrEqual(16);
    expect(result).toBeLessThanOrEqual(28);
  });

  test("floor prevents unreasonably low cap", () => {
    // Only 5 QBs with data — cap would be tiny without floor
    const qbPoints = makePoints(5, 400, 10);

    const result = calculateReplacementLevel({
      position: "QB",
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: { QB: qbPoints },
    });

    // Floor for QB is 16, buffered demand is 14
    // min(14, 16) = 14 since buffered < floor,
    // but cap = max(floor, dataResult) = 16
    // result = min(14, 16) = 14
    expect(result).toBe(14);
  });

  test("ceiling enforces hard max", () => {
    // Huge league with tons of QBs
    const qbPoints = makePoints(200, 500, 1);

    const result = calculateReplacementLevel({
      position: "QB",
      rosterPositions: { QB: 2 },
      flexRules: [],
      totalTeams: 40,
      allPlayerPoints: { QB: qbPoints },
    });

    // buffered = 80 * 1.15 = 92, QB ceiling = 36
    // result = min(92, 36) = 36
    expect(result).toBe(36);
  });

  test("empty projections fall back to floor cap", () => {
    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      allPlayerPoints: {},
    });

    // buffered = 24 * 1.15 = 27.6 → 28
    // With empty {}, productionCap uses floor (RB: 32)
    // min(28, 32) = 28
    expect(result).toBe(28);
  });
});

describe("calculateAllReplacementLevels", () => {
  test("calculates levels for all roster positions", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, RB: 2, WR: 2, TE: 1 },
      [],
      undefined,
      12,
      {},
    );

    // All use buffer: 14, 28, 28, 14
    expect(levels.QB).toBe(14);
    expect(levels.RB).toBe(28);
    expect(levels.WR).toBe(28);
    expect(levels.TE).toBe(14);
  });

  test("includes positions from flex rules", () => {
    const levels = calculateAllReplacementLevels(
      { FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      12,
      {},
    );

    expect(levels.RB).toBeDefined();
    expect(levels.WR).toBeDefined();
    expect(levels.TE).toBeDefined();
  });

  test("includes granular positions from mappings", () => {
    const levels = calculateAllReplacementLevels(
      { DB: 1 },
      [],
      { DB: ["CB", "S"] },
      12,
      {},
    );

    expect(levels.CB).toBeDefined();
    expect(levels.S).toBeDefined();
  });

  test("excludes bench/taxi/IR from positions", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, BN: 6, TAXI: 3, IR: 2 },
      [],
      undefined,
      12,
      {},
    );

    expect(levels.QB).toBeDefined();
    expect(levels.BN).toBeUndefined();
    expect(levels.TAXI).toBeUndefined();
    expect(levels.IR).toBeUndefined();
  });
});

describe("calculateStarterDemand", () => {
  test("calculates demand for direct starters", () => {
    const demand = calculateStarterDemand(
      "RB",
      { RB: 2 },
      [],
      undefined,
      12,
    );

    expect(demand).toBe(24);
  });

  test("includes flex via equal-split without projections", () => {
    const demand = calculateStarterDemand(
      "RB",
      { RB: 2, FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      12,
    );

    // 24 direct + 12/3 = 28
    expect(demand).toBeCloseTo(28, 1);
  });

  test("uses dynamic flex with projections", () => {
    const pts = {
      RB: makePoints(60, 300, 3),
      WR: makePoints(60, 250, 3),
      TE: makePoints(30, 180, 5),
    };

    const demand = calculateStarterDemand(
      "RB",
      { RB: 2, WR: 2, TE: 1, FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      12,
      pts,
    );

    // With projections, RB should get more than equal share
    expect(demand).toBeGreaterThan(24);
  });
});

describe("extreme configurations (torture tests)", () => {
  test("handles 4-team league", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      4,
      {},
    );

    // QB: 4*1.15 = 4.6 → 5
    expect(levels.QB).toBe(5);
    expect(levels.RB).toBeLessThan(15);
  });

  test("handles 40-team league with ceiling caps", () => {
    const pts = {
      QB: makePoints(200, 500, 1),
      RB: makePoints(200, 400, 1),
      WR: makePoints(200, 400, 1),
      TE: makePoints(100, 300, 2),
    };

    const levels = calculateAllReplacementLevels(
      { QB: 2, RB: 2, WR: 2, TE: 1 },
      [],
      undefined,
      40,
      pts,
    );

    // QB ceiling = 36, so capped
    expect(levels.QB).toBeLessThanOrEqual(36);
    expect(levels.RB).toBeLessThanOrEqual(72);
    expect(levels.WR).toBeLessThanOrEqual(100);
    expect(levels.TE).toBeLessThanOrEqual(40);
  });

  test("handles weird slot mix (5 TE, 0 WR)", () => {
    const levels = calculateAllReplacementLevels(
      { TE: 5 },
      [],
      undefined,
      12,
      {},
    );

    // 60 * 1.15 = 69, TE ceiling = 40 → capped at 40
    expect(levels.TE).toBeLessThanOrEqual(40);
    expect(levels.WR).toBeUndefined();
  });

  test("handles superflex (2QB eligible)", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, SUPERFLEX: 1 },
      [
        {
          slot: "SUPERFLEX",
          eligible: ["QB", "RB", "WR", "TE"],
        },
      ],
      undefined,
      12,
      {},
    );

    // QB: 12 direct + 12/4 flex = 15, buffered: 15*1.15 = 17.25 → 17
    expect(levels.QB).toBeGreaterThan(12);
    expect(levels.QB).toBeLessThanOrEqual(36); // ceiling
  });

  test("handles all-IDP league", () => {
    // Provide enough IDP players so floor caps don't truncate
    const pts = {
      LB: makePoints(100, 250, 1),
      EDR: makePoints(60, 200, 2),
      CB: makePoints(60, 180, 2),
      S: makePoints(60, 180, 2),
      IL: makePoints(40, 150, 2),
    };

    const levels = calculateAllReplacementLevels(
      { LB: 4, EDR: 2, CB: 2, S: 2, IL: 2 },
      [],
      undefined,
      12,
      pts,
    );

    // LB: 48*1.15 = 55.2 → 55, LB ceiling = 90
    expect(levels.LB).toBe(55);
    // EDR: 24*1.15 = 27.6 → 28, ceiling = 48
    expect(levels.EDR).toBe(28);
  });
});

describe("invariants", () => {
  test("replacement levels are always positive integers", () => {
    const configs: Array<{
      rosterPositions: Record<string, number>;
      totalTeams: number;
    }> = [
      { rosterPositions: { QB: 1 }, totalTeams: 12 },
      { rosterPositions: { QB: 0 }, totalTeams: 12 },
      { rosterPositions: {}, totalTeams: 12 },
      { rosterPositions: { RB: 3, FLEX: 2 }, totalTeams: 8 },
    ];

    for (const config of configs) {
      const levels = calculateAllReplacementLevels(
        config.rosterPositions,
        [],
        undefined,
        config.totalTeams,
        {},
      );

      for (const [, level] of Object.entries(levels)) {
        expect(level).toBeGreaterThan(0);
        expect(Number.isInteger(level)).toBe(true);
      }
    }
  });

  test("replacement levels scale monotonically with team count", () => {
    const teamCounts = [4, 8, 12, 16, 20, 24, 32, 40];
    const results: Record<number, Record<string, number>> = {};

    for (const teams of teamCounts) {
      results[teams] = calculateAllReplacementLevels(
        { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
        [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
        undefined,
        teams,
        {},
      );
    }

    for (let i = 1; i < teamCounts.length; i++) {
      const smaller = results[teamCounts[i - 1]];
      const larger = results[teamCounts[i]];

      for (const pos of Object.keys(smaller)) {
        expect(larger[pos]).toBeGreaterThanOrEqual(smaller[pos]);
      }
    }
  });

  test("more roster slots means higher replacement level", () => {
    const oneRB = calculateAllReplacementLevels(
      { RB: 1 },
      [],
      undefined,
      12,
      {},
    );

    const twoRB = calculateAllReplacementLevels(
      { RB: 2 },
      [],
      undefined,
      12,
      {},
    );

    const threeRB = calculateAllReplacementLevels(
      { RB: 3 },
      [],
      undefined,
      12,
      {},
    );

    expect(twoRB.RB).toBeGreaterThan(oneRB.RB);
    expect(threeRB.RB).toBeGreaterThan(twoRB.RB);
  });

  test("replacement never exceeds ceiling cap", () => {
    const positions = ["QB", "RB", "WR", "TE"];
    const ceilings: Record<string, number> = {
      QB: 36, RB: 72, WR: 100, TE: 40,
    };

    for (const pos of positions) {
      const pts: Record<string, number[]> = {
        [pos]: makePoints(200, 500, 1),
      };

      const result = calculateReplacementLevel({
        position: pos,
        rosterPositions: { [pos]: 5 },
        flexRules: [],
        totalTeams: 40,
        allPlayerPoints: pts,
      });

      expect(result).toBeLessThanOrEqual(ceilings[pos]);
    }
  });
});
