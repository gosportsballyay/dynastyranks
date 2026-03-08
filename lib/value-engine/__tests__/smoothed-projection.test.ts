/**
 * Unit tests for multi-season smoothed projection.
 *
 * Verifies weighted averaging, 17-game prorating, missing-season
 * handling, and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  computeSmoothedProjection,
  computeVeteranConfidence,
} from "../compute-unified";

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

describe("computeVeteranConfidence", () => {
  it("full season (16 games) returns 1.0", () => {
    expect(
      computeVeteranConfidence(16, [{ season: 2025, points: 200, gamesPlayed: 16 }], 7),
    ).toBe(1);
  });

  it("rookie with 3 games gets base penalty", () => {
    expect(
      computeVeteranConfidence(3, [{ season: 2025, points: 30, gamesPlayed: 3 }], 1),
    ).toBeCloseTo(0.375, 3);
  });

  it("proven vet, 3 games, 2 healthy priors → floor 0.85", () => {
    const seasons = [
      { season: 2025, points: 30, gamesPlayed: 3 },
      { season: 2024, points: 200, gamesPlayed: 17 },
      { season: 2023, points: 190, gamesPlayed: 16 },
    ];
    expect(computeVeteranConfidence(3, seasons, 7)).toBe(0.85);
  });

  it("proven vet, 3 games, 1 healthy prior → floor 0.70", () => {
    const seasons = [
      { season: 2025, points: 30, gamesPlayed: 3 },
      { season: 2024, points: 200, gamesPlayed: 17 },
    ];
    expect(computeVeteranConfidence(3, seasons, 5)).toBe(0.70);
  });

  it("3-year player with 1 healthy prior stays at base", () => {
    // yearsExperience < 4, only 1 healthy prior → not proven
    const seasons = [
      { season: 2025, points: 30, gamesPlayed: 3 },
      { season: 2024, points: 200, gamesPlayed: 17 },
    ];
    expect(computeVeteranConfidence(3, seasons, 3)).toBeCloseTo(0.375, 3);
  });

  it("null yearsExp with 2 healthy priors → floor 0.85", () => {
    const seasons = [
      { season: 2025, points: 30, gamesPlayed: 3 },
      { season: 2024, points: 200, gamesPlayed: 17 },
      { season: 2023, points: 190, gamesPlayed: 15 },
    ];
    expect(computeVeteranConfidence(3, seasons, null)).toBe(0.85);
  });

  it("no prior seasons stays at base", () => {
    expect(
      computeVeteranConfidence(3, [{ season: 2025, points: 30, gamesPlayed: 3 }], null),
    ).toBeCloseTo(0.375, 3);
  });

  it("proven vet, 0 games (full IR), 2 healthy priors → floor 0.85", () => {
    const seasons = [
      { season: 2025, points: 0, gamesPlayed: 0 },
      { season: 2024, points: 200, gamesPlayed: 17 },
      { season: 2023, points: 190, gamesPlayed: 16 },
    ];
    expect(computeVeteranConfidence(0, seasons, 7)).toBe(0.85);
  });

  it("exact threshold (8 games) returns 1.0", () => {
    const seasons = [
      { season: 2025, points: 80, gamesPlayed: 8 },
      { season: 2024, points: 200, gamesPlayed: 17 },
    ];
    expect(computeVeteranConfidence(8, seasons, 5)).toBe(1);
  });

  it("prior season exactly 8 GP counts as healthy", () => {
    const seasons = [
      { season: 2025, points: 30, gamesPlayed: 3 },
      { season: 2024, points: 80, gamesPlayed: 8 },
    ];
    // yearsExp=5 + 1 healthy prior → proven, floor 0.70
    expect(computeVeteranConfidence(3, seasons, 5)).toBe(0.70);
  });
});
