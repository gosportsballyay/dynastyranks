/**
 * Yahoo Fantasy Football API Adapter
 *
 * Yahoo requires OAuth2 authentication. Users must complete the OAuth flow
 * before connecting leagues. Tokens are stored in the userTokens table
 * and automatically refreshed when expired.
 *
 * API documentation: https://developer.yahoo.com/fantasysports/guide/
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

const YAHOO_API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

/**
 * Yahoo position names to normalized positions.
 */
const YAHOO_POSITION_MAP: Record<string, string> = {
  // Offense
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DST",
  // Flex slots
  "W/R": "FLEX",        // WR/RB flex
  "W/T": "FLEX",        // WR/TE flex
  "W/R/T": "FLEX",      // Standard flex
  "Q/W/R/T": "SUPERFLEX",
  // IDP - Granular
  DE: "DE",
  DT: "DT",
  CB: "CB",
  S: "S",
  // IDP - Consolidated
  DL: "DL",
  LB: "LB",
  DB: "DB",
  D: "IDP_FLEX",        // Any defensive player
  // Roster slots
  BN: "BN",
  IR: "IR",
  IL: "IR",
  "IR+": "IR",
};

/**
 * Flex slot eligibility by Yahoo slot name.
 */
const YAHOO_FLEX_ELIGIBLE: Record<string, string[]> = {
  "W/R": ["WR", "RB"],
  "W/T": ["WR", "TE"],
  "W/R/T": ["RB", "WR", "TE"],
  "Q/W/R/T": ["QB", "RB", "WR", "TE"],
  D: ["DL", "LB", "DB"],
};

/**
 * Yahoo stat categories to normalized stat keys.
 * Yahoo uses string category names - disambiguation happens by category context.
 *
 * IMPORTANT: Yahoo may use the same category name for different stats.
 * "Interceptions" in defense = def_int (positive)
 * "Interceptions" in passing = int (negative, thrown by QB)
 * This is handled by checking the stat_id ranges or the group context.
 */
const YAHOO_STAT_MAP: Record<string, string> = {
  // Passing (stat_ids 1-19)
  "Passing Yards": "pass_yd",
  "Passing Touchdowns": "pass_td",
  "Interceptions Thrown": "int",
  "Completions": "pass_cmp",
  "Passing Attempts": "pass_att",
  "Passes Intercepted": "int",
  "Interceptions": "int",  // In passing context
  "2-Point Conversions": "pass_2pt",
  // Rushing (stat_ids 20-29)
  "Rushing Yards": "rush_yd",
  "Rushing Touchdowns": "rush_td",
  "Rushing Attempts": "rush_att",
  // Receiving (stat_ids 30-39)
  "Receiving Yards": "rec_yd",
  "Receiving Touchdowns": "rec_td",
  "Receptions": "rec",
  "Reception Yards": "rec_yd",
  "Reception Touchdowns": "rec_td",
  "Targets": "rec_target",
  // Fumbles
  Fumbles: "fum",
  "Fumbles Lost": "fum_lost",
  // Kicking
  "Field Goals Made": "fg",
  "Field Goals 0-19 Yards": "fg_0_19",
  "Field Goals 20-29 Yards": "fg_20_29",
  "Field Goals 30-39 Yards": "fg_30_39",
  "Field Goals 40-49 Yards": "fg_40_49",
  "Field Goals 50+ Yards": "fg_50_plus",
  "PAT Made": "xp",
  "PAT Missed": "xp_miss",
  // IDP - Use stat IDs 50+ for defense
  "Total Tackles": "tackle_solo",
  "Assisted Tackles": "tackle_assist",
  Sacks: "sack",
  "Defensive Interceptions": "def_int",
  "Interception Return Yards": "def_int_yd",
  "Forced Fumbles": "fum_force",
  "Fumble Recoveries": "fum_rec",
  "Fumbles Recovery Yards": "fum_rec_yd",
  "Passes Defended": "pass_def",
  "Defensive Touchdowns": "def_td",
  Safeties: "safety",
  "Blocked Kicks": "blk_kick",
  "Tackles for Loss": "tackle_loss",
  // DST
  "Points Allowed": "dst_pts_allowed",
  "Sacks (Team)": "dst_sack",
  "Fumble Recoveries (Team)": "dst_fum_rec",
  "Interceptions (Team)": "dst_int",
  "Blocked Punt/FG/PAT": "dst_blk_kick",
  "Safety (Team)": "dst_safety",
  "Kick/Punt Return Touchdowns": "dst_ret_td",
};

