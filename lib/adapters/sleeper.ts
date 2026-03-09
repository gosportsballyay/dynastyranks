/**
 * Sleeper API Adapter
 *
 * Sleeper has a free, public API that doesn't require authentication.
 * You just need the username to get user data, then league IDs for league data.
 *
 * API Docs: https://docs.sleeper.app/
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

const SLEEPER_API_BASE = "https://api.sleeper.app/v1";

// Sleeper API response types
interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  draft_id: string;
  status: string;
  settings: SleeperLeagueSettings;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
}

interface SleeperLeagueSettings {
  max_keepers: number;
  draft_rounds: number;
  trade_deadline: number;
  reserve_slots: number;
  taxi_slots: number;
  playoff_teams: number;
  num_teams: number;
  bench_lock: number;
  [key: string]: number | undefined;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
  };
}

interface SleeperDraftPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

interface SleeperDraft {
  draft_id: string;
  season: string;
  status: "pre_draft" | "drafting" | "complete";
  /** Maps slot position (string) → roster_id. */
  slot_to_roster_id: Record<string, number> | null;
  /** Maps user_id (string) → slot position. */
  draft_order: Record<string, number> | null;
  settings: {
    rounds: number;
    [key: string]: unknown;
  };
}

interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata: {
    team_name?: string;
  };
}

export class SleeperAdapter extends BaseAdapter implements LeagueProviderAdapter {
  readonly provider = "sleeper" as const;
  private username: string;
  private userId: string | null = null;

  constructor(config: AdapterConfig) {
    super({ ...config, rateLimitMs: 100 }); // Sleeper is generous with rate limits
    if (!config.username) {
      throw new Error("Sleeper adapter requires username");
    }
    this.username = config.username;
  }

  /**
   * Get user ID from username
   */
  private async getUserId(): Promise<string> {
    if (this.userId) return this.userId;

    const user = await this.fetch<SleeperUser>(
      `${SLEEPER_API_BASE}/user/${this.username}`,
      undefined,
      "GetUser"
    );

    this.userId = user.user_id;
    return this.userId;
  }

  /**
   * Fetch all leagues for user in given season
   */
  async getUserLeagues(season: number): Promise<AdapterLeague[]> {
    const userId = await this.getUserId();

    const leagues = await this.fetch<SleeperLeague[]>(
      `${SLEEPER_API_BASE}/user/${userId}/leagues/nfl/${season}`,
      undefined,
      "GetUserLeagues"
    );

    return leagues.map((league) => ({
      externalLeagueId: league.league_id,
      name: league.name,
      season: parseInt(league.season),
      totalTeams: league.total_rosters,
      draftType: "snake", // Sleeper default
    }));
  }

  /**
   * Fetch and normalize league settings
   */
  async getLeagueSettings(leagueId: string): Promise<AdapterSettings> {
    const league = await this.fetch<SleeperLeague>(
      `${SLEEPER_API_BASE}/league/${leagueId}`,
      undefined,
      "GetLeague"
    );

    // Parse roster positions
    const rosterPositions = this.parseRosterPositions(league.roster_positions);

    // Parse flex rules from roster positions
    const flexRules = this.parseFlexRules(league.roster_positions);

    // Normalize scoring rules
    const scoringRules = this.normalizeScoringRules(league.scoring_settings);

    // Detect IDP structure
    const idpStructure = this.determineIdpStructure(rosterPositions);

    // Calculate bench slots (positions that aren't starters or special)
    const benchSlots =
      league.roster_positions.filter((pos) => pos === "BN").length;

    return {
      scoringRules,
      positionScoringOverrides: undefined, // Sleeper doesn't have position-specific scoring
      rosterPositions,
      flexRules,
      positionMappings: this.getDefaultPositionMappings(idpStructure),
      idpStructure,
      benchSlots,
      taxiSlots: league.settings.taxi_slots || 0,
      irSlots: league.settings.reserve_slots || 0,
      metadata: {
        draftRounds: league.settings.draft_rounds,
        playoffTeams: league.settings.playoff_teams,
        tradeDeadline: league.settings.trade_deadline,
      },
    };
  }

