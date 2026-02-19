import { describe, it, expect } from "vitest";
import { projectPlayerValue, projectRosterValue } from "../roster-projection";
import { sampleRoster } from "./fixtures/sample-rosters";

describe("projectPlayerValue", () => {
  it("returns lower value for aging RBs", () => {
    const now = projectPlayerValue(5000, "RB", 25, 0);
    const future = projectPlayerValue(5000, "RB", 25, 3);
    expect(future).toBeLessThan(now);
  });

  it("returns stable value for prime-age QBs", () => {
    // QB peak is 28-33, so a 29-year-old QB 1 year forward should be stable
    const now = projectPlayerValue(7000, "QB", 29, 0);
    const future = projectPlayerValue(7000, "QB", 29, 1);
    expect(future).toBe(now); // Both in peak range
  });

  it("handles null age by defaulting to 26", () => {
    const val = projectPlayerValue(5000, "WR", null, 1);
    const expected = projectPlayerValue(5000, "WR", 26, 1);
    expect(val).toBe(expected);
  });

  it("handles zero value", () => {
    expect(projectPlayerValue(0, "RB", 25, 3)).toBe(0);
  });
});

describe("projectRosterValue", () => {
  it("projects total roster value forward", () => {
    const now = projectRosterValue(sampleRoster, 0);
    const future = projectRosterValue(sampleRoster, 3);
    // Mix of positions, but overall should decline over 3 years
    expect(future).toBeLessThan(now);
  });

  it("returns exact current total for 0 years forward", () => {
    const total = sampleRoster.reduce((s, p) => s + p.value, 0);
    expect(projectRosterValue(sampleRoster, 0)).toBe(total);
  });
});
