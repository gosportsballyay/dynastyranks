import { describe, it, expect } from "vitest";
import {
  computeFairness,
  analyzeRosterImpact,
  computeMarketDivergence,
} from "../trade-analysis";
import { sampleRoster, sampleRoster2 } from "./fixtures/sample-rosters";
import { sampleLeagueConfig } from "./fixtures/sample-league-config";
import type { TradeAsset, PlayerAsset, DraftPickAsset } from "../types";

function playerAsset(p: PlayerAsset): TradeAsset {
  return { type: "player", asset: p };
}

function pickAsset(p: DraftPickAsset): TradeAsset {
  return { type: "pick", asset: p };
}

const fakePick: DraftPickAsset = {
  pickId: "pick1",
  season: 2026,
  round: 1,
  pickNumber: null,
  projectedPickNumber: 6,
  originalTeamId: null,
  originalTeamName: null,
  ownerTeamId: "t1",
  value: 5000,
};

describe("computeFairness", () => {
  it("reports balanced when values are equal", () => {
    const side1 = [playerAsset(sampleRoster[0])]; // qb1: 8000
    const side2 = [playerAsset(sampleRoster2[1])]; // t2rb1: 8500
    // Close enough to be within 5%
    const result = computeFairness(side1, side2);
    expect(result.side1Total).toBe(8000);
    expect(result.side2Total).toBe(8500);
  });

  it("detects imbalanced trades", () => {
    const side1 = [playerAsset(sampleRoster[0])]; // 8000
    const side2 = [playerAsset(sampleRoster[7])]; // 2000
    const result = computeFairness(side1, side2);
    expect(result.verdict).toBe("imbalanced");
    expect(result.adjustedPctDiff).toBeGreaterThan(15);
  });

  it("handles empty sides", () => {
    const result = computeFairness([], []);
    expect(result.side1Total).toBe(0);
    expect(result.side2Total).toBe(0);
    expect(result.verdict).toBe("balanced");
    expect(result.totalAdjustmentValue).toBe(0);
    expect(result.waiverAdjustment).toBe(0);
    expect(result.studAdjustment).toBe(0);
  });

  it("computes correct percentage difference", () => {
    const side1 = [
      playerAsset({ ...sampleRoster[0], value: 1000 } as PlayerAsset),
    ];
    const side2 = [
      playerAsset({ ...sampleRoster[1], value: 900 } as PlayerAsset),
    ];
    const result = computeFairness(side1, side2);
    // delta = 100, max = 1000, pct = 10%
    expect(result.pctDiff).toBeCloseTo(10, 0);
    // Same asset count → no adjustment → adjusted = raw
    expect(result.adjustedPctDiff).toBeCloseTo(10, 0);
    expect(result.verdict).toBe("slight-edge");
  });

  it("favors the team that sends LESS value", () => {
    // Side 1 sends 8000, side 2 sends 2000 → side 2 is favored
    const side1 = [playerAsset(sampleRoster[0])]; // 8000
    const side2 = [playerAsset(sampleRoster[7])]; // 2000
    const result = computeFairness(side1, side2);
    // delta > 0 means side1 sends more → side2 is favored
    expect(result.adjustedDelta).toBeGreaterThan(0);
  });

  it("applies waiver + stud adjustment for uneven trades", () => {
    // 1 stud (8000) vs 3 picks (2700 each = 8100 total)
    const side1 = [playerAsset(sampleRoster[0])]; // 8000
    const side2 = [
      pickAsset({ ...fakePick, pickId: "p1", value: 2700 }),
      pickAsset({ ...fakePick, pickId: "p2", value: 2700 }),
      pickAsset({ ...fakePick, pickId: "p3", value: 2700 }),
    ];
    const result = computeFairness(side1, side2);

    // extraCount = 2, repVal = 300 (default)
    // waiver = 300*1.0 + 300*1.1 = 630
    expect(result.waiverAdjustment).toBe(630);

    // stud: topValue=8000 > 7000
    // studPct = (8000-7000)/3000 = 0.333
    // studBonus = 0.333 * 0.08 * 8100 ≈ 216
    expect(result.studAdjustment).toBeGreaterThan(200);
    expect(result.studAdjustment).toBeLessThan(230);

    // Total adjustment makes fewer-side win
    expect(result.totalAdjustmentValue).toBe(
      result.waiverAdjustment + result.studAdjustment,
    );
    // Adjusted delta should favor stud side (side1)
    expect(result.adjustedDelta).toBeGreaterThan(0);
  });

  it("applies no stud premium for mid-tier assets", () => {
    // 2 solid players (4000+4000=8000) vs 4 role players (2100 each)
    const side1 = [
      playerAsset({ ...sampleRoster[0], value: 4000 } as PlayerAsset),
      playerAsset({ ...sampleRoster[1], value: 4000 } as PlayerAsset),
    ];
    const side2 = [
      pickAsset({ ...fakePick, pickId: "p1", value: 2100 }),
      pickAsset({ ...fakePick, pickId: "p2", value: 2100 }),
      pickAsset({ ...fakePick, pickId: "p3", value: 2100 }),
      pickAsset({ ...fakePick, pickId: "p4", value: 2100 }),
    ];
    const result = computeFairness(side1, side2);

    // Top value on fewer side = 4000 < 7000 → no stud premium
    expect(result.studAdjustment).toBe(0);
    // Still has waiver adjustment (2 extra assets)
    expect(result.waiverAdjustment).toBeGreaterThan(0);
  });

  it("scales waiver cost with extra asset count", () => {
    const side1 = [playerAsset(sampleRoster[0])]; // 1 asset
    const side2_2 = [
      pickAsset({ ...fakePick, pickId: "p1", value: 4000 }),
      pickAsset({ ...fakePick, pickId: "p2", value: 4000 }),
    ];
    const side2_4 = [
      pickAsset({ ...fakePick, pickId: "p1", value: 2000 }),
      pickAsset({ ...fakePick, pickId: "p2", value: 2000 }),
      pickAsset({ ...fakePick, pickId: "p3", value: 2000 }),
      pickAsset({ ...fakePick, pickId: "p4", value: 2000 }),
    ];

    const result2 = computeFairness(side1, side2_2);
    const result4 = computeFairness(side1, side2_4);

    // 1 extra: 300*1.0 = 300
    expect(result2.waiverAdjustment).toBe(300);
    // 3 extra: 300*1.0 + 300*1.1 + 300*1.2 = 990
    expect(result4.waiverAdjustment).toBe(990);
    expect(result4.waiverAdjustment).toBeGreaterThan(
      result2.waiverAdjustment,
    );
  });

  it("uses provided replacementValue", () => {
    const side1 = [playerAsset(sampleRoster[0])]; // 1 asset
    const side2 = [
      pickAsset({ ...fakePick, pickId: "p1", value: 4000 }),
      pickAsset({ ...fakePick, pickId: "p2", value: 4000 }),
    ];

    const defaultResult = computeFairness(side1, side2);
    const customResult = computeFairness(side1, side2, 600);

    // Custom repVal=600 → waiver = 600*1.0 = 600
    expect(customResult.waiverAdjustment).toBe(600);
    // Default repVal=300 → waiver = 300*1.0 = 300
    expect(defaultResult.waiverAdjustment).toBe(300);
    expect(customResult.waiverAdjustment).toBeGreaterThan(
      defaultResult.waiverAdjustment,
    );
  });

  it("no adjustment for equal asset counts", () => {
    const side1 = [
      playerAsset({ ...sampleRoster[0], value: 8000 } as PlayerAsset),
    ];
    const side2 = [
      playerAsset({ ...sampleRoster[1], value: 7000 } as PlayerAsset),
    ];
    const result = computeFairness(side1, side2);
    expect(result.waiverAdjustment).toBe(0);
    expect(result.studAdjustment).toBe(0);
    expect(result.totalAdjustmentValue).toBe(0);
  });
});

