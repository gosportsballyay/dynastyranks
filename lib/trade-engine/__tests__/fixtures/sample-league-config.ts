import type { LeagueConfig } from "../../types";

/** Standard 12-team PPR league with IDP. */
export const sampleLeagueConfig: LeagueConfig = {
  totalTeams: 12,
  rosterPositions: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    DL: 2,
    LB: 2,
    DB: 2,
    IDP_FLEX: 1,
    BN: 10,
    TAXI: 3,
    IR: 2,
  },
  flexRules: [
    { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
    { slot: "IDP_FLEX", eligible: ["DL", "LB", "DB"] },
  ],
  positionMappings: {
    DL: ["EDR", "IL"],
    DB: ["CB", "S"],
  },
  benchSlots: 10,
  taxiSlots: 3,
  irSlots: 2,
};

/** Superflex 10-team league, no IDP. */
export const sampleSFLeagueConfig: LeagueConfig = {
  totalTeams: 10,
  rosterPositions: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 1,
    SUPERFLEX: 1,
    BN: 7,
    TAXI: 2,
    IR: 2,
  },
  flexRules: [
    { slot: "FLEX", eligible: ["RB", "WR", "TE"] },
    { slot: "SUPERFLEX", eligible: ["QB", "RB", "WR", "TE"] },
  ],
  benchSlots: 7,
  taxiSlots: 2,
  irSlots: 2,
};
