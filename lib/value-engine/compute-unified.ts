/**
 * Unified Value Engine
 *
 * Blends market consensus with league-specific signals into a single
 * authoritative value per player per league. Blend weights are dynamic,
 * scaling with format complexity (auto mode) or user-selected emphasis.
 *
 * Auto range: consensus [0.35, 0.70], league [0.30, 0.65]
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
import { calculateFantasyPoints, type ScoringRule } from "./vorp";
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
import { buildPositionResolver } from "./position-normalization";
import { hashString } from "@/lib/utils";
import type { PositionGroup } from "@/types";
import { computeFormatComplexity } from "./format-complexity";
import { computeBlendWeights, type BlendMode } from "./blend";
import { normalizeStatKeys } from "@/lib/stats/canonical-keys";

export const ENGINE_VERSION = "3.1.0";
export const PROJECTION_VERSION = "1.0.0";

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
const IDP_CONSENSUS_DISCOUNT = 0.55;


const IDP_POSITIONS = new Set([
  "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
]);

/**
 * Penalty for consensus-expected positions with no consensus data.
 *
 * If a position has >50% consensus coverage (e.g. QB, RB, WR, TE)
 * but a specific player has zero consensus value, it means no ranking
 * site bothers to rank them — a strong negative signal. Career backups
 * and fringe players get this penalty to prevent them from ranking
 * near starters.
 */
const NO_CONSENSUS_PENALTY = 0.55;

interface ComputeValuesResult {
  success: boolean;
  playerCount: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
  engineVersion: string;
  projectionVersion: string;
  latestDataSeason: number;
  leagueConfigHash: string | null;
}

type ValueSource =
  | "unified"
  | "consensus_only"
  | "signal_primary"
  | "league_signal_only"
  | "minimum";

