/**
 * ESPN Fantasy Football API Adapter
 *
 * ESPN's API is semi-public with no official documentation. Private leagues
 * require cookie-based authentication (espn_s2 + SWID cookies from browser).
 * Public leagues work without authentication.
 *
 * Key endpoints use "views" to fetch specific data:
 * - mSettings: League scoring and roster configuration
 * - mTeam: Team information and owners
 * - mRoster: Player rosters
 * - mDraftDetail: Draft picks and trades
 */

import { BaseAdapter } from "./base";
import type {
  LeagueProviderAdapter,
  AdapterConfig,
  AdapterLeague,
  AdapterSettings,
  AdapterTeam,
  AdapterPlayer,
  AdapterDraftPick,
  FlexRule,
  IDPStructure,
} from "@/types";

const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

/**
 * ESPN position slot IDs to normalized position names.
 * ESPN uses numeric slot IDs for roster positions.
 */
const ESPN_POSITION_MAP: Record<number, string> = {
  // Offense
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  17: "K",
  16: "DST",
  // Flex slots
  3: "FLEX",       // RB/WR
  5: "FLEX",       // WR/TE
  7: "SUPERFLEX",  // OP (Offensive Player)
  23: "FLEX",      // FLEX (RB/WR/TE)
  // IDP - Granular
  8: "DT",
  9: "DE",
  10: "LB",
  12: "CB",
  13: "S",
  // IDP - Consolidated
  11: "DL",
  14: "DB",
  15: "IDP_FLEX",  // DP (Defensive Player)
  // Roster slots
  20: "BN",
  21: "IR",
  24: "TAXI",
};

/**
 * Flex slot eligibility by ESPN slot ID.
 */
const ESPN_FLEX_ELIGIBLE: Record<number, string[]> = {
  3: ["RB", "WR"],           // R/W flex
  5: ["WR", "TE"],           // W/T flex
  7: ["QB", "RB", "WR", "TE"], // OP (Superflex)
  23: ["RB", "WR", "TE"],    // Standard flex
  15: ["DL", "LB", "DB"],    // DP (IDP flex)
};

/**
 * ESPN scoring stat IDs to normalized stat keys.
 * ESPN uses numeric IDs for each scoring category.
 */
const ESPN_STAT_MAP: Record<number, string> = {
  // Passing
  0: "pass_att",
  1: "pass_cmp",
  3: "pass_yd",
  4: "pass_td",
  19: "pass_2pt",
  20: "int",
  // Rushing
  23: "rush_att",
  24: "rush_yd",
  25: "rush_td",
  26: "rush_2pt",
  // Receiving
  41: "rec_target",
  42: "rec_yd",
  43: "rec_td",
  44: "rec_2pt",
  53: "rec",  // Receptions (PPR)
  // Fumbles
  68: "fum",
  72: "fum_lost",
  // Kicking
  77: "fg_0_39",
  78: "fg_40_49",
  79: "fg_50_plus",
  80: "fg",
  85: "xp",
  86: "xp_miss",
  // IDP
  99: "tackle_solo",
  100: "tackle_assist",
  101: "sack",
  102: "def_int",
  103: "fum_force",
  104: "fum_rec",
  106: "def_td",
  107: "safety",
  108: "pass_def",
  109: "blk_kick",
  110: "tackle_loss",
  // DST
  89: "dst_td",
  90: "dst_int",
  91: "dst_fum_rec",
  92: "dst_blk_kick",
  93: "dst_safety",
  94: "dst_sack",
  95: "dst_pts_allowed",
  96: "dst_yds_allowed",
};

/**
 * ESPN player position IDs to position names.
 */
const ESPN_PLAYER_POSITION_MAP: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  7: "P",
  9: "DT",
  10: "DE",
  11: "LB",
  12: "CB",
  13: "S",
  14: "EDR",  // Edge rusher
  16: "DST",
};

// ESPN API response types
interface ESPNLeague {
  id: number;
  settings: {
    name: string;
    size: number;
  };
  seasonId: number;
  scoringPeriodId: number;
  draftDetail?: ESPNDraftDetail;
}

interface ESPNDraftDetail {
  drafted: boolean;
  picks?: ESPNDraftPick[];
}