/**
 * Yahoo stat ID ranges for category disambiguation.
 * Used to distinguish offensive from defensive stats.
 */
const YAHOO_STAT_ID_RANGES = {
  passing: { min: 1, max: 19 },
  rushing: { min: 20, max: 29 },
  receiving: { min: 30, max: 39 },
  returning: { min: 40, max: 49 },
  defense: { min: 50, max: 79 },
  kicking: { min: 80, max: 99 },
};

// Yahoo API response types
interface YahooFantasyContent {
  fantasy_content: {
    users?: YahooUsersWrapper;
    league?: YahooLeague[];
    team?: YahooTeam[];
  };
}

interface YahooUsersWrapper {
  "0": {
    user: YahooUser[];
  };
}

interface YahooUser {
  games: {
    "0": {
      game: YahooGame[];
    };
  };
}

interface YahooGame {
  leagues?: {
    count: number;
    [key: string]: YahooLeagueWrapper | number;
  };
}

interface YahooLeagueWrapper {
  league: YahooLeague[];
}

interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  num_teams: number;
  draft_status: string;
  season: string;
  scoring_type?: string;
  settings?: YahooSettings[];
  standings?: YahooStandingsWrapper[];
}

interface YahooSettings {
  stat_modifiers?: {
    stats: {
      stat: YahooStatModifier[];
    };
  };
  roster_positions?: {
    roster_position: YahooRosterPosition[];
  };
  stat_categories?: {
    stats: {
      stat: YahooStatCategory[];
    };
  };
}

interface YahooStatModifier {
  stat_id: number;
  value: string;
  bonuses?: YahooBonus[];
}

interface YahooBonus {
  target: string;
  points: string;
}

interface YahooStatCategory {
  stat_id: number;
  enabled: string;
  name: string;
  display_name: string;
  sort_order: string;
  position_type?: string;  // "O" for offense, "DT" for defense/team
}

interface YahooRosterPosition {
  position: string;
  position_type?: string;
  count: number;
  is_bench?: number;
}

interface YahooStandingsWrapper {
  teams: {
    count: number;
    [key: string]: YahooTeamWrapper | number;
  };
}

interface YahooTeamWrapper {
  team: YahooTeam[];
}

interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  managers?: YahooManager[];
  team_standings?: {
    rank: number;
    outcome_totals: {
      wins: string;
      losses: string;
      ties: string;
    };
    points_for: string;
  };
  roster?: {
    players: {
      count: number;
      [key: string]: YahooPlayerWrapper | number;
    };
  };
  draft_results?: {
    draft_result: YahooDraftResult[];
  };
}

interface YahooManager {
  manager_id: string;
  nickname: string;
  is_current_login?: number;
}

interface YahooPlayerWrapper {
  player: YahooPlayer[];
}

interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: {
    full: string;
    first: string;
    last: string;
  };
  editorial_team_abbr?: string;
  display_position: string;
  selected_position?: {
    position: string;
  };
}

interface YahooDraftResult {
  pick: number;
  round: number;
  team_key: string;
  player_key?: string;
}

export interface YahooAdapterConfig extends AdapterConfig {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string; expiresAt: Date }) => void;
}

export class YahooAdapter extends BaseAdapter implements LeagueProviderAdapter {
  readonly provider = "yahoo" as const;
  private accessToken: string;
  private refreshToken?: string;
  private expiresAt?: Date;
  private onTokenRefresh?: YahooAdapterConfig["onTokenRefresh"];

  constructor(config: YahooAdapterConfig) {
    super({ ...config, rateLimitMs: 300 });  // Yahoo is stricter on rate limits
    if (!config.accessToken) {
      throw new Error("Yahoo adapter requires accessToken");
    }
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.expiresAt = config.expiresAt;
    this.onTokenRefresh = config.onTokenRefresh;
  }

  /**
   * Ensure we have a valid access token, refresh if expired.
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.expiresAt || new Date() < this.expiresAt) {
      return;  // Token still valid
    }

    if (!this.refreshToken) {
      throw new Error("Yahoo access token expired and no refresh token available");
    }

    const clientId = process.env.YAHOO_CLIENT_ID;
    const clientSecret = process.env.YAHOO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Yahoo OAuth credentials not configured");
    }

    const response = await fetch(YAHOO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Yahoo token refresh failed: ${errorText}`);
    }

    const tokens = await response.json();

    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token || this.refreshToken;
    this.expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Notify caller to save new tokens
    if (this.onTokenRefresh) {
      this.onTokenRefresh({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken!,
        expiresAt: this.expiresAt,
      });
    }
  }

  /**
   * Get headers with OAuth Bearer token.
   */
  private async getHeaders(): Promise<Record<string, string>> {
    await this.ensureValidToken();
    return {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
    };
  }