/**
 * Compute unified player values for a league.
 *
 * Steps:
 * 1. Fetch league settings, players, historical stats
 * 2. Compute format complexity + dynamic blend weights
 * 3. Compute fantasy points per player
 * 4. Read consensus from aggregated_values
 * 5. Blend: value = consensus×W_c + leagueSignal×W_l
 * 6. IDP normalization post-pass
 * 7. Rank, tier, write to player_values
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

    // Normalize scoring rules (e.g. tfl → tackle_loss) so
    // they match canonical stat keys from any historical data source
    const normalizedScoringRules = normalizeStatKeys(
      settings.scoringRules as Record<string, number>,
    ) as typeof settings.scoringRules;

    const bonusThresholds = (
      settings.metadata as Record<string, unknown> | null
    )?.bonusThresholds as
      | Record<string, Array<{ min: number; max?: number; bonus: number }>>
      | undefined;

    const structuredRules =
      (settings.structuredRules as ScoringRule[] | null) ?? null;

    // --- Compute dynamic blend weights ---
    const complexity = computeFormatComplexity({
      totalTeams: league.totalTeams,
      rosterPositions: settings.rosterPositions,
      scoringRules: normalizedScoringRules,
    });
    const blendMode = (
      (settings.metadata as Record<string, unknown> | null)
        ?.valuationMode ?? "auto"
    ) as BlendMode;
    const {
      consensus: CONSENSUS_WEIGHT,
      league: LEAGUE_SIGNAL_WEIGHT,
    } = computeBlendWeights(complexity, blendMode);

    console.log(
      `Blend: complexity=${complexity.toFixed(2)}, ` +
        `mode=${blendMode}, ` +
        `consensus=${(CONSENSUS_WEIGHT * 100).toFixed(0)}%, ` +
        `league=${(LEAGUE_SIGNAL_WEIGHT * 100).toFixed(0)}%`,
    );

    const idpSignalDiscount = computeIdpSignalDiscount(
      settings.rosterPositions as Record<string, number>,
    );
    console.log(
      `IDP signal discount: ${idpSignalDiscount.toFixed(3)}`,
    );

    // --- Build position resolver for IDP normalization ---
    const resolvePosition = await buildPositionResolver(
      settings.rosterPositions as Record<string, number>,
    );

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
        engineVersion: ENGINE_VERSION,
        projectionVersion: PROJECTION_VERSION,
        latestDataSeason: 0,
        leagueConfigHash: null,
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
      scoringRules: normalizedScoringRules,
      positionScoringOverrides:
        settings.positionScoringOverrides ?? undefined,
      bonusThresholds,
      structuredRules,
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
        gameLogs: Record<number, Record<string, number>> | null;
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
        gameLogs: (stat.gameLogs as
          Record<number, Record<string, number>> | null) ?? null,
      });
      historicalByPlayer.set(stat.canonicalPlayerId, existing);
    }

    // --- Compute per-season fantasy points for each player ---
    // Compute raw (non-prorated) fantasy points per historical
    // season so the smoothing function can prorate at the points
    // level instead of scaling stats (avoids bonus distortion).
    const playerSeasonPoints = new Map<
      string,
      Array<{ season: number; points: number; gamesPlayed: number }>
    >();

    for (const player of players) {
      const history = historicalByPlayer.get(player.id);
      if (!history || history.length === 0) continue;

      const seasonPts: Array<{
        season: number;
        points: number;
        gamesPlayed: number;
      }> = [];

      for (const h of history) {
        const stats = normalizeStatKeys(h.stats);
        const pts = calculateFantasyPoints(
          stats,
          normalizedScoringRules,
          settings.positionScoringOverrides?.[player.position],
          bonusThresholds,
          h.gamesPlayed,
          h.gameLogs,
          structuredRules,
          player.position,
        );
        seasonPts.push({
          season: h.season,
          points: pts,
          gamesPlayed: h.gamesPlayed,
        });
      }

      playerSeasonPoints.set(player.id, seasonPts);
    }

    // --- Compute smoothed projections per player ---
    const playerPoints = new Map<
      string,
      { points: number; player: (typeof players)[0] }
    >();

    // Find the latest season any player has data for, used
    // to detect missed-season absences (injury, holdout, etc.)
    let latestDataSeason = 0;
    for (const seasons of playerSeasonPoints.values()) {
      for (const s of seasons) {
        if (s.season > latestDataSeason) {
          latestDataSeason = s.season;
        }
      }
    }

    for (const player of players) {
      const seasons = playerSeasonPoints.get(player.id);
      if (!seasons || seasons.length === 0) continue;

      // Gating uses most recent season with data
      const sorted = [...seasons].sort(
        (a, b) => b.season - a.season,
      );
      const recent = sorted[0];

      const isFA = !player.nflTeam || player.nflTeam === "FA";
      const seasonAge = targetSeason - recent.season;

      // Skip stale data (>2 seasons old)
      if (seasonAge > 2) continue;

      // Skip FAs with stale data (>1 season old)
      if (isFA && seasonAge > 1) continue;

      // Skip tiny-sample FAs entirely
      const minGames = 4;
      if (isFA && recent.gamesPlayed < minGames) continue;

      // Weighted multi-season smoothing (prorates internally)
      let points = computeSmoothedProjection(
        seasons,
        targetSeason,
      );

      // Age curve on smoothed projection
      if (player.age && recent.season < targetSeason) {
        const ageFactor = getAgeCurveMultiplier(
          player.position,
          player.age + 1,
        );
        points *= ageFactor;
      }

      // Confidence scaling based on most recent season
      const confidence = Math.min(1, recent.gamesPlayed / 8);
      points *= confidence;

      // Missed-season penalty: detect the latest season any
      // player has data for, then penalize players who are
      // missing that season. This catches injury absences
      // regardless of offseason vs in-season timing.
      if (recent.season < latestDataSeason && !isFA) {
        const missedYears = latestDataSeason - recent.season;
        // 0.4 for 1 missed year, 0.2 for 2 missed years
        const missedPenalty = Math.max(0.2, 0.6 - missedYears * 0.2);
        points *= missedPenalty;
      }

      // FA discount — free agents are riskier / less valuable
      if (isFA) {
        points *= recent.gamesPlayed < 8 ? 0.5 : 0.75;
      }

      if (points > 0) {
        playerPoints.set(player.id, { points, player });
      }
    }

    console.log(
      `Computed fantasy points for ${playerPoints.size} players`,
    );

    // --- Resolve positions for IDP normalization ---
    // Resolve all players (not just those with stats) so the
    // rookie/consensus-only path also uses resolved positions.
    const resolvedPositions = new Map<string, string>();
    for (const player of players) {
      resolvedPositions.set(
        player.id,
        resolvePosition(player.id, player.position),
      );
    }

    // --- Build position points arrays (sorted desc) ---
    const pointsByPosition: Record<string, number[]> = {};
    for (const { points, player } of playerPoints.values()) {
      const pos =
        resolvedPositions.get(player.id) ?? player.position;
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

    // --- Compute consensus coverage per position ---
    // Used to detect "signal-primary" positions (IDP) where no
    // consensus data exists vs "consensus-expected" positions
    // (offense) where missing consensus is a negative signal.
    const posCoverageTotal = new Map<string, number>();
    const posCoverageHas = new Map<string, number>();
    for (const [playerId, { player }] of playerPoints) {
      const pos =
        resolvedPositions.get(playerId) ?? player.position;
      posCoverageTotal.set(
        pos, (posCoverageTotal.get(pos) ?? 0) + 1,
      );
      const consVal = consensusMap.get(playerId);
      if (consVal && (consVal.aggregatedValue ?? 0) > 0) {
        posCoverageHas.set(
          pos, (posCoverageHas.get(pos) ?? 0) + 1,
        );
      }
    }

    // --- Compute median league signal per position (for rookies) ---
    const positionSignals: Record<string, number[]> = {};

    // --- IDP signal collector for percentile ranking ---
    const idpSignals: Array<{ id: string; signal: number }> = [];

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
      fpValue: number | null;
      consensusComponent: number;
      leagueSignalComponent: number;
      lowConfidence: boolean;
      valueSource: ValueSource;
      eligibilityPosition: string | null;
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
      const fpVal = consensus?.fpValue ?? null;

      let leagueSignalVal = 0;
      let delta = 0;
      let scarcity = 1;
      let dampenedMod = 1;
      let projectedPts = 0;
      let rankInPos = 0;

      // Use resolved position for all scarcity/baseline logic
      const pos =
        resolvedPositions.get(player.id) ?? player.position;

      if (pointsData) {
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

        // Collect IDP signals for percentile ranking
        if (IDP_POSITIONS.has(pos) && leagueSignalVal > 0) {
          idpSignals.push({ id: player.id, signal: leagueSignalVal });
        }
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
      const isIdp = IDP_POSITIONS.has(pos);
      const groupDiscount = isIdp ? IDP_CONSENSUS_DISCOUNT : 1.0;
      const demandScalar = idpDemandScalars[pos] ?? 1.0;
      const adjustedConsensus =
        consensusBase * groupDiscount * demandScalar;

      // Discount IDP league signal — high IDP scoring doesn't
      // translate to dynasty trade value. demandScalar is NOT
      // applied here because the league signal already reflects
      // demand via starterDemand in baseline/scarcity calcs.
      const adjustedSignal = isIdp
        ? leagueSignalVal * idpSignalDiscount
        : leagueSignalVal;

      if (adjustedConsensus > 0 && adjustedSignal > 0) {
        // Both available — standard blend
        consensusComponent = adjustedConsensus * CONSENSUS_WEIGHT;
        leagueSignalComponent = adjustedSignal * LEAGUE_SIGNAL_WEIGHT;
        finalValue = consensusComponent + leagueSignalComponent;
        valueSource = "unified";
      } else if (adjustedConsensus > 0 && adjustedSignal === 0) {
        // Rookie or no stats — consensus only, use position
        // median signal as fallback for league signal
        const signals = positionSignals[pos];
        const medianSignal =
          signals && signals.length > 0
            ? signals.sort((a, b) => a - b)[
                Math.floor(signals.length / 2)
              ]
            : 0;

        const adjMedian = isIdp
          ? medianSignal * idpSignalDiscount
          : medianSignal;

        consensusComponent = adjustedConsensus * CONSENSUS_WEIGHT;
        leagueSignalComponent = adjMedian * LEAGUE_SIGNAL_WEIGHT;
        finalValue = consensusComponent + leagueSignalComponent;

        // Missed-season penalty: experienced players (have
        // historical data) with 0 games in the most recent
        // season get a steep discount. Consensus rankings
        // are slow to adjust for injury/absence.
        const seasonData = playerSeasonPoints.get(player.id);
        if (seasonData && seasonData.length > 0) {
          const mostRecent = [...seasonData].sort(
            (a, b) => b.season - a.season,
          )[0];
          if (mostRecent.gamesPlayed === 0) {
            finalValue *= 0.35;
            lowConfidence = true;
          } else if (mostRecent.gamesPlayed < 4) {
            finalValue *= 0.55;
            lowConfidence = true;
          }
        }

        valueSource =
          adjMedian > 0 ? "unified" : "consensus_only";
      } else if (consensusBase === 0 && leagueSignalVal > 0) {
        const coverageRatio =
          (posCoverageHas.get(pos) ?? 0) /
          (posCoverageTotal.get(pos) ?? 1);

        consensusComponent = 0;

        if (coverageRatio < 0.2) {
          // Signal-primary position (IDP) — consensus doesn't
          // exist for this position group, so signal is the
          // best available data, not a fallback
          const stability = pos === "CB"
            ? cbStabilityMultiplier(
                (settings.rosterPositions as Record<string, number>)["CB"] ?? 0,
              )
            : 1.0;
          leagueSignalComponent = adjustedSignal * stability;
          finalValue = adjustedSignal * stability;
          valueSource = "signal_primary";
          lowConfidence = false;
        } else {
          // Consensus-expected position — no ranking site
          // bothers to rank this player, strong negative signal
          const penalized = adjustedSignal * NO_CONSENSUS_PENALTY;
          leagueSignalComponent = penalized;
          finalValue = penalized;
          valueSource = "league_signal_only";
          lowConfidence = true;
        }
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
        replacementPoints: baselines[pos] ?? 0,
        vorp: Math.max(0, delta),
        normalizedVorp: Math.max(0, delta),
        scarcityMultiplier: scarcity,
        ageCurveMultiplier: dampenedMod,
        dynastyPremium: dampenedMod,
        rankInPosition: rankInPos,
        positionGroup: player.positionGroup as PositionGroup,
        position: pos,
        eligibilityPosition:
          pos !== player.position ? pos : null,
        consensusValue: adjustedConsensus > 0
          ? Math.round(adjustedConsensus)
          : null,
        ktcValue: ktcVal,
        fcValue: fcVal,
        dpValue: dpVal,
        fpValue: fpVal,
        consensusComponent,
        leagueSignalComponent,
        lowConfidence,
        valueSource,
        lastSeasonPoints: lastSeason?.points ?? null,
        lastSeasonRankOverall: lastSeason?.rankOverall ?? null,
        lastSeasonRankPosition: lastSeason?.rankPosition ?? null,
      });
    }

    // --- Compute IDP percentiles from collected signals ---
    idpSignals.sort((a, b) => b.signal - a.signal);
    const idpPercentiles = new Map<string, number>();
    for (let i = 0; i < idpSignals.length; i++) {
      const p =
        idpSignals.length > 1
          ? 1 - i / (idpSignals.length - 1)
          : 0.5;
      idpPercentiles.set(idpSignals[i].id, p);
    }

    // --- Second pass: apply tiered discount to signal_primary IDP ---
    for (const entry of valuesList) {
      if (entry.valueSource !== "signal_primary") continue;
      if (!IDP_POSITIONS.has(entry.position)) continue;

      const pctile =
        idpPercentiles.get(entry.canonicalPlayerId) ?? 0;
      const tiered = computeIdpTieredDiscount(pctile);
      const liqPenalty =
        pctile < 0.85
          ? computeIdpLiquidityPenalty(
              entry.position,
              pointsByPosition,
              starterDemands[entry.position] ?? 1,
            )
          : 1.0;

      // Recover raw signal: stored as leagueSignalVal * idpSignalDiscount
      const rawSignal =
        entry.leagueSignalComponent / idpSignalDiscount;
      const tieredSignal = rawSignal * tiered * liqPenalty;

      entry.leagueSignalComponent = tieredSignal;
      entry.value = Math.round(tieredSignal);
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
          eligibilityPosition: pv.eligibilityPosition ?? null,
          // Unified-specific columns
          consensusValue: pv.consensusValue,
          ktcValue: pv.ktcValue,
          fcValue: pv.fcValue,
          dpValue: pv.dpValue,
          fpValue: pv.fpValue,
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
        settings: normalizedScoringRules,
        rosterPositions: settings.rosterPositions,
        flexRules: settings.flexRules,
        totalTeams: league.totalTeams,
        playerCount: valuesList.length,
        engine: "unified",
        blendMode,
        complexity,
      }),
    );

    await db.insert(valueComputationLogs).values({
      leagueId,
      engineVersion: ENGINE_VERSION,
      projectionVersion: PROJECTION_VERSION,
      inputsHash,
      playerCount: valuesList.length,
      durationMs: Date.now() - startTime,
      warnings: warnings.length > 0 ? warnings : null,
      errors: errors.length > 0 ? errors : null,
    });

    await db
      .update(leagues)
      .set({
        lastComputedAt: new Date(),
        leagueConfigHash: inputsHash,
      })
      .where(eq(leagues.id, leagueId));

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
      engineVersion: ENGINE_VERSION,
      projectionVersion: PROJECTION_VERSION,
      latestDataSeason,
      leagueConfigHash: inputsHash,
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
      engineVersion: ENGINE_VERSION,
      projectionVersion: PROJECTION_VERSION,
      latestDataSeason: 0,
      leagueConfigHash: null,
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

/**
 * Compute a format-aware IDP signal discount.
 *
 * Leagues with more IDP starter slots relative to total starters
 * tend to have higher tackle-driven point inflation. The discount
 * scales accordingly to prevent IDP from dominating offensive tiers.
 *
 * @returns Discount factor in [0.45, 0.60]
 */
