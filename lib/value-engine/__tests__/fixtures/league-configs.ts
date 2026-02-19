/**
 * Synthetic league configurations for value engine integration tests.
 *
 * 10 configs, each extending a base with targeted changes.
 * These mirror real league setups without needing a database.
 */

import type { AdapterSettings, FlexRule } from "@/types";

interface LeagueConfig {
  name: string;
  totalTeams: number;
  settings: AdapterSettings;
}

const BASE_SCORING: Record<string, number> = {
  pass_yd: 0.04,
  pass_td: 4,
  int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1.0,
  rec_yd: 0.1,
  rec_td: 6,
  fum: -2,
};

const BASE_ROSTER: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 2,
};

const BASE_FLEX: FlexRule[] = [
  { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
];

function makeConfig(
  name: string,
  overrides: Partial<{
    totalTeams: number;
    scoringRules: Record<string, number>;
    positionScoringOverrides: Record<string, Record<string, number>>;
    rosterPositions: Record<string, number>;
    flexRules: FlexRule[];
    positionMappings: Record<string, string[]>;
    idpStructure: AdapterSettings["idpStructure"];
    benchSlots: number;
    metadata: Record<string, unknown>;
  }>,
): LeagueConfig {
  return {
    name,
    totalTeams: overrides.totalTeams ?? 12,
    settings: {
      scoringRules: { ...BASE_SCORING, ...overrides.scoringRules },
      positionScoringOverrides: overrides.positionScoringOverrides,
      rosterPositions: overrides.rosterPositions ?? { ...BASE_ROSTER },
      flexRules: overrides.flexRules ?? [...BASE_FLEX],
      positionMappings: overrides.positionMappings,
      idpStructure: overrides.idpStructure ?? "none",
      benchSlots: overrides.benchSlots ?? 7,
      taxiSlots: 3,
      irSlots: 2,
      metadata: overrides.metadata,
    },
  };
}

/** 1. Baseline: 1QB/2RB/2WR/1TE/2FLEX, 12 teams, full PPR */
export const LEAGUE_1QB_PPR = makeConfig("1QB PPR", {});

/** 2. Adds SUPERFLEX slot + QB-eligible flex rule */
export const LEAGUE_SF_PPR = makeConfig("SuperFlex PPR", {
  rosterPositions: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    SUPERFLEX: 1,
  },
  flexRules: [
    { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
    { slot: "SUPERFLEX", eligible: ["QB", "RB", "WR", "TE"] },
  ],
});

/** 3. Half-PPR: rec=0.5 */
export const LEAGUE_1QB_HALF_PPR = makeConfig("1QB Half-PPR", {
  scoringRules: { rec: 0.5 },
});

/** 4. Standard: rec=0 */
export const LEAGUE_1QB_STANDARD = makeConfig("1QB Standard", {
  scoringRules: { rec: 0 },
});

/** 5. TE Premium: TE gets 1.5 per reception */
export const LEAGUE_1QB_TEP = makeConfig("1QB TEP", {
  positionScoringOverrides: {
    TE: { rec: 1.5 },
  },
});

/** 6. IDP Consolidated: DL/LB/DB + IDP_FLEX + IDP scoring */
export const LEAGUE_IDP_CONSOLIDATED = makeConfig("IDP Consolidated", {
  rosterPositions: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    DL: 2,
    LB: 3,
    DB: 2,
    IDP_FLEX: 1,
  },
  flexRules: [
    { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
    { slot: "IDP_FLEX", eligible: ["DL", "LB", "DB"] },
  ],
  positionMappings: {
    DL: ["EDR", "IL", "DE", "DT"],
    LB: ["LB", "ILB", "OLB"],
    DB: ["CB", "S"],
  },
  idpStructure: "consolidated",
  scoringRules: {
    tackle_solo: 1.0,
    tackle_assist: 0.5,
    sack: 3.0,
    def_int: 4.0,
    fum_force: 2.0,
    fum_rec: 2.0,
    pass_def: 1.5,
    def_td: 6.0,
  },
  benchSlots: 10,
});

/** 7. IDP Heavy: higher IDP scoring multipliers */
export const LEAGUE_IDP_HEAVY = makeConfig("IDP Heavy", {
  rosterPositions: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    DL: 2,
    LB: 3,
    DB: 2,
    IDP_FLEX: 2,
  },
  flexRules: [
    { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
    { slot: "IDP_FLEX", eligible: ["DL", "LB", "DB"] },
  ],
  positionMappings: {
    DL: ["EDR", "IL", "DE", "DT"],
    LB: ["LB", "ILB", "OLB"],
    DB: ["CB", "S"],
  },
  idpStructure: "consolidated",
  scoringRules: {
    tackle_solo: 2.0,
    tackle_assist: 1.0,
    sack: 5.0,
    def_int: 6.0,
    fum_force: 3.0,
    fum_rec: 3.0,
    pass_def: 2.5,
    def_td: 6.0,
    tackle_loss: 2.0,
    qb_hit: 1.5,
  },
  benchSlots: 12,
});

/** 8. Bonus: metadata.bonusThresholds for yardage milestones */
export const LEAGUE_BONUS = makeConfig("Bonus Scoring", {
  metadata: {
    bonusThresholds: {
      rush_yd: [
        { min: 100, max: 199, bonus: 3 },
        { min: 200, bonus: 6 },
      ],
      pass_yd: [
        { min: 300, max: 399, bonus: 3 },
        { min: 400, bonus: 6 },
      ],
      rec_yd: [
        { min: 100, max: 199, bonus: 3 },
      ],
    },
  },
});

/** 9. Points Per Attempt: penalizes volume passing/rushing */
export const LEAGUE_PPA = makeConfig("Points Per Attempt", {
  scoringRules: { pass_att: -0.2, rush_att: -0.1 },
});

/** 10. 14-team: same as baseline but more teams */
export const LEAGUE_14_TEAM = makeConfig("14-Team PPR", {
  totalTeams: 14,
});

/** All configs for iteration in universal tests */
export const ALL_CONFIGS: LeagueConfig[] = [
  LEAGUE_1QB_PPR,
  LEAGUE_SF_PPR,
  LEAGUE_1QB_HALF_PPR,
  LEAGUE_1QB_STANDARD,
  LEAGUE_1QB_TEP,
  LEAGUE_IDP_CONSOLIDATED,
  LEAGUE_IDP_HEAVY,
  LEAGUE_BONUS,
  LEAGUE_PPA,
  LEAGUE_14_TEAM,
];
