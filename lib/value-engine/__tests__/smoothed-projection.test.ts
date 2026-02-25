/**
 * Unit tests for multi-season smoothed projection.
 *
 * Verifies weighted averaging, 17-game prorating, missing-season
 * handling, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { computeSmoothedProjection } from "../compute-unified";

describe("computeSmoothedProjection", () => {
  const target = 2026;

  it("weights 3 full seasons correctly (60/30/10)", () => {
    const seasons = [
      { season: 2026, points: 170, gamesPlayed: 17 },
      { season: 2025, points: 170, gamesPlayed: 17 },
      { season: 2024, points: 170, gamesPlayed: 17 },
    ];
    // All 17-game seasons at 170 pts → prorated = 170 each
    // 170*0.6 + 170*0.3 + 170*0.1 = 170
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(170, 1);
  });

  it("single season applies 10% stability discount", () => {
    const seasons = [
      { season: 2026, points: 100, gamesPlayed: 10 },
    ];
    // prorated = (100/10)*17 = 170
    // Single season → 170 * 0.90 = 153
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(153, 1);
  });

  it("single season in older slot applies same discount", () => {
    // Player had a big 2025 but nothing in 2026 or 2024
    const seasons = [
      { season: 2025, points: 200, gamesPlayed: 17 },
    ];
    // Only 1 season matched → 200 * 0.90 = 180
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(180, 1);
  });

  it("two-season player applies 3% stability discount", () => {
    // 2026: missing, 2025: 35 pts in 11 GP, 2024: 5 pts in 5 GP
    const seasons = [
      { season: 2025, points: 35, gamesPlayed: 11 },
      { season: 2024, points: 5, gamesPlayed: 5 },
    ];
    // 2026 missing → 0*0.6 = 0
    // 2025 → (35/11)*17 = 54.09, 54.09*0.3 = 16.23
    // 2024 → (5/5)*17 = 17, 17*0.1 = 1.7
    // raw total ≈ 17.93, * 0.97 ≈ 17.39
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(17.39, 0);
  });

  it("returns 0 when no seasons match the lookback window", () => {
    const seasons = [
      { season: 2020, points: 200, gamesPlayed: 17 },
    ];
    // All 3 lookback years (2026, 2025, 2024) missing
    expect(computeSmoothedProjection(seasons, target)).toBe(0);
  });

  it("returns 0 for empty seasons array", () => {
    expect(computeSmoothedProjection([], target)).toBe(0);
  });

  it("handles 0 gamesPlayed gracefully", () => {
    const seasons = [
      { season: 2026, points: 0, gamesPlayed: 0 },
    ];
    // 0 GP → treated as 0
    expect(computeSmoothedProjection(seasons, target)).toBe(0);
  });

  it("consistent producer keeps high projection", () => {
    const seasons = [
      { season: 2026, points: 250, gamesPlayed: 17 },
      { season: 2025, points: 240, gamesPlayed: 16 },
      { season: 2024, points: 230, gamesPlayed: 17 },
    ];
    // 2026: 250*0.6 = 150
    // 2025: (240/16)*17 = 255, 255*0.3 = 76.5
    // 2024: 230*0.1 = 23
    // total = 249.5
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(249.5, 0);
  });
});