export function computeIdpSignalDiscount(
  rosterPositions: Record<string, number>,
): number {
  const IDP_SLOTS = new Set([
    "LB", "DL", "DB", "EDR", "IL", "CB", "S", "IDP_FLEX",
  ]);
  const NON_STARTER = new Set(["BN", "IR", "TAXI"]);

  let idpStarters = 0;
  let totalStarters = 0;

  for (const [slot, count] of Object.entries(rosterPositions)) {
    if (NON_STARTER.has(slot)) continue;
    totalStarters += count;
    if (IDP_SLOTS.has(slot)) idpStarters += count;
  }

  if (totalStarters === 0) return 0.50;

  const idpRatio = idpStarters / totalStarters;
  const raw = 0.55 - idpRatio * 0.10;
  return Math.max(0.45, Math.min(0.60, raw));
}

/**
 * Percentile-based tiered discount for IDP signal_primary values.
 *
 * Elite IDPs (top 5%) get a higher multiplier (~0.62) while bulk
 * IDPs get a lower one (~0.42). Linear interpolation within each
 * band prevents cliff effects at tier boundaries.
 *
 * @param percentile - Player percentile in [0, 1] where 1.0 = best
 * @returns Discount factor in [0.42, 0.62]
 */
export function computeIdpTieredDiscount(
  percentile: number,
): number {
  if (percentile >= 0.95) return 0.62;
  if (percentile >= 0.85) {
    const t = (percentile - 0.85) / 0.10;
    return 0.55 + t * (0.62 - 0.55);
  }
  if (percentile >= 0.50) {
    const t = (percentile - 0.50) / 0.35;
    return 0.48 + t * (0.55 - 0.48);
  }
  const t = percentile / 0.50;
  return 0.42 + t * (0.48 - 0.42);
}