  /**
   * Fetch user's leagues for the given season.
   */
  async getUserLeagues(season: number): Promise<AdapterLeague[]> {
    const url = `${YAHOO_API_BASE}/users;use_login=1/games;game_keys=nfl/leagues?format=json`;
    const headers = await this.getHeaders();

    const response = await this.fetch<YahooFantasyContent>(
      url,
      { headers },
      "GetUserLeagues"
    );

    const leagues: AdapterLeague[] = [];
    const users = response.fantasy_content.users;
    if (!users) return leagues;

    const user = users["0"]?.user[0];
    if (!user?.games) return leagues;

    const game = user.games["0"]?.game[0];
    if (!game?.leagues) return leagues;

    // Iterate through leagues
    for (const key of Object.keys(game.leagues)) {
      if (key === "count") continue;
      const leagueWrapper = game.leagues[key] as YahooLeagueWrapper;
      const league = leagueWrapper?.league?.[0];
      if (!league) continue;

      // Filter by season
      if (parseInt(league.season) !== season) continue;

      leagues.push({
        externalLeagueId: league.league_id,
        name: league.name,
        season: parseInt(league.season),
        totalTeams: league.num_teams,
        draftType: league.draft_status === "postdraft" ? "snake" : "snake",
      });
    }

    return leagues;
  }

  /**
   * Get league by ID and extract basic info.
   */
  async getLeagueById(
    leagueId: string,
    season: number
  ): Promise<AdapterLeague | null> {
    try {
      const gameKey = `nfl`;
      const leagueKey = `${gameKey}.l.${leagueId}`;
      const url = `${YAHOO_API_BASE}/league/${leagueKey}?format=json`;
      const headers = await this.getHeaders();

      const response = await this.fetch<YahooFantasyContent>(
        url,
        { headers },
        "GetLeagueById"
      );

      const league = response.fantasy_content.league?.[0];
      if (!league) return null;

      return {
        externalLeagueId: league.league_id,
        name: league.name,
        season: parseInt(league.season),
        totalTeams: league.num_teams,
        draftType: "snake",
      };
    } catch (error) {
      console.error("Yahoo getLeagueById error:", error);
      return null;
    }
  }

