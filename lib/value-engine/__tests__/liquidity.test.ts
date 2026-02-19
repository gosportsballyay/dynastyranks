import { describe, test, expect } from "vitest";
import { calculateLiquidityMultiplier } from "../replacement-level";

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

describe("calculateLiquidityMultiplier", () => {
  test("returns 1.0 for empty position", () => {
    const result = calculateLiquidityMultiplier(
      "QB",
      [],
      12,
      6,
      12,
    );

    expect(result).toBe(1.0);
  });

  test("returns 1.0 for zero starter demand", () => {
    const result = calculateLiquidityMultiplier(
      "QB",
      makePoints(30, 400, 5),
      0,
      6,
      12,
    );

    expect(result).toBe(1.0);
  });

  test("deep bench > shallow bench multiplier", () => {
    const pts = makePoints(80, 350, 3);

    const shallow = calculateLiquidityMultiplier(
      "RB",
      pts,
      24,
      2,   // shallow bench
      12,
    );

    const deep = calculateLiquidityMultiplier(
      "RB",
      pts,
      24,
      60,  // deep bench
      12,
    );

    expect(deep).toBeGreaterThan(shallow);
  });

  test("scarce position (RB) > deep position (QB)", () => {
    const rbPts = makePoints(60, 300, 4);
    const qbPts = makePoints(60, 400, 3);

    const rbMult = calculateLiquidityMultiplier(
      "RB",
      rbPts,
      24,
      10,
      12,
    );

    const qbMult = calculateLiquidityMultiplier(
      "QB",
      qbPts,
      12,
      10,
      12,
    );

    // RB has higher liquidity coefficient (0.15 vs 0.05)
    expect(rbMult).toBeGreaterThan(qbMult);
  });

  test("always >= 1.0", () => {
    const positions = ["QB", "RB", "WR", "TE", "LB", "DL", "DB"];
    const benchConfigs = [0, 2, 6, 12, 30];

    for (const pos of positions) {
      for (const bench of benchConfigs) {
        const result = calculateLiquidityMultiplier(
          pos,
          makePoints(50, 300, 3),
          12,
          bench,
          12,
        );

        expect(result).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  test("bounded < 1.5", () => {
    const positions = ["QB", "RB", "WR", "TE", "LB", "DL", "DB"];

    for (const pos of positions) {
      // Extreme: massive bench, few players
      const result = calculateLiquidityMultiplier(
        pos,
        makePoints(200, 500, 1),
        48,
        100,
        40,
      );

      expect(result).toBeLessThan(1.5);
    }
  });

  test("TE has meaningful liquidity boost", () => {
    const tePts = makePoints(40, 200, 4);

    const result = calculateLiquidityMultiplier(
      "TE",
      tePts,
      12,
      10,
      12,
    );

    // TE coefficient is 0.12, should produce noticeable boost
    expect(result).toBeGreaterThan(1.0);
    expect(result).toBeLessThan(1.4);
  });
});
