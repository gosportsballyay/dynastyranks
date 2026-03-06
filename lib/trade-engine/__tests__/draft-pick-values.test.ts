import { describe, it, expect } from "vitest";
import {
  computePickValue,
  getLeagueValueStats,
  computeAllPickValues,
} from "../draft-pick-values";
import type { LeagueValueStats } from "../types";

const sampleStats: LeagueValueStats = {
  avgEliteValue: 8000,
  avgStarterValue: 6000,
  avgBenchValue: 2000,
  replacementValue: 500,
};

describe("computePickValue", () => {
  it("values early 1st round picks highest", () => {
    const pick1 = computePickValue(1, 1, 12, sampleStats, 0);
    const pick12 = computePickValue(1, 12, 12, sampleStats, 0);
    expect(pick1).toBeGreaterThan(pick12);
    expect(pick1).toBeGreaterThan(4000);
  });

  it("values round 1 picks higher than round 2", () => {
    const r1mid = computePickValue(1, 6, 12, sampleStats, 0);
    const r2mid = computePickValue(2, 6, 12, sampleStats, 0);
    expect(r1mid).toBeGreaterThan(r2mid);
  });

  it("applies future discount for picks in later years", () => {
    const thisYear = computePickValue(1, 1, 12, sampleStats, 0);
    const nextYear = computePickValue(1, 1, 12, sampleStats, 1);
    const twoYears = computePickValue(1, 1, 12, sampleStats, 2);
    expect(nextYear).toBeLessThan(thisYear);
    expect(twoYears).toBeLessThan(nextYear);
    // 10% discount per year
    expect(nextYear).toBeCloseTo(thisYear * 0.9, -1);
  });

  it("values round 5+ using roster spot premium model", () => {
    const r5 = computePickValue(5, 6, 12, sampleStats, 0);
    const r7 = computePickValue(7, 6, 12, sampleStats, 0);
    expect(r5).toBeGreaterThan(r7);
    expect(r5).toBeGreaterThan(0);
    // Late picks should be much less than early picks
    const r1 = computePickValue(1, 6, 12, sampleStats, 0);
    expect(r5).toBeLessThan(r1 * 0.3);
  });

  it("values round 8+ at minimum decay", () => {
    const r8 = computePickValue(8, 6, 12, sampleStats, 0);
    const r10 = computePickValue(10, 6, 12, sampleStats, 0);
    // Both use default 0.1 decay, should be equal
    expect(r8).toBe(r10);
  });

  it("uses elite ceiling for early picks, widening gap vs late 1sts", () => {
    const pick1 = computePickValue(1, 1, 12, sampleStats, 0);
    const pick12 = computePickValue(1, 12, 12, sampleStats, 0);
    // With elite ceiling, 1.01 should be boosted more than 1.12
    // Elite blend at pick 1: 100%, at pick 12: ~52%
    // The gap should be wider than without elite ceiling
    const noEliteStats = { ...sampleStats, avgEliteValue: sampleStats.avgStarterValue };
    const pick1Flat = computePickValue(1, 1, 12, noEliteStats, 0);
    const pick12Flat = computePickValue(1, 12, 12, noEliteStats, 0);
    const gapWithElite = pick1 - pick12;
    const gapWithout = pick1Flat - pick12Flat;
    expect(gapWithElite).toBeGreaterThan(gapWithout);
  });

  it("does not affect late-round picks (round 5+)", () => {
    const r5 = computePickValue(5, 6, 12, sampleStats, 0);
    const noEliteStats = { ...sampleStats, avgEliteValue: sampleStats.avgStarterValue };
    const r5Flat = computePickValue(5, 6, 12, noEliteStats, 0);
    // Round 5+ uses roster spot premium model, no elite ceiling
    expect(r5).toBe(r5Flat);
  });
});

describe("getLeagueValueStats", () => {
  it("returns sensible defaults for empty input", () => {
    const stats = getLeagueValueStats([]);
    expect(stats.avgEliteValue).toBe(7000);
    expect(stats.avgStarterValue).toBe(5000);
    expect(stats.avgBenchValue).toBe(1500);
    expect(stats.replacementValue).toBe(500);
  });

  it("computes stats from ranked player values", () => {
    const players = Array.from({ length: 100 }, (_, i) => ({
      value: 10000 - i * 90,
      rank: i + 1,
    }));
    const stats = getLeagueValueStats(players);
    // Elite (top 12) > starters (top 24) > bench > replacement
    expect(stats.avgEliteValue).toBeGreaterThan(stats.avgStarterValue);
    expect(stats.avgStarterValue).toBeGreaterThan(stats.avgBenchValue);
    expect(stats.avgBenchValue).toBeGreaterThan(stats.replacementValue);
  });
});

describe("computeAllPickValues", () => {
  it("values all provided picks", () => {
    const picks = [
      { id: "p1", season: 2026, round: 1, pickNumber: 3, projectedPickNumber: null },
      { id: "p2", season: 2026, round: 2, pickNumber: null, projectedPickNumber: 8 },
      { id: "p3", season: 2027, round: 1, pickNumber: null, projectedPickNumber: null },
    ];
    const players = Array.from({ length: 50 }, (_, i) => ({
      value: 8000 - i * 100,
      rank: i + 1,
    }));
    const values = computeAllPickValues(picks, players, 2026, 12);
    expect(values.size).toBe(3);
    // Pick 1 (1.03 this year) > Pick 3 (1.06 next year, future discounted)
    expect(values.get("p1")!).toBeGreaterThan(values.get("p3")!);
  });

  it("uses round midpoint when no pick number available", () => {
    const picks = [
      { id: "p1", season: 2026, round: 1, pickNumber: null, projectedPickNumber: null },
    ];
    const players = Array.from({ length: 50 }, (_, i) => ({
      value: 8000 - i * 100,
      rank: i + 1,
    }));
    const values = computeAllPickValues(picks, players, 2026, 12);
    expect(values.get("p1")!).toBeGreaterThan(0);
  });
});
