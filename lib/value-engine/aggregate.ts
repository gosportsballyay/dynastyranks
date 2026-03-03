/**
 * Aggregation Engine for MyDynastyValues
 *
 * Combines dynasty rankings from multiple sources (KTC, FantasyCalc, DynastyProcess)
 * into a unified aggregated value for each player.
 *
 * For IDP players (not covered by major sources), we fall back to our stats-based model.
 */

import { db } from "@/lib/db/client";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  externalRankings,
  aggregatedValues,
  canonicalPlayers,
  leagues,
} from "@/lib/db/schema";

/**
 * Source weights for aggregation.
 * Weights sum to 1.0 for each category.
 */
interface SourceWeights {
  ktc: number;
  fantasycalc: number;
  dynastyprocess: number;
  fantasypros?: number;
  idpModel?: number;
}

const OFFENSE_WEIGHTS: SourceWeights = {
  ktc: 0.40, // Most trusted crowdsourced rankings
  fantasycalc: 0.35, // Algorithm-based from real trades
  dynastyprocess: 0.25, // Built on FantasyPros ECR
};

const IDP_WEIGHTS: SourceWeights = {
  ktc: 0.20, // KTC has some IDP
  fantasycalc: 0.20, // FC has minimal IDP
  dynastyprocess: 0.10, // DP rarely covers IDP
  fantasypros: 0.50, // Primary IDP consensus source
};

/**
 * IDP positions that need special handling
 */
const IDP_POSITIONS = ["LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT"];

/**
 * Offensive positions covered by major sources
 */
const OFFENSE_POSITIONS = ["QB", "RB", "WR", "TE"];

/**
 * Normalize a value to our 0-10000 scale.
 * Different sources use different scales, so we need to normalize.
 */
function normalizeValue(value: number, source: string, maxValue: number): number {
  // KTC values are typically 0-10000
  // FC values are typically 0-11000
  // DP values are typically 0-11000
  // We normalize all to 0-10000
  if (maxValue <= 0) return 0;
  return Math.round((value / maxValue) * 10000);
}

interface ExternalRanking {
  source: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  value: number | null;
  rank: number | null;
  positionRank: number | null;
  isSuperFlex: boolean;
  isTePremium: boolean;
  canonicalPlayerId: string | null;
}

interface PlayerRankings {
  playerName: string;
  position: string;
  nflTeam: string | null;
  canonicalPlayerId: string | null;
  ktc: number | null;
  fantasycalc: number | null;
  dynastyprocess: number | null;
  fantasypros: number | null;
  idpValue: number | null;
}

interface AggregatedResult {
  canonicalPlayerId: string;
  aggregatedValue: number;
  aggregatedRank: number;
  aggregatedPositionRank: number;
  ktcValue: number | null;
  fcValue: number | null;
  fpValue: number | null;
  dpValue: number | null;
  idpValue: number | null;
  sfAdjustment: number;
  tepAdjustment: number;
}

/**
 * Fetch external rankings for a given settings context
 */
async function fetchExternalRankings(
  isSuperFlex: boolean,
  isTePremium: boolean,
  season: number
): Promise<ExternalRanking[]> {
  const rankings = await db
    .select({
      source: externalRankings.source,
      playerName: externalRankings.playerName,
      position: externalRankings.position,
      nflTeam: externalRankings.nflTeam,
      value: externalRankings.value,
      rank: externalRankings.rank,
      positionRank: externalRankings.positionRank,
      isSuperFlex: externalRankings.isSuperFlex,
      isTePremium: externalRankings.isTEPremium,
      canonicalPlayerId: externalRankings.canonicalPlayerId,
    })
    .from(externalRankings)
    .where(
      and(
        eq(externalRankings.isSuperFlex, isSuperFlex),
        eq(externalRankings.isTEPremium, isTePremium),
        eq(externalRankings.season, season)
      )
    );

  return rankings;
}

