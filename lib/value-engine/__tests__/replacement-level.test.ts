import { describe, test, expect } from "vitest";
import {
  calculateReplacementLevel,
  calculateAllReplacementLevels,
  calculateStarterDemand,
} from "../replacement-level";

describe("calculateReplacementLevel", () => {
  test("calculates basic replacement level for direct starters only", () => {
    const result = calculateReplacementLevel({
      position: "QB",
      rosterPositions: { QB: 1 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    // 12 teams × 1 QB = 12 starters
    expect(result).toBe(12);
  });

  test("scales replacement level with team count", () => {
    const base = { position: "QB", rosterPositions: { QB: 1 }, flexRules: [], benchSlots: 0 };

    const result12 = calculateReplacementLevel({ ...base, totalTeams: 12 });
    const result24 = calculateReplacementLevel({ ...base, totalTeams: 24 });

    expect(result24).toBeGreaterThan(result12);
    expect(result24).toBe(24);
    expect(result12).toBe(12);
  });

  test("handles multiple starter slots", () => {
    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    // 12 teams × 2 RBs = 24 starters
    expect(result).toBe(24);
  });

  test("includes flex demand with default weights", () => {
    const result = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2, FLEX: 1 },
      flexRules: [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      totalTeams: 12,
      benchSlots: 0,
    });

    // 12 × 2 = 24 direct + 12 × 0.4 (FLEX weight for RB) = 24 + 4.8 ≈ 29
    expect(result).toBeGreaterThan(24);
    expect(result).toBe(29); // Math.round(24 + 4.8)
  });

  test("includes bench factor", () => {
    const withoutBench = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    const withBench = calculateReplacementLevel({
      position: "RB",
      rosterPositions: { RB: 2 },
      flexRules: [],
      totalTeams: 12,
      benchSlots: 60, // 5 per team
    });

    expect(withBench).toBeGreaterThan(withoutBench);
  });

  test("handles position mappings for consolidated IDP", () => {
    const result = calculateReplacementLevel({
      position: "CB",
      rosterPositions: { DB: 2 }, // DB is a consolidated slot
      flexRules: [],
      positionMappings: { DB: ["CB", "S"] }, // CB and S can fill DB slots
      totalTeams: 12,
      benchSlots: 0,
    });

    // 12 × 2 DB slots / 2 granular positions = 12 for CB
    expect(result).toBe(12);
  });

  test("returns minimum of 1 even with no slots", () => {
    const result = calculateReplacementLevel({
      position: "K",
      rosterPositions: {},
      flexRules: [],
      totalTeams: 12,
      benchSlots: 0,
    });

    expect(result).toBe(1);
  });
});

describe("calculateAllReplacementLevels", () => {
  test("calculates levels for all roster positions", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, RB: 2, WR: 2, TE: 1 },
      [],
      undefined,
      12,
      0
    );

    expect(levels.QB).toBe(12);
    expect(levels.RB).toBe(24);
    expect(levels.WR).toBe(24);
    expect(levels.TE).toBe(12);
  });

  test("includes positions from flex rules", () => {
    const levels = calculateAllReplacementLevels(
      { FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      12,
      0
    );

    // RB, WR, TE should all be included even though no direct slots
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
      0
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
      0
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
      12
    );

    expect(demand).toBe(24);
  });

  test("includes flex contribution", () => {
    const demand = calculateStarterDemand(
      "RB",
      { RB: 2, FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      12
    );

    // 24 direct + 12 × 0.4 = 28.8
    expect(demand).toBeCloseTo(28.8, 1);
  });
});

describe("extreme configurations (torture tests)", () => {
  test("handles 4-team league", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 },
      [{ slot: "FLEX", eligible: ["RB", "WR", "TE"] }],
      undefined,
      4,
      0
    );

    expect(levels.QB).toBe(4); // 4 teams × 1 QB
    expect(levels.RB).toBeLessThan(12); // Smaller than 12-team league
  });

  test("handles 40-team league", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 2, RB: 2, WR: 2, TE: 1 },
      [],
      undefined,
      40,
      0
    );

    expect(levels.QB).toBe(80); // 40 teams × 2 QBs
    expect(levels.RB).toBe(80);
    expect(levels.WR).toBe(80);
    expect(levels.TE).toBe(40);
  });

  test("handles weird slot mix (5 TE, 0 WR)", () => {
    const levels = calculateAllReplacementLevels(
      { TE: 5 },
      [],
      undefined,
      12,
      0
    );

    expect(levels.TE).toBe(60); // 12 × 5
    expect(levels.WR).toBeUndefined(); // No WR slots
  });

  test("handles superflex (2QB eligible)", () => {
    const levels = calculateAllReplacementLevels(
      { QB: 1, SUPERFLEX: 1 },
      [{ slot: "SUPERFLEX", eligible: ["QB", "RB", "WR", "TE"] }],
      undefined,
      12,
      0
    );

    // QB: 12 direct + 12 × 0.8 (SUPERFLEX weight) ≈ 22
    expect(levels.QB).toBeGreaterThan(12);
    expect(levels.QB).toBeLessThanOrEqual(22);
  });

  test("handles all-IDP league", () => {
    const levels = calculateAllReplacementLevels(
      { LB: 4, EDR: 2, CB: 2, S: 2, IL: 2 },
      [],
      undefined,
      12,
      0
    );

    expect(levels.LB).toBe(48); // 12 × 4
    expect(levels.EDR).toBe(24);
    expect(levels.CB).toBe(24);
    expect(levels.S).toBe(24);
    expect(levels.IL).toBe(24);
  });
});

describe("invariants", () => {
  test("replacement levels are always positive integers", () => {
    const configs = [
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
        0
      );

      for (const [pos, level] of Object.entries(levels)) {
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
        0
      );
    }

    // Each position's replacement level should increase with team count
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
      0
    );

    const twoRB = calculateAllReplacementLevels(
      { RB: 2 },
      [],
      undefined,
      12,
      0
    );

    const threeRB = calculateAllReplacementLevels(
      { RB: 3 },
      [],
      undefined,
      12,
      0
    );

    expect(twoRB.RB).toBeGreaterThan(oneRB.RB);
    expect(threeRB.RB).toBeGreaterThan(twoRB.RB);
  });
});