  /**
   * Fetch all teams in league
   */
  async getTeams(leagueId: string): Promise<AdapterTeam[]> {
    const [rosters, users] = await Promise.all([
      this.fetch<SleeperRoster[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/rosters`,
        undefined,
        "GetRosters"
      ),
      this.fetch<SleeperLeagueUser[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/users`,
        undefined,
        "GetUsers"
      ),
    ]);

    // Create user lookup
    const userMap = new Map<string, SleeperLeagueUser>();
    for (const user of users) {
      userMap.set(user.user_id, user);
    }

    return rosters.map((roster, index) => {
      const user = roster.owner_id ? userMap.get(roster.owner_id) : null;

      return {
        externalTeamId: roster.roster_id.toString(),
        ownerName: user?.display_name || `Team ${index + 1}`,
        teamName: user?.metadata?.team_name
          || user?.display_name
          || `Team ${index + 1}`,
        standingRank: index + 1, // Will need to sort by wins
        totalPoints: roster.settings?.fpts || 0,
        wins: roster.settings?.wins || 0,
        losses: roster.settings?.losses || 0,
        ties: roster.settings?.ties || 0,
      };
    });
  }

  /**
   * Fetch all rostered players
   */
  async getRosters(leagueId: string): Promise<AdapterPlayer[]> {
    const [league, rosterData] = await Promise.all([
      this.fetch<SleeperLeague>(
        `${SLEEPER_API_BASE}/league/${leagueId}`,
        undefined,
        "GetLeagueForSlots"
      ),
      this.fetch<SleeperRoster[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/rosters`,
        undefined,
        "GetRostersForPlayers"
      ),
    ]);

    // Starter slot labels from league config (excludes BN)
    const starterSlots = league.roster_positions.filter(
      (pos) => pos !== "BN",
    );

    const players: AdapterPlayer[] = [];

    for (const roster of rosterData) {
      const teamId = roster.roster_id.toString();
      const starterSet = new Set<string>();

      // Assign starters with specific slot labels
      if (roster.starters) {
        for (let i = 0; i < roster.starters.length; i++) {
          const playerId = roster.starters[i];
          if (playerId && playerId !== "0") {
            starterSet.add(playerId);
            players.push({
              externalPlayerId: playerId,
              teamExternalId: teamId,
              slotPosition: starterSlots[i] ?? "START",
            });
          }
        }
      }

      // Non-starter players
      if (roster.players) {
        const reserveSet = new Set(roster.reserve || []);
        const taxiSet = new Set(roster.taxi || []);

        for (const playerId of roster.players) {
          if (starterSet.has(playerId)) continue;
          let slot = "BN";
          if (reserveSet.has(playerId)) slot = "IR";
          if (taxiSet.has(playerId)) slot = "TAXI";
          players.push({
            externalPlayerId: playerId,
            teamExternalId: teamId,
            slotPosition: slot,
          });
        }
      }
    }

    return players;
  }

  /**
   * Fetch draft picks — generates full future pick inventory,
   * then overlays traded pick ownership changes.
   *
   * Sleeper's /traded_picks endpoint only returns picks that
   * changed hands. We generate default picks for each team/season/
   * round, then reassign ownership based on trades.
   */
  async getDraftPicks(leagueId: string): Promise<AdapterDraftPick[]> {
    const [league, rosters, tradedPicks, drafts] = await Promise.all([
      this.fetch<SleeperLeague>(
        `${SLEEPER_API_BASE}/league/${leagueId}`,
        undefined,
        "GetLeagueForPicks"
      ),
      this.fetch<SleeperRoster[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/rosters`,
        undefined,
        "GetRostersForPicks"
      ),
      this.fetch<SleeperDraftPick[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/traded_picks`,
        undefined,
        "GetTradedPicks"
      ),
      this.fetch<SleeperDraft[]>(
        `${SLEEPER_API_BASE}/league/${leagueId}/drafts`,
        undefined,
        "GetDrafts"
      ),
    ]);

    const currentSeason = parseInt(league.season);
    const draftRounds = league.settings.draft_rounds || 5;

    // Build user_id → roster_id lookup from rosters
    const userToRoster = new Map<string, number>();
    for (const roster of rosters) {
      if (roster.owner_id) {
        userToRoster.set(roster.owner_id, roster.roster_id);
      }
    }

    // Build draft order maps from Sleeper's actual drafts.
    // For each season with a draft, map roster_id → pick slot.
    // Prefer pre_draft (upcoming) over complete (past) for same season.
    const draftOrderBySeason = new Map<
      number,
      Map<number, number>
    >();
    // Sort so pre_draft comes last (overwrites completed entries)
    const sortedDrafts = [...drafts].sort((a, b) => {
      const priority = { complete: 0, drafting: 1, pre_draft: 2 };
      return (
        (priority[a.status] ?? 0) - (priority[b.status] ?? 0)
      );
    });
    for (const draft of sortedDrafts) {
      const season = parseInt(draft.season);
      const rosterToSlot = new Map<number, number>();

      if (draft.slot_to_roster_id) {
        // slot_to_roster_id: { "1": rosterId, "2": rosterId }
        for (const [slot, rosterId] of Object.entries(
          draft.slot_to_roster_id,
        )) {
          rosterToSlot.set(rosterId, parseInt(slot));
        }
      } else if (draft.draft_order) {
        // draft_order: { userId: slotNumber }
        // Convert user_id → roster_id via rosters
        for (const [userId, slot] of Object.entries(
          draft.draft_order,
        )) {
          const rosterId = userToRoster.get(userId);
          if (rosterId !== undefined) {
            rosterToSlot.set(rosterId, slot);
          }
        }
      }

      if (rosterToSlot.size > 0) {
        draftOrderBySeason.set(season, rosterToSlot);
      }
    }

    // Fallback: project pick positions from standings
    const projectedPickMap = this.projectPickPositions(rosters);

    // Generate full inventory for upcoming seasons.
    const futureSeasons = [
      currentSeason,
      currentSeason + 1,
      currentSeason + 2,
    ];

    // Build default inventory: each team owns their own picks
    const picks: AdapterDraftPick[] = [];
    for (const season of futureSeasons) {
      const draftOrder = draftOrderBySeason.get(season);
      for (let round = 1; round <= draftRounds; round++) {
        for (const roster of rosters) {
          const teamId = roster.roster_id.toString();
          // Use actual draft order if this team has one, else project
          const knownSlot = draftOrder?.get(roster.roster_id);
          const projSlot = projectedPickMap.get(roster.roster_id);
          picks.push({
            season,
            round,
            pickNumber: knownSlot ?? undefined,
            projectedPickNumber: knownSlot
              ? undefined
              : projSlot,
            ownerTeamExternalId: teamId,
            originalTeamExternalId: teamId,
          });
        }
      }
    }

    // Apply traded pick ownership changes.
    // If a traded pick falls outside the generated inventory
    // (e.g. season beyond 3-year window, extra round), add it.
    for (const trade of tradedPicks) {
      const tradeSeason = parseInt(trade.season);
      const match = picks.find(
        (p) =>
          p.season === tradeSeason &&
          p.round === trade.round &&
          p.originalTeamExternalId ===
            trade.roster_id.toString(),
      );
      if (match) {
        match.ownerTeamExternalId = trade.owner_id.toString();
      } else {
        const draftOrder = draftOrderBySeason.get(tradeSeason);
        const knownSlot = draftOrder?.get(trade.roster_id);
        const projSlot = projectedPickMap.get(trade.roster_id);
        picks.push({
          season: tradeSeason,
          round: trade.round,
          pickNumber: knownSlot ?? undefined,
          projectedPickNumber: knownSlot
            ? undefined
            : projSlot,
          ownerTeamExternalId: trade.owner_id.toString(),
          originalTeamExternalId: trade.roster_id.toString(),
        });
      }
    }

    return picks;
  }

  /**
   * Project pick positions from standings. Worst record = pick 1.
   * Uses wins, then total points as tiebreaker.
   */
  private projectPickPositions(
    rosters: SleeperRoster[],
  ): Map<number, number> {
    const sorted = [...rosters].sort((a, b) => {
      const aWins = a.settings?.wins ?? 0;
      const bWins = b.settings?.wins ?? 0;
      if (aWins !== bWins) return aWins - bWins; // fewer wins = earlier pick
      const aPts = a.settings?.fpts ?? 0;
      const bPts = b.settings?.fpts ?? 0;
      return aPts - bPts; // fewer points = earlier pick
    });

    const result = new Map<number, number>();
    sorted.forEach((roster, index) => {
      result.set(roster.roster_id, index + 1);
    });
    return result;
  }

  /**
   * Parse roster positions into counts
   */
  private parseRosterPositions(positions: string[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const pos of positions) {
      // Normalize position names
      const normalized = this.normalizePosition(pos);
      if (normalized !== "BN") {
        // Don't count bench as a position
        counts[normalized] = (counts[normalized] || 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Normalize position name
   */
  private normalizePosition(pos: string): string {
    const mapping: Record<string, string> = {
      SUPER_FLEX: "SUPERFLEX",
      REC_FLEX: "FLEX",
      WRRB_FLEX: "FLEX",
      IDP_FLEX: "IDP_FLEX",
      DEF: "DST",
    };
    return mapping[pos] || pos;
  }

  /**
   * Parse flex rules from roster positions
   */
  private parseFlexRules(positions: string[]): FlexRule[] {
    const rules: FlexRule[] = [];
    const seen = new Set<string>();

    for (const pos of positions) {
      if (seen.has(pos)) continue;

      if (pos === "FLEX" || pos === "WRRB_FLEX" || pos === "REC_FLEX") {
        rules.push({ slot: "FLEX", eligible: ["RB", "WR", "TE"] });
        seen.add(pos);
      } else if (pos === "SUPER_FLEX") {
        rules.push({ slot: "SUPERFLEX", eligible: ["QB", "RB", "WR", "TE"] });
        seen.add(pos);
      } else if (pos === "IDP_FLEX") {
        rules.push({ slot: "IDP_FLEX", eligible: ["DL", "LB", "DB"] });
        seen.add(pos);
      }
    }

    return rules;
  }

  /**
   * Normalize Sleeper scoring rules to our format
   */
  private normalizeScoringRules(
    scoring: Record<string, number>
  ): Record<string, number> {
    const normalized: Record<string, number> = {};

    // Map Sleeper keys to our standard keys
    const keyMapping: Record<string, string> = {
      pass_yd: "pass_yd",
      pass_td: "pass_td",
      pass_int: "int",
      pass_2pt: "pass_2pt",
      rush_yd: "rush_yd",
      rush_td: "rush_td",
      rush_2pt: "rush_2pt",
      rec: "rec",
      rec_yd: "rec_yd",
      rec_td: "rec_td",
      rec_2pt: "rec_2pt",
      bonus_rec_te: "te_rec_bonus",
      fum_lost: "fum",
      // IDP
      tkl: "tackle_solo",
      tkl_ast: "tackle_assist",
      tkl_loss: "tackle_loss",
      sack: "sack",
      qb_hit: "qb_hit",
      int: "def_int",
      ff: "fum_force",
      fum_rec: "fum_rec",
      pass_def: "pass_def",
      safe: "safety",
      td: "def_td",
      blk_kick: "blk_kick",
    };

    for (const [sleeperKey, value] of Object.entries(scoring)) {
      if (value !== 0) {
        const normalizedKey = keyMapping[sleeperKey] || sleeperKey;
        normalized[normalizedKey] = value;
      }
    }

    return normalized;
  }

  /**
   * Detect IDP structure from roster positions
   */
  private determineIdpStructure(positions: Record<string, number>): IDPStructure {
    const hasIdp = ["DL", "LB", "DB", "IDP_FLEX"].some((pos) => positions[pos]);

    if (!hasIdp) return "none";

    // Sleeper uses consolidated positions (DL, LB, DB)
    return "consolidated";
  }

  /**
   * Get default position mappings for IDP
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
 * Create a new Sleeper adapter instance
 */
export function createSleeperAdapter(username: string): SleeperAdapter {
  return new SleeperAdapter({ username });
}