/**
 * Group rankings by player and aggregate by source
 */
function groupByPlayer(rankings: ExternalRanking[]): Map<string, PlayerRankings> {
  const playerMap = new Map<string, PlayerRankings>();
  // Track all canonical IDs seen per player key for majority vote
  const idVotes = new Map<string, Map<string, number>>();

  for (const r of rankings) {
    if (r.position === "PICK") continue;

    const key = normalizePlayerKey(r.playerName, r.position);

    if (!playerMap.has(key)) {
      playerMap.set(key, {
        playerName: r.playerName,
        position: r.position,
        nflTeam: r.nflTeam,
        canonicalPlayerId: r.canonicalPlayerId,
        ktc: null,
        fantasycalc: null,
        dynastyprocess: null,
        fantasypros: null,
        idpValue: null,
      });
      idVotes.set(key, new Map());
    }

    const player = playerMap.get(key)!;

    // Track canonical ID votes across sources
    if (r.canonicalPlayerId) {
      const votes = idVotes.get(key)!;
      votes.set(
        r.canonicalPlayerId,
        (votes.get(r.canonicalPlayerId) ?? 0) + 1,
      );
    }

    switch (r.source) {
      case "ktc":
        player.ktc = r.value;
        break;
      case "fantasycalc":
        player.fantasycalc = r.value;
        break;
      case "dynastyprocess":
        player.dynastyprocess = r.value;
        break;
      case "fantasypros":
        player.fantasypros = r.value;
        break;
    }
  }

  // Resolve canonical IDs by majority vote
  for (const [key, player] of playerMap) {
    const votes = idVotes.get(key);
    if (!votes || votes.size === 0) continue;

    let bestId: string | null = null;
    let bestCount = 0;
    for (const [id, count] of votes) {
      if (count > bestCount) {
        bestId = id;
        bestCount = count;
      }
    }
    player.canonicalPlayerId = bestId;
  }

  return playerMap;
}

/**
 * Normalize player name for matching across sources
 */
/**
 * Collapse IDP sub-positions into parent groups for matching.
 *
 * FantasyPros may tag a player as "DB" while other sources use
 * "CB" or "S". Similarly "DL" may appear instead of "EDR"/"IL".
 * Normalizing to the parent group ensures cross-source merging.
 */
const IDP_POSITION_GROUPS: Record<string, string> = {
  cb: "db", s: "db", db: "db",
  edr: "dl", il: "dl", de: "dl", dt: "dl", dl: "dl",
  lb: "lb",
};

