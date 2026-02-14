import { describe, it, expect } from "vitest";
import { computeLeagueSignal, calculateScarcity } from "../league-signal";

describe("computeLeagueSignal", () => {
  const positionPoints = [350, 320, 290, 260, 230, 200, 170, 140, 110, 80];

  it("gives elite players a high signal", () => {
    const result = computeLeagueSignal(
      350,     // top player
      "RB",
      200,     // baseline
      4,       // starterDemand
      1.1,     // dampenedDynastyMod (slightly young)
      positionPoints,
    );
    expect(result.leagueSignal).toBeGreaterThan(5000);
    expect(result.delta).toBe(150);
  });

  it("gives replacement-level players signal around midpoint", () => {
    const result = computeLeagueSignal(
      200,     // at baseline
      "RB",
      200,
      4,
      1.0,
      positionPoints,
    );
    // Sigmoid at delta=0 → ~5000, but scarcity and dynasty may shift
    expect(result.leagueSignal).toBeGreaterThan(1500);
    expect(result.leagueSignal).toBeLessThan(5500);
    expect(result.delta).toBe(0);
  });

  it("gives below-replacement players a low but nonzero signal", () => {
    const result = computeLeagueSignal(
      80,      // worst player
      "RB",
      200,
      4,
      0.9,     // aging player
      positionPoints,
    );
    expect(result.leagueSignal).toBeGreaterThan(0);
    expect(result.leagueSignal).toBeLessThan(3000);
    expect(result.delta).toBeLessThan(0);
  });

  it("dynasty modifier amplifies young players", () => {
    const young = computeLeagueSignal(
      260,
      "RB",
      200,
      4,
      1.15,    // young premium
      positionPoints,
    );
    const old = computeLeagueSignal(
      260,
      "RB",
      200,
      4,
      0.85,    // aging discount
      positionPoints,
    );
    expect(young.leagueSignal).toBeGreaterThan(old.leagueSignal);
  });
});

describe("calculateScarcity", () => {
  it("returns > 1.0 for elite players at thin positions", () => {
    const scarcity = calculateScarcity(1, 4, "TE");
    expect(scarcity).toBeGreaterThan(1.0);
  });

  it("returns ~1.0 for below-replacement players", () => {
    const scarcity = calculateScarcity(20, 4, "WR");
    expect(scarcity).toBeCloseTo(1.0, 1);
  });

  it("returns higher scarcity for thin positions", () => {
    const te = calculateScarcity(1, 4, "TE");
    const wr = calculateScarcity(1, 4, "WR");
    expect(te).toBeGreaterThan(wr);
  });
});
