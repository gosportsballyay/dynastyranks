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
      { season: 2025, points: 170, gamesPlayed: 17 },
      { season: 2024, points: 170, gamesPlayed: 17 },
      { season: 2023, points: 170, gamesPlayed: 17 },
    ];
    // All 17-game seasons at 170 pts → prorated = 170 each
    // 170*0.6 + 170*0.3 + 170*0.1 = 170
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(170, 1);
  });

  it("prorates partial seasons to 17 games", () => {
    const seasons = [
      { season: 2025, points: 100, gamesPlayed: 10 },
    ];
    // prorated = (100/10)*17 = 170, weighted = 170*0.6 = 102
    // 2024, 2023 missing → 0
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(102, 1);
  });

  it("treats missing seasons as 0", () => {
    // Player had a big 2024 but nothing in 2025 or 2023
    const seasons = [
      { season: 2024, points: 200, gamesPlayed: 17 },
    ];
    // 2025 missing → 0*0.6 = 0
    // 2024 → 200*0.3 = 60
    // 2023 missing → 0*0.1 = 0
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(60, 1);
  });

  it("handles boom/bust player (Amadi-like profile)", () => {
    // 2025: 0 production (no row = missing), 2024: 35 pts in 11 GP, 2023: 5 pts in 5 GP
    const seasons = [
      { season: 2024, points: 35, gamesPlayed: 11 },
      { season: 2023, points: 5, gamesPlayed: 5 },
    ];
    // 2025 missing → 0*0.6 = 0
    // 2024 → (35/11)*17 = 54.09, 54.09*0.3 = 16.23
    // 2023 → (5/5)*17 = 17, 17*0.1 = 1.7
    // total ≈ 17.93
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(17.93, 0);
  });

  it("returns 0 when no seasons match the lookback window", () => {
    const seasons = [
      { season: 2020, points: 200, gamesPlayed: 17 },
    ];
    // All 3 lookback years (2025, 2024, 2023) missing
    expect(computeSmoothedProjection(seasons, target)).toBe(0);
  });

  it("returns 0 for empty seasons array", () => {
    expect(computeSmoothedProjection([], target)).toBe(0);
  });

  it("handles 0 gamesPlayed gracefully", () => {
    const seasons = [
      { season: 2025, points: 0, gamesPlayed: 0 },
    ];
    // 0 GP → treated as 0
    expect(computeSmoothedProjection(seasons, target)).toBe(0);
  });

  it("consistent producer keeps high projection", () => {
    const seasons = [
      { season: 2025, points: 250, gamesPlayed: 17 },
      { season: 2024, points: 240, gamesPlayed: 16 },
      { season: 2023, points: 230, gamesPlayed: 17 },
    ];
    // 2025: 250*0.6 = 150
    // 2024: (240/16)*17 = 255, 255*0.3 = 76.5
    // 2023: 230*0.1 = 23
    // total = 249.5
    expect(computeSmoothedProjection(seasons, target)).toBeCloseTo(249.5, 0);
  });
});
