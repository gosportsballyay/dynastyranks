/**
 * ESPN adapter parsing contract tests.
 *
 * Mocks BaseAdapter.fetch() to return handcrafted fixture JSON,
 * then verifies the full getLeagueSettings() normalization pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import { ESPNAdapter } from "../espn";
import {
  assertValidSettings,
  assert1QBPpr,
  assertSuperFlex,
  assertIdpConsolidated,
} from "./adapter-contract";

import fixture1qbPpr from "./fixtures/espn/1qb-ppr.json";
import fixtureSfPpr from "./fixtures/espn/superflex-ppr.json";
import fixtureIdp from "./fixtures/espn/idp-consolidated.json";
import fixtureBonus from "./fixtures/espn/bonus-scoring.json";

function createAdapter(): ESPNAdapter {
  return new ESPNAdapter({});
}

function mockFetch(adapter: ESPNAdapter, fixture: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(adapter as any, "fetch").mockResolvedValue(fixture);
}

describe("ESPNAdapter parsing", () => {
  it("parses 1QB PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbPpr);
    const settings = await adapter.getLeagueSettings("12345");

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
    expect(settings.scoringRules.rec).toBe(1.0);
    expect(settings.scoringRules.fum_lost).toBe(-2);
  });

  it("parses SuperFlex PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureSfPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertSuperFlex(settings);

    expect(settings.rosterPositions.SUPERFLEX).toBe(1);
    expect(settings.benchSlots).toBe(8);
    expect(settings.taxiSlots).toBe(3);
  });

  it("parses IDP consolidated correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureIdp);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertIdpConsolidated(settings);

    expect(settings.rosterPositions.DL).toBe(2);
    expect(settings.rosterPositions.LB).toBe(3);
    expect(settings.rosterPositions.DB).toBe(2);
    expect(settings.rosterPositions.IDP_FLEX).toBe(1);
    expect(settings.scoringRules.tackle_solo).toBe(1.0);
    expect(settings.scoringRules.sack).toBe(3.0);
    expect(settings.scoringRules.def_int).toBe(4.0);
  });

  it("parses bonus/position-override scoring correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureBonus);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);

    expect(settings.scoringRules.rec).toBe(1.0);
    // ESPN supports position-level overrides via pointsOverrides
    // The TE rec override in our fixture
    if (settings.positionScoringOverrides?.TE) {
      expect(settings.positionScoringOverrides.TE.rec).toBe(1.5);
    }
  });
});
