/**
 * Unified Value Engine
 *
 * Blends market consensus (70%) with league-specific signals (30%)
 * into a single authoritative value per player per league.
 *
 * Formula: unifiedValue = (consensusBase × 0.7) + (leagueSignal × 0.3)
 */

import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  canonicalPlayers,
  playerValues,
  valueComputationLogs,
  historicalStats,
  aggregatedValues,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateFantasyPoints } from "./vorp";
import { calculateStarterDemand } from "./replacement-level";
import {
  getAgeCurveMultiplier,
  getDampenedDynastyMod,
} from "./age-curves";
import {
  shouldUseOffseasonProjections,
} from "./offseason-projections";
import {
  computeLastSeasonPoints,
  getTargetSeasonForRankings,
} from "./compute-last-season";
import { computeEffectiveBaseline } from "./effective-baseline";
import { computeLeagueSignal } from "./league-signal";
import { normalizeIdpValues } from "./idp-normalization";
import { hashString } from "@/lib/utils";
import type { PositionGroup } from "@/types";

const ENGINE_VERSION = "2.1.0";
const CONSENSUS_WEIGHT = 0.7;
const LEAGUE_SIGNAL_WEIGHT = 0.3;

/**
 * IDP position-group discount applied to consensus values.
 *
 * Every major dynasty ranking site (KTC, FantasyCalc, DynastyProcess)
 * ranks IDP players in a completely separate universe from offense.
 * When we blend IDP consensus into the same value space as offense,
 * raw IDP values would compete unfairly. This discount ensures IDP
 * values land well below comparable offense values in the overall
 * ranking (typically IDP starts around rank 30-50 in IDP leagues).
 *
 * The demand scalar (computed per-league) further adjusts within
 * IDP positions based on roster construction.
 */
const IDP_CONSENSUS_DISCOUNT = 0.35;

const IDP_POSITIONS = new Set([
  "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
]);

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

