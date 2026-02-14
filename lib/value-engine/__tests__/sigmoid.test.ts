import { describe, it, expect } from "vitest";
import { sigmoidScale } from "../sigmoid";

describe("sigmoidScale", () => {
  it("returns ~5000 at delta=0 (replacement level)", () => {
    const val = sigmoidScale(0);
    expect(val).toBeGreaterThanOrEqual(4900);
    expect(val).toBeLessThanOrEqual(5100);
  });

  it("returns ~8800 at delta=+100 (elite)", () => {
    const val = sigmoidScale(100);
    expect(val).toBeGreaterThanOrEqual(8500);
    expect(val).toBeLessThanOrEqual(9200);
  });

  it("returns ~9500 at delta=+150 (generational)", () => {
    const val = sigmoidScale(150);
    expect(val).toBeGreaterThanOrEqual(9200);
    expect(val).toBeLessThanOrEqual(9800);
  });

  it("returns ~1200 at delta=-100 (well below replacement)", () => {
    const val = sigmoidScale(-100);
    expect(val).toBeGreaterThanOrEqual(800);
    expect(val).toBeLessThanOrEqual(1500);
  });

  it("never outputs below 200 even for extreme negatives", () => {
    const val = sigmoidScale(-500);
    expect(val).toBeGreaterThanOrEqual(200);
  });

  it("never outputs above 10000 even for extreme positives", () => {
    const val = sigmoidScale(500);
    expect(val).toBeLessThanOrEqual(10000);
  });

  it("is monotonically increasing", () => {
    const deltas = [-200, -100, -50, 0, 50, 100, 200];
    const values = deltas.map((d) => sigmoidScale(d));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("respects custom steepness", () => {
    const steep = sigmoidScale(50, 0.05);
    const flat = sigmoidScale(50, 0.01);
    // Steeper curve → more separation from midpoint
    expect(steep).toBeGreaterThan(flat);
  });
});
