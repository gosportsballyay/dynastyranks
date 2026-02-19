import type { PlayerAsset } from "../../types";

/** Helper to create a player asset with sensible defaults. */
function makePlayer(
  overrides: Partial<PlayerAsset> & { playerId: string; position: string },
): PlayerAsset {
  return {
    playerName: overrides.playerId,
    positionGroup: ["QB", "RB", "WR", "TE", "K"].includes(
      overrides.position,
    )
      ? "offense"
      : "defense",
    age: 26,
    nflTeam: "NYG",
    value: 3000,
    projectedPoints: 150,
    consensusValue: null,
    consensusComponent: null,
    leagueSignalComponent: null,
    rank: 50,
    rankInPosition: 10,
    tier: 3,
    scarcityMultiplier: 1.0,
    ageCurveMultiplier: 1.0,
    dynastyPremium: 0,
    ...overrides,
  };
}

/** A competitive roster for testing lineup solving. */
export const sampleRoster: PlayerAsset[] = [
  makePlayer({ playerId: "qb1", position: "QB", projectedPoints: 320, value: 8000, rank: 3 }),
  makePlayer({ playerId: "rb1", position: "RB", projectedPoints: 250, value: 7500, rank: 5, age: 24 }),
  makePlayer({ playerId: "rb2", position: "RB", projectedPoints: 200, value: 5500, rank: 15, age: 25 }),
  makePlayer({ playerId: "rb3", position: "RB", projectedPoints: 140, value: 3000, rank: 40, age: 27 }),
  makePlayer({ playerId: "wr1", position: "WR", projectedPoints: 260, value: 8500, rank: 2, age: 25 }),
  makePlayer({ playerId: "wr2", position: "WR", projectedPoints: 220, value: 6500, rank: 10, age: 24 }),
  makePlayer({ playerId: "wr3", position: "WR", projectedPoints: 190, value: 5000, rank: 20, age: 27 }),
  makePlayer({ playerId: "wr4", position: "WR", projectedPoints: 120, value: 2000, rank: 55 }),
  makePlayer({ playerId: "te1", position: "TE", projectedPoints: 170, value: 5500, rank: 12 }),
  makePlayer({ playerId: "dl1", position: "EDR", projectedPoints: 110, value: 2500, rank: 60 }),
  makePlayer({ playerId: "dl2", position: "IL", projectedPoints: 90, value: 1800, rank: 75 }),
  makePlayer({ playerId: "lb1", position: "LB", projectedPoints: 130, value: 3000, rank: 42 }),
  makePlayer({ playerId: "lb2", position: "LB", projectedPoints: 115, value: 2200, rank: 58 }),
  makePlayer({ playerId: "db1", position: "CB", projectedPoints: 100, value: 2000, rank: 65 }),
  makePlayer({ playerId: "db2", position: "S", projectedPoints: 105, value: 2100, rank: 62 }),
  makePlayer({ playerId: "db3", position: "CB", projectedPoints: 80, value: 1200, rank: 85 }),
  makePlayer({ playerId: "bn1", position: "RB", projectedPoints: 100, value: 1500, rank: 80, age: 23 }),
  makePlayer({ playerId: "bn2", position: "WR", projectedPoints: 90, value: 1200, rank: 88, age: 22 }),
];

/** A second roster for trade counterparty. */
export const sampleRoster2: PlayerAsset[] = [
  makePlayer({ playerId: "t2qb1", position: "QB", projectedPoints: 290, value: 7000, rank: 8 }),
  makePlayer({ playerId: "t2rb1", position: "RB", projectedPoints: 270, value: 8500, rank: 1, age: 23 }),
  makePlayer({ playerId: "t2rb2", position: "RB", projectedPoints: 180, value: 4500, rank: 22, age: 26 }),
  makePlayer({ playerId: "t2wr1", position: "WR", projectedPoints: 240, value: 7500, rank: 4, age: 26 }),
  makePlayer({ playerId: "t2wr2", position: "WR", projectedPoints: 200, value: 5200, rank: 18, age: 28 }),
  makePlayer({ playerId: "t2wr3", position: "WR", projectedPoints: 160, value: 3800, rank: 30 }),
  makePlayer({ playerId: "t2te1", position: "TE", projectedPoints: 150, value: 4000, rank: 25, age: 28 }),
  makePlayer({ playerId: "t2lb1", position: "LB", projectedPoints: 125, value: 2800, rank: 45 }),
  makePlayer({ playerId: "t2lb2", position: "LB", projectedPoints: 110, value: 2000, rank: 63 }),
  makePlayer({ playerId: "t2dl1", position: "EDR", projectedPoints: 100, value: 2200, rank: 68 }),
  makePlayer({ playerId: "t2dl2", position: "IL", projectedPoints: 85, value: 1500, rank: 82 }),
  makePlayer({ playerId: "t2db1", position: "S", projectedPoints: 95, value: 1800, rank: 72 }),
  makePlayer({ playerId: "t2db2", position: "CB", projectedPoints: 88, value: 1600, rank: 78 }),
];
