/**
 * Fleaflicker API Adapter
 *
 * Fleaflicker has a comprehensive API that supports granular IDP positions
 * and position-specific scoring rules.
 *
 * Key endpoints:
 * - FetchLeagueRules: Roster + scoring configuration
 * - FetchLeagueStandings: Team standings
 * - FetchRoster: Individual team rosters
 * - FetchTeamPicks: Future draft picks
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

const FLEAFLICKER_API_BASE = "https://www.fleaflicker.com/api";

// Fleaflicker API response types
interface FleaflickerLeague {
  id: number;
  name: string;
  size: number;
}

interface FleaflickerSeason {
  year: number;
  currentPeriod?: {
    low: number;
  };
}

interface FleaflickerRosterPosition {
  label: string;
  group?: string; // "START", "INJURED", "TAXI" - bench has no group
  start?: number;
  max?: number; // Used for bench slots
  min?: number;
  eligibility?: string[]; // Granular positions that can fill this slot
}

interface FleaflickerScoringRule {
  category: {
    id: number;
    nameSingular: string;
    namePlural: string;
    abbreviation: string;
    lowerIsBetter?: boolean; // True for offensive turnovers (INTs thrown)
  };
  points: {
    value: number;
    formatted: string;
  };
  pointsPer?: {
    value: number;
    formatted: string;
  };
  applyTo?: string[]; // Position-specific: ["EDR"], ["CB", "S"], etc.
  applyToAll?: boolean;
  isBonus?: boolean;
  boundLower?: number;
  boundUpper?: number;
}

interface FleaflickerScoringGroup {
  label: string;
  scoringRules: FleaflickerScoringRule[];
}

interface FleaflickerLeagueRules {
  rosterPositions: FleaflickerRosterPosition[];
  groups: FleaflickerScoringGroup[];
  numStarters?: number;
  numBench?: number;
}

interface FleaflickerTeam {
  id: number;
  name: string;
  owners?: Array<{
    id: number;
    displayName: string;
  }>;
  recordOverall?: {
    wins: number;
    losses: number;
    ties?: number;
    pointsFor?: {
      value: number;
    };
  };
  rank?: number;
}

interface FleaflickerStandings {
  divisions: Array<{
    teams: FleaflickerTeam[];
  }>;
}

interface FleaflickerPlayer {
  id: number;
  nameFull?: string;
  position?: string;
  proTeam?: {
    abbreviation: string;
  };
}

interface FleaflickerRosterSlot {
  position: {
    label: string;
    group: string;
    eligibility?: string[];
  };
  leaguePlayer?: {
    proPlayer: FleaflickerPlayer;
  };
}

interface FleaflickerRoster {
  groups: Array<{
    slots: FleaflickerRosterSlot[];
  }>;
}

interface FleaflickerDraftPick {
  slot: {
    round: number;
    slot?: number;
  };
  season: number;
  originalOwner?: {
    id: number;
  };
}

interface FleaflickerTeamPicks {
  picks: FleaflickerDraftPick[];
}

export class FleaflickerAdapter
  extends BaseAdapter
  implements LeagueProviderAdapter
{
  readonly provider = "fleaflicker" as const;

  constructor(config: AdapterConfig) {
    // Fleaflicker needs slightly slower rate limiting
    super({ ...config, rateLimitMs: 250 });
  }

  /**
   * Build API URL with parameters
   */
  private buildUrl(endpoint: string, params: Record<string, string>): string {
    const url = new URL(`${FLEAFLICKER_API_BASE}/${endpoint}`);
    url.searchParams.set("sport", "NFL");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * Fetch user's leagues - Fleaflicker requires knowing the league ID
   * For MVP, we'll have users input their league ID directly
   */
  async getUserLeagues(season: number): Promise<AdapterLeague[]> {
    // Fleaflicker doesn't have a "get all leagues for user" endpoint
    // Users will need to provide league IDs directly
    // Return empty array - leagues will be added via getLeagueSettings
    return [];
  }

  /**
   * Fetch league by ID and extract basic info
   */
  async getLeagueById(
    leagueId: string,
    season: number
  ): Promise<AdapterLeague | null> {
    try {
      // Use FetchLeagueStandings which returns league info
      // Note: season is returned as a number, not an object
      const standings = await this.fetch<FleaflickerStandings & { league: FleaflickerLeague; season: number }>(
        this.buildUrl("FetchLeagueStandings", {
          league_id: leagueId,
          season: season.toString(),
        }),
        undefined,
        "FetchLeagueStandings"
      );

      return {
        externalLeagueId: standings.league.id.toString(),
        name: standings.league.name,
        season: standings.season || season,
        totalTeams: standings.league.size,
        draftType: "snake",
      };
    } catch (error) {
      console.error("Fleaflicker getLeagueById error:", error);
      return null;
    }
  }

  /**
   * Fetch and normalize league settings
   * This is where Fleaflicker shines - it has the most detailed settings
   */
  async getLeagueSettings(leagueId: string): Promise<AdapterSettings> {
    const rules = await this.fetch<FleaflickerLeagueRules>(
      this.buildUrl("FetchLeagueRules", {
        league_id: leagueId,
      }),
      undefined,
      "FetchLeagueRules"
    );

    // Parse roster positions
    const { rosterPositions, flexRules, positionMappings, benchSlots, taxiSlots, irSlots } =
      this.parseRosterPositions(rules.rosterPositions);

    // Parse scoring rules WITH group labels preserved
    // This is critical - the group label (Passing, Rushing, etc.) tells us
    // what type of stat it is (e.g., "Yard" in "Passing" group = pass_yd)
    const rulesWithGroups: Array<{ rule: FleaflickerScoringRule; groupLabel: string }> = [];
    for (const group of rules.groups || []) {
      const groupLabel = group.label || "";
      for (const rule of group.scoringRules || []) {
        rulesWithGroups.push({ rule, groupLabel });
      }
    }

    // Parse scoring rules with position-specific handling and bonus thresholds
    const { scoringRules, positionScoringOverrides, bonusThresholds } =
      this.parseScoringRules(rulesWithGroups);

    // Detect IDP structure
    const idpStructure = this.determineIdpStructure(rosterPositions, positionMappings);

    return {
      scoringRules,
      positionScoringOverrides:
        Object.keys(positionScoringOverrides).length > 0
          ? positionScoringOverrides
          : undefined,
      rosterPositions,
      flexRules,
      positionMappings:
        Object.keys(positionMappings).length > 0 ? positionMappings : undefined,
      idpStructure,
      benchSlots,
      taxiSlots,
      irSlots,
      metadata: {
        numStarters: rules.numStarters,
        numBench: rules.numBench,
        bonusThresholds:
          Object.keys(bonusThresholds).length > 0 ? bonusThresholds : undefined,
      },
    };
  }

  /**
   * Fetch all teams with standings - uses concurrent fetching
   */
  async getTeams(leagueId: string): Promise<AdapterTeam[]> {
    const standings = await this.fetch<FleaflickerStandings>(
      this.buildUrl("FetchLeagueStandings", {
        league_id: leagueId,
      }),
      undefined,
      "FetchLeagueStandings"
    );

    const teams: AdapterTeam[] = [];
    let rank = 1;

    for (const division of standings.divisions) {
      for (const team of division.teams) {
        teams.push({
          externalTeamId: team.id.toString(),
          ownerName: team.owners?.[0]?.displayName || `Owner ${team.id}`,
          teamName: team.name,
          standingRank: team.rank || rank,
          totalPoints: team.recordOverall?.pointsFor?.value || 0,
          wins: team.recordOverall?.wins || 0,
          losses: team.recordOverall?.losses || 0,
          ties: team.recordOverall?.ties || 0,
        });
        rank++;
      }
    }

    return teams;
  }

  /**
   * Fetch all rostered players - CONCURRENT fetching for speed
   */
  async getRosters(leagueId: string): Promise<AdapterPlayer[]> {
    // First get all teams
    const teams = await this.getTeams(leagueId);

    // Fetch all rosters concurrently
    const rosterPromises = teams.map((team) =>
      this.fetchTeamRoster(leagueId, team.externalTeamId)
    );

    const rosters = await Promise.all(rosterPromises);

    // Flatten into single array
    return rosters.flat();
  }

  /**
   * Fetch roster for a single team
   */
  private async fetchTeamRoster(
    leagueId: string,
    teamId: string
  ): Promise<AdapterPlayer[]> {
    try {
      const roster = await this.fetch<FleaflickerRoster>(
        this.buildUrl("FetchRoster", {
          league_id: leagueId,
          team_id: teamId,
        }),
        undefined,
        `FetchRoster_${teamId}`
      );

      const players: AdapterPlayer[] = [];

      for (const group of roster.groups || []) {
        for (const slot of group.slots || []) {
          if (slot.leaguePlayer?.proPlayer) {
            const player = slot.leaguePlayer.proPlayer;
            players.push({
              externalPlayerId: player.id.toString(),
              teamExternalId: teamId,
              slotPosition: this.mapSlotGroup(slot.position.group),
              playerName: player.nameFull,
              playerPosition: player.position,
            });
          }
        }
      }

      return players;
    } catch (error) {
      console.error(`Failed to fetch roster for team ${teamId}:`, error);
      return [];
    }
  }

  /**
   * Map Fleaflicker slot group to our standard format
   */
  private mapSlotGroup(group: string): string {
    const mapping: Record<string, string> = {
      START: "START",
      BENCH: "BN",
      INJURED_RESERVE: "IR",
      TAXI: "TAXI",
    };
    return mapping[group] || group;
  }

  /**
   * Fetch draft picks - concurrent for all teams
   */
  async getDraftPicks(leagueId: string): Promise<AdapterDraftPick[]> {
    const teams = await this.getTeams(leagueId);

    // Fetch picks for all teams concurrently
    const pickPromises = teams.map((team) =>
      this.fetchTeamPicks(leagueId, team.externalTeamId)
    );

    const allPicks = await Promise.all(pickPromises);

    return allPicks.flat();
  }

  /**
   * Fetch picks for a single team
   */
  private async fetchTeamPicks(
    leagueId: string,
    teamId: string
  ): Promise<AdapterDraftPick[]> {
    try {
      const response = await this.fetch<FleaflickerTeamPicks>(
        this.buildUrl("FetchTeamPicks", {
          league_id: leagueId,
          team_id: teamId,
        }),
        undefined,
        `FetchTeamPicks_${teamId}`
      );

      return (response.picks || []).map((pick) => ({
        season: pick.season,
        round: pick.slot.round,
        pickNumber: pick.slot.slot,
        ownerTeamExternalId: teamId,
        originalTeamExternalId: pick.originalOwner?.id.toString(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Parse roster positions from Fleaflicker format
   * This extracts position counts, flex rules, and position mappings
   */
  private parseRosterPositions(positions: FleaflickerRosterPosition[]): {
    rosterPositions: Record<string, number>;
    flexRules: FlexRule[];
    positionMappings: Record<string, string[]>;
    benchSlots: number;
    taxiSlots: number;
    irSlots: number;
  } {
    const rosterPositions: Record<string, number> = {};
    const flexRules: FlexRule[] = [];
    const positionMappings: Record<string, string[]> = {};
    let benchSlots = 0;
    let taxiSlots = 0;
    let irSlots = 0;

    for (const pos of positions) {
      const label = pos.label.toUpperCase();
      // Use start for slot count, fall back to max for bench slots
      const count = pos.start || pos.max || 1;

      // Handle bench slots - no group, just label "BN" with max property
      if (label === "BN") {
        benchSlots = pos.max || 0;
        continue;
      }
      // Handle IR slots - Fleaflicker uses "INJURED" not "INJURED_RESERVE"
      if (pos.group === "INJURED" || pos.group === "INJURED_RESERVE") {
        irSlots += pos.start || 0;
        continue;
      }
      // Handle taxi slots
      if (pos.group === "TAXI") {
        taxiSlots += pos.start || 0;
        continue;
      }

      // Only count starting positions
      if (pos.group !== "START") continue;

      // Check for flex positions (have eligibility array)
      if (pos.eligibility && pos.eligibility.length > 0) {
        // This is a flex position
        const flexLabel = this.normalizeFlexLabel(label);
        rosterPositions[flexLabel] = (rosterPositions[flexLabel] || 0) + count;

        // Create flex rule
        const eligible = pos.eligibility.map((e) => e.toUpperCase());
        flexRules.push({
          slot: flexLabel,
          eligible,
        });

        // If consolidated position (DL, DB) has eligibility, store mapping
        if (["DL", "DB", "LB"].includes(label) && eligible.length > 1) {
          positionMappings[label] = eligible;
        }
      } else {
        // Regular position
        rosterPositions[label] = (rosterPositions[label] || 0) + count;
      }
    }

    return {
      rosterPositions,
      flexRules,
      positionMappings,
      benchSlots,
      taxiSlots,
      irSlots,
    };
  }

  /**
   * Normalize flex position labels
   */
  private normalizeFlexLabel(label: string): string {
    const mapping: Record<string, string> = {
      "RB/WR/TE": "FLEX",
      "WR/RB/TE": "FLEX",
      "QB/RB/WR/TE": "SUPERFLEX",
      "DL/LB/DB": "IDP_FLEX",
    };
    return mapping[label] || label;
  }

  /**
   * Parse scoring rules with position-specific handling and bonus thresholds.
   * Fleaflicker's applyTo field determines position-specific rules.
   * isBonus with boundLower/boundUpper indicates threshold bonuses.
   *
   * IMPORTANT: Rules must include groupLabel to properly derive stat keys.
   * The group label (Passing, Rushing, etc.) disambiguates generic categories
   * like "Yard" into specific keys like "pass_yd" vs "rush_yd".
   */
  private parseScoringRules(
    rulesWithGroups: Array<{ rule: FleaflickerScoringRule; groupLabel: string }>
  ): {
    scoringRules: Record<string, number>;
    positionScoringOverrides: Record<string, Record<string, number>>;
    bonusThresholds: Record<string, Array<{ min: number; max?: number; bonus: number }>>;
  } {
    const scoringRules: Record<string, number> = {};
    const positionScoringOverrides: Record<string, Record<string, number>> = {};
    const bonusThresholds: Record<string, Array<{ min: number; max?: number; bonus: number }>> = {};

    for (const { rule, groupLabel } of rulesWithGroups) {
      const statKey = this.deriveStatKey(rule, groupLabel);

      // Handle bonus threshold rules (e.g., +6 for 400-449 passing yards)
      if (rule.isBonus && rule.boundLower !== undefined) {
        if (!bonusThresholds[statKey]) {
          bonusThresholds[statKey] = [];
        }
        bonusThresholds[statKey].push({
          min: rule.boundLower,
          max: rule.boundUpper,
          bonus: rule.points.value,
        });
        continue; // Don't add bonus rules to per-stat scoring
      }

      // Use pointsPer if available (per-stat value), otherwise fall back to points
      const points = rule.pointsPer?.value ?? rule.points.value;

      // Skip rules without per-stat scoring (flat bonuses handled above)
      if (!rule.pointsPer && !rule.isBonus) {
        // This is a flat per-occurrence rule (e.g., 6 pts per TD)
        // Only add if it's truly per-occurrence (forEvery === 1 or not set)
      }

      // Determine if position-specific or general
      const isPositionSpecific =
        !rule.applyToAll &&
        rule.applyTo &&
        rule.applyTo.length > 0 &&
        rule.applyTo.length < 10;

      if (isPositionSpecific) {
        // Position-specific scoring
        for (const position of rule.applyTo!) {
          const posUpper = position.toUpperCase();
          if (!positionScoringOverrides[posUpper]) {
            positionScoringOverrides[posUpper] = {};
          }
          positionScoringOverrides[posUpper][statKey] = points;
        }
      } else {
        // General scoring rule
        scoringRules[statKey] = points;
      }
    }

    return { scoringRules, positionScoringOverrides, bonusThresholds };
  }

  /**
   * Derive stat key from Fleaflicker scoring rule using GROUP LABEL.
   *
   * This is the critical fix: Fleaflicker's API returns generic category names
   * like "Yard", "TD", "Attempt" - the GROUP LABEL tells us what type:
   *   - Group "Passing" + Category "Yard" → pass_yd
   *   - Group "Rushing" + Category "Yard" → rush_yd
   *   - Group "Receiving" + Category "Yard" → rec_yd
   *
   * Uses nameSingular (e.g., "Passing Yard") which matches the Colab output format.
   */
  private deriveStatKey(rule: FleaflickerScoringRule, groupLabel: string): string {
    const group = groupLabel.toLowerCase();
    // Use nameSingular for category (matches Colab format), fall back to namePlural
    const category = (rule.category.nameSingular || rule.category.namePlural).toLowerCase();
    const isNegative = rule.points.value < 0 || (rule.pointsPer && rule.pointsPer.value < 0);

    // === PASSING GROUP ===
    if (group === "passing") {
      if (category.includes("yard")) return "pass_yd";
      if (category.includes("td")) return "pass_td";
      if (category.includes("completion")) return "pass_cmp";
      if (category.includes("attempt")) return "pass_att";
      if (category.includes("interception")) return "int";  // Offensive INT (thrown) = negative
      if (category.includes("2 pt")) return "pass_2pt";
    }

    // === RUSHING GROUP ===
    if (group === "rushing") {
      if (category.includes("yard")) return "rush_yd";
      if (category.includes("td")) return "rush_td";
      if (category.includes("attempt")) return "rush_att";
      if (category.includes("2 pt")) return "rush_2pt";
    }

    // === RECEIVING GROUP ===
    if (group === "receiving") {
      if (category.includes("yard")) return "rec_yd";
      if (category.includes("td")) return "rec_td";
      if (category.includes("catch") || category.includes("reception")) return "rec";
      if (category.includes("2 pt")) return "rec_2pt";
    }

    // === MISC/OFFENSE GROUP ===
    if (group === "misc" || group === "offense" || group === "miscellaneous") {
      if (category.includes("fumble") && category.includes("lost")) return "fum_lost";
      if (category.includes("fumble") && category.includes("recovery") && category.includes("td")) return "fum_rec_td";
      if (category.includes("fumble")) return "fum";
    }

    // === KICKING GROUP ===
    if (group === "kicking") {
      if (category.includes("field goal") && category.includes("miss")) return "fg_miss";
      if (category.includes("field goal")) return "fg";
      if (category.includes("xp") && category.includes("miss")) return "xp_miss";
      if (category.includes("extra point") && category.includes("miss")) return "xp_miss";
      if (category.includes("extra point") || category === "xp") return "xp";
    }

    // === RETURNING GROUP ===
    if (group === "returning" || group === "returns") {
      if (category.includes("kick") && category.includes("yard")) return "kr_yd";
      if (category.includes("kick") && category.includes("td")) return "kr_td";
      if (category.includes("punt") && category.includes("yard")) return "pr_yd";
      if (category.includes("punt") && category.includes("td")) return "pr_td";
    }

    // === DEFENSE/IDP GROUP ===
    if (group === "defense" || group === "idp" || group === "defensive") {
      if (category.includes("solo") && category.includes("tackle")) return "tackle_solo";
      if (category.includes("assisted") && category.includes("tackle")) return "tackle_assist";
      if (category.includes("tackle") && category.includes("loss")) return "tackle_loss";
      if (category.includes("sack")) return "sack";
      if (category.includes("interception") && category.includes("return") && category.includes("yard")) return "def_int_yd";
      if (category.includes("interception")) return "def_int";  // Defensive INT = positive
      if (category.includes("fumble") && category.includes("force")) return "fum_force";
      if (category.includes("fumble") && category.includes("recover")) return "fum_rec";
      if (category.includes("fumble") && category.includes("return") && category.includes("yard")) return "fum_rec_yd";
      if (category.includes("pass") && category.includes("defend")) return "pass_def";
      if (category.includes("qb") && category.includes("hit")) return "qb_hit";
      if (category.includes("safety")) return "safety";
      if (category.includes("defensive") && category.includes("td")) return "def_td";
      if (category.includes("blocked") && category.includes("kick")) return "blk_kick";
      if (category.includes("conversion") && category.includes("return")) return "conv_ret";
    }

    // === FALLBACK: Try full category name matching (legacy support) ===
    const fullName = category;

    // Passing (if category includes full name like "passing yard")
    if (fullName.includes("passing yard")) return "pass_yd";
    if (fullName.includes("passing td")) return "pass_td";
    if (fullName.includes("passing completion")) return "pass_cmp";
    if (fullName.includes("passing attempt")) return "pass_att";

    // Rushing
    if (fullName.includes("rushing yard")) return "rush_yd";
    if (fullName.includes("rushing td")) return "rush_td";
    if (fullName.includes("rushing attempt")) return "rush_att";

    // Receiving
    if (fullName.includes("receiving yard")) return "rec_yd";
    if (fullName.includes("receiving td")) return "rec_td";

    // Log warning with full context for debugging
    console.warn(
      `[Fleaflicker] Unknown scoring rule - Group: "${groupLabel}", Category: "${rule.category.nameSingular}" / "${rule.category.namePlural}", Abbrev: "${rule.category.abbreviation}"`
    );
    return rule.category.abbreviation.toLowerCase();
  }

  /**
   * Detect IDP structure from roster positions and mappings
   */
  private determineIdpStructure(
    positions: Record<string, number>,
    mappings: Record<string, string[]>
  ): IDPStructure {
    const positionKeys = Object.keys(positions);

    const consolidated = ["DL", "LB", "DB", "IDP_FLEX"].some((p) =>
      positionKeys.includes(p)
    );
    const granular = ["EDR", "IL", "CB", "S", "DE", "DT"].some((p) =>
      positionKeys.includes(p)
    );

    // Check if mappings indicate granular support
    const hasMappings = Object.keys(mappings).length > 0;

    if (!consolidated && !granular) {
      return "none";
    }

    if (consolidated && granular) {
      return "mixed";
    }

    if (consolidated && hasMappings) {
      // Consolidated positions with eligibility mappings
      return "consolidated";
    }

    if (granular) {
      return "granular";
    }

    return "consolidated";
  }
}

/**
 * Create a new Fleaflicker adapter instance
 */
export function createFleaflickerAdapter(
  config: AdapterConfig = {}
): FleaflickerAdapter {
  return new FleaflickerAdapter(config);
}
