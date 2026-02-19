/**
 * Unit tests for CB stability multiplier.
 *
 * Verifies that the demand-scaled penalty produces correct values
 * across different CB starter slot configurations.
 */

import { describe, it, expect } from "vitest";
import { cbStabilityMultiplier } from "../compute-unified";

describe("cbStabilityMultiplier", () => {
  it("returns 0.75 for start-1 CB leagues", () => {
    expect(cbStabilityMultiplier(1)).toBeCloseTo(0.75, 2);
  });

  it("returns 0.82 for start-2 CB leagues", () => {
    expect(cbStabilityMultiplier(2)).toBeCloseTo(0.82, 2);
  });

  it("returns 0.89 for start-3 CB leagues (still penalized)", () => {
    expect(cbStabilityMultiplier(3)).toBeCloseTo(0.89, 2);
  });

  it("caps at 0.92 for start-4+ CB leagues", () => {
    expect(cbStabilityMultiplier(4)).toBeCloseTo(0.92, 2);
    expect(cbStabilityMultiplier(5)).toBeCloseTo(0.92, 2);
    expect(cbStabilityMultiplier(10)).toBeCloseTo(0.92, 2);
  });

  it("returns 0.75 when CB slots is 0 (no CB slot)", () => {
    expect(cbStabilityMultiplier(0)).toBeCloseTo(0.75, 2);
  });
});
