/**
 * Main Value Computation Engine
 *
 * Orchestrates the full value calculation pipeline:
 * 1. Get projections (or generate offseason projections)
 * 2. Calculate fantasy points per league scoring
 * 3. Calculate VORP
 * 4. Apply age curves and dynasty premium
 * 5. Apply scarcity multipliers
 * 6. Generate final rankings
 */

import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  canonicalPlayers,
  projections,
  playerValues,
  valueComputationLogs,
  historicalStats,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateVORP, calculateFantasyPoints } from "./vorp";
import { getDynastyPremium, getAgeTier, getAgeCurveMultiplier } from "./age-curves";
import {
  calculateAllReplacementLevels,
  calculateStarterDemand,
  calculateLiquidityMultiplier,
} from "./replacement-level";
import { generateOffseasonProjection, shouldUseOffseasonProjections } from "./offseason-projections";
import { computeLastSeasonPoints, getTargetSeasonForRankings } from "./compute-last-season";
import { hashString, groupBy } from "@/lib/utils";
import type { PositionGroup, DataSource } from "@/types";

const ENGINE_VERSION = "1.3.0"; // Projection-aware replacement + liquidity multiplier
const PROJECTION_COVERAGE_THRESHOLD = 0.70; // 70% of top players must have projections

// Position bounds for projected points (plausibility check)
const POSITION_BOUNDS: Record<string, { min: number; max: number }> = {
  QB: { min: 50, max: 500 },
  RB: { min: 20, max: 450 },
  WR: { min: 20, max: 450 },
  TE: { min: 15, max: 350 },
  LB: { min: 30, max: 350 },
  EDR: { min: 25, max: 350 },
  CB: { min: 20, max: 300 },
  S: { min: 25, max: 300 },
  IL: { min: 20, max: 250 },
  DB: { min: 20, max: 300 },
};

// IDP positions for gating logic
const IDP_POSITIONS = ["LB", "CB", "S", "EDR", "IL", "DB"];

interface EstimatorGateResult {
  generate: boolean;
  discount: number; // 1.0 = full, 0.5 = 50%, 0 = exclude
  reason: string;
}

/**
 * Determine if we should generate an offseason estimate for a player
 * Implements two-tier FA handling + staleness gating
 */
function shouldGenerateEstimate(
  player: { position: string; nflTeam: string | null; yearsExperience: number | null },
  mostRecentSeason: number,
  mostRecentGamesPlayed: number,
  targetSeason: number
): EstimatorGateResult {
  const seasonAge = targetSeason - mostRecentSeason;

  // Gate 1: Stale data (>2 seasons old) → exclude
  if (seasonAge > 2) {
    return { generate: false, discount: 0, reason: "stale_data" };
  }

  // Gate 2: Rookies → exclude from historical projection
  if (player.yearsExperience === 0) {
    return { generate: false, discount: 0, reason: "rookie" };
  }

  const isFA = !player.nflTeam || player.nflTeam === "FA";
  const isDefensive = IDP_POSITIONS.includes(player.position);
  const snapsThreshold = isDefensive ? 400 : 200;

  // Estimate snaps from games (rough: 50 snaps/game offense, 40 defense)
  const estimatedSnaps = mostRecentGamesPlayed * (isDefensive ? 40 : 50);
  const meetsSnapsThreshold = estimatedSnaps >= snapsThreshold;
  const meetsGamesThreshold = mostRecentGamesPlayed >= 8;

  // Tier A: Meaningful contributor (8+ games OR snaps threshold) → 50% discount if FA
  if (meetsGamesThreshold || meetsSnapsThreshold) {
    if (isFA) {
      return { generate: true, discount: 0.5, reason: "fa_tier_a" };
    }
    return { generate: true, discount: 1.0, reason: "valid" };
  }

  // Tier B: Below thresholds
  if (isFA) {
    return { generate: false, discount: 0, reason: "fa_tier_b" };
  }

  // Signed but low production → still generate but flag
  return { generate: true, discount: 0.8, reason: "low_production" };
}

/**
 * Validate and clamp projected points to position bounds
 */