/**
 * Liquidity-based penalty for mid/low-tier IDP positions.
 *
 * Estimates waiver talent availability by comparing fantasy points
 * at the waiver index (starterDemand + 15) vs the replacement
 * index. If the drop-off is shallow (ratio >= 0.85), replacements
 * are plentiful and mid/low IDP values are penalized further.
 *
 * @returns Penalty factor in [0.92, 1.0]; 1.0 = no penalty
 */
export function computeIdpLiquidityPenalty(
  position: string,
  pointsByPosition: Record<string, number[]>,
  starterDemand: number,
): number {
  const posPoints = pointsByPosition[position];
  if (!posPoints) return 1.0;

  const replacementIdx = starterDemand;
  const waiverIdx = replacementIdx + 15;

  if (
    waiverIdx >= posPoints.length ||
    replacementIdx >= posPoints.length
  ) {
    return 1.0;
  }

  const replacementPts = posPoints[replacementIdx];
  if (replacementPts <= 0) return 1.0;

  const depthRatio = posPoints[waiverIdx] / replacementPts;

  if (depthRatio >= 0.85) {
    const penalty =
      1 - 0.08 * ((depthRatio - 0.85) / 0.15);
    return Math.max(0.92, Math.min(1.0, penalty));
  }

  return 1.0;
}

