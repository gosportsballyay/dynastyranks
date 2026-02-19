/**
 * Yahoo adapter parsing contract tests.
 *
 * Mocks BaseAdapter.fetch() to return handcrafted fixture JSON,
 * then verifies the full getLeagueSettings() normalization pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import { YahooAdapter } from "../yahoo";
import {
  assertValidSettings,
  assert1QBPpr,
  assertSuperFlex,
  assertIdpConsolidated,
  assertBonusScoring,
} from "./adapter-contract";

import fixture1qbPpr from "./fixtures/yahoo/1qb-ppr.json";
import fixtureSfPpr from "./fixtures/yahoo/superflex-ppr.json";
import fixtureIdp from "./fixtures/yahoo/idp-consolidated.json";
import fixtureBonus from "./fixtures/yahoo/bonus-scoring.json";

function createAdapter(): YahooAdapter {
  return new YahooAdapter({ accessToken: "test-token" });
}

function mockFetch(adapter: YahooAdapter, fixture: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(adapter as any, "fetch").mockResolvedValue(fixture);
}

describe("YahooAdapter parsing", () => {
  it("parses 1QB PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbPpr);
    const settings = await adapter.getLeagueSettings("100001");

    assertValidSettings(settings);
    assert1QBPpr(settings);

    expect(settings.rosterPositions.RB).toBe(2);
    expect(settings.rosterPositions.WR).toBe(2);
    expect(settings.rosterPositions.TE).toBe(1);
    expect(settings.rosterPositions.K).toBe(1);
    expect(settings.rosterPositions.DST).toBe(1);
    expect(settings.benchSlots).toBe(7);
    expect(settings.irSlots).toBe(2);
    expect(settings.scoringRules.pass_yd).toBe(0.04);
    expect(settings.scoringRules.rec).toBe(1);
    expect(settings.scoringRules.fum_lost).toBe(-2);
  });

  it("parses SuperFlex PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureSfPpr);
    const settings = await adapter.getLeagueSettings("100002");

    assertValidSettings(settings);
    assertSuperFlex(settings);

    expect(settings.rosterPositions.SUPERFLEX).toBe(1);
    expect(settings.benchSlots).toBe(8);
  });

  it("parses IDP consolidated correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureIdp);
    const settings = await adapter.getLeagueSettings("100003");

    assertValidSettings(settings);
    assertIdpConsolidated(settings);

    expect(settings.rosterPositions.DL).toBe(2);
    expect(settings.rosterPositions.LB).toBe(3);
    expect(settings.rosterPositions.DB).toBe(2);
    expect(settings.rosterPositions.IDP_FLEX).toBe(1);
    expect(settings.scoringRules.tackle_solo).toBe(1);
    expect(settings.scoringRules.sack).toBe(3);
    expect(settings.scoringRules.def_int).toBe(4);
  });

  it("parses bonus scoring correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureBonus);
    const settings = await adapter.getLeagueSettings("100004");

    assertValidSettings(settings);
    assertBonusScoring(settings);

    const thresholds = settings.metadata!.bonusThresholds as Record<
      string,
      Array<{ min: number; bonus: number }>
    >;
    expect(thresholds.pass_yd).toBeDefined();
    expect(thresholds.rush_yd).toBeDefined();
  });
});