interface ESPNDraftPick {
  roundId: number;
  overallPickNumber: number;
  teamId: number;
  tradedToTeamId?: number;
  keeper?: boolean;
}

interface ESPNSettings {
  scoringSettings: {
    scoringItems: ESPNScoringItem[];
  };
  rosterSettings: {
    lineupSlotCounts: Record<string, number>;
    positionLimits: Record<string, number>;
  };
  draftSettings: {
    type: string;  // "SNAKE", "AUCTION"
  };
  acquisitionSettings?: {
    waiverProcessDays?: number[];
  };
  tradeSettings?: {
    deadlineDate?: number;
  };
}

interface ESPNScoringItem {
  statId: number;
  pointsOverrides?: Record<string, number>;  // Position-specific
  points: number;  // Base points
  isReverseItem?: boolean;  // True for negative scoring (fumbles, INTs)
}

interface ESPNTeam {
  id: number;
  name?: string;
  abbrev?: string;
  owners?: string[];
  record?: {
    overall: {
      wins: number;
      losses: number;
      ties: number;
      pointsFor: number;
    };
  };
  playoffSeed?: number;
  roster?: {
    entries: ESPNRosterEntry[];
  };
}

interface ESPNRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: {
    player: ESPNPlayer;
  };
}

interface ESPNPlayer {
  id: number;
  fullName: string;
  defaultPositionId: number;
  proTeamId: number;
  injuryStatus?: string;
}

interface ESPNMember {
  id: string;
  displayName: string;
}

interface ESPNFullResponse {
  id: number;
  settings: ESPNSettings;
  seasonId: number;
  teams: ESPNTeam[];
  members?: ESPNMember[];
  draftDetail?: ESPNDraftDetail;
}

export interface ESPNAdapterConfig extends AdapterConfig {
  espnS2?: string;   // espn_s2 cookie for private leagues
  swid?: string;     // SWID cookie for private leagues
  leagueId?: string; // ESPN league ID (for direct access)
  season?: number;   // League season year (defaults to current year)
}

export class ESPNAdapter extends BaseAdapter implements LeagueProviderAdapter {
  readonly provider = "espn" as const;
  private espnS2?: string;
  private swid?: string;
  private leagueId?: string;
  private season: number;

  constructor(config: ESPNAdapterConfig) {
    super({ ...config, rateLimitMs: 200 });
    this.espnS2 = config.espnS2;
    this.swid = config.swid;
    this.leagueId = config.leagueId;
    this.season = config.season ?? new Date().getFullYear();
  }

  /**
   * Build API URL for ESPN league endpoint.
   */
  private buildUrl(leagueId: string, season: number, views: string[]): string {
    const viewParams = views.map((v) => `view=${v}`).join("&");
    return `${ESPN_API_BASE}/seasons/${season}/segments/0/leagues/${leagueId}?${viewParams}`;
  }

  /**
   * Get headers with authentication cookies if available.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (this.espnS2 && this.swid) {
      headers["Cookie"] = `espn_s2=${this.espnS2}; SWID=${this.swid}`;
    }

    return headers;
  }

  /**
   * ESPN doesn't have a user discovery endpoint.
   * Users must provide league ID directly.
   */
  async getUserLeagues(_season: number): Promise<AdapterLeague[]> {
    // ESPN has no "get all user leagues" endpoint
    // Return empty - leagues are added via getLeagueById
    return [];
  }

  /**
   * Fetch league by ID and extract basic info.
   */
  async getLeagueById(
    leagueId: string,
    season: number
  ): Promise<AdapterLeague | null> {
    try {
      const url = this.buildUrl(leagueId, season, ["mSettings"]);
      const response = await this.fetch<ESPNFullResponse>(
        url,
        { headers: this.getHeaders() },
        "GetLeague"
      );

      const settings = response.settings;
      // ESPN API can nest settings in different ways depending on the view
      const leagueName = (settings as unknown as { name?: string }).name || `ESPN League ${response.id}`;
      const numTeams = settings.rosterSettings?.lineupSlotCounts
        ? Object.keys(settings.rosterSettings.lineupSlotCounts).length
        : 10;

      return {
        externalLeagueId: response.id.toString(),
        name: leagueName,
        season: response.seasonId,
        totalTeams: numTeams,
        draftType: this.mapDraftType(settings.draftSettings?.type),
      };
    } catch (error) {
      console.error("ESPN getLeagueById error:", error);
      return null;
    }
  }