interface ComputeValuesResult {
  success: boolean;
  playerCount: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

type ValueSource =
  | "unified"
  | "consensus_only"
  | "league_signal_only"
  | "minimum";

/**
 * Compute unified player values for a league.
 *
 * Steps:
 * 1. Fetch league settings, players, historical stats
 * 2. Compute fantasy points per player
 * 3. Read consensus from aggregated_values
 * 4. Blend: value = consensus×0.7 + leagueSignal×0.3
 * 5. IDP normalization post-pass
 * 6. Rank, tier, write to player_values
 */
export async function computeUnifiedValues(
  leagueId: string,
): Promise<ComputeValuesResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // --- Fetch league + settings ---
    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);

    if (!league) throw new Error("League not found");

    const [settings] = await db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, leagueId))
      .limit(1);

    if (!settings) throw new Error("League settings not found");

    const bonusThresholds = (
      settings.metadata as Record<string, unknown> | null
    )?.bonusThresholds as
      | Record<string, Array<{ min: number; max?: number; bonus: number }>>
      | undefined;

    // --- Fetch players ---
    const players = await db
      .select()
      .from(canonicalPlayers)
      .where(eq(canonicalPlayers.isActive, true));

    if (players.length === 0) {
      warnings.push("No active players found");
      return {
        success: false,
        playerCount: 0,
        warnings,
        errors: ["No players in database"],
        durationMs: Date.now() - startTime,
      };
    }

    // --- Fetch consensus values ---
    const consensusRows = await db
      .select()
      .from(aggregatedValues)
      .where(eq(aggregatedValues.leagueId, leagueId));

    const consensusMap = new Map(
      consensusRows.map((r) => [r.canonicalPlayerId, r]),
    );
    console.log(
      `Loaded ${consensusMap.size} consensus values for league`,
    );

    // --- Last season points (proof layer) ---
    const lastSeasonResults = await computeLastSeasonPoints({
      scoringRules: settings.scoringRules,
      positionScoringOverrides:
        settings.positionScoringOverrides ?? undefined,
      bonusThresholds,
    });

    // --- Target season + projections mode ---
    const targetSeason = getTargetSeasonForRankings();
    const useOffseason = shouldUseOffseasonProjections(
      targetSeason,
      false,
    );

    // --- Fetch historical stats ---
    const recentSeasons = [
      targetSeason,
      targetSeason - 1,
      targetSeason - 2,
    ];
    const allHistorical = await db
      .select()
      .from(historicalStats)
      .where(inArray(historicalStats.season, recentSeasons));

    const historicalByPlayer = new Map<
      string,
      Array<{
        season: number;
        stats: Record<string, number>;
        gamesPlayed: number;
      }>
    >();
    for (const stat of allHistorical) {
      const existing = historicalByPlayer.get(
        stat.canonicalPlayerId,
      ) ?? [];
      existing.push({
        season: stat.season,
        stats: stat.stats as Record<string, number>,
        gamesPlayed: stat.gamesPlayed ?? 17,
      });
      historicalByPlayer.set(stat.canonicalPlayerId, existing);
    }

    // --- Calculate fantasy points for each player ---
    const playerPoints = new Map<
      string,
      { points: number; player: (typeof players)[0] }
    >();

    for (const player of players) {
      const history = historicalByPlayer.get(player.id);
      if (!history || history.length === 0) continue;

      // Use most recent season stats
      const sorted = [...history].sort(
        (a, b) => b.season - a.season,
      );
      const recent = sorted[0];

      // Scale to 17 games
      let projectedStats = { ...recent.stats };
      if (recent.gamesPlayed < 17 && recent.gamesPlayed > 0) {
        const ratio = 17 / recent.gamesPlayed;
        for (const stat of Object.keys(projectedStats)) {
          if (!stat.includes("pct") && !stat.includes("rate")) {
            projectedStats[stat] *= ratio;
          }
        }
      }

      // Age curve adjustment for offseason projections
      if (player.age && recent.season < targetSeason) {
        const ageFactor = getAgeCurveMultiplier(
          player.position,
          player.age + 1,
        );
        for (const stat of Object.keys(projectedStats)) {
          projectedStats[stat] *= ageFactor;
        }
      }

      let points = calculateFantasyPoints(
        projectedStats,
        settings.scoringRules,
        settings.positionScoringOverrides?.[player.position],
        bonusThresholds,
      );

      // Clamp to position bounds
      const bounds = POSITION_BOUNDS[player.position];
      if (bounds && points > bounds.max) {
        points = bounds.max;
      }

      if (points > 0) {
        playerPoints.set(player.id, { points, player });
      }
    }

    console.log(
      `Computed fantasy points for ${playerPoints.size} players`,
    );

    // --- Build position points arrays (sorted desc) ---
    const pointsByPosition: Record<string, number[]> = {};
    for (const { points, player } of playerPoints.values()) {
      const pos = player.position;
      if (!pointsByPosition[pos]) pointsByPosition[pos] = [];
      pointsByPosition[pos].push(points);
    }
    for (const pos of Object.keys(pointsByPosition)) {
      pointsByPosition[pos].sort((a, b) => b - a);
    }

    // --- Compute effective baselines per position ---
    const baselines: Record<string, number> = {};
    const starterDemands: Record<string, number> = {};
    const allPositions = Object.keys(pointsByPosition);

    for (const pos of allPositions) {
      const demand = calculateStarterDemand(
        pos,
        settings.rosterPositions,
        settings.flexRules,
        settings.positionMappings ?? undefined,
        league.totalTeams,
      );
      starterDemands[pos] = demand;
      baselines[pos] = computeEffectiveBaseline(
        pos,
        pointsByPosition[pos],
        demand,
        settings.benchSlots,
        league.totalTeams,
      );
    }

    // --- Compute IDP positional demand scalars ---
    // Consensus sources rank IDP position-agnostically but league
    // roster construction determines how valuable each IDP position
    // actually is. Scale consensus down for low-demand IDP positions
    // (e.g., 1 IL slot) relative to high-demand ones (e.g., 3 LB).
    const idpDemandScalars = computeIdpDemandScalars(
      starterDemands,
    );

    // --- Compute median league signal per position (for rookies) ---
    const positionSignals: Record<string, number[]> = {};

    // --- Blend values ---
    const valuesList: Array<{
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
      position: string;
      // Unified-specific
      consensusValue: number | null;
      ktcValue: number | null;
      fcValue: number | null;
      dpValue: number | null;
      consensusComponent: number;
      leagueSignalComponent: number;
      lowConfidence: boolean;
      valueSource: ValueSource;
      lastSeasonPoints: number | null;
      lastSeasonRankOverall: number | null;
      lastSeasonRankPosition: number | null;
    }> = [];

    // First pass: compute values for players with stats
    for (const player of players) {
      const consensus = consensusMap.get(player.id);
      const pointsData = playerPoints.get(player.id);

      const consensusBase = consensus?.aggregatedValue ?? 0;
      const ktcVal = consensus?.ktcValue ?? null;
      const fcVal = consensus?.fcValue ?? null;
      const dpVal = consensus?.dpValue ?? null;

      let leagueSignalVal = 0;
      let delta = 0;
      let scarcity = 1;
      let dampenedMod = 1;
      let projectedPts = 0;
      let rankInPos = 0;

      if (pointsData) {
        const pos = player.position;
        projectedPts = pointsData.points;
        const baseline = baselines[pos] ?? 0;

        dampenedMod = player.age
          ? getDampenedDynastyMod(
              pos,
              player.age,
              player.yearsExperience ?? undefined,
              player.draftRound ?? undefined,
            )
          : 1.0;

        const signalResult = computeLeagueSignal(
          projectedPts,
          pos,
          baseline,
          starterDemands[pos] ?? 1,
          dampenedMod,
          pointsByPosition[pos] ?? [],
        );

        leagueSignalVal = signalResult.leagueSignal;
        delta = signalResult.delta;
        scarcity = signalResult.scarcity;
        rankInPos =
          (pointsByPosition[pos] ?? []).findIndex(
            (pts) => pts <= projectedPts,
          ) + 1 ||
          (pointsByPosition[pos]?.length ?? 0) + 1;

        // Track signals for median calculation (rookies)
        if (!positionSignals[pos]) positionSignals[pos] = [];
        positionSignals[pos].push(leagueSignalVal);
      }

      // Determine value source and final blend
      let finalValue: number;
      let valueSource: ValueSource;
      let lowConfidence = false;
      let consensusComponent = 0;
      let leagueSignalComponent = 0;

      // Apply IDP discounts to consensus values.
      // 1. Position-group discount: IDP consensus comes from a
      //    separate ranking universe and must not compete with offense.
      // 2. Demand scalar: adjusts within IDP based on roster slots.
      const isIdp = IDP_POSITIONS.has(player.position);
      const groupDiscount = isIdp ? IDP_CONSENSUS_DISCOUNT : 1.0;
      const demandScalar =
        idpDemandScalars[player.position] ?? 1.0;
      const adjustedConsensus =
        consensusBase * groupDiscount * demandScalar;

      if (adjustedConsensus > 0 && leagueSignalVal > 0) {
        // Both available — standard blend
        consensusComponent = adjustedConsensus * CONSENSUS_WEIGHT;
        leagueSignalComponent = leagueSignalVal * LEAGUE_SIGNAL_WEIGHT;
        finalValue = consensusComponent + leagueSignalComponent;
        valueSource = "unified";
      } else if (adjustedConsensus > 0 && leagueSignalVal === 0) {
        // Rookie or no stats — consensus only, use position
        // median signal as fallback for league signal
        const pos = player.position;
        const signals = positionSignals[pos];
        const medianSignal =
          signals && signals.length > 0
            ? signals.sort((a, b) => a - b)[
                Math.floor(signals.length / 2)
              ]
            : 0;

        consensusComponent = adjustedConsensus * CONSENSUS_WEIGHT;
        leagueSignalComponent = medianSignal * LEAGUE_SIGNAL_WEIGHT;
        finalValue = consensusComponent + leagueSignalComponent;
        valueSource =
          medianSignal > 0 ? "unified" : "consensus_only";
      } else if (consensusBase === 0 && leagueSignalVal > 0) {
        // No-consensus IDP or obscure player
        consensusComponent = 0;
        leagueSignalComponent = leagueSignalVal;
        finalValue = leagueSignalVal;
        valueSource = "league_signal_only";
        lowConfidence = true;
      } else {
        // Neither — skip unless rostered (handled below)
        continue;
      }

      if (finalValue <= 0) continue;

      const lastSeason = lastSeasonResults.get(player.id);

      valuesList.push({
        canonicalPlayerId: player.id,
        value: Math.round(finalValue),
        projectedPoints: projectedPts,
        replacementPoints: baselines[player.position] ?? 0,
        vorp: Math.max(0, delta),
        normalizedVorp: Math.max(0, delta),
        scarcityMultiplier: scarcity,
        ageCurveMultiplier: dampenedMod,
        dynastyPremium: dampenedMod,
        rankInPosition: rankInPos,
        positionGroup: player.positionGroup as PositionGroup,
        position: player.position,
        consensusValue: adjustedConsensus > 0
          ? Math.round(adjustedConsensus)
          : null,
        ktcValue: ktcVal,
        fcValue: fcVal,
        dpValue: dpVal,
        consensusComponent,
        leagueSignalComponent,
        lowConfidence,
        valueSource,
        lastSeasonPoints: lastSeason?.points ?? null,
        lastSeasonRankOverall: lastSeason?.rankOverall ?? null,
        lastSeasonRankPosition: lastSeason?.rankPosition ?? null,
      });
    }

    // --- IDP normalization ---
    const idpSlots = countIdpSlots(settings.rosterPositions);
    const offenseSlots = countOffenseSlots(settings.rosterPositions);

    if (idpSlots > 0) {
      normalizeIdpValues(valuesList, idpSlots, offenseSlots);
    }

    // --- Sort and assign ranks ---
    valuesList.sort((a, b) => b.value - a.value);

    let rank = 1;
    for (const pv of valuesList) {
      (pv as any).rank = rank++;
    }

    // Position ranks
    const posGroups = new Map<string, number>();
    for (const pv of valuesList) {
      const posRank = (posGroups.get(pv.position) ?? 0) + 1;
      posGroups.set(pv.position, posRank);
      pv.rankInPosition = posRank;
    }

    // Tiers (12 players per tier)
    for (const pv of valuesList) {
      (pv as any).tier = Math.ceil((pv as any).rank / 12);
    }

    // --- Write to DB ---
    await db
      .delete(playerValues)
      .where(eq(playerValues.leagueId, leagueId));

    const BATCH_SIZE = 100;
    for (let i = 0; i < valuesList.length; i += BATCH_SIZE) {
      const batch = valuesList.slice(i, i + BATCH_SIZE);
      await db.insert(playerValues).values(
        batch.map((pv) => ({
          leagueId,
          canonicalPlayerId: pv.canonicalPlayerId,
          value: pv.value,
          rank: (pv as any).rank as number,
          rankInPosition: pv.rankInPosition,
          tier: (pv as any).tier as number,
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
          dataSource: "unified" as const,
          positionGroup: pv.positionGroup,
          projectionSource: "unified_blend" as const,
          uncertainty: pv.lowConfidence
            ? ("high" as const)
            : ("medium" as const),
          engineVersion: ENGINE_VERSION,
          // Unified-specific columns
          consensusValue: pv.consensusValue,
          ktcValue: pv.ktcValue,
          fcValue: pv.fcValue,
          dpValue: pv.dpValue,
          consensusComponent: pv.consensusComponent,
          leagueSignalComponent: pv.leagueSignalComponent,
          lowConfidence: pv.lowConfidence,
          valueSource: pv.valueSource,
        })),
      );
    }

    // --- Log computation ---
    const inputsHash = await hashString(
      JSON.stringify({
        settings: settings.scoringRules,
        rosterPositions: settings.rosterPositions,
        flexRules: settings.flexRules,
        totalTeams: league.totalTeams,
        playerCount: valuesList.length,
        engine: "unified",
      }),
    );

    await db.insert(valueComputationLogs).values({
      leagueId,
      engineVersion: ENGINE_VERSION,
      inputsHash,
      playerCount: valuesList.length,
      durationMs: Date.now() - startTime,
      warnings: warnings.length > 0 ? warnings : null,
      errors: errors.length > 0 ? errors : null,
    });

    console.log(
      `Unified engine: wrote ${valuesList.length} player values ` +
        `(${Date.now() - startTime}ms)`,
    );

    return {
      success: true,
      playerCount: valuesList.length,
      warnings,
      errors,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : String(error);
    errors.push(msg);
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
 * Compute demand-based scalars for IDP positions.
 *
 * Consensus sources rank IDP players without considering league
 * roster construction. A league that starts 1 IL but 3 EDR should
 * value EDR consensus much higher than IL consensus.
 *
 * The scalar is `demand / maxIdpDemand`, so the highest-demand IDP
 * position keeps a scalar of 1.0 and lower-demand positions are
 * reduced proportionally. A floor of 0.3 prevents total elimination.
 *
 * Offensive positions always get 1.0 (consensus sources model
 * offense accurately).
 */
function computeIdpDemandScalars(
  starterDemands: Record<string, number>,
): Record<string, number> {
  const scalars: Record<string, number> = {};

  // Find the max demand among IDP positions
  let maxIdpDemand = 0;
  for (const [pos, demand] of Object.entries(starterDemands)) {
    if (IDP_POSITIONS.has(pos) && demand > maxIdpDemand) {
      maxIdpDemand = demand;
    }
  }

  if (maxIdpDemand === 0) return scalars;

  for (const [pos, demand] of Object.entries(starterDemands)) {
    if (IDP_POSITIONS.has(pos)) {
      // Scale by relative demand, floor at 0.3
      scalars[pos] = Math.max(0.3, demand / maxIdpDemand);
    }
    // Offense positions: no scalar entry → defaults to 1.0
  }

  return scalars;
}

/**
 * Count total IDP starter slots from roster positions.
 */
function countIdpSlots(
  rosterPositions: Record<string, number>,
): number {
  let slots = 0;
  for (const [pos, count] of Object.entries(rosterPositions)) {
    if (IDP_POSITIONS.has(pos) || pos === "IDP_FLEX") {
      slots += count;
    }
  }
  return slots;
}

/**
 * Count total offense starter slots from roster positions.
 */
function countOffenseSlots(
  rosterPositions: Record<string, number>,
): number {
  const offensePos = new Set([
    "QB", "RB", "WR", "TE", "K", "FLEX", "SUPERFLEX", "SF",
    "REC_FLEX",
  ]);
  let slots = 0;
  for (const [pos, count] of Object.entries(rosterPositions)) {
    if (offensePos.has(pos)) {
      slots += count;
    }
  }
  return slots;
}
