import { describe, it, expect } from "vitest";
import { normalizeIdpValues } from "../idp-normalization";

function makePlayer(
  id: string,
  position: string,
  value: number,
) {
  return { canonicalPlayerId: id, position, value };
}

describe("normalizeIdpValues", () => {
  it("scales up suppressed IDP values", () => {
    const values = [
      // Offense players with healthy values
      makePlayer("1", "QB", 8000),
      makePlayer("2", "RB", 7000),
      makePlayer("3", "WR", 6500),
      makePlayer("4", "RB", 5000),
      makePlayer("5", "WR", 4000),
      // IDP players heavily suppressed
      makePlayer("6", "LB", 500),
      makePlayer("7", "DL", 400),
      makePlayer("8", "DB", 350),
      makePlayer("9", "LB", 300),
    ];

    // 4 IDP slots, 6 offense slots → IDP should be ~67% of offense
    const result = normalizeIdpValues(values, 4, 6);

    // IDP values should have increased
    const lb1 = result.find((v) => v.canonicalPlayerId === "6")!;
    expect(lb1.value).toBeGreaterThan(500);
  });

  it("does not change already-proportional IDP values", () => {
    const values = [
      makePlayer("1", "QB", 8000),
      makePlayer("2", "RB", 6000),
      makePlayer("3", "WR", 5000),
      // IDP values proportional to offense
      makePlayer("4", "LB", 5500),
      makePlayer("5", "DL", 4500),
      makePlayer("6", "DB", 4000),
    ];

    const result = normalizeIdpValues(values, 3, 3);

    // Values should be unchanged
    const lb = result.find((v) => v.canonicalPlayerId === "4")!;
    expect(lb.value).toBe(5500);
  });

  it("does nothing when no IDP slots", () => {
    const values = [
      makePlayer("1", "QB", 8000),
      makePlayer("2", "RB", 6000),
    ];

    const result = normalizeIdpValues(values, 0, 6);

    expect(result[0].value).toBe(8000);
    expect(result[1].value).toBe(6000);
  });

  it("caps scale factor at 2.0x", () => {
    const values = [
      makePlayer("1", "RB", 8000),
      makePlayer("2", "WR", 6000),
      // Extremely suppressed IDP
      makePlayer("3", "LB", 10),
      makePlayer("4", "DL", 5),
    ];

    const result = normalizeIdpValues(values, 4, 4);

    // With cap at 2.0x, values should not exceed 2x original
    // (though they may exceed if scale factor applies differently)
    const lb = result.find((v) => v.canonicalPlayerId === "3")!;
    expect(lb.value).toBeLessThanOrEqual(10 * 2 + 1); // +1 for rounding
  });
});
