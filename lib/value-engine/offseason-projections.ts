/**
 * Offseason Projections
 *
 * When official projections aren't available (January-July),
 * we generate projections from recent season stats + age curves.
 */

import { getAgeCurveMultiplier } from "./age-curves";

interface HistoricalStats {
  season: number;
  stats: Record<string, number>;
  gamesPlayed?: number;
}

interface OffseasonProjection {
  stats: Record<string, number>;
  fantasyPoints: number;
  confidence: {
    mean: number;
    p10: number;
    p90: number;
  };
  source: "offseason_model";
  methodology: string;
  uncertainty: "high";
}

/**
 * Generate offseason projection for a player
 *
 * Strategy:
 * 1. Use most recent season as baseline
 * 2. Apply age curve adjustment
 * 3. Regress to career mean (if available)
 * 4. Apply wide confidence intervals
 */
export function generateOffseasonProjection(
  position: string,
  currentAge: number,
  historicalStats: HistoricalStats[],
  scoringRules: Record<string, number>,
  positionOverrides?: Record<string, number>
): OffseasonProjection | null {
  if (historicalStats.length === 0) {
    return null;
  }

  // Sort by season descending
  const sorted = [...historicalStats].sort((a, b) => b.season - a.season);
  const mostRecent = sorted[0];

  // Start with most recent season stats
  let projectedStats = { ...mostRecent.stats };

  // Adjust for games played if partial season
  if (mostRecent.gamesPlayed && mostRecent.gamesPlayed < 17) {
    const gamesRatio = 17 / mostRecent.gamesPlayed;
    for (const stat of Object.keys(projectedStats)) {
      // Only scale counting stats, not rates
      if (!stat.includes("pct") && !stat.includes("rate")) {
        projectedStats[stat] *= gamesRatio;
      }
    }
  }

  // Apply age curve for next season
  const nextAge = currentAge + 1;
  const ageFactor = getAgeCurveMultiplier(position, nextAge);

  for (const stat of Object.keys(projectedStats)) {
    projectedStats[stat] *= ageFactor;
  }

  // Regression to mean (if we have 3+ seasons)
  if (sorted.length >= 3) {
    const careerAvg = calculateCareerAverage(sorted.slice(0, 3));

    // 60% recent, 40% career average
    for (const stat of Object.keys(projectedStats)) {
      const careerValue = careerAvg[stat] || 0;
      projectedStats[stat] = projectedStats[stat] * 0.6 + careerValue * 0.4;
    }
  }

  // Apply conservative role security discount
  const roleSecurity = estimateRoleSecurity(sorted, position, currentAge);
  for (const stat of Object.keys(projectedStats)) {
    projectedStats[stat] *= roleSecurity;
  }

  // Calculate fantasy points
  let fantasyPoints = 0;
  for (const [stat, value] of Object.entries(projectedStats)) {
    const pts = positionOverrides?.[stat] ?? scoringRules[stat] ?? 0;
    fantasyPoints += value * pts;
  }

  // Wide confidence intervals for offseason projections
  const confidence = {
    mean: fantasyPoints,
    p10: fantasyPoints * 0.60, // Worst case: 40% below
    p90: fantasyPoints * 1.40, // Best case: 40% above
  };

  return {
    stats: projectedStats,
    fantasyPoints,
    confidence,
    source: "offseason_model",
    methodology: `age_curve_${ageFactor.toFixed(2)}_regression_${sorted.length >= 3 ? "3yr" : "1yr"}`,
    uncertainty: "high",
  };
}

/**
 * Calculate average stats across seasons
 */
function calculateCareerAverage(
  seasons: HistoricalStats[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const season of seasons) {
    for (const [stat, value] of Object.entries(season.stats)) {
      totals[stat] = (totals[stat] || 0) + value;
      counts[stat] = (counts[stat] || 0) + 1;
    }
  }

  const averages: Record<string, number> = {};
  for (const stat of Object.keys(totals)) {
    averages[stat] = totals[stat] / counts[stat];
  }

  return averages;
}

/**
 * Estimate role security based on usage consistency
 */
function estimateRoleSecurity(
  historicalStats: HistoricalStats[],
  position: string,
  age: number
): number {
  if (historicalStats.length < 2) {
    return 0.85; // Default conservative
  }

  // Calculate coefficient of variation in opportunity
  const opportunityMetric = getOpportunityMetric(position);
  const opportunities = historicalStats
    .map((s) => s.stats[opportunityMetric] || 0)
    .filter((v) => v > 0);

  if (opportunities.length < 2) {
    return 0.85;
  }

  const mean = opportunities.reduce((a, b) => a + b, 0) / opportunities.length;
  const variance =
    opportunities.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    opportunities.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean; // Coefficient of variation

  // Lower CV = more consistent = higher security
  let baseSecurity = 1.0 - Math.min(cv, 0.5);

  // Age penalty
  if (position === "RB" && age > 28) {
    baseSecurity *= 0.9;
  } else if (age > 32) {
    baseSecurity *= 0.92;
  }

  return Math.max(0.7, baseSecurity);
}

/**
 * Get the primary opportunity metric for a position
 */
function getOpportunityMetric(position: string): string {
  const metrics: Record<string, string> = {
    QB: "pass_att",
    RB: "rush_att",
    WR: "targets",
    TE: "targets",
    // IDP
    LB: "tackles",
    DL: "snaps",
    DB: "snaps",
    EDR: "snaps",
    IL: "snaps",
    CB: "snaps",
    S: "snaps",
  };

  return metrics[position] || "snaps";
}

/**
 * Determine if we should use offseason projections
 * Based on current date and projection availability
 */
export function shouldUseOffseasonProjections(
  targetSeason: number,
  hasOfficialProjections: boolean
): boolean {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // If we have official projections, use them
  if (hasOfficialProjections) {
    return false;
  }

  // Offseason: January - June
  // Projections typically available: July onwards
  if (targetSeason > currentYear) {
    // Future season - definitely use offseason model
    return true;
  }

  if (targetSeason === currentYear && currentMonth < 7) {
    // Current year but before July
    return true;
  }

  return false;
}