function normalizePlayerKey(name: string, position: string): string {
  // Normalize name: lowercase, remove suffixes like "II", "III", "Jr.", etc.
  const normalized = name
    .toLowerCase()
    .replace(/\s+(ii|iii|iv|jr\.?|sr\.?)$/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  const posLower = position.toLowerCase();
  const posGroup = IDP_POSITION_GROUPS[posLower] ?? posLower;

  return `${normalized}:${posGroup}`;
}

/**
 * Calculate weighted aggregate value for a player
 */
function calculateAggregateValue(player: PlayerRankings): number {
  const isIDP = IDP_POSITIONS.includes(player.position);
  const weights = isIDP ? IDP_WEIGHTS : OFFENSE_WEIGHTS;

  let totalWeight = 0;
  let weightedSum = 0;

  // KTC
  if (player.ktc !== null && player.ktc > 0) {
    weightedSum += player.ktc * weights.ktc;
    totalWeight += weights.ktc;
  }

  // FantasyCalc
  if (player.fantasycalc !== null && player.fantasycalc > 0) {
    weightedSum += player.fantasycalc * weights.fantasycalc;
    totalWeight += weights.fantasycalc;
  }

  // DynastyProcess
  if (player.dynastyprocess !== null && player.dynastyprocess > 0) {
    weightedSum += player.dynastyprocess * weights.dynastyprocess;
    totalWeight += weights.dynastyprocess;
  }

  // FantasyPros (primarily IDP, but handles any position)
  if (
    player.fantasypros !== null &&
    player.fantasypros > 0 &&
    weights.fantasypros
  ) {
    weightedSum += player.fantasypros * weights.fantasypros;
    totalWeight += weights.fantasypros;
  }

  // If no sources have data, return 0
  if (totalWeight === 0) return 0;

  // Normalize by actual weights used (in case some sources are missing)
  return Math.round(weightedSum / totalWeight);
}

/**
 * Calculate ranks for all players after aggregation
 */
function calculateRanks(
  players: Array<{ canonicalPlayerId: string; value: number; position: string }>
): Map<string, { overallRank: number; positionRank: number }> {
  // Sort by value descending for overall rank
  const sortedOverall = [...players].sort((a, b) => b.value - a.value);

  // Calculate position ranks
  const positionGroups = new Map<string, typeof players>();
  for (const p of players) {
    if (!positionGroups.has(p.position)) {
      positionGroups.set(p.position, []);
    }
    positionGroups.get(p.position)!.push(p);
  }

  // Sort each position group
  for (const [, group] of positionGroups) {
    group.sort((a, b) => b.value - a.value);
  }

  // Build rank map
  const rankMap = new Map<string, { overallRank: number; positionRank: number }>();

  for (let i = 0; i < sortedOverall.length; i++) {
    const p = sortedOverall[i];
    const positionGroup = positionGroups.get(p.position)!;
    const positionRank = positionGroup.findIndex((x) => x.canonicalPlayerId === p.canonicalPlayerId) + 1;

    rankMap.set(p.canonicalPlayerId, {
      overallRank: i + 1,
      positionRank,
    });
  }

  return rankMap;
}

/**
 * Main aggregation function: compute aggregated values for all players in a league
 */
export async function computeAggregatedValues(leagueId: string): Promise<void> {
  // Get league settings
  const league = await db.query.leagues.findFirst({
    where: eq(leagues.id, leagueId),
    with: {
      settings: true,
    },
  });

  if (!league) {
    throw new Error(`League not found: ${leagueId}`);
  }

  const settings = league.settings;

  // Detect SuperFlex from roster positions or flex rules
  const rosterPositions = settings?.rosterPositions as Record<string, number> | undefined;
  const flexRules = settings?.flexRules as Array<{ slot: string; eligible: string[] }> | undefined;
  const scoringRules = settings?.scoringRules as Record<string, number> | undefined;

  // SuperFlex = has SUPERFLEX slot or a flex that includes QB
  const hasSuperFlexSlot = (rosterPositions?.["SUPERFLEX"] ?? 0) > 0 || (rosterPositions?.["SF"] ?? 0) > 0;
  const hasQbFlexSlot = flexRules?.some(
    (rule) => rule.eligible?.includes("QB") && rule.slot !== "QB"
  );
  const isSuperFlex = hasSuperFlexSlot || hasQbFlexSlot || false;

  // TE Premium = has TE-specific reception bonus
  const isTePremium = (scoringRules?.["te_rec"] ?? 0) > (scoringRules?.["rec"] ?? 0);

  // Determine current season
  const now = new Date();
  const season = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;

  console.log(`Computing aggregated values for league ${leagueId}`);
  console.log(`Settings: SF=${isSuperFlex}, TEP=${isTePremium}, Season=${season}`);

  // Fetch external rankings for this context
  const rankings = await fetchExternalRankings(isSuperFlex, isTePremium, season);
  console.log(`Fetched ${rankings.length} external rankings`);

  // Group by player
  const playerMap = groupByPlayer(rankings);
  console.log(`Found ${playerMap.size} unique players`);

  // Calculate aggregate values
  const aggregatedResults: Array<{
    canonicalPlayerId: string;
    value: number;
    position: string;
    ktc: number | null;
    fc: number | null;
    fp: number | null;
    dp: number | null;
    idp: number | null;
  }> = [];

  for (const [, player] of playerMap) {
    // Skip players without a canonical ID (need to match them first)
    if (!player.canonicalPlayerId) continue;

    const value = calculateAggregateValue(player);
    if (value > 0) {
      aggregatedResults.push({
        canonicalPlayerId: player.canonicalPlayerId,
        value,
        position: player.position,
        ktc: player.ktc,
        fc: player.fantasycalc,
        fp: player.fantasypros,
        dp: player.dynastyprocess,
        idp: player.idpValue,
      });
    }
  }

  console.log(`Calculated ${aggregatedResults.length} aggregated values`);

  // Calculate ranks
  const rankMap = calculateRanks(aggregatedResults);

  // Upsert into aggregated_values table
  for (const result of aggregatedResults) {
    const ranks = rankMap.get(result.canonicalPlayerId);
    if (!ranks) continue;

    await db
      .insert(aggregatedValues)
      .values({
        canonicalPlayerId: result.canonicalPlayerId,
        leagueId,
        aggregatedValue: result.value,
        aggregatedRank: ranks.overallRank,
        aggregatedPositionRank: ranks.positionRank,
        ktcValue: result.ktc,
        fcValue: result.fc,
        fpValue: result.fp,
        dpValue: result.dp,
        idpValue: result.idp,
        sfAdjustment: isSuperFlex ? 1.0 : 0,
        tepAdjustment: isTePremium ? 1.0 : 0,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [aggregatedValues.leagueId, aggregatedValues.canonicalPlayerId],
        set: {
          aggregatedValue: result.value,
          aggregatedRank: ranks.overallRank,
          aggregatedPositionRank: ranks.positionRank,
          ktcValue: result.ktc,
          fcValue: result.fc,
          fpValue: result.fp,
          dpValue: result.dp,
          idpValue: result.idp,
          sfAdjustment: isSuperFlex ? 1.0 : 0,
          tepAdjustment: isTePremium ? 1.0 : 0,
          computedAt: new Date(),
        },
      });
  }

  console.log(`Upserted ${aggregatedResults.length} aggregated values for league ${leagueId}`);
}

/**
 * Pick the best canonical player from multiple name matches.
 *
 * When stripping suffixes (Jr, Sr, III) produces multiple hits,
 * prefer active players on real NFL teams over retired/FA players.
 */
function pickBestCandidate<
  T extends { isActive: boolean; nflTeam: string | null },
>(candidates: T[]): T | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // Prefer active + on a real team
  const active = candidates.filter(
    (c) => c.isActive && c.nflTeam && !c.nflTeam.includes("FA"),
  );
  if (active.length === 1) return active[0];

  // Prefer any active player
  const anyActive = candidates.filter((c) => c.isActive);
  if (anyActive.length > 0) return anyActive[0];

  return candidates[0];
}

