import { describe, it, expect } from "vitest";
import { computeBlendWeights, type BlendMode } from "../blend";

describe("computeBlendWeights", () => {
  describe("fixed modes", () => {
    it("market_anchored returns 0.65/0.35", () => {
      const w = computeBlendWeights(0.5, "market_anchored");
      expect(w.consensus).toBe(0.65);
      expect(w.league).toBe(0.35);
    });

    it("balanced returns 0.50/0.50", () => {
      const w = computeBlendWeights(0.5, "balanced");
      expect(w.consensus).toBe(0.50);
      expect(w.league).toBe(0.50);
    });

    it("league_driven returns 0.35/0.65", () => {
      const w = computeBlendWeights(0.5, "league_driven");
      expect(w.consensus).toBe(0.35);
      expect(w.league).toBe(0.65);
    });

    it("fixed modes ignore complexity", () => {
      const w0 = computeBlendWeights(0, "balanced");
      const w1 = computeBlendWeights(1, "balanced");
      expect(w0.consensus).toBe(w1.consensus);
      expect(w0.league).toBe(w1.league);
    });
  });

  describe("auto mode", () => {
    it("complexity 0 gives consensus=0.70", () => {
      const w = computeBlendWeights(0, "auto");
      expect(w.consensus).toBeCloseTo(0.70, 5);
      expect(w.league).toBeCloseTo(0.30, 5);
    });

    it("complexity 1 gives consensus=0.35", () => {
      const w = computeBlendWeights(1, "auto");
      expect(w.consensus).toBeCloseTo(0.35, 5);
      expect(w.league).toBeCloseTo(0.65, 5);
    });

    it("complexity 0.5 gives consensus=0.525", () => {
      const w = computeBlendWeights(0.5, "auto");
      expect(w.consensus).toBeCloseTo(0.525, 5);
      expect(w.league).toBeCloseTo(0.475, 5);
    });

    it("weights always sum to 1.0", () => {
      for (const c of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const w = computeBlendWeights(c, "auto");
        expect(w.consensus + w.league).toBeCloseTo(1.0, 10);
      }
    });

    it("auto consensus stays in [0.35, 0.70]", () => {
      for (let c = 0; c <= 1; c += 0.05) {
        const w = computeBlendWeights(c, "auto");
        expect(w.consensus).toBeGreaterThanOrEqual(0.35 - 1e-10);
        expect(w.consensus).toBeLessThanOrEqual(0.70 + 1e-10);
      }
    });

    it("defaults to auto when mode not specified", () => {
      const w = computeBlendWeights(0);
      expect(w.consensus).toBeCloseTo(0.70, 5);
    });
  });

  describe("expected format outputs", () => {
    it("12-team 1QB (complexity ~0) => ~70/30", () => {
      const w = computeBlendWeights(0);
      expect(w.consensus).toBeCloseTo(0.70, 2);
      expect(w.league).toBeCloseTo(0.30, 2);
    });

    it("14-team SF (complexity ~0.22) => ~62/38", () => {
      const w = computeBlendWeights(0.22);
      expect(w.consensus).toBeCloseTo(0.623, 2);
      expect(w.league).toBeCloseTo(0.377, 2);
    });

    it("16-team IDP (complexity ~0.55) => ~51/49", () => {
      const w = computeBlendWeights(0.55);
      expect(w.consensus).toBeCloseTo(0.5075, 2);
      expect(w.league).toBeCloseTo(0.4925, 2);
    });

    it("18-team deep IDP (complexity ~0.83) => ~41/59", () => {
      const w = computeBlendWeights(0.83);
      expect(w.consensus).toBeCloseTo(0.4095, 2);
      expect(w.league).toBeCloseTo(0.5905, 2);
    });
  });
});
