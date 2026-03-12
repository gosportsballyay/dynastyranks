/**
 * MyFantasyLeague (MFL) API Adapter
 *
 * MFL is the platform of choice for serious dynasty IDP leagues.
 * It offers granular per-position IDP scoring (DE/DT/LB/CB/S),
 * configurable roster slots, taxi squads, and full draft pick trading.
 *
 * Auth: API key for private leagues, no auth for public leagues.
 * API: All params are CASE SENSITIVE. Year is part of URL path.
 *
 * Quirks:
 * - Single-item responses return object instead of array
 * - api.myfantasyleague.com 302s to server-specific URLs (www43, etc.)
 *   Node fetch follows redirects by default, so this is handled
 * - Rules use nested {event.$t, points.$t, range.$t} format
 * - Points format: "*3" = 3 per unit, "3/0.5" = tiered, "6" = flat bonus
 * - Starter limits are ranges like "1-2" or "0-3"
 * - All players show status "ROSTER" — taxi/IR count from league config
 */

import { BaseAdapter } from "./base";
import type {
  LeagueProviderAdapter,
  AdapterLeague,
  AdapterSettings,
  AdapterTeam,
  AdapterPlayer,
  AdapterDraftPick,
  FlexRule,
  IDPStructure,
  MFLAdapterConfig,
} from "@/types";
import type { CanonicalStatKey } from "@/lib/stats/canonical-keys";

const MFL_API_BASE = "https://api.myfantasyleague.com";

/**
 * MFL stat event code -> canonical stat key mapping.
 *
 * MFL uses short event codes in its rules endpoint. We map the
 * core stats and log unmapped codes as warnings. Codes verified
 * against live MFL API responses.
 */
const MFL_STAT_MAP: Record<string, CanonicalStatKey> = {
  // Passing
  PA: "pass_att",
  PC: "pass_cmp",
  PY: "pass_yd",
  "1P": "pass_yd",  // first down passing yards
  IN: "int",
  P2: "pass_2pt",
  // Rushing
  RA: "rush_att",
  RY: "rush_yd",
  "1R": "rush_yd",  // first down rushing yards
  R2: "rush_2pt",
  // Receiving
  CC: "rec",         // catches/completions (MFL's reception stat)
  CY: "rec_yd",      // catch yards
  "1C": "rec_yd",    // first down catch yards
  C2: "rec_2pt",
  TGT: "rec_tgt",
  // Touchdowns (MFL uses event codes with range-based TD scoring)
  "#P": "pass_td",   // passing TDs
  "#R": "rush_td",   // rushing TDs
  "#C": "rec_td",    // receiving/catch TDs
  "#DR": "def_td",   // defensive return TDs
  "#FR": "def_td",   // fumble return TDs
  "#IT": "int",      // interceptions thrown (negative)
  // Fumbles
  FU: "fum",
  FL: "fum_lost",
  F: "fum",          // fumble (sometimes used as alternate)
  // IDP
  TK: "tackle_solo",
  AS: "tackle_assist",
  SK: "sack",
  IC: "def_int",     // interception caught (defensive)
  ICY: "def_int",    // INT return yards (mapped to def_int as proxy)
  PD: "pass_def",
  FF: "fum_force",
  FC: "fum_rec",     // fumble caught/recovered
  DD: "def_td",      // defensive TD (alternate)
  SF: "safety",
  QH: "qb_hit",
  TKL: "tackle_loss",
  SKY: "sack",       // sack yards (proxy to sack)
  // Blocked kicks
  BLP: "blk_kick",   // blocked punt
  BLF: "blk_kick",   // blocked FG
  BLE: "blk_kick",   // blocked XP
  // Kicking
  FG: "fg",
  MG: "fg_miss",
  EP: "xp",
  EM: "xp_miss",
};

/**
 * MFL position codes -> normalized position names.
 */
