/**
 * Unit tests for IDP scaling functions.
 *
 * Verifies the format-aware IDP signal discount, tiered percentile
 * discount, and liquidity penalty produce correct values across
 * different league configurations.
 */

import { describe, it, expect } from "vitest";
import {
  computeIdpSignalDiscount,
  computeIdpTieredDiscount,
  computeIdpLiquidityPenalty,
} from "../compute-unified";

describe("computeIdpSignalDiscount", () => {
  it("returns base 0.55 when no IDP slots", () => {
    const roster = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 };
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeCloseTo(0.55, 2);
  });

  it("returns ~0.53 for light IDP (3 IDP / 18 total)", () => {
    const roster = {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
      LB: 2, DB: 1,
      BN: 7,
    };
    // totalStarters = 1+2+2+1+2+2+1 = 11 (BN excluded)
    // idpStarters = 2+1 = 3
    // idpRatio = 3/11 = 0.2727
    // raw = 0.55 - 0.2727*0.10 = 0.5227
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeGreaterThanOrEqual(0.45);
    expect(discount).toBeLessThanOrEqual(0.60);
    expect(discount).toBeCloseTo(0.523, 2);
  });

  it("returns ~0.51 for heavy IDP (9 IDP / 20 total)", () => {
    const roster = {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1,
      DL: 2, LB: 3, DB: 2, IDP_FLEX: 2,
      BN: 10,
    };
    // totalStarters = 1+2+2+1+1+2+3+2+2 = 16 (BN excluded)
    // idpStarters = 2+3+2+2 = 9
    // idpRatio = 9/16 = 0.5625
    // raw = 0.55 - 0.5625*0.10 = 0.4938
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeGreaterThanOrEqual(0.45);
    expect(discount).toBeLessThanOrEqual(0.60);
    expect(discount).toBeCloseTo(0.494, 2);
  });

  it("returns 0.50 fallback for empty roster", () => {
    const discount = computeIdpSignalDiscount({});
    expect(discount).toBe(0.50);
  });

  it("clamps to floor 0.45 for extreme IDP ratio", () => {
    // All IDP slots
    const roster = { LB: 5, DL: 5, DB: 5 };
    // totalStarters = 15, idpStarters = 15, ratio = 1.0
    // raw = 0.55 - 1.0*0.10 = 0.45 (exactly at floor)
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeCloseTo(0.45, 10);
  });

  it("clamps to ceiling 0.55 for minimal IDP", () => {
    const roster = {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
      LB: 1,
      BN: 7,
    };
    // totalStarters = 1+2+2+1+2+1 = 9 (BN excluded)
    // idpStarters = 1
    // idpRatio = 1/9 = 0.111
    // raw = 0.55 - 0.111*0.10 = 0.5389
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeCloseTo(0.539, 2);
    expect(discount).toBeLessThanOrEqual(0.55);
  });

  it("excludes BN, IR, TAXI from starter count", () => {
    const roster = {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
      LB: 2, DB: 1,
      BN: 10, IR: 3, TAXI: 4,
    };
    // BN/IR/TAXI excluded → same as without them
    const withoutBench = {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2,
      LB: 2, DB: 1,
    };
    expect(computeIdpSignalDiscount(roster)).toBe(
      computeIdpSignalDiscount(withoutBench),
    );
  });

  it("recognizes all IDP slot types", () => {
    // Each IDP slot type counted individually
    const roster = {
      QB: 1, RB: 1, WR: 1, TE: 1,
      LB: 1, DL: 1, DB: 1, EDR: 1,
      IL: 1, CB: 1, S: 1, IDP_FLEX: 1,
    };
    // totalStarters = 12, idpStarters = 8 (LB+DL+DB+EDR+IL+CB+S+IDP_FLEX)
    // idpRatio = 8/12 = 0.667
    // raw = 0.55 - 0.667*0.10 = 0.4833
    const discount = computeIdpSignalDiscount(roster);
    expect(discount).toBeGreaterThanOrEqual(0.45);
    expect(discount).toBeCloseTo(0.483, 2);
  });
});

