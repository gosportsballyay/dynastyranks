/**
 * Fleaflicker adapter parsing contract tests.
 *
 * Mocks BaseAdapter.fetch() to return fixture JSON, then verifies
 * the full getLeagueSettings() normalization pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import { FleaflickerAdapter } from "../fleaflicker";
import {
  assertValidSettings,
  assert1QBPpr,
  assertSuperFlex,
  assertHalfPpr,
  assertTEP,
  assertIdpGranular,
  assertBonusScoring,
} from "./adapter-contract";

import fixture1qbPpr from "./fixtures/fleaflicker/1qb-ppr.json";
import fixtureSfPpr from "./fixtures/fleaflicker/superflex-ppr.json";
import fixture1qbHalfPpr from "./fixtures/fleaflicker/1qb-half-ppr.json";
import fixture1qbPprTep from "./fixtures/fleaflicker/1qb-ppr-tep.json";
import fixtureIdp from "./fixtures/fleaflicker/idp-granular.json";
import fixtureBonus from "./fixtures/fleaflicker/bonus-scoring.json";

function createAdapter(): FleaflickerAdapter {
  return new FleaflickerAdapter({});
}

function mockFetch(
  adapter: FleaflickerAdapter,
  fixture: unknown,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(adapter as any, "fetch").mockResolvedValue(fixture);
}

describe("FleaflickerAdapter parsing", () => {
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
    expect(settings.benchSlots).toBe(7);
    expect(settings.irSlots).toBe(2);
    expect(settings.taxiSlots).toBe(3);
    expect(settings.scoringRules.pass_yd).toBe(0.04);
    expect(settings.scoringRules.rec).toBe(1.0);
  });

  it("parses SuperFlex PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureSfPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertSuperFlex(settings);

    expect(settings.rosterPositions.SUPERFLEX).toBe(1);
    expect(settings.benchSlots).toBe(8);
    expect(settings.taxiSlots).toBe(4);
  });

  it("parses 1QB Half-PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbHalfPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertHalfPpr(settings);

    expect(settings.benchSlots).toBe(6);
    expect(settings.irSlots).toBe(1);
  });

  it("parses 1QB PPR TEP correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbPprTep);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertTEP(settings);

    // Fleaflicker stores TE premium as position-specific override
    expect(settings.positionScoringOverrides?.TE?.rec).toBe(1.5);
    expect(settings.scoringRules.rec).toBe(1.0);
  });

  it("parses IDP granular correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureIdp);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertIdpGranular(settings);

    expect(settings.rosterPositions.EDR).toBe(2);
    expect(settings.rosterPositions.LB).toBe(2);
    expect(settings.rosterPositions.CB).toBe(2);
    expect(settings.rosterPositions.S).toBe(1);
    expect(settings.scoringRules.tackle_solo).toBe(1.0);
    expect(settings.scoringRules.sack).toBe(4.0);
    // EDR position-specific sack override
    expect(settings.positionScoringOverrides?.EDR?.sack).toBe(5.0);
  });

  it("parses bonus scoring correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureBonus);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertBonusScoring(settings);

    // Verify bonus thresholds were captured
    const thresholds = settings.metadata!.bonusThresholds as Record<
      string,
      Array<{ min: number; max?: number; bonus: number }>
    >;
    expect(thresholds.pass_yd).toBeDefined();
    expect(thresholds.pass_yd.length).toBeGreaterThanOrEqual(2);
    expect(thresholds.rush_yd).toBeDefined();
    expect(thresholds.rush_yd.length).toBeGreaterThanOrEqual(2);
  });
});
