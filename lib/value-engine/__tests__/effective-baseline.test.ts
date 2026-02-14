import { describe, it, expect } from "vitest";
import { computeEffectiveBaseline } from "../effective-baseline";

describe("computeEffectiveBaseline", () => {
  const positionPoints = [300, 280, 260, 240, 220, 200, 180, 160, 140, 120];

  it("returns a value between starter and waiver baseline", () => {
    const baseline = computeEffectiveBaseline(
      "RB",
      positionPoints,
      4,      // starterDemand
      6,      // benchSlots
      12,     // totalTeams
    );
    // Starter baseline at rank 4: 240
    // Waiver baseline at rank 6: 200
    expect(baseline).toBeGreaterThanOrEqual(200);
    expect(baseline).toBeLessThanOrEqual(240);
  });

  it("shallow bench pushes baseline toward starter level", () => {
    const shallow = computeEffectiveBaseline(
      "RB",
      positionPoints,
      4,
      2,      // very few bench slots
      12,
    );
    const deep = computeEffectiveBaseline(
      "RB",
      positionPoints,
      4,
      12,     // many bench slots
      12,
    );
    // Shallow bench → higher baseline (closer to starter)
    expect(shallow).toBeGreaterThan(deep);
  });

  it("deep bench pushes baseline lower", () => {
    const deep = computeEffectiveBaseline(
      "WR",
      positionPoints,
      4,
      20,     // deep bench
      10,
    );
    const starterBaseline = positionPoints[3]; // rank 4: 240
    expect(deep).toBeLessThan(starterBaseline);
  });

  it("handles empty position points", () => {
    const baseline = computeEffectiveBaseline("QB", [], 2, 6, 12);
    expect(baseline).toBe(0);
  });

  it("handles single-player position", () => {
    const baseline = computeEffectiveBaseline(
      "K",
      [100],
      1,
      6,
      12,
    );
    // Both starter and waiver baselines clamp to the only player
    expect(baseline).toBe(100);
  });
});