describe("computeIdpTieredDiscount", () => {
  it("returns 0.55 at p=1.0 (best IDP)", () => {
    expect(computeIdpTieredDiscount(1.0)).toBeCloseTo(0.55, 10);
  });

  it("returns 0.55 at p=0.95 (elite threshold)", () => {
    expect(computeIdpTieredDiscount(0.95)).toBeCloseTo(0.55, 10);
  });

  it("returns ~0.525 at p=0.90 (high tier midpoint)", () => {
    // lerp(0.50, 0.55, (0.90-0.85)/0.10) = 0.50 + 0.5*0.05 = 0.525
    expect(computeIdpTieredDiscount(0.90)).toBeCloseTo(0.525, 2);
  });

  it("returns 0.50 at p=0.85 (high/mid boundary)", () => {
    expect(computeIdpTieredDiscount(0.85)).toBeCloseTo(0.50, 10);
  });

  it("returns 0.46 at p=0.50 (mid/low boundary)", () => {
    expect(computeIdpTieredDiscount(0.50)).toBeCloseTo(0.46, 10);
  });

  it("returns 0.42 at p=0.0 (worst IDP)", () => {
    expect(computeIdpTieredDiscount(0.0)).toBeCloseTo(0.42, 10);
  });

  it("is monotonically increasing", () => {
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
      0.85, 0.9, 0.95, 1.0];
    for (let i = 1; i < steps.length; i++) {
      expect(
        computeIdpTieredDiscount(steps[i]),
      ).toBeGreaterThanOrEqual(
        computeIdpTieredDiscount(steps[i - 1]),
      );
    }
  });

  it("stays within [0.42, 0.55] bounds for all inputs", () => {
    for (let p = 0; p <= 1; p += 0.01) {
      const d = computeIdpTieredDiscount(p);
      expect(d).toBeGreaterThanOrEqual(0.42 - 1e-10);
      expect(d).toBeLessThanOrEqual(0.55 + 1e-10);
    }
  });
});

describe("computeIdpLiquidityPenalty", () => {
  it("returns 1.0 when position has no data", () => {
    expect(computeIdpLiquidityPenalty("LB", {}, 10)).toBe(1.0);
  });

  it("returns 1.0 when insufficient depth (not enough players)", () => {
    // starterDemand=10, waiverIdx=25, but only 20 players
    const pts = Array.from({ length: 20 }, (_, i) => 200 - i * 5);
    expect(
      computeIdpLiquidityPenalty("LB", { LB: pts }, 10),
    ).toBe(1.0);
  });

  it("returns 1.0 for steep depth curve (ratio < 0.85)", () => {
    // Significant drop-off between replacement and waiver
    const pts = Array.from({ length: 40 }, (_, i) => 200 - i * 4);
    // replacementIdx=5, waiverIdx=20
    // pts[5]=180, pts[20]=120, ratio=120/180=0.667 < 0.85
    expect(
      computeIdpLiquidityPenalty("LB", { LB: pts }, 5),
    ).toBe(1.0);
  });

  it("returns penalty < 1.0 for shallow depth curve (ratio >= 0.85)", () => {
    // Very flat depth curve — lots of replacement talent
    const pts = Array.from({ length: 40 }, (_, i) => 200 - i * 0.5);
    // replacementIdx=5, waiverIdx=20
    // pts[5]=197.5, pts[20]=190.0, ratio=190/197.5=0.962
    const penalty = computeIdpLiquidityPenalty(
      "LB", { LB: pts }, 5,
    );
    expect(penalty).toBeLessThan(1.0);
    expect(penalty).toBeGreaterThanOrEqual(0.92);
  });

  it("clamps penalty to floor of 0.92", () => {
    // Completely flat curve (ratio = 1.0)
    const pts = Array.from({ length: 40 }, () => 200);
    // ratio = 200/200 = 1.0
    // penalty = 1 - 0.08*((1.0-0.85)/0.15) = 1 - 0.08 = 0.92
    const penalty = computeIdpLiquidityPenalty(
      "LB", { LB: pts }, 5,
    );
    expect(penalty).toBeCloseTo(0.92, 10);
  });

  it("returns 1.0 when replacement points are zero", () => {
    const pts = Array.from({ length: 40 }, () => 0);
    expect(
      computeIdpLiquidityPenalty("LB", { LB: pts }, 5),
    ).toBe(1.0);
  });
});