const MFL_POSITION_MAP: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FB: "RB",   // Fullbacks map to RB for value purposes
  PK: "K",
  PN: "K",    // Punters map to K (kicker slot)
  K: "K",
  Def: "DST",
  DE: "DE",
  DT: "DT",
  LB: "LB",
  CB: "CB",
  S: "S",
  DL: "DL",
  DB: "DB",
  EDR: "EDR",
  // Non-mappable positions (skip for value engine)
  Coach: "Coach",
  Off: "Off",
  ST: "ST",
  XX: "XX",
  KR: "WR",   // Kick returners are usually WR/RB
  // Team-based positions from players endpoint
  TMQB: "QB",
  TMRB: "RB",
  TMWR: "WR",
  TMTE: "TE",
  TMPK: "K",
  TMPN: "K",
  TMDL: "DL",
  TMLB: "LB",
  TMDB: "DB",
  // Flex/utility
  FLEX: "FLEX",
  "RB/WR": "FLEX",
  "RB/WR/TE": "FLEX",
  "WR/TE": "FLEX",
  "QB/RB/WR/TE": "SUPERFLEX",
  "QB/RB/WR/TE/K": "SUPERFLEX",
  "DL/LB/DB": "IDP_FLEX",
  "DE/DT/LB/CB/S": "IDP_FLEX",
};

/**
 * Flex eligibility by MFL slot name.
 */
const MFL_FLEX_ELIGIBLE: Record<string, string[]> = {
  "RB/WR": ["RB", "WR"],
  "RB/WR/TE": ["RB", "WR", "TE"],
  "WR/TE": ["WR", "TE"],
  "QB/RB/WR/TE": ["QB", "RB", "WR", "TE"],
  "QB/RB/WR/TE/K": ["QB", "RB", "WR", "TE", "K"],
  "DL/LB/DB": ["DL", "LB", "DB"],
  "DE/DT/LB/CB/S": ["DE", "DT", "LB", "CB", "S"],
  FLEX: ["RB", "WR", "TE"],
};

// MFL API response types
interface MFLLeagueResponse {
  league: MFLLeague;
}

interface MFLLeague {
  id: string;
  name: string;
  baseURL?: string;
  franchises?: {
    count?: string;
    franchise: MFLFranchise | MFLFranchise[];
  };
  starters?: {
    count?: string;
    idp_starters?: string;
    position: MFLStarterPosition | MFLStarterPosition[];
  };
  rosterSize?: string;
  injuredReserve?: string;
  taxiSquad?: string;
}

interface MFLFranchise {
  id: string;
  name: string;
  owner_name?: string;
  abbrev?: string;
}

interface MFLStarterPosition {
  name: string;
  limit: string; // Can be "1", "1-2", "0-3", etc.
}

/**
 * MFL rules response — actual format uses nested $t fields.
 */
interface MFLRulesResponse {
  rules: {
    positionRules?: MFLPositionRules | MFLPositionRules[];
  };
}

interface MFLPositionRules {
  positions: string;
  rule?: MFLRule | MFLRule[];
}

interface MFLRule {
  event: { $t: string };
  points: { $t: string };
  range: { $t: string };
}

interface MFLStandingsResponse {
  leagueStandings: {
    franchise: MFLStandingsFranchise | MFLStandingsFranchise[];
  };
}

interface MFLStandingsFranchise {
  id: string;
  fname?: string;
  h2hw?: string;   // head-to-head wins
  h2hl?: string;   // head-to-head losses
  h2ht?: string;   // head-to-head ties
  pp?: string;      // points for (total scored)
  pf?: string;      // alternate points for field
  all_play_pct?: string;
}

interface MFLRostersResponse {
  rosters: {
    franchise: MFLRosterFranchise | MFLRosterFranchise[];
  };
}

interface MFLRosterFranchise {
  id: string;
  week?: string;
  player?: MFLRosterPlayer | MFLRosterPlayer[];
}

interface MFLRosterPlayer {
  id: string;
  status: string;
  salary?: string;
  contractYear?: string;
  contractStatus?: string;
  contractInfo?: string;
  drafted?: string;
}

interface MFLPlayersResponse {
  players: {
    player: MFLPlayerInfo | MFLPlayerInfo[];
  };
}

interface MFLPlayerInfo {
  id: string;
  name: string; // "LastName, FirstName"
  position: string;
  team: string;
  status?: string;
  stats_global_id?: string;
  draft_year?: string;
  draft_team?: string;
}

interface MFLFutureDraftPicksResponse {
  futureDraftPicks: {
    franchise: MFLDraftPickFranchise | MFLDraftPickFranchise[];
  };
}

interface MFLDraftPickFranchise {
  id: string;
  futureDraftPick?: MFLFutureDraftPick | MFLFutureDraftPick[];
}