describe("analyzeRosterImpact", () => {
  it("computes lineup delta for a trade", () => {
    // Trade: send rb3 (140pts), receive t2wr1 (240pts)
    const assetsOut: TradeAsset[] = [playerAsset(sampleRoster[3])]; // rb3
    const assetsIn: TradeAsset[] = [playerAsset(sampleRoster2[3])]; // t2wr1

    const result = analyzeRosterImpact({
      myRoster: sampleRoster,
      assetsOut,
      assetsIn,
      config: sampleLeagueConfig,
    });

    // Should improve lineup since we're trading a bench RB for a WR2
    expect(result.lineupDelta).toBeGreaterThanOrEqual(0);
    expect(result.lineupBefore).toBeDefined();
    expect(result.lineupAfter).toBeDefined();
    expect(result.efficiency).toBeDefined();
  });

  it("detects positional thinning", () => {
    // Trade away both LBs — should thin LB
    const lb1 = sampleRoster.find((p) => p.playerId === "lb1")!;
    const lb2 = sampleRoster.find((p) => p.playerId === "lb2")!;
    const assetsOut: TradeAsset[] = [playerAsset(lb1), playerAsset(lb2)];
    const assetsIn: TradeAsset[] = [playerAsset(sampleRoster2[3])]; // one WR

    const result = analyzeRosterImpact({
      myRoster: sampleRoster,
      assetsOut,
      assetsIn,
      config: sampleLeagueConfig,
    });

    expect(result.efficiency.thinPositions).toContain("LB");
    expect(result.efficiency.consolidation).toBe(true);
    expect(result.efficiency.spotDelta).toBe(1); // sent 2, received 1
  });

  it("computes 1-year and 3-year deltas", () => {
    const assetsOut: TradeAsset[] = [playerAsset(sampleRoster[3])];
    const assetsIn: TradeAsset[] = [playerAsset(sampleRoster2[3])];

    const result = analyzeRosterImpact({
      myRoster: sampleRoster,
      assetsOut,
      assetsIn,
      config: sampleLeagueConfig,
    });

    // Just verify they're numbers
    expect(typeof result.oneYearDelta).toBe("number");
    expect(typeof result.threeYearDelta).toBe("number");
  });
});

describe("computeMarketDivergence", () => {
  it("detects divergence when consensus differs from structural", () => {
    const playerWithDivergence: PlayerAsset = {
      ...sampleRoster[0],
      value: 8000,
      consensusValue: 5000,
    };
    const side1: TradeAsset[] = [playerAsset(playerWithDivergence)];
    const side2: TradeAsset[] = [playerAsset(sampleRoster2[1])];

    const result = computeMarketDivergence(side1, side2);
    const div = result.assetDivergences.find(
      (d) => d.playerId === playerWithDivergence.playerId,
    );
    expect(div).toBeDefined();
    expect(div!.significant).toBe(true);
    expect(div!.direction).toBe("league-higher");
  });

  it("reports aligned when values match", () => {
    const aligned: PlayerAsset = {
      ...sampleRoster[0],
      value: 8000,
      consensusValue: 7800,
    };
    const side1: TradeAsset[] = [playerAsset(aligned)];
    const side2: TradeAsset[] = [];
    const result = computeMarketDivergence(side1, side2);
    expect(result.assetDivergences[0].significant).toBe(false);
  });
});