function validateProjectedPoints(
  position: string,
  points: number,
  playerName: string,
  warnings: string[]
): { points: number; isOutlier: boolean } {
  const bounds = POSITION_BOUNDS[position];
  if (!bounds) return { points, isOutlier: false };

  if (points > bounds.max) {
    warnings.push(
      `OUTLIER: ${playerName} (${position}) has ${points.toFixed(1)} pts, clamped to ${bounds.max}`
    );
    return { points: bounds.max, isOutlier: true };
  }

  return { points, isOutlier: false };
}

/**
 * Get historical data weight based on season age
 */
function getSeasonWeight(seasonAge: number): number {
  if (seasonAge === 0) return 1.0; // Last season: full weight
  if (seasonAge === 1) return 0.5; // Two seasons ago: 50% weight
  return 0; // Older: ignore
}

interface ComputeValuesResult {
  success: boolean;
  playerCount: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

/**
 * Compute player values for a league.
 *
 * @deprecated Use {@link computeUnifiedValues} from `./compute-unified.ts`
 * instead. This function uses the old VORP-only pipeline which does not
 * blend consensus rankings. Kept for backward compatibility.
 */
export async function computeLeagueValues(
  leagueId: string
): Promise<ComputeValuesResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Fetch league and settings
    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);

    if (!league) {
      throw new Error("League not found");
    }

    const [settings] = await db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, leagueId))
      .limit(1);

    if (!settings) {
      throw new Error("League settings not found");
    }

    // Extract bonus thresholds from metadata (if available)
    const bonusThresholds = (settings.metadata as Record<string, unknown> | null)
      ?.bonusThresholds as Record<string, Array<{ min: number; max?: number; bonus: number }>> | undefined;

    // Fetch all active players
    const players = await db
      .select()
      .from(canonicalPlayers)
      .where(eq(canonicalPlayers.isActive, true));

    if (players.length === 0) {
      warnings.push("No active players found - run player seed first");
      return {
        success: false,
        playerCount: 0,
        warnings,
        errors: ["No players in database"],
        durationMs: Date.now() - startTime,
      };
    }

    // Compute last season points first (proof layer)
    console.log("Computing last season points...");
    const lastSeasonResults = await computeLastSeasonPoints({
      scoringRules: settings.scoringRules,
      positionScoringOverrides: settings.positionScoringOverrides ?? undefined,
      bonusThresholds,
    });
    console.log(`Computed last season points for ${lastSeasonResults.size} players`);

    // Determine target season using calendar-based auto-detection
    // This is UNIVERSAL for all leagues/adapters - ignores league.season field
    const targetSeason = getTargetSeasonForRankings();
    console.log(`Target season (auto-detected): ${targetSeason} (league.season in DB: ${league.season})`);
    const forceOffseason = shouldUseOffseasonProjections(targetSeason, false);

    // Batch fetch all projections upfront
    const allProjections = await db.select().from(projections);
    const projectionsMap = new Map(
      allProjections.map((p) => [p.canonicalPlayerId, p])
    );

    // Fetch historical stats - include target season for actuals mode
    // plus prior seasons for fallback estimates
    const recentSeasons = [targetSeason, targetSeason - 1, targetSeason - 2];
    const allHistoricalStats = await db
      .select()
      .from(historicalStats)
      .where(inArray(historicalStats.season, recentSeasons));

    // Group historical stats by player
    const historicalByPlayer = new Map<
      string,
      Array<{ season: number; stats: Record<string, number>; gamesPlayed: number }>
    >();
    for (const stat of allHistoricalStats) {
      const existing = historicalByPlayer.get(stat.canonicalPlayerId) || [];
      existing.push({
        season: stat.season,
        stats: stat.stats as Record<string, number>,
        gamesPlayed: stat.gamesPlayed || 17,
      });
      historicalByPlayer.set(stat.canonicalPlayerId, existing);
    }

    // Calculate projection coverage (for top players by last season performance)
    const topPlayerIds = new Set(
      [...lastSeasonResults.entries()]
        .sort((a, b) => b[1].rankOverall - a[1].rankOverall)
        .slice(0, 300)
        .map(([id]) => id)
    );

    const playersWithProjections = [...topPlayerIds].filter((id) =>
      projectionsMap.has(id)
    ).length;
    const projectionCoverage = topPlayerIds.size > 0
      ? playersWithProjections / topPlayerIds.size
      : 0;

    const useOffseason = forceOffseason || projectionCoverage < PROJECTION_COVERAGE_THRESHOLD;

    if (useOffseason && !forceOffseason) {
      warnings.push(
        `Projection coverage ${(projectionCoverage * 100).toFixed(0)}% is below ${(PROJECTION_COVERAGE_THRESHOLD * 100)}% threshold. Using offseason estimates.`
      );
    } else if (forceOffseason) {
      warnings.push(
        `Using offseason projection model for ${targetSeason} season`
      );
    }

    // Track data source usage for reporting
    const dataSourceCounts = { projections: 0, offseason: 0, flat: 0, lastSeasonActual: 0 };

    // Calculate fantasy points for each player
    const playerPoints: Map<
      string,
      { points: number; player: typeof players[0]; dataSource: DataSource }
    > = new Map();

    for (const player of players) {
      let fantasyPoints = 0;
      let dataSource: DataSource = "projections";

      // Get player's historical stats
      const playerHistory = historicalByPlayer.get(player.id);

      // PRIORITY 1: Use target season actuals if available (e.g., 2025 completed stats)
      const targetSeasonStats = playerHistory?.find(s => s.season === targetSeason);

      if (targetSeasonStats) {
        // Use actual stats directly - NO scaling, NO age adjustments
        fantasyPoints = calculateFantasyPoints(
          targetSeasonStats.stats,
          settings.scoringRules,
          settings.positionScoringOverrides?.[player.position],
          bonusThresholds,
          targetSeasonStats.gamesPlayed
        );
        dataSource = "last_season_actual";
        dataSourceCounts.lastSeasonActual++;
      }
      // PRIORITY 2: Use projection data if available and in-season
      else {
        const projection = projectionsMap.get(player.id);

        if (projection && !useOffseason) {
          fantasyPoints = calculateFantasyPoints(
            projection.stats,
            settings.scoringRules,
            settings.positionScoringOverrides?.[player.position],
            bonusThresholds
          );
          dataSource = "projections";
          dataSourceCounts.projections++;
        }
        // PRIORITY 3: Generate offseason estimate from prior seasons
        else if (playerHistory && playerHistory.length > 0) {
          // Filter to only prior seasons (not target season) for estimates
          const priorSeasons = playerHistory.filter(s => s.season < targetSeason);

          if (priorSeasons.length === 0) {
            // No prior seasons, skip this player
            fantasyPoints = 0;
            dataSourceCounts.flat++;
            continue;
          }

          // Sort by season descending
          const sorted = [...priorSeasons].sort((a, b) => b.season - a.season);
          const mostRecent = sorted[0];

          // Check estimator gating before generating projection
          const gateResult = shouldGenerateEstimate(
            {
              position: player.position,
              nflTeam: player.nflTeam,
              yearsExperience: player.yearsExperience,
            },
            mostRecent.season,
            mostRecent.gamesPlayed,
            targetSeason
          );

          if (!gateResult.generate) {
            // Player gated out - skip
            fantasyPoints = 0;
            dataSourceCounts.flat++;
            continue;
          }

          // Start with most recent season stats, scaled to 17 games
          let projectedStats = { ...mostRecent.stats };
          if (mostRecent.gamesPlayed < 17 && mostRecent.gamesPlayed > 0) {
            const gamesRatio = 17 / mostRecent.gamesPlayed;
            for (const stat of Object.keys(projectedStats)) {
              if (!stat.includes("pct") && !stat.includes("rate")) {
                projectedStats[stat] *= gamesRatio;
              }
            }
          }

          // Apply age curve adjustment
          if (player.age) {
            const ageFactor = getAgeCurveMultiplier(player.position, player.age + 1);
            for (const stat of Object.keys(projectedStats)) {
              projectedStats[stat] *= ageFactor;
            }
          }

          // Regression to career mean (if 2+ seasons with weighting)
          if (sorted.length >= 2) {
            // Weight by season age
            let weightedStats: Record<string, number> = {};
            let totalWeight = 0;

            for (let i = 0; i < Math.min(sorted.length, 2); i++) {
              const seasonAge = targetSeason - sorted[i].season;
              const weight = getSeasonWeight(seasonAge);
              if (weight > 0) {
                totalWeight += weight;
                for (const [stat, value] of Object.entries(sorted[i].stats)) {
                  weightedStats[stat] = (weightedStats[stat] || 0) + value * weight;
                }
              }
            }

            if (totalWeight > 0) {
              for (const stat of Object.keys(weightedStats)) {
                weightedStats[stat] /= totalWeight;
              }
              // Blend: 60% most recent scaled, 40% weighted average
              for (const stat of Object.keys(projectedStats)) {
                const avgValue = weightedStats[stat] || 0;
                if (avgValue > 0) {
                  projectedStats[stat] = projectedStats[stat] * 0.6 + avgValue * 0.4;
                }
              }
            }
          }

          // Role security discount for players who missed games
          if (mostRecent.gamesPlayed < 12) {
            for (const stat of Object.keys(projectedStats)) {
              projectedStats[stat] *= 0.9;
            }
          }

          fantasyPoints = calculateFantasyPoints(
            projectedStats,
            settings.scoringRules,
            settings.positionScoringOverrides?.[player.position],
            bonusThresholds
          );

          // Apply FA discount if applicable
          if (gateResult.discount < 1.0) {
            fantasyPoints *= gateResult.discount;
          }

          // Validate and clamp to position bounds
          const validated = validateProjectedPoints(
            player.position,
            fantasyPoints,
            player.name,
            warnings
          );
          fantasyPoints = validated.points;

          dataSource = "offseason_estimate";
          dataSourceCounts.offseason++;
        } else {
          // No data available - player is not ranked (0 points)
          fantasyPoints = 0;
          dataSourceCounts.flat++;
        }
      }

      // Only include players with actual data
      if (fantasyPoints > 0) {
        playerPoints.set(player.id, { points: fantasyPoints, player, dataSource });
      }
    }

    // Log data source distribution
    console.log(`Data sources: lastSeasonActual=${dataSourceCounts.lastSeasonActual}, projections=${dataSourceCounts.projections}, offseason=${dataSourceCounts.offseason}, skipped=${dataSourceCounts.flat}`);

    // Group players by position and sort by points
    const pointsByPosition: Record<string, number[]> = {};
    for (const { points, player } of playerPoints.values()) {
      const pos = player.position;
      if (!pointsByPosition[pos]) {
        pointsByPosition[pos] = [];
      }
      pointsByPosition[pos].push(points);
    }

    // Sort each position's points descending
    for (const pos of Object.keys(pointsByPosition)) {
      pointsByPosition[pos].sort((a, b) => b - a);
    }

    // Calculate replacement levels (projection-aware)
    const replacementLevels = calculateAllReplacementLevels(
      settings.rosterPositions,
      settings.flexRules,
      settings.positionMappings ?? undefined,
      league.totalTeams,
      pointsByPosition,
    );

    // Calculate liquidity multipliers per position
    const liquidityMultipliers: Record<string, number> = {};
    for (const pos of Object.keys(pointsByPosition)) {
      const demand = calculateStarterDemand(
        pos,
        settings.rosterPositions,
        settings.flexRules,
        settings.positionMappings ?? undefined,
        league.totalTeams,
        pointsByPosition,
      );
      liquidityMultipliers[pos] = calculateLiquidityMultiplier(
        pos,
        pointsByPosition[pos],
        demand,
        settings.benchSlots,
        league.totalTeams,
      );
    }

    // Calculate VORP for each player
    const playerValuesList: Array<{
      canonicalPlayerId: string;
      value: number;
      projectedPoints: number;
      replacementPoints: number;
      vorp: number;
      normalizedVorp: number;
      scarcityMultiplier: number;
      ageCurveMultiplier: number;
      dynastyPremium: number;
      rankInPosition: number;
      positionGroup: PositionGroup;
      projectionSource: "offseason_model" | "in_season";
      uncertainty: "high" | "medium" | "low";
      dataSource: DataSource;
      lastSeasonPoints: number | null;
      lastSeasonRankOverall: number | null;
      lastSeasonRankPosition: number | null;
    }> = [];

    for (const [playerId, { points, player, dataSource }] of playerPoints.entries()) {
      const vorpResult = calculateVORP({
        playerPoints: points,
        position: player.position,
        allPlayerPoints: pointsByPosition,
        rosterPositions: settings.rosterPositions,
        flexRules: settings.flexRules,
        positionMappings: settings.positionMappings ?? undefined,
        totalTeams: league.totalTeams,
        liquidityMultiplier:
          liquidityMultipliers[player.position] ?? 1.0,
      });

      // Calculate dynasty premium
      let dynastyPremium = 1.0;
      let ageCurveMultiplier = 1.0;

      if (player.age) {
        dynastyPremium = getDynastyPremium(
          player.position,
          player.age,
          player.yearsExperience ?? undefined,
          player.draftRound ?? undefined
        );
        ageCurveMultiplier = dynastyPremium; // For now, same as dynasty premium
      }

      // Calculate final value
      const finalValue =
        vorpResult.normalizedVorp *
        vorpResult.scarcityMultiplier *
        dynastyPremium *
        100; // Scale to more readable numbers

      // Get last season data for this player
      const lastSeason = lastSeasonResults.get(playerId);

      playerValuesList.push({
        canonicalPlayerId: playerId,
        value: finalValue,
        projectedPoints: points,
        replacementPoints: vorpResult.replacementPoints,
        vorp: vorpResult.vorp,
        normalizedVorp: vorpResult.normalizedVorp,
        scarcityMultiplier: vorpResult.scarcityMultiplier,
        ageCurveMultiplier,
        dynastyPremium,
        rankInPosition: vorpResult.rankInPosition,
        positionGroup: player.positionGroup as PositionGroup,
        projectionSource: useOffseason ? "offseason_model" : "in_season",
        uncertainty: useOffseason ? "high" : "medium",
        dataSource,
        lastSeasonPoints: lastSeason?.points ?? null,
        lastSeasonRankOverall: lastSeason?.rankOverall ?? null,
        lastSeasonRankPosition: lastSeason?.rankPosition ?? null,
      });
    }

    // Sort by value and assign ranks
    playerValuesList.sort((a, b) => b.value - a.value);

    // Assign overall ranks
    let rank = 1;
    for (const pv of playerValuesList) {
      (pv as any).rank = rank++;
    }

    // Assign tiers (every 12 players = new tier, roughly)
    for (const pv of playerValuesList) {
      (pv as any).tier = Math.ceil((pv as any).rank / 12);
    }

    // Delete existing values for this league
    await db.delete(playerValues).where(eq(playerValues.leagueId, leagueId));

    // Insert new values in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < playerValuesList.length; i += BATCH_SIZE) {
      const batch = playerValuesList.slice(i, i + BATCH_SIZE);
      await db.insert(playerValues).values(
        batch.map((pv) => ({
          leagueId,
          canonicalPlayerId: pv.canonicalPlayerId,
          value: pv.value,
          rank: (pv as any).rank,
          rankInPosition: pv.rankInPosition,
          tier: (pv as any).tier,
          projectedPoints: pv.projectedPoints,
          replacementPoints: pv.replacementPoints,
          vorp: pv.vorp,
          normalizedVorp: pv.normalizedVorp,
          scarcityMultiplier: pv.scarcityMultiplier,
          ageCurveMultiplier: pv.ageCurveMultiplier,
          dynastyPremium: pv.dynastyPremium,
          riskDiscount: 0,
          lastSeasonPoints: pv.lastSeasonPoints,
          lastSeasonRankOverall: pv.lastSeasonRankOverall,
          lastSeasonRankPosition: pv.lastSeasonRankPosition,
          dataSource: pv.dataSource,
          positionGroup: pv.positionGroup,
          projectionSource: pv.projectionSource,
          uncertainty: pv.uncertainty,
          engineVersion: ENGINE_VERSION,
        }))
      );
    }

    // Create input hash for deterministic reruns
    const inputsHash = await hashString(
      JSON.stringify({
        settings: settings.scoringRules,
        rosterPositions: settings.rosterPositions,
        flexRules: settings.flexRules,
        totalTeams: league.totalTeams,
        playerCount: playerValuesList.length,
      })
    );

    // Log computation
    await db.insert(valueComputationLogs).values({
      leagueId,
      engineVersion: ENGINE_VERSION,
      inputsHash,
      playerCount: playerValuesList.length,
      durationMs: Date.now() - startTime,
      warnings: warnings.length > 0 ? warnings : null,
      errors: errors.length > 0 ? errors : null,
    });

    return {
      success: true,
      playerCount: playerValuesList.length,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);

    return {
      success: false,
      playerCount: 0,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Calculate average stats across seasons for career regression
 */
function calculateCareerAverage(
  seasons: Array<{ stats: Record<string, number> }>
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