interface MFLFutureDraftPick {
  year: string;
  round: string;
  originalPickFor: string;
  pick?: string;
}

/**
 * Normalize MFL's inconsistent array/object responses.
 * MFL returns a single object when there's 1 item, array for 2+.
 */
function ensureArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Parse MFL points format string.
 *
 * MFL scoring formats:
 * - "*3"     → 3 points per unit (per-stat multiplier)
 * - "*0.1"   → 0.1 points per unit (e.g., per yard)
 * - "6"      → flat 6 point bonus for the range
 * - "3/0.5"  → tiered: 3 base + 0.5 per unit in range
 * - "-4"     → negative flat bonus
 *
 * For our purposes, we extract the per-unit multiplier when
 * present (*X), otherwise treat as a bonus and skip (bonuses
 * are range-dependent and our engine handles them differently).
 *
 * Returns the per-unit multiplier, or null for non-per-unit rules.
 */
function parseMflPoints(pointsStr: string): number | null {
  if (pointsStr.startsWith("*")) {
    return parseFloat(pointsStr.slice(1));
  }
  // Tiered format "X/Y" — use Y as per-unit
  if (pointsStr.includes("/")) {
    const parts = pointsStr.split("/");
    return parseFloat(parts[1]);
  }
  // Flat bonus — not a per-unit multiplier
  return null;
}