/**
 * Match external rankings to canonical players by name.
 *
 * Runs after scraping to link external_rankings rows to
 * canonical_players via canonicalPlayerId.
 */
export async function matchExternalRankingsToPlayers(): Promise<void> {
  // Get all unmatched external rankings
  const unmatched = await db
    .select({
      id: externalRankings.id,
      playerName: externalRankings.playerName,
      position: externalRankings.position,
      nflTeam: externalRankings.nflTeam,
    })
    .from(externalRankings)
    .where(sql`${externalRankings.canonicalPlayerId} IS NULL`);

  console.log(`Found ${unmatched.length} unmatched external rankings`);

  let matched = 0;

  for (const ranking of unmatched) {
    // Strategy 1: exact name + position match
    let player = await db.query.canonicalPlayers.findFirst({
      where: and(
        eq(canonicalPlayers.name, ranking.playerName),
        eq(canonicalPlayers.position, ranking.position),
      ),
    });

    // Strategy 2: normalize periods in suffixes
    // "Marvin Harrison Jr" should match "Marvin Harrison Jr."
    if (!player) {
      const withPeriod = ranking.playerName.replace(
        /\s+(Jr|Sr|II|III|IV)$/i,
        (m) => m + ".",
      );
      if (withPeriod !== ranking.playerName) {
        player = await db.query.canonicalPlayers.findFirst({
          where: and(
            eq(canonicalPlayers.name, withPeriod),
            eq(canonicalPlayers.position, ranking.position),
          ),
        });
      }
    }

    // Strategy 3: strip suffix entirely, search both stripped
    // and suffix variants. "Marvin Harrison" must find both
    // "Marvin Harrison" and "Marvin Harrison Jr." in canonical.
    if (!player) {
      const normalized = ranking.playerName
        .replace(/\s+(II|III|IV|Jr\.?|Sr\.?)$/i, "")
        .trim();

      const nameVariants = [
        normalized,
        `${normalized} Jr.`,
        `${normalized} Jr`,
        `${normalized} Sr.`,
        `${normalized} Sr`,
        `${normalized} II`,
        `${normalized} III`,
        `${normalized} IV`,
      ];

      const candidates = await db.query.canonicalPlayers.findMany({
        where: and(
          inArray(canonicalPlayers.name, nameVariants),
          eq(canonicalPlayers.position, ranking.position),
        ),
      });

      // Prefer active player on a real NFL team over retired
      player = pickBestCandidate(candidates);
    }

    // Strategy 4: match by team + last name
    if (!player && ranking.nflTeam) {
      const players = await db.query.canonicalPlayers.findMany({
        where: and(
          eq(canonicalPlayers.nflTeam, ranking.nflTeam),
          eq(canonicalPlayers.position, ranking.position),
        ),
      });

      const nameParts = ranking.playerName
        .toLowerCase()
        .split(" ");
      for (const p of players) {
        const pNameParts = p.name.toLowerCase().split(" ");
        if (
          nameParts[nameParts.length - 1] ===
          pNameParts[pNameParts.length - 1]
        ) {
          player = p;
          break;
        }
      }
    }

    if (player) {
      await db
        .update(externalRankings)
        .set({ canonicalPlayerId: player.id })
        .where(eq(externalRankings.id, ranking.id));
      matched++;
    }
  }

  console.log(`Matched ${matched} of ${unmatched.length} external rankings to canonical players`);
}

