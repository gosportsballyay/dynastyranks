import { describe, it, expect } from "vitest";
import { solveOptimalLineup } from "../optimal-lineup";
import { sampleRoster } from "./fixtures/sample-rosters";
import { sampleLeagueConfig } from "./fixtures/sample-league-config";

describe("solveOptimalLineup", () => {
  it("fills all dedicated position slots", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    // Count starters by slot
    const slotCounts: Record<string, number> = {};
    for (const s of result.starters) {
      slotCounts[s.slot] = (slotCounts[s.slot] || 0) + 1;
    }

    expect(slotCounts["QB"]).toBe(1);
    expect(slotCounts["RB"]).toBe(2);
    expect(slotCounts["WR"]).toBe(3);
    expect(slotCounts["TE"]).toBe(1);
    expect(slotCounts["DL"]).toBe(2);
    expect(slotCounts["LB"]).toBe(2);
    expect(slotCounts["DB"]).toBe(2);
  });

  it("fills flex slots from remaining eligible players", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    const flexStarters = result.starters.filter((s) => s.slot === "FLEX");
    expect(flexStarters.length).toBe(1);
    expect(["RB", "WR", "TE"]).toContain(flexStarters[0].player.position);
  });

  it("fills IDP_FLEX slot from remaining IDP players", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    const idpFlex = result.starters.filter((s) => s.slot === "IDP_FLEX");
    expect(idpFlex.length).toBe(1);
    const idpPositions = ["DL", "LB", "DB", "EDR", "IL", "CB", "S"];
    expect(idpPositions).toContain(idpFlex[0].player.position);
  });

  it("assigns the best players to each slot", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    // QB should be our only QB (qb1)
    const qbStarter = result.starters.find((s) => s.slot === "QB");
    expect(qbStarter?.player.playerId).toBe("qb1");

    // Top 2 RBs should start
    const rbStarters = result.starters
      .filter((s) => s.slot === "RB")
      .sort((a, b) => b.player.projectedPoints - a.player.projectedPoints);
    expect(rbStarters[0].player.playerId).toBe("rb1");
    expect(rbStarters[1].player.playerId).toBe("rb2");
  });

  it("places remaining players on bench", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    const totalPlayers = sampleRoster.length;
    const starterCount = result.starters.length;
    const benchCount = result.bench.length;
    expect(starterCount + benchCount).toBe(totalPlayers);
    expect(benchCount).toBeGreaterThan(0);
  });

  it("calculates correct total starter points", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    const manualTotal = result.starters.reduce(
      (sum, s) => sum + s.player.projectedPoints,
      0,
    );
    expect(result.totalStarterPoints).toBe(manualTotal);
  });

  it("maps EDR/IL to DL slots via positionMappings", () => {
    const result = solveOptimalLineup(sampleRoster, sampleLeagueConfig);

    const dlStarters = result.starters.filter((s) => s.slot === "DL");
    expect(dlStarters.length).toBe(2);
    for (const s of dlStarters) {
      expect(["DL", "EDR", "IL"]).toContain(s.player.position);
    }
  });
});