  /**
   * Fetch and normalize league settings.
   */
  async getLeagueSettings(leagueId: string): Promise<AdapterSettings> {
    const url = this.buildUrl(leagueId, this.season, ["mSettings"]);

    const response = await this.fetch<ESPNFullResponse>(
      url,
      { headers: this.getHeaders() },
      "GetLeagueSettings"
    );

    const settings = response.settings;

    // Parse roster positions from lineupSlotCounts
    const { rosterPositions, flexRules, benchSlots, irSlots, taxiSlots } =
      this.parseRosterPositions(settings.rosterSettings.lineupSlotCounts);

    // Parse scoring rules
    const { scoringRules, positionScoringOverrides } =
      this.parseScoringRules(settings.scoringSettings.scoringItems);

    // Detect IDP structure
    const idpStructure = this.determineIdpStructure(rosterPositions);

    // Get position mappings for consolidated IDP
    const positionMappings = this.getDefaultPositionMappings(idpStructure);

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
        draftType: settings.draftSettings?.type,
      },
    };
  }

  /**
   * Fetch all teams with standings.
   */
  async getTeams(leagueId: string): Promise<AdapterTeam[]> {
    const url = this.buildUrl(leagueId, this.season, ["mTeam"]);

    const response = await this.fetch<ESPNFullResponse>(
      url,
      { headers: this.getHeaders() },
      "GetTeams"
    );

    // Create owner display name lookup from members
    const memberMap = new Map<string, string>();
    for (const member of response.members || []) {
      memberMap.set(member.id, member.displayName);
    }

    return (response.teams || []).map((team, index) => ({
      externalTeamId: team.id.toString(),
      ownerName: team.owners?.[0]
        ? memberMap.get(team.owners[0]) || `Owner ${team.id}`
        : `Team ${team.id}`,
      teamName: team.name || team.abbrev || `Team ${team.id}`,
      standingRank: team.playoffSeed || index + 1,
      totalPoints: team.record?.overall?.pointsFor || 0,
      wins: team.record?.overall?.wins || 0,
      losses: team.record?.overall?.losses || 0,
      ties: team.record?.overall?.ties || 0,
    }));
  }

  /**
   * Fetch all rostered players using concurrent fetching.
   */
  async getRosters(leagueId: string): Promise<AdapterPlayer[]> {
    const url = this.buildUrl(leagueId, this.season, ["mRoster", "mTeam"]);

    const response = await this.fetch<ESPNFullResponse>(
      url,
      { headers: this.getHeaders() },
      "GetRosters"
    );

    const players: AdapterPlayer[] = [];

    for (const team of response.teams || []) {
      const teamId = team.id.toString();

      for (const entry of team.roster?.entries || []) {
        const slotPosition = this.mapSlotPosition(entry.lineupSlotId);
        const player = entry.playerPoolEntry?.player;

        players.push({
          externalPlayerId: entry.playerId.toString(),
          teamExternalId: teamId,
          slotPosition,
          playerName: player?.fullName,
          playerPosition: player
            ? ESPN_PLAYER_POSITION_MAP[player.defaultPositionId]
            : undefined,
        });
      }
    }

    return players;
  }

  /**
   * Fetch draft picks including traded picks.
   */
  async getDraftPicks(leagueId: string): Promise<AdapterDraftPick[]> {
    const url = this.buildUrl(leagueId, this.season, ["mDraftDetail"]);

    try {
      const response = await this.fetch<ESPNFullResponse>(
        url,
        { headers: this.getHeaders() },
        "GetDraftPicks"
      );

      const draftDetail = response.draftDetail;
      if (!draftDetail?.picks) {
        return [];
      }

      // For future picks (not yet drafted), we need to track ownership
      // ESPN shows tradedToTeamId if the pick was traded
      return draftDetail.picks.map((pick) => ({
        season: this.season,
        round: pick.roundId,
        pickNumber: pick.overallPickNumber,
        ownerTeamExternalId: (pick.tradedToTeamId || pick.teamId).toString(),
        originalTeamExternalId: pick.teamId.toString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Parse roster positions from ESPN lineupSlotCounts.
   */
  private parseRosterPositions(slotCounts: Record<string, number>): {
    rosterPositions: Record<string, number>;
    flexRules: FlexRule[];
    benchSlots: number;
    irSlots: number;
    taxiSlots: number;
  } {
    const rosterPositions: Record<string, number> = {};
    const flexRules: FlexRule[] = [];
    let benchSlots = 0;
    let irSlots = 0;
    let taxiSlots = 0;
    const seenFlexSlots = new Set<string>();

    for (const [slotIdStr, count] of Object.entries(slotCounts)) {
      if (count === 0) continue;

      const slotId = parseInt(slotIdStr);
      const position = ESPN_POSITION_MAP[slotId];

      if (!position) continue;

      // Handle special slots
      if (position === "BN") {
        benchSlots = count;
        continue;
      }
      if (position === "IR") {
        irSlots = count;
        continue;
      }
      if (position === "TAXI") {
        taxiSlots = count;
        continue;
      }

      // Add to roster positions
      rosterPositions[position] = (rosterPositions[position] || 0) + count;

      // Check for flex eligibility
      const eligible = ESPN_FLEX_ELIGIBLE[slotId];
      if (eligible && !seenFlexSlots.has(position)) {
        flexRules.push({ slot: position, eligible });
        seenFlexSlots.add(position);
      }
    }

    return { rosterPositions, flexRules, benchSlots, irSlots, taxiSlots };
  }

  /**
   * Parse scoring rules from ESPN scoringItems.
   */
  private parseScoringRules(scoringItems: ESPNScoringItem[]): {
    scoringRules: Record<string, number>;
    positionScoringOverrides: Record<string, Record<string, number>>;
  } {
    const scoringRules: Record<string, number> = {};
    const positionScoringOverrides: Record<string, Record<string, number>> = {};

    for (const item of scoringItems) {
      const statKey = ESPN_STAT_MAP[item.statId];
      if (!statKey) continue;

      // Base scoring
      scoringRules[statKey] = item.points;

      // Position-specific overrides
      if (item.pointsOverrides) {
        for (const [posId, points] of Object.entries(item.pointsOverrides)) {
          const position = ESPN_PLAYER_POSITION_MAP[parseInt(posId)];
          if (position) {
            if (!positionScoringOverrides[position]) {
              positionScoringOverrides[position] = {};
            }
            positionScoringOverrides[position][statKey] = points;
          }
        }
      }
    }

    return { scoringRules, positionScoringOverrides };
  }

  /**
   * Map ESPN slot ID to normalized slot position.
   */
  private mapSlotPosition(slotId: number): string {
    return ESPN_POSITION_MAP[slotId] ?? "BN";
  }

  /**
   * Determine IDP structure from roster positions.
   */
  private determineIdpStructure(positions: Record<string, number>): IDPStructure {
    const posKeys = Object.keys(positions);

    const consolidated = ["DL", "LB", "DB", "IDP_FLEX"].some((p) =>
      posKeys.includes(p)
    );
    const granular = ["DE", "DT", "CB", "S", "EDR"].some((p) =>
      posKeys.includes(p)
    );

    if (!consolidated && !granular) return "none";
    if (consolidated && granular) return "mixed";
    if (consolidated) return "consolidated";
    return "granular";
  }

  /**
   * Get default position mappings for IDP.
   */
  private getDefaultPositionMappings(
    idpStructure: IDPStructure
  ): Record<string, string[]> | undefined {
    if (idpStructure === "none") return undefined;

    return {
      DL: ["EDR", "IL", "DE", "DT"],
      LB: ["LB", "ILB", "OLB"],
      DB: ["CB", "S"],
    };
  }

  /**
   * Map ESPN draft type to normalized type.
   */
  private mapDraftType(type?: string): string {
    switch (type) {
      case "AUCTION":
        return "auction";
      case "SNAKE":
      default:
        return "snake";
    }
  }
}

/**
 * Create a new ESPN adapter instance.
 */
export function createESPNAdapter(config: ESPNAdapterConfig = {}): ESPNAdapter {
  return new ESPNAdapter(config);
}
