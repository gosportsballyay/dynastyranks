import { describe, it, expect } from "vitest";
import {
  computeFormatComplexity,
  clamp,
  type FormatInput,
} from "../format-complexity";

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("clamps to min", () => {
    expect(clamp(-0.5, 0, 1)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
  });
});

describe("computeFormatComplexity", () => {
  const standardInput: FormatInput = {
    totalTeams: 12,
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 },
    scoringRules: { rec: 1.0 },
  };

  it("standard 12-team 1QB returns 0", () => {
    const result = computeFormatComplexity(standardInput);
    expect(result).toBe(0);
  });

  it("8-team league clamps negative sizeFactor to 0", () => {
    const input: FormatInput = {
      totalTeams: 8,
      rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 },
      scoringRules: { rec: 1.0 },
    };
    const result = computeFormatComplexity(input);
    // sizeFactor = (8-12)/8 = -0.5, clamped to -0.25
    // All other factors 0, raw = -0.25, clamped to 0
    expect(result).toBe(0);
  });

  it("IDP consolidated adds ~0.20", () => {
    const input: FormatInput = {
      totalTeams: 12,
      rosterPositions: {
        QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1,
        DL: 2, LB: 3, DB: 2,
      },
      scoringRules: { rec: 1.0, tackle_solo: 1.0 },
    };
    const result = computeFormatComplexity(input);
    // idpFactor=0.20, flexFactor depends on ratio
    expect(result).toBeGreaterThanOrEqual(0.15);
    expect(result).toBeLessThanOrEqual(0.35);
  });

  it("SuperFlex adds 0.15", () => {
    const input: FormatInput = {
      totalTeams: 12,
      rosterPositions: {
        QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1,
      },
      scoringRules: { rec: 1.0 },
    };
    const result = computeFormatComplexity(input);
    // superflexFactor=0.15, flexFactor from SF+FLEX ratio
    expect(result).toBeGreaterThanOrEqual(0.15);
    expect(result).toBeLessThanOrEqual(0.35);
  });

  it("SF + IDP combined ~0.50", () => {
    const input: FormatInput = {
      totalTeams: 12,
      rosterPositions: {
        QB: 1, RB: 2, WR: 2, TE: 1,
        FLEX: 1, SUPERFLEX: 1,
        DL: 2, LB: 3, DB: 2, IDP_FLEX: 1,
      },
      scoringRules: { rec: 1.0, tackle_solo: 1.0 },
    };
    const result = computeFormatComplexity(input);
    // SF=0.15, IDP=0.20, flex ratio, size=0
    expect(result).toBeGreaterThanOrEqual(0.35);
    expect(result).toBeLessThanOrEqual(0.60);
  });

  it("deep 18-team IDP with heavy tackle + TEP ~0.83", () => {
    const input: FormatInput = {
      totalTeams: 18,
      rosterPositions: {
        QB: 1, RB: 2, WR: 2, TE: 1,
        FLEX: 2, SUPERFLEX: 1,
        DL: 2, LB: 3, DB: 2, IDP_FLEX: 2,
      },
      scoringRules: {
        rec: 1.0,
        te_rec: 1.5,
        tackle_solo: 2.0,
      },
    };
    const result = computeFormatComplexity(input);
    // size=(18-12)/8=0.75 clamped to 0.25
    // SF=0.15, IDP=0.20, TEP=0.10, heavyTackle=0.10
    // flexRatio significant, flexFactor up to 0.15
    expect(result).toBeGreaterThanOrEqual(0.70);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("result is always clamped to [0, 1]", () => {
    // Extreme league with every factor maxed
    const extreme: FormatInput = {
      totalTeams: 32,
      rosterPositions: {
        QB: 1, SUPERFLEX: 3, FLEX: 5, IDP_FLEX: 5,
        LB: 5, DL: 5, DB: 5,
      },
      scoringRules: {
        te_rec: 2.0,
        tackle_solo: 5.0,
      },
    };
    const result = computeFormatComplexity(extreme);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("TE premium only triggers at te_rec >= 1.5", () => {
    const noTep: FormatInput = {
      ...standardInput,
      scoringRules: { rec: 1.0, te_rec: 1.25 },
    };
    expect(computeFormatComplexity(noTep)).toBe(0);

    const yesTep: FormatInput = {
      ...standardInput,
      scoringRules: { rec: 1.0, te_rec: 1.5 },
    };
    expect(computeFormatComplexity(yesTep)).toBe(0.10);
  });

  it("SF slot name aliases work", () => {
    const sfInput: FormatInput = {
      totalTeams: 12,
      rosterPositions: {
        QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SF: 1,
      },
      scoringRules: { rec: 1.0 },
    };
    const result = computeFormatComplexity(sfInput);
    expect(result).toBeGreaterThanOrEqual(0.15);
  });
});