export class MFLAdapter
  extends BaseAdapter
  implements LeagueProviderAdapter
{
  readonly provider = "mfl" as const;
  private apiKey?: string;
  private leagueId?: string;
  private season: number;
  private playerCache: Map<string, MFLPlayerInfo> | null =
    null;

  constructor(config: MFLAdapterConfig) {
    super({ ...config, rateLimitMs: 300 });
    this.apiKey = config.apiKey;
    this.leagueId = config.leagueId;
    this.season = config.season ?? new Date().getFullYear();
  }

  /**
   * Build MFL API URL. Year is part of the path, not query.
   * MFL will 302 redirect to the correct server (www43, etc.)
   * which Node fetch follows automatically.
   */
  private buildUrl(
    endpoint: string,
    leagueId: string,
    extraParams?: Record<string, string>,
  ): string {
    const params = new URLSearchParams({
      TYPE: endpoint,
      L: leagueId,
      JSON: "1",
      ...extraParams,
    });
    if (this.apiKey) {
      params.set("APIKEY", this.apiKey);
    }
    return (
      `${MFL_API_BASE}/${this.season}/export?` +
      params.toString()
    );
  }

  /**
   * Build URL without league ID (for global endpoints like players).
   */
  private buildGlobalUrl(
    endpoint: string,
    extraParams?: Record<string, string>,
  ): string {
    const params = new URLSearchParams({
      TYPE: endpoint,
      JSON: "1",
      ...extraParams,
    });
    if (this.apiKey) {
      params.set("APIKEY", this.apiKey);
    }
    return (
      `${MFL_API_BASE}/${this.season}/export?` +
      params.toString()
    );
  }

  /**
   * MFL has no user-league discovery endpoint.
   */
  async getUserLeagues(
    _season: number,
  ): Promise<AdapterLeague[]> {
    return [];
  }

  /**
   * Fetch league by ID and extract basic info.
   */
  async getLeagueById(
    leagueId: string,
    season: number,
  ): Promise<AdapterLeague | null> {
    try {
      const savedSeason = this.season;
      this.season = season;
      const url = this.buildUrl("league", leagueId);
      this.season = savedSeason;

      const response =
        await this.fetch<MFLLeagueResponse>(
          url,
          {},
          "GetLeague",
        );

      const league = response.league;
      const franchises = ensureArray(
        league.franchises?.franchise,
      );

      return {
        externalLeagueId: league.id,
        name: league.name,
        season,
        totalTeams: franchises.length,
        draftType: "snake",
      };
    } catch (error) {
      console.error("MFL getLeagueById error:", error);
      return null;
    }
  }

  /**
   * Fetch and normalize league settings.
   */
  async getLeagueSettings(
    leagueId: string,
  ): Promise<AdapterSettings> {
    const [leagueResponse, rulesResponse] =
      await Promise.all([
        this.fetch<MFLLeagueResponse>(
          this.buildUrl("league", leagueId),
          {},
          "GetLeagueSettings",
        ),
        this.fetch<MFLRulesResponse>(
          this.buildUrl("rules", leagueId),
          {},
          "GetRules",
        ),
      ]);

    const league = leagueResponse.league;
    const starterPositions = ensureArray(
      league.starters?.position,
    );

    const {
      rosterPositions,
      flexRules,
      benchSlots,
      irSlots,
      taxiSlots,
    } = this.parseRosterPositions(
      league,
      starterPositions,
    );

    const { scoringRules, positionScoringOverrides } =
      this.parseScoringRules(rulesResponse);

    const idpStructure =
      this.determineIdpStructure(rosterPositions);

    const positionMappings =
      this.getDefaultPositionMappings(idpStructure);

    return {
      scoringRules,
      positionScoringOverrides:
        Object.keys(positionScoringOverrides).length > 0
          ? positionScoringOverrides
          : undefined,
      rosterPositions,
      flexRules,
      positionMappings,
      idpStructure,
      benchSlots,
      taxiSlots,
      irSlots,
      metadata: {
        mflLeagueId: league.id,
      },
    };
  }

  /**
   * Fetch all teams with standings.
   */
  async getTeams(
    leagueId: string,
  ): Promise<AdapterTeam[]> {
    const [leagueResponse, standingsResponse] =
      await Promise.all([
        this.fetch<MFLLeagueResponse>(
          this.buildUrl("league", leagueId),
          {},
          "GetTeams_League",
        ),
        this.fetch<MFLStandingsResponse>(
          this.buildUrl("leagueStandings", leagueId),
          {},
          "GetTeams_Standings",
        ).catch(() => null),
      ]);

    const franchises = ensureArray(
      leagueResponse.league.franchises?.franchise,
    );
    const standings = standingsResponse
      ? ensureArray(
          standingsResponse.leagueStandings?.franchise,
        )
      : [];

    const standingsMap = new Map<
      string,
      MFLStandingsFranchise
    >();
    for (const s of standings) {
      standingsMap.set(s.id, s);
    }

    // Sort by points (pp field) descending to derive rank
    const sorted = [...franchises].sort((a, b) => {
      const aPoints = parseFloat(
        standingsMap.get(a.id)?.pp ?? "0",
      );
      const bPoints = parseFloat(
        standingsMap.get(b.id)?.pp ?? "0",
      );
      return bPoints - aPoints;
    });

    return sorted.map((f, index) => {
      const s = standingsMap.get(f.id);
      return {
        externalTeamId: f.id,
        ownerName: f.owner_name || f.name,
        teamName: f.name,
        standingRank: index + 1,
        totalPoints: s?.pp ? parseFloat(s.pp) : 0,
        wins: s?.h2hw ? parseInt(s.h2hw) : 0,
        losses: s?.h2hl ? parseInt(s.h2hl) : 0,
        ties: s?.h2ht ? parseInt(s.h2ht) : 0,
      };
    });
  }

  /**
   * Fetch all rostered players.
   */
  async getRosters(
    leagueId: string,
  ): Promise<AdapterPlayer[]> {
    const rostersResponse =
      await this.fetch<MFLRostersResponse>(
        this.buildUrl("rosters", leagueId),
        {},
        "GetRosters",
      );

    const franchises = ensureArray(
      rostersResponse.rosters?.franchise,
    );

    const allPlayerIds = new Set<string>();
    for (const franchise of franchises) {
      for (const player of ensureArray(
        franchise.player,
      )) {
        allPlayerIds.add(player.id);
      }
    }

    const playerInfoMap = await this.getPlayerInfo(
      Array.from(allPlayerIds),
    );

    const players: AdapterPlayer[] = [];

    for (const franchise of franchises) {
      const teamId = franchise.id;

      for (const rosterPlayer of ensureArray(
        franchise.player,
      )) {
        const info = playerInfoMap.get(rosterPlayer.id);
        // MFL status is always "ROSTER" — all players
        // are on the active roster from the API's
        // perspective. Taxi/IR are part of roster count.
        const slotPosition = this.mapRosterStatus(
          rosterPlayer.status,
        );

        players.push({
          externalPlayerId: rosterPlayer.id,
          teamExternalId: teamId,
          slotPosition,
          playerName: info
            ? this.formatPlayerName(info.name)
            : undefined,
          playerPosition: info
            ? this.normalizePosition(info.position)
            : undefined,
        });
      }
    }

    return players;
  }

  /**
   * Fetch draft picks using MFL's futureDraftPicks endpoint.
   *
   * Unlike ESPN, MFL tracks actual pick ownership — the endpoint
   * returns picks each franchise currently owns (including traded
   * picks). Missing picks = traded away.
   */
  async getDraftPicks(
    leagueId: string,
  ): Promise<AdapterDraftPick[]> {
    const teams = await this.getTeams(leagueId);
    const totalTeams = teams.length;

    // Project pick positions from standings
    const projectedSlot = new Map<string, number>();
    for (const team of teams) {
      projectedSlot.set(
        team.externalTeamId,
        totalTeams -
          (team.standingRank ?? totalTeams) +
          1,
      );
    }

    const picks: AdapterDraftPick[] = [];

    try {
      const response =
        await this.fetch<MFLFutureDraftPicksResponse>(
          this.buildUrl("futureDraftPicks", leagueId),
          {},
          "GetDraftPicks",
        );

      const draftFranchises = ensureArray(
        response.futureDraftPicks?.franchise,
      );

      for (const franchise of draftFranchises) {
        for (const pick of ensureArray(
          franchise.futureDraftPick,
        )) {
          const season = parseInt(pick.year);
          const round = parseInt(pick.round);

          picks.push({
            season,
            round,
            pickNumber: pick.pick
              ? parseInt(pick.pick)
              : undefined,
            projectedPickNumber: projectedSlot.get(
              pick.originalPickFor,
            ),
            ownerTeamExternalId: franchise.id,
            originalTeamExternalId: pick.originalPickFor,
          });
        }
      }
    } catch {
      // futureDraftPicks unavailable — generate defaults
      const currentYear = new Date().getFullYear();
      const futureSeasons = [
        currentYear,
        currentYear + 1,
        currentYear + 2,
      ];
      for (const season of futureSeasons) {
        for (let round = 1; round <= 5; round++) {
          for (const team of teams) {
            picks.push({
              season,
              round,
              projectedPickNumber: projectedSlot.get(
                team.externalTeamId,
              ),
              ownerTeamExternalId: team.externalTeamId,
              originalTeamExternalId:
                team.externalTeamId,
            });
          }
        }
      }
    }

    return picks;
  }

  /**
   * Parse roster positions from MFL league starters config.
   *
   * MFL starters use range limits like "1-2", "0-3".
   * We use the maximum value as the slot count.
   */
  private parseRosterPositions(
    league: MFLLeague,
    starterPositions: MFLStarterPosition[],
  ): {
    rosterPositions: Record<string, number>;
    flexRules: FlexRule[];
    benchSlots: number;
    irSlots: number;
    taxiSlots: number;
  } {
    const rosterPositions: Record<string, number> = {};
    const flexRules: FlexRule[] = [];
    const seenFlexSlots = new Set<string>();

    for (const pos of starterPositions) {
      // Parse range limit: "1-2" → max 2, "0-3" → max 3
      // MFL uses flexible lineup limits; we use the max
      // for roster slot counting
      const limitParts = pos.limit.split("-");
      const count =
        parseInt(limitParts[limitParts.length - 1]) || 1;
      const normalized =
        MFL_POSITION_MAP[pos.name] || pos.name;

      if (
        normalized === "BN" ||
        normalized === "IR" ||
        normalized === "TAXI"
      ) {
        continue;
      }

      rosterPositions[normalized] =
        (rosterPositions[normalized] || 0) + count;

      const eligible = MFL_FLEX_ELIGIBLE[pos.name];
      if (eligible && !seenFlexSlots.has(normalized)) {
        flexRules.push({ slot: normalized, eligible });
        seenFlexSlots.add(normalized);
      }
    }

    const rosterSize = parseInt(
      league.rosterSize || "0",
    );
    const irSlots = parseInt(
      league.injuredReserve || "0",
    );
    const taxiSlots = parseInt(
      league.taxiSquad || "0",
    );

    // MFL starter count: use the explicit count field
    // (e.g., "21-22") when available, else sum positions.
    // The starters.count field gives the actual number of
    // starters, while position maxes can exceed it due to
    // flexible lineup limits.
    let starterCount: number;
    const countStr = league.starters?.count;
    if (countStr) {
      // "21-22" → use max value
      const parts = countStr.split("-");
      starterCount =
        parseInt(parts[parts.length - 1]) || 0;
    } else {
      starterCount = Object.values(
        rosterPositions,
      ).reduce((a, b) => a + b, 0);
    }

    // In MFL, rosterSize is the active roster only —
    // IR and taxi are separate allocations, not subtracted.
    const benchSlots = Math.max(
      0,
      rosterSize - starterCount,
    );

    return {
      rosterPositions,
      flexRules,
      benchSlots,
      irSlots,
      taxiSlots,
    };
  }

  /**
   * Parse scoring rules from MFL rules endpoint.
   *
   * MFL rules format uses nested objects:
   *   positionRules[].rule[].event.$t  — stat code
   *   positionRules[].rule[].points.$t — scoring format
   *   positionRules[].rule[].range.$t  — value range
   *
   * We extract per-unit multipliers (e.g., *0.1 per yard) as
   * the base scoring rules. Flat bonuses and tiered scoring
   * are logged but not stored (our engine handles bonuses via
   * game logs, not estimated from per-unit rules).
   *
   * Position groups with many positions (>5) are treated as
   * base scoring. Smaller groups create position overrides.
   */
  private parseScoringRules(
    rulesResponse: MFLRulesResponse,
  ): {
    scoringRules: Partial<Record<CanonicalStatKey, number>>;
    positionScoringOverrides: Record<
      string,
      Partial<Record<CanonicalStatKey, number>>
    >;
  } {
    const scoringRules: Partial<
      Record<CanonicalStatKey, number>
    > = {};
    const positionScoringOverrides: Record<
      string,
      Partial<Record<CanonicalStatKey, number>>
    > = {};
    const unmappedStats = new Set<string>();

    const positionRules = ensureArray(
      rulesResponse.rules?.positionRules,
    );

    // Two-pass approach: extract per-group scoring first,
    // then separate base rules from position overrides.
    // This ensures ordering in the API response doesn't
    // affect which rules are treated as base vs override.
    const parsedGroups: Array<{
      positions: string[];
      scoring: Partial<Record<CanonicalStatKey, number>>;
    }> = [];

    for (const posRule of positionRules) {
      const positions = posRule.positions
        .split("|")
        .map((p: string) => p.trim());
      const rules = ensureArray(posRule.rule);

      const ruleScoring: Partial<
        Record<CanonicalStatKey, number>
      > = {};

      for (const rule of rules) {
        const eventCode = rule.event.$t;
        const pointsStr = rule.points.$t;
        const rangeStr = rule.range.$t;

        const canonicalKey = MFL_STAT_MAP[eventCode];
        if (!canonicalKey) {
          unmappedStats.add(eventCode);
          continue;
        }

        const perUnit = parseMflPoints(pointsStr);
        if (perUnit !== null) {
          const isTdEvent = eventCode.startsWith("#");
          const isBaseRange =
            rangeStr.startsWith("0-") ||
            rangeStr.startsWith("-") ||
            isTdEvent;
          if (isBaseRange) {
            if (!(canonicalKey in ruleScoring)) {
              ruleScoring[canonicalKey] = perUnit;
            }
          }
        } else {
          const flatVal = parseFloat(pointsStr);
          if (!isNaN(flatVal)) {
            const isTd = eventCode.startsWith("#");
            const isPerOccurrence =
              canonicalKey === "fum_lost" ||
              canonicalKey === "fum";
            if (
              (isTd || isPerOccurrence) &&
              !(canonicalKey in ruleScoring)
            ) {
              ruleScoring[canonicalKey] = flatVal;
            }
          }
        }
      }

      parsedGroups.push({ positions, scoring: ruleScoring });
    }

    // Pass 1: populate base scoring from wide groups
    // (sorted by group size descending — widest first)
    const sorted = [...parsedGroups].sort(
      (a, b) => b.positions.length - a.positions.length,
    );
    for (const group of sorted) {
      if (group.positions.length <= 5) continue;
      for (const [key, val] of Object.entries(
        group.scoring,
      )) {
        const statKey = key as CanonicalStatKey;
        if (!(statKey in scoringRules)) {
          scoringRules[statKey] = val;
        }
      }
    }

    // Pass 2: extract position overrides from narrow groups
    for (const group of sorted) {
      if (group.positions.length > 5) continue;
      for (const pos of group.positions) {
        const normalizedPos =
          MFL_POSITION_MAP[pos] || pos;
        if (
          normalizedPos === "K" ||
          normalizedPos === "DST"
        ) {
          continue;
        }
        const overrides: Partial<
          Record<CanonicalStatKey, number>
        > = {};
        for (const [key, val] of Object.entries(
          group.scoring,
        )) {
          const statKey = key as CanonicalStatKey;
          if (scoringRules[statKey] !== val) {
            overrides[statKey] = val;
          }
        }
        if (Object.keys(overrides).length > 0) {
          if (
            !positionScoringOverrides[normalizedPos]
          ) {
            positionScoringOverrides[normalizedPos] =
              {};
          }
          Object.assign(
            positionScoringOverrides[normalizedPos],
            overrides,
          );
        }
      }
    }

    if (unmappedStats.size > 0) {
      console.warn(
        "MFL: unmapped stat codes:",
        Array.from(unmappedStats).join(", "),
      );
    }

    return { scoringRules, positionScoringOverrides };
  }

  /**
   * Fetch player info from MFL players endpoint.
   * Caches results within the adapter session (~2800 players).
   */
  private async getPlayerInfo(
    _playerIds: string[],
  ): Promise<Map<string, MFLPlayerInfo>> {
    if (this.playerCache) {
      return this.playerCache;
    }

    try {
      const url = this.buildGlobalUrl("players", {
        DETAILS: "1",
      });

      const response =
        await this.fetch<MFLPlayersResponse>(
          url,
          {},
          "GetPlayers",
        );

      const players = ensureArray(
        response.players?.player,
      );
      this.playerCache = new Map();
      for (const p of players) {
        this.playerCache.set(p.id, p);
      }
    } catch (error) {
      console.error(
        "MFL: Failed to fetch players endpoint:",
        error,
      );
      this.playerCache = new Map();
    }

    return this.playerCache;
  }

  /**
   * Map MFL roster status to normalized slot position.
   * MFL returns "ROSTER" for all players — taxi/IR are
   * part of the roster count, not separate statuses.
   */
  private mapRosterStatus(status: string): string {
    switch (status) {
      case "TAXI_SQUAD":
        return "TAXI";
      case "INJURED_RESERVE":
        return "IR";
      case "ROSTER":
      default:
        return "BN";
    }
  }

  /**
   * Format "LastName, FirstName" → "FirstName LastName".
   */
  private formatPlayerName(mflName: string): string {
    if (!mflName.includes(",")) return mflName;
    const [last, first] = mflName
      .split(",")
      .map((s) => s.trim());
    return `${first} ${last}`;
  }

  /**
   * Normalize MFL position to our canonical positions.
   */
  private normalizePosition(
    mflPosition: string,
  ): string {
    return MFL_POSITION_MAP[mflPosition] || mflPosition;
  }

  /**
   * Determine IDP structure from roster positions.
   */
  private determineIdpStructure(
    positions: Record<string, number>,
  ): IDPStructure {
    const posKeys = Object.keys(positions);

    // DL and DB are consolidated positions; LB exists in
    // both consolidated and granular systems, so it's not
    // a signal either way
    const consolidated = [
      "DL",
      "DB",
      "IDP_FLEX",
    ].some((p) => posKeys.includes(p));
    const granular = [
      "DE",
      "DT",
      "CB",
      "S",
      "EDR",
    ].some((p) => posKeys.includes(p));
    const hasLb = posKeys.includes("LB");

    if (!consolidated && !granular && !hasLb) return "none";
    if (consolidated && granular) return "mixed";
    if (consolidated) return "consolidated";
    if (granular || hasLb) return "granular";
    return "none";
  }

  /**
   * Get default position mappings for IDP.
   */
  private getDefaultPositionMappings(
    idpStructure: IDPStructure,
  ): Record<string, string[]> | undefined {
    if (idpStructure === "none") return undefined;

    return {
      DL: ["EDR", "IL", "DE", "DT"],
      LB: ["LB", "ILB", "OLB"],
      DB: ["CB", "S"],
    };
  }
}

/**
 * Create a new MFL adapter instance.
 */
export function createMFLAdapter(
  config: MFLAdapterConfig = {},
): MFLAdapter {
  return new MFLAdapter(config);
}