/**
 * Get aggregated rankings for a league, optionally filtered by position
 */
export async function getAggregatedRankings(
  leagueId: string,
  options: {
    position?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<
  Array<{
    player: {
      id: string;
      name: string;
      position: string;
      nflTeam: string | null;
    };
    aggregatedValue: number;
    aggregatedRank: number;
    aggregatedPositionRank: number;
    ktcValue: number | null;
    fcValue: number | null;
    dpValue: number | null;
  }>
> {
  const { position, limit = 100, offset = 0 } = options;

  const query = db
    .select({
      player: {
        id: canonicalPlayers.id,
        name: canonicalPlayers.name,
        position: canonicalPlayers.position,
        nflTeam: canonicalPlayers.nflTeam,
      },
      aggregatedValue: aggregatedValues.aggregatedValue,
      aggregatedRank: aggregatedValues.aggregatedRank,
      aggregatedPositionRank: aggregatedValues.aggregatedPositionRank,
      ktcValue: aggregatedValues.ktcValue,
      fcValue: aggregatedValues.fcValue,
      dpValue: aggregatedValues.dpValue,
    })
    .from(aggregatedValues)
    .innerJoin(canonicalPlayers, eq(aggregatedValues.canonicalPlayerId, canonicalPlayers.id))
    .where(
      position
        ? and(
            eq(aggregatedValues.leagueId, leagueId),
            eq(canonicalPlayers.position, position)
          )
        : eq(aggregatedValues.leagueId, leagueId)
    )
    .orderBy(desc(aggregatedValues.aggregatedValue))
    .limit(limit)
    .offset(offset);

  return query;
}