/**
 * Demand-scaled stability multiplier for CB signal_primary values.
 *
 * CBs are volatile week-to-week — tackle-driven scoring swings
 * make them streamable in shallow leagues. Start-1 leagues get a
 * strong penalty (0.75) because any waiver CB can fill the slot.
 * Start-2+ leagues ease the penalty because demand narrows the
 * replacement pool, but it never disappears (cap 0.92).
 *
 * @param cbSlotsPerTeam - rosterPositions["CB"] per team
 * @returns Multiplier in [0.75, 0.92]
 */
export function cbStabilityMultiplier(
  cbSlotsPerTeam: number,
): number {
  const base = 0.75;
  const step = 0.07;
  const mult = base + step * Math.max(0, cbSlotsPerTeam - 1);
  return Math.min(mult, 0.92);
}

/**
 * Weighted multi-season smoothing for projected fantasy points.
 *
 * Replaces single-season 17-game extrapolation with a 3-year
 * weighted average. Each season is prorated to 17 games at the
 * points level (not stats level) to avoid bonus-threshold
 * distortion. Missing seasons count as 0 — a player who vanished
 * for a year has that reflected in their projection.
 *
 * Weights: most recent 60%, prior 30%, two back 10%.
 *
 * @param seasons - Per-season fantasy points (raw, not prorated)
 * @param targetSeason - Season being projected for
 * @returns Smoothed 17-game projected fantasy points
 */
export function computeSmoothedProjection(
  seasons: Array<{
    season: number;
    points: number;
    gamesPlayed: number;
  }>,
  targetSeason: number,
): number {
  const weights = [0.6, 0.3, 0.1];
  let total = 0;

  let seasonsFound = 0;
  let singleSeasonProrated = 0;
  for (let i = 0; i < 3; i++) {
    const seasonYear = targetSeason - i;
    const season = seasons.find((s) => s.season === seasonYear);

    if (season && season.gamesPlayed > 0) {
      const prorated =
        (season.points / season.gamesPlayed) * 17;
      total += prorated * weights[i];
      seasonsFound++;
      singleSeasonProrated = prorated;
    }
    // Missing season or 0 GP → adds 0
  }

  // Rookies: single season should not be diluted by
  // treating nonexistent prior seasons as zero production.
  // 10% stability discount for unproven track record.
  if (seasonsFound === 1) {
    return singleSeasonProrated * 0.90;
  }

  // Two-season players: mild 3% stability discount.
  if (seasonsFound === 2) {
    total *= 0.97;
  }

  return total;
}
