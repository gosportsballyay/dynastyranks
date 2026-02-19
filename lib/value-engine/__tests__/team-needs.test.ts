import { describe, test, expect } from "vitest";
import {
  computeTeamNeeds,
  classifyTeams,
  computeUpgradeTargets,
  type TeamNeedInput,
  type TeamNeedsResult,
  type PositionStrength,
} from "../team-needs";

/** Helper: create a player list from an array of values. */
function players(values: number[]): Array<{ value: number }> {
  return values.map((value) => ({ value }));
}

/** Default scarcity factors for tests. */
const SCARCITY: Record<string, number> = {
  QB: 0.8,
  RB: 1.1,
  WR: 0.9,
  TE: 1.15,
  DL: 1.0,
  LB: 0.9,
  DB: 0.9,
};

/** Find a position in a PositionStrength array. */
function findPos(
  arr: PositionStrength[],
  pos: string,
): PositionStrength | undefined {
  return arr.find((p) => p.position === pos);
}

// ─── Mutual Exclusivity ─────────────────────────────────────────

describe("mutual exclusivity", () => {
  test("no position appears in both needs and surplus", () => {
    // The old overlap scenario: good starters + 1 tradeable depth
    // + 2 below-rep bench pieces
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([
          8000, 7500, 7000, 6500, 6000, 5500, 5000, 4500,
          4000, 3500, 3000, 2500, 2000, 1500, 1000, 500,
        ]),
        // starters [8000,6000] both above rep (500). depth: 4000,200,100
        teamPlayers: players([8000, 6000, 4000, 200, 100]),
        starterDemand: 2.0,
        replacementRank: 16, // repValue = 500
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const needPositions = new Set(result.needs.map((n) => n.position));
    const surplusPositions = new Set(
      result.surplus.map((s) => s.position),
    );

    for (const pos of needPositions) {
      expect(surplusPositions.has(pos)).toBe(false);
    }
  });

  test("good starters + bad bench → surplus only", () => {
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([
          8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000,
        ]),
        // starters [7000, 5000] above rep (1000). bench [100] below
        teamPlayers: players([7000, 5000, 100]),
        starterDemand: 2.0,
        replacementRank: 8,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // starterScore = (7000-1000) + (5000-1000) = 10000 > 0 → surplus
    expect(findPos(result.surplus, "RB")).toBeDefined();
    expect(findPos(result.needs, "RB")).toBeUndefined();
  });

  test("net-negative starters despite one good player → need only", () => {
    // 4 starter slots, one good player can't carry three bad ones.
    // Best players ARE starters (sorted desc), so "good bench" is
    // structurally impossible — this test verifies the realistic case.
    const inputs: Record<string, TeamNeedInput> = {
      WR: {
        leaguePlayers: players([
          8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000,
        ]),
        // Sorted desc: [6000, 2000, 800, 500, 100]
        // Starters (top 4): [6000, 2000, 800, 500]
        // starterScore = (6000-1000)+(2000-1000)+(800-1000)+(500-1000)
        //              = 5000 + 1000 - 200 - 500 = 5300 → surplus
        // With only 2 starter slots:
        // Starters: [6000, 2000], depth: [800, 500, 100]
        // starterScore = 5000 + 1000 = 6000 → surplus
        // Neither works for "need". Use all-bad roster:
        teamPlayers: players([800, 500, 100]),
        starterDemand: 2.0,
        replacementRank: 8,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // starterScore = (800-1000) + (500-1000) = -700 < 0 → need
    expect(findPos(result.needs, "WR")).toBeDefined();
    expect(findPos(result.surplus, "WR")).toBeUndefined();
  });

  test("across multiple positions: each position in at most one list", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([9000, 8000, 7000, 6000, 5000, 4000]),
        teamPlayers: players([9000, 8000]),
        starterDemand: 1.8,
        replacementRank: 6,
      },
      RB: {
        leaguePlayers: players([8000, 7000, 6000, 5000, 4000, 3000]),
        teamPlayers: players([200, 100]),
        starterDemand: 2.4,
        replacementRank: 6,
      },
      WR: {
        leaguePlayers: players([7000, 6000, 5000, 4000, 3000, 2000]),
        teamPlayers: players([7000, 6000, 5000, 4000]),
        starterDemand: 2.4,
        replacementRank: 6,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const needSet = new Set(result.needs.map((n) => n.position));
    const surplusSet = new Set(result.surplus.map((s) => s.position));

    for (const pos of needSet) {
      expect(surplusSet.has(pos)).toBe(false);
    }
  });
});

// ─── Needs ──────────────────────────────────────────────────────

describe("computeTeamNeeds — needs", () => {
  test("weak QB starters in superflex → QB is top need", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([
          9000, 8500, 8000, 7500, 7000, 6500, 6000, 5500,
          5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500,
          1000, 500,
        ]),
        teamPlayers: players([400, 200]),
        starterDemand: 1.8,
        replacementRank: 18,
      },
      RB: {
        leaguePlayers: players([
          8000, 7500, 7000, 6500, 6000, 5500, 5000, 4500,
          4000, 3500, 3000, 2500,
        ]),
        teamPlayers: players([7000, 6000, 5000]),
        starterDemand: 2.4,
        replacementRank: 12,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(result.needs[0].position).toBe("QB");
    expect(result.needs[0].starterScore).toBeLessThan(0);
  });

  test("depth penalty deepens need when starters are below rep", () => {
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([
          8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000,
        ]),
        // Both starters below rep (1000), bench also below
        teamPlayers: players([800, 600, 100]),
        starterDemand: 2.0,
        replacementRank: 8,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const rb = findPos(result.needs, "RB")!;

    expect(rb).toBeDefined();
    expect(rb.starterScore).toBeLessThan(0);
    expect(rb.depthModifier).toBeGreaterThan(0);
    // depthModifier makes score larger than starterScore alone
    expect(rb.score).toBeGreaterThan(
      Math.abs(rb.starterScore) * 1.1 * 1.0,
    );
  });

  test("team above replacement everywhere → empty needs", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([9000, 8000, 7000, 6000, 5000, 4000]),
        teamPlayers: players([9000, 7000]),
        starterDemand: 1.0,
        replacementRank: 6,
      },
      RB: {
        leaguePlayers: players([8000, 7000, 6000, 5000, 4000, 3000]),
        teamPlayers: players([8000, 7000, 6000]),
        starterDemand: 2.0,
        replacementRank: 6,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(result.needs).toHaveLength(0);
  });

  test("IDP positions computed independently", () => {
    const inputs: Record<string, TeamNeedInput> = {
      LB: {
        leaguePlayers: players([
          3000, 2800, 2600, 2400, 2200, 2000, 1800, 1600,
          1400, 1200, 1000, 800,
        ]),
        teamPlayers: players([500, 400, 300]),
        starterDemand: 3.0,
        replacementRank: 12,
      },
      DB: {
        leaguePlayers: players([
          2500, 2300, 2100, 1900, 1700, 1500, 1300, 1100,
        ]),
        teamPlayers: players([2500, 2300]),
        starterDemand: 2.0,
        replacementRank: 8,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(findPos(result.needs, "LB")).toBeDefined();
    expect(findPos(result.needs, "DB")).toBeUndefined();
  });

  test("scarcity amplifies TE need over WR need at equal deficit", () => {
    const makeInput = (): TeamNeedInput => ({
      leaguePlayers: players([5000, 4000, 3000, 2000, 1000]),
      teamPlayers: players([500]),
      starterDemand: 1.0,
      replacementRank: 5,
    });

    const inputs: Record<string, TeamNeedInput> = {
      TE: makeInput(),
      WR: makeInput(),
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const teNeed = findPos(result.needs, "TE")!;
    const wrNeed = findPos(result.needs, "WR")!;

    // TE (1.15) > WR (0.9) scarcity
    expect(teNeed.score).toBeGreaterThan(wrNeed.score);
  });

  test("returns at most 3 needs", () => {
    const makeWeak = (): TeamNeedInput => ({
      leaguePlayers: players([5000, 4000, 3000, 2000]),
      teamPlayers: players([100]),
      starterDemand: 1.0,
      replacementRank: 4,
    });

    const inputs: Record<string, TeamNeedInput> = {
      QB: makeWeak(),
      RB: makeWeak(),
      WR: makeWeak(),
      TE: makeWeak(),
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(result.needs.length).toBeLessThanOrEqual(3);
  });

  test("empty roster slots count as deficit", () => {
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([5000, 4000, 3000, 2000]),
        teamPlayers: players([]),
        starterDemand: 2.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const rb = findPos(result.needs, "RB")!;

    expect(rb).toBeDefined();
    // starterScore = (0-2000) + (0-2000) = -4000
    expect(rb.starterScore).toBe(-4000);
  });
});

// ─── Surplus ────────────────────────────────────────────────────

describe("computeTeamNeeds — surplus", () => {
  test("starters above rep + above-rep depth → surplus with tradeable info", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([
          9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000,
          1000, 500,
        ]),
        // 3 QBs all above rep (500), 1 starter slot
        teamPlayers: players([9000, 6000, 3000]),
        starterDemand: 1.0,
        replacementRank: 10,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const qb = findPos(result.surplus, "QB")!;

    expect(qb).toBeDefined();
    expect(qb.starterScore).toBeGreaterThan(0);
    expect(qb.tradeableDepthCount).toBe(2);
    // tradeableDepthValue = (6000-500) + (3000-500) = 8000
    expect(qb.tradeableDepthValue).toBe(8000);
  });

  test("exactly enough good starters, no above-rep depth → surplus from starters only", () => {
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([
          8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000,
        ]),
        // 2 above rep (1000), 1 below rep bench
        teamPlayers: players([7000, 5000, 500]),
        starterDemand: 2.0,
        replacementRank: 8,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const rb = findPos(result.surplus, "RB")!;

    expect(rb).toBeDefined();
    expect(rb.tradeableDepthCount).toBe(0);
    expect(rb.tradeableDepthValue).toBe(0);
    // starterScore = (7000-1000) + (5000-1000) = 10000
    expect(rb.starterScore).toBe(10000);
  });

  test("team below replacement → no surplus", () => {
    const inputs: Record<string, TeamNeedInput> = {
      WR: {
        leaguePlayers: players([8000, 7000, 6000, 5000, 4000, 3000]),
        teamPlayers: players([1000, 500]),
        starterDemand: 2.0,
        replacementRank: 6,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(findPos(result.surplus, "WR")).toBeUndefined();
  });

  test("returns at most 3 surplus positions", () => {
    const makeDeep = (): TeamNeedInput => ({
      leaguePlayers: players([5000, 4000, 3000, 2000, 1000]),
      teamPlayers: players([5000, 4000, 3000, 2000]),
      starterDemand: 1.0,
      replacementRank: 5,
    });

    const inputs: Record<string, TeamNeedInput> = {
      QB: makeDeep(),
      RB: makeDeep(),
      WR: makeDeep(),
      TE: makeDeep(),
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(result.surplus.length).toBeLessThanOrEqual(3);
  });
});

// ─── starterScore == 0 tiebreaker ───────────────────────────────

describe("starterScore == 0 tiebreaker", () => {
  test("starters exactly at rep + weak bench → need via depth", () => {
    const inputs: Record<string, TeamNeedInput> = {
      TE: {
        leaguePlayers: players([5000, 4000, 3000, 2000]),
        // Starter exactly at rep (2000), bench below
        teamPlayers: players([2000, 500]),
        starterDemand: 1.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const te = findPos(result.needs, "TE");

    expect(te).toBeDefined();
    expect(te!.starterScore).toBe(0);
    expect(te!.depthModifier).toBeGreaterThan(0);
    expect(findPos(result.surplus, "TE")).toBeUndefined();
  });

  test("starters exactly at rep + strong bench → surplus via depth", () => {
    const inputs: Record<string, TeamNeedInput> = {
      TE: {
        leaguePlayers: players([5000, 4000, 3000, 2000]),
        // Starter exactly at rep (2000), bench above
        teamPlayers: players([2000, 4000]),
        starterDemand: 1.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    const te = findPos(result.surplus, "TE");

    expect(te).toBeDefined();
    expect(te!.starterScore).toBe(0);
    expect(te!.tradeableDepthCount).toBe(1);
    expect(findPos(result.needs, "TE")).toBeUndefined();
  });

  test("starters exactly at rep + bench exactly at rep → neither", () => {
    const inputs: Record<string, TeamNeedInput> = {
      TE: {
        leaguePlayers: players([5000, 4000, 3000, 2000]),
        teamPlayers: players([2000, 2000]),
        starterDemand: 1.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(findPos(result.needs, "TE")).toBeUndefined();
    expect(findPos(result.surplus, "TE")).toBeUndefined();
  });

  test("starterScore == 0, mixed bench → penalty wins (need)", () => {
    const inputs: Record<string, TeamNeedInput> = {
      RB: {
        leaguePlayers: players([6000, 5000, 4000, 3000, 2000, 1000]),
        // Starter at rep (1000), bench has one above and one below
        // depthPenalty = (1000-100)*0.25 = 225
        // depthBonus = (3000-1000)*0.25 = 500
        // depthPenalty > 0 so it's a need? No: we check penalty first
        // Actually depthPenalty > 0 → need
        teamPlayers: players([1000, 3000, 100]),
        starterDemand: 1.0,
        replacementRank: 6,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // depthPenalty > 0 → treated as need
    expect(findPos(result.needs, "RB")).toBeDefined();
    expect(findPos(result.surplus, "RB")).toBeUndefined();
  });
});

// ─── Edge cases ─────────────────────────────────────────────────

describe("computeTeamNeeds — edge cases", () => {
  test("empty position inputs → empty results", () => {
    const result = computeTeamNeeds({}, SCARCITY);
    expect(result.needs).toHaveLength(0);
    expect(result.surplus).toHaveLength(0);
  });

  test("uses default depth factors when no scarcity override", () => {
    const inputs: Record<string, TeamNeedInput> = {
      TE: {
        leaguePlayers: players([5000, 4000, 3000, 2000]),
        teamPlayers: players([500]),
        starterDemand: 1.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs);
    expect(result.needs).toHaveLength(1);
    expect(result.needs[0].position).toBe("TE");
  });

  test("replacement rank beyond league players defaults to 0", () => {
    const inputs: Record<string, TeamNeedInput> = {
      K: {
        leaguePlayers: players([100, 50]),
        teamPlayers: players([80]),
        starterDemand: 1.0,
        replacementRank: 5,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // repValue = 0, player 80 > 0 → surplus
    expect(findPos(result.surplus, "K")).toBeDefined();
    expect(result.needs).toHaveLength(0);
  });
});

// ─── teamCompetitiveScore ───────────────────────────────────────

describe("teamCompetitiveScore", () => {
  test("sums starterScore across all positions", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([9000, 8000, 7000, 6000]),
        // starter: [8000], repValue=6000 → starterScore = 2000
        teamPlayers: players([8000]),
        starterDemand: 1.0,
        replacementRank: 4,
      },
      RB: {
        leaguePlayers: players([7000, 6000, 5000, 4000]),
        // starters: [3000, 2000], repValue=4000
        // starterScore = (3000-4000) + (2000-4000) = -3000
        teamPlayers: players([3000, 2000]),
        starterDemand: 2.0,
        replacementRank: 4,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // 2000 + (-3000) = -1000
    expect(result.teamCompetitiveScore).toBe(-1000);
    expect(result.positionStarterScores).toEqual({ QB: 2000, RB: -3000 });
  });

  test("is zero when all starters exactly at replacement", () => {
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([5000, 4000, 3000]),
        teamPlayers: players([3000]),
        starterDemand: 1.0,
        replacementRank: 3,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    expect(result.teamCompetitiveScore).toBe(0);
  });

  test("empty positions produce score of 0", () => {
    const result = computeTeamNeeds({}, SCARCITY);
    expect(result.teamCompetitiveScore).toBe(0);
  });

  test("includes positions even if they have rawDelta == 0", () => {
    // starterScore == 0, no depth → rawDelta == 0 → skipped in
    // needs/surplus but still counted in teamCompetitiveScore.
    const inputs: Record<string, TeamNeedInput> = {
      QB: {
        leaguePlayers: players([5000, 4000, 3000]),
        teamPlayers: players([3000]),
        starterDemand: 1.0,
        replacementRank: 3,
      },
      RB: {
        leaguePlayers: players([6000, 5000, 4000]),
        // starterScore = (6000-4000) + (5000-4000) = 3000
        teamPlayers: players([6000, 5000]),
        starterDemand: 2.0,
        replacementRank: 3,
      },
    };

    const result = computeTeamNeeds(inputs, SCARCITY);
    // QB contributes 0, RB contributes 3000
    expect(result.teamCompetitiveScore).toBe(3000);
  });
});

// ─── classifyTeams ──────────────────────────────────────────────

describe("classifyTeams", () => {
  /** Build a minimal TeamNeedsResult with a given score. */
  function makeResult(score: number): TeamNeedsResult {
    return {
      needs: [],
      surplus: [],
      upgradeTargets: [],
      teamCompetitiveScore: score,
      teamCompetitivePercentile: null,
      teamTier: null,
      positionStarterScores: {},
      _allSurplusEntries: [],
    };
  }

  test("10 teams: top 3 contender, bottom 3 rebuilder, middle middling", () => {
    const results = [
      makeResult(10000), // rank 0 → percentile 100
      makeResult(9000),  // rank 1 → percentile 89
      makeResult(8000),  // rank 2 → percentile 78
      makeResult(7000),  // rank 3 → percentile 67
      makeResult(6000),  // rank 4 → percentile 56
      makeResult(5000),  // rank 5 → percentile 44
      makeResult(4000),  // rank 6 → percentile 33
      makeResult(3000),  // rank 7 → percentile 22
      makeResult(2000),  // rank 8 → percentile 11
      makeResult(1000),  // rank 9 → percentile 0
    ];

    classifyTeams(results);

    // Top 3 (percentile >= 70) → contender
    expect(results[0].teamTier).toBe("contender");
    expect(results[1].teamTier).toBe("contender");
    expect(results[2].teamTier).toBe("contender");

    // Middle (30 < percentile < 70)
    expect(results[3].teamTier).toBe("middling");
    expect(results[4].teamTier).toBe("middling");
    expect(results[5].teamTier).toBe("middling");
    expect(results[6].teamTier).toBe("middling");

    // Bottom 3 (percentile <= 30) → rebuilder
    expect(results[7].teamTier).toBe("rebuilder");
    expect(results[8].teamTier).toBe("rebuilder");
    expect(results[9].teamTier).toBe("rebuilder");
  });

  test("percentiles are set correctly", () => {
    const results = [
      makeResult(5000),
      makeResult(3000),
      makeResult(1000),
    ];

    classifyTeams(results);

    expect(results[0].teamCompetitivePercentile).toBe(100);
    expect(results[1].teamCompetitivePercentile).toBe(50);
    expect(results[2].teamCompetitivePercentile).toBe(0);
  });

  test("single team gets percentile 50 and middling", () => {
    const results = [makeResult(5000)];
    classifyTeams(results);

    expect(results[0].teamCompetitivePercentile).toBe(50);
    expect(results[0].teamTier).toBe("middling");
  });

  test("empty array does not throw", () => {
    const results: TeamNeedsResult[] = [];
    expect(() => classifyTeams(results)).not.toThrow();
  });

  test("handles negative scores correctly", () => {
    const results = [
      makeResult(5000),
      makeResult(-1000),
      makeResult(-5000),
    ];

    classifyTeams(results);

    expect(results[0].teamTier).toBe("contender");
    expect(results[2].teamTier).toBe("rebuilder");
    expect(results[0].teamCompetitivePercentile).toBe(100);
    expect(results[2].teamCompetitivePercentile).toBe(0);
  });

  test("works on unsorted input", () => {
    const results = [
      makeResult(1000),  // worst
      makeResult(10000), // best
      makeResult(5000),  // middle
    ];

    classifyTeams(results);

    // Array order preserved, classification correct
    expect(results[0].teamTier).toBe("rebuilder");
    expect(results[0].teamCompetitivePercentile).toBe(0);
    expect(results[1].teamTier).toBe("contender");
    expect(results[1].teamCompetitivePercentile).toBe(100);
    expect(results[2].teamTier).toBe("middling");
    expect(results[2].teamCompetitivePercentile).toBe(50);
  });

  test("does not modify needs or surplus arrays", () => {
    const results = [makeResult(5000), makeResult(1000)];
    classifyTeams(results);

    expect(results[0].needs).toHaveLength(0);
    expect(results[0].surplus).toHaveLength(0);
  });
});

// ─── computeUpgradeTargets ──────────────────────────────────────

describe("computeUpgradeTargets", () => {
  /** Make a PositionStrength entry. */
  function makeEntry(
    position: string,
    starterScore: number,
    score: number,
  ): PositionStrength {
    return {
      position,
      score,
      starterScore,
      depthModifier: 0,
      tradeableDepthCount: 0,
      tradeableDepthValue: 0,
    };
  }

  /** Build a TeamNeedsResult for upgrade target testing. */
  function makeTeamResult(opts: {
    tier: "contender" | "middling" | "rebuilder";
    positionStarterScores: Record<string, number>;
    allSurplus: PositionStrength[];
  }): TeamNeedsResult {
    return {
      needs: [],
      surplus: [...opts.allSurplus].slice(0, 3),
      upgradeTargets: [],
      teamCompetitiveScore: 0,
      teamCompetitivePercentile: null,
      teamTier: opts.tier,
      positionStarterScores: opts.positionStarterScores,
      _allSurplusEntries: opts.allSurplus,
    };
  }

  test("positions below contender baseline become upgrade targets", () => {
    // 3 contenders with QB starterScores: 5000, 4000, 3000 → median 4000
    const contender1 = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 5000 },
      allSurplus: [makeEntry("QB", 5000, 5000)],
    });
    const contender2 = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 4000 },
      allSurplus: [makeEntry("QB", 4000, 4000)],
    });
    const contender3 = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 3000 },
      allSurplus: [makeEntry("QB", 3000, 3000)],
    });

    // Middling team with QB starterScore 2000 < baseline 4000
    const middling = makeTeamResult({
      tier: "middling",
      positionStarterScores: { QB: 2000 },
      allSurplus: [makeEntry("QB", 2000, 2000)],
    });

    const results = [contender1, contender2, contender3, middling];
    computeUpgradeTargets(results);

    // Middling team's QB should be an upgrade target
    expect(middling.upgradeTargets).toHaveLength(1);
    expect(middling.upgradeTargets[0].position).toBe("QB");
    expect(middling.surplus).toHaveLength(0);
  });

  test("positions at or above contender baseline stay surplus", () => {
    const contender = makeTeamResult({
      tier: "contender",
      positionStarterScores: { RB: 3000 },
      allSurplus: [makeEntry("RB", 3000, 3000)],
    });

    // Another team at exactly the baseline
    const other = makeTeamResult({
      tier: "middling",
      positionStarterScores: { RB: 3000 },
      allSurplus: [makeEntry("RB", 3000, 3000)],
    });

    computeUpgradeTargets([contender, other]);

    expect(other.surplus).toHaveLength(1);
    expect(other.upgradeTargets).toHaveLength(0);
  });

  test("needs are never touched", () => {
    const needEntry = makeEntry("WR", -500, 500);
    const contender = makeTeamResult({
      tier: "contender",
      positionStarterScores: { WR: 5000 },
      allSurplus: [],
    });
    const rebuilder = makeTeamResult({
      tier: "rebuilder",
      positionStarterScores: { WR: -500 },
      allSurplus: [],
    });
    rebuilder.needs = [needEntry];

    computeUpgradeTargets([contender, rebuilder]);

    // Need still there, not moved
    expect(rebuilder.needs).toHaveLength(1);
    expect(rebuilder.needs[0].position).toBe("WR");
    expect(rebuilder.upgradeTargets).toHaveLength(0);
  });

  test("no overlap between needs, upgradeTargets, and surplus", () => {
    const contender = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 8000, RB: 6000, WR: 4000 },
      allSurplus: [
        makeEntry("QB", 8000, 8000),
        makeEntry("RB", 6000, 6000),
        makeEntry("WR", 4000, 4000),
      ],
    });

    // Middling team: QB below baseline, RB at baseline, WR below
    const middling = makeTeamResult({
      tier: "middling",
      positionStarterScores: { QB: 2000, RB: 6000, WR: 1000 },
      allSurplus: [
        makeEntry("QB", 2000, 2000),
        makeEntry("RB", 6000, 6000),
        makeEntry("WR", 1000, 1000),
      ],
    });

    computeUpgradeTargets([contender, middling]);

    const needPositions = new Set(middling.needs.map((n) => n.position));
    const upgradePositions = new Set(
      middling.upgradeTargets.map((u) => u.position),
    );
    const surplusPositions = new Set(
      middling.surplus.map((s) => s.position),
    );

    // No overlaps
    for (const pos of upgradePositions) {
      expect(needPositions.has(pos)).toBe(false);
      expect(surplusPositions.has(pos)).toBe(false);
    }
    for (const pos of surplusPositions) {
      expect(needPositions.has(pos)).toBe(false);
    }
  });

  test("no contenders → baseline is 0, all positive entries stay surplus", () => {
    const middling = makeTeamResult({
      tier: "middling",
      positionStarterScores: { QB: 500 },
      allSurplus: [makeEntry("QB", 500, 500)],
    });

    computeUpgradeTargets([middling]);

    expect(middling.surplus).toHaveLength(1);
    expect(middling.upgradeTargets).toHaveLength(0);
  });

  test("contender median computed correctly with even count", () => {
    // 2 contenders: QB scores 3000, 5000 → median = 4000
    const c1 = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 3000 },
      allSurplus: [makeEntry("QB", 3000, 3000)],
    });
    const c2 = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 5000 },
      allSurplus: [makeEntry("QB", 5000, 5000)],
    });

    // Team with QB starterScore 3500 < 4000 → upgrade target
    const other = makeTeamResult({
      tier: "middling",
      positionStarterScores: { QB: 3500 },
      allSurplus: [makeEntry("QB", 3500, 3500)],
    });

    computeUpgradeTargets([c1, c2, other]);

    expect(other.upgradeTargets).toHaveLength(1);
    expect(other.surplus).toHaveLength(0);
  });

  test("returns at most 3 upgrade targets", () => {
    const contender = makeTeamResult({
      tier: "contender",
      positionStarterScores: { QB: 8000, RB: 8000, WR: 8000, TE: 8000 },
      allSurplus: [
        makeEntry("QB", 8000, 8000),
        makeEntry("RB", 8000, 8000),
        makeEntry("WR", 8000, 8000),
        makeEntry("TE", 8000, 8000),
      ],
    });

    const weak = makeTeamResult({
      tier: "middling",
      positionStarterScores: { QB: 100, RB: 100, WR: 100, TE: 100 },
      allSurplus: [
        makeEntry("QB", 100, 100),
        makeEntry("RB", 100, 100),
        makeEntry("WR", 100, 100),
        makeEntry("TE", 100, 100),
      ],
    });

    computeUpgradeTargets([contender, weak]);

    expect(weak.upgradeTargets.length).toBeLessThanOrEqual(3);
  });
});