  /**
   * Fetch and normalize league settings.
   */
  async getLeagueSettings(leagueId: string): Promise<AdapterSettings> {
    const gameKey = "nfl";
    const leagueKey = `${gameKey}.l.${leagueId}`;
    const url = `${YAHOO_API_BASE}/league/${leagueKey}/settings?format=json`;
    const headers = await this.getHeaders();

    const response = await this.fetch<YahooFantasyContent>(
      url,
      { headers },
      "GetLeagueSettings"
    );

    const leagueArray = response.fantasy_content.league;
    if (!leagueArray || leagueArray.length < 2) {
      throw new Error("Invalid Yahoo league settings response");
    }

    const settings = leagueArray[1].settings?.[0];
    if (!settings) {
      throw new Error("No settings found in Yahoo response");
    }

    // Build stat ID to name map for disambiguation
    const statIdToName = new Map<number, { name: string; positionType?: string }>();
    if (settings.stat_categories?.stats?.stat) {
      for (const cat of settings.stat_categories.stats.stat) {
        statIdToName.set(cat.stat_id, {
          name: cat.name,
          positionType: cat.position_type,
        });
      }
    }

    // Parse roster positions
    const { rosterPositions, flexRules, benchSlots, irSlots, taxiSlots } =
      this.parseRosterPositions(settings.roster_positions?.roster_position || []);

    // Parse scoring rules with stat name disambiguation
    const { scoringRules, positionScoringOverrides, bonusThresholds } =
      this.parseScoringRules(
        settings.stat_modifiers?.stats?.stat || [],
        statIdToName
      );

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
        bonusThresholds:
          Object.keys(bonusThresholds).length > 0 ? bonusThresholds : undefined,
      },
    };
  }

  /**
   * Fetch all teams with standings.
   */
  async getTeams(leagueId: string): Promise<AdapterTeam[]> {
    const gameKey = "nfl";
    const leagueKey = `${gameKey}.l.${leagueId}`;
    const url = `${YAHOO_API_BASE}/league/${leagueKey}/standings?format=json`;
    const headers = await this.getHeaders();

    const response = await this.fetch<YahooFantasyContent>(
      url,
      { headers },
      "GetTeams"
    );

    const leagueArray = response.fantasy_content.league;
    if (!leagueArray || leagueArray.length < 2) {
      return [];
    }

    const standings = leagueArray[1].standings?.[0];
    if (!standings?.teams) {
      return [];
    }

    const teams: AdapterTeam[] = [];

    for (const key of Object.keys(standings.teams)) {
      if (key === "count") continue;
      const teamWrapper = standings.teams[key] as YahooTeamWrapper;
      const teamArray = teamWrapper?.team;
      if (!teamArray || teamArray.length < 2) continue;

      const teamInfo = teamArray[0] as unknown as YahooTeam;
      const teamStandings = (teamArray[1] as unknown as { team_standings: YahooTeam["team_standings"] })?.team_standings;

      teams.push({
        externalTeamId: teamInfo.team_id,
        ownerName: teamInfo.managers?.[0]?.nickname || `Owner ${teamInfo.team_id}`,
        teamName: teamInfo.name,
        standingRank: teamStandings?.rank || 0,
        totalPoints: parseFloat(teamStandings?.points_for || "0"),
        wins: parseInt(teamStandings?.outcome_totals?.wins || "0"),
        losses: parseInt(teamStandings?.outcome_totals?.losses || "0"),
        ties: parseInt(teamStandings?.outcome_totals?.ties || "0"),
      });
    }

    return teams;
  }

  /**
   * Fetch all rostered players using concurrent fetching.
   */
  async getRosters(leagueId: string): Promise<AdapterPlayer[]> {
    // First get all teams
    const teams = await this.getTeams(leagueId);

    // Fetch rosters concurrently
    const rosterPromises = teams.map((team) =>
      this.fetchTeamRoster(leagueId, team.externalTeamId)
    );

    const rosters = await Promise.all(rosterPromises);

    return rosters.flat();
  }

  /**
   * Fetch roster for a single team.
   */
  private async fetchTeamRoster(
    leagueId: string,
    teamId: string
  ): Promise<AdapterPlayer[]> {
    try {
      const gameKey = "nfl";
      const teamKey = `${gameKey}.l.${leagueId}.t.${teamId}`;
      const url = `${YAHOO_API_BASE}/team/${teamKey}/roster?format=json`;
      const headers = await this.getHeaders();

      const response = await this.fetch<YahooFantasyContent>(
        url,
        { headers },
        `GetRoster_${teamId}`
      );

      const teamArray = response.fantasy_content.team;
      if (!teamArray || teamArray.length < 2) {
        return [];
      }

      const roster = (teamArray[1] as unknown as { roster: YahooTeam["roster"] })?.roster;
      if (!roster?.players) {
        return [];
      }

      const players: AdapterPlayer[] = [];

      for (const key of Object.keys(roster.players)) {
        if (key === "count") continue;
        const playerWrapper = roster.players[key] as YahooPlayerWrapper;
        const playerArray = playerWrapper?.player;
        if (!playerArray || playerArray.length < 2) continue;

        const playerInfo = playerArray[0] as unknown as YahooPlayer;
        const selectedPosition = (playerArray[1] as unknown as { selected_position: YahooPlayer["selected_position"] })?.selected_position;

        const slotPosition = this.mapSlotPosition(selectedPosition?.position);

        players.push({
          externalPlayerId: playerInfo.player_id,
          teamExternalId: teamId,
          slotPosition,
          playerName: playerInfo.name.full,
          playerPosition: playerInfo.display_position.split(",")[0],  // Take first position
        });
      }

      return players;
    } catch (error) {
      console.error(`Failed to fetch roster for team ${teamId}:`, error);
      return [];
    }
  }

  /**
   * Fetch draft picks.
   */
  async getDraftPicks(leagueId: string): Promise<AdapterDraftPick[]> {
    try {
      const gameKey = "nfl";
      const leagueKey = `${gameKey}.l.${leagueId}`;
      const url = `${YAHOO_API_BASE}/league/${leagueKey}/draftresults?format=json`;
      const headers = await this.getHeaders();

      const response = await this.fetch<YahooFantasyContent>(
        url,
        { headers },
        "GetDraftPicks"
      );

      // Yahoo's draft results format is complex, and future picks are not easily available
      // For now, return empty - this would need more work to support traded picks
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Parse roster positions from Yahoo format.
   */
  private parseRosterPositions(positions: YahooRosterPosition[]): {
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
    const taxiSlots = 0;  // Yahoo doesn't have taxi squads
    const seenFlexSlots = new Set<string>();

    for (const pos of positions) {
      const normalizedPos = YAHOO_POSITION_MAP[pos.position] || pos.position;

      // Handle special slots
      if (pos.is_bench) {
        benchSlots = pos.count;
        continue;
      }
      if (normalizedPos === "IR") {
        irSlots += pos.count;
        continue;
      }

      // Add to roster positions
      rosterPositions[normalizedPos] = (rosterPositions[normalizedPos] || 0) + pos.count;

      // Check for flex eligibility
      const eligible = YAHOO_FLEX_ELIGIBLE[pos.position];
      if (eligible && !seenFlexSlots.has(normalizedPos)) {
        flexRules.push({ slot: normalizedPos, eligible });
        seenFlexSlots.add(normalizedPos);
      }
    }

    return { rosterPositions, flexRules, benchSlots, irSlots, taxiSlots };
  }

  /**
   * Parse scoring rules from Yahoo stat modifiers.
   * Uses stat category info to disambiguate similar stat names.
   */
  private parseScoringRules(
    statModifiers: YahooStatModifier[],
    statIdToName: Map<number, { name: string; positionType?: string }>
  ): {
    scoringRules: Record<string, number>;
    positionScoringOverrides: Record<string, Record<string, number>>;
    bonusThresholds: Record<string, Array<{ min: number; max?: number; bonus: number }>>;
  } {
    const scoringRules: Record<string, number> = {};
    const positionScoringOverrides: Record<string, Record<string, number>> = {};
    const bonusThresholds: Record<string, Array<{ min: number; max?: number; bonus: number }>> = {};

    for (const stat of statModifiers) {
      const statInfo = statIdToName.get(stat.stat_id);
      const statKey = this.deriveStatKey(stat.stat_id, statInfo);

      if (!statKey) continue;

      const value = parseFloat(stat.value);

      // Store base scoring rule
      scoringRules[statKey] = value;

      // Handle bonuses (threshold-based)
      if (stat.bonuses) {
        for (const bonus of stat.bonuses) {
          if (!bonusThresholds[statKey]) {
            bonusThresholds[statKey] = [];
          }
          bonusThresholds[statKey].push({
            min: parseInt(bonus.target),
            bonus: parseFloat(bonus.points),
          });
        }
      }
    }

    return { scoringRules, positionScoringOverrides, bonusThresholds };
  }

  /**
   * Derive stat key from Yahoo stat ID and category info.
   * Uses stat ID ranges to disambiguate similar category names.
   */
  private deriveStatKey(
    statId: number,
    statInfo?: { name: string; positionType?: string }
  ): string | null {
    if (!statInfo) return null;

    const name = statInfo.name;
    const isDefense = statInfo.positionType === "DT" ||
      (statId >= YAHOO_STAT_ID_RANGES.defense.min &&
       statId <= YAHOO_STAT_ID_RANGES.defense.max);

    // Handle interceptions disambiguation
    if (name.toLowerCase().includes("intercept")) {
      return isDefense ? "def_int" : "int";
    }

    // Try direct mapping
    const directKey = YAHOO_STAT_MAP[name];
    if (directKey) return directKey;

    // Try case-insensitive search
    for (const [mapName, key] of Object.entries(YAHOO_STAT_MAP)) {
      if (mapName.toLowerCase() === name.toLowerCase()) {
        return key;
      }
    }

    // Log unmapped stats
    console.warn(`[Yahoo] Unknown stat: id=${statId}, name="${name}", posType="${statInfo.positionType}"`);
    return null;
  }

  /**
   * Map Yahoo slot position to normalized slot.
   */
  private mapSlotPosition(position?: string): string {
    if (!position) return "BN";

    const normalized = YAHOO_POSITION_MAP[position];
    if (!normalized) return position;

    if (["BN", "IR"].includes(normalized)) {
      return normalized;
    }

    return "START";
  }

  /**
   * Determine IDP structure from roster positions.
   */
  private determineIdpStructure(positions: Record<string, number>): IDPStructure {
    const posKeys = Object.keys(positions);

    const consolidated = ["DL", "LB", "DB", "IDP_FLEX"].some((p) =>
      posKeys.includes(p)
    );
    const granular = ["DE", "DT", "CB", "S"].some((p) => posKeys.includes(p));

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
}

/**
 * Create a new Yahoo adapter instance.
 */
export function createYahooAdapter(config: YahooAdapterConfig): YahooAdapter {
  return new YahooAdapter(config);
}
