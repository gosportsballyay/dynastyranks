/**
 * Sleeper adapter parsing contract tests.
 *
 * Mocks BaseAdapter.fetch() to return fixture JSON, then verifies
 * the full getLeagueSettings() normalization pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import { SleeperAdapter } from "../sleeper";
import {
  assertValidSettings,
  assert1QBPpr,
  assertSuperFlex,
  assertHalfPpr,
  assertTEP,
  assertIdpConsolidated,
} from "./adapter-contract";

import fixture1qbPpr from "./fixtures/sleeper/1qb-ppr.json";
import fixtureSfPpr from "./fixtures/sleeper/superflex-ppr.json";
import fixture1qbHalfPpr from "./fixtures/sleeper/1qb-half-ppr.json";
import fixture1qbPprTep from "./fixtures/sleeper/1qb-ppr-tep.json";
import fixtureIdp from "./fixtures/sleeper/idp-consolidated.json";
import fixtureBonus from "./fixtures/sleeper/bonus-scoring.json";

function createAdapter(): SleeperAdapter {
  return new SleeperAdapter({ username: "test" });
}

function mockFetch(
  adapter: SleeperAdapter,
  fixture: unknown,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(adapter as any, "fetch").mockResolvedValue(fixture);
}

describe("SleeperAdapter parsing", () => {
  it("parses 1QB PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assert1QBPpr(settings);

    expect(settings.rosterPositions.RB).toBe(2);
    expect(settings.rosterPositions.WR).toBe(2);
    expect(settings.rosterPositions.TE).toBe(1);
    expect(settings.rosterPositions.FLEX).toBe(2);
    expect(settings.benchSlots).toBe(7);
    expect(settings.taxiSlots).toBe(3);
    expect(settings.irSlots).toBe(2);
    expect(settings.scoringRules.pass_td).toBe(4);
    expect(settings.scoringRules.rush_td).toBe(6);
  });

  it("parses SuperFlex PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureSfPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertSuperFlex(settings);

    expect(settings.rosterPositions.SUPERFLEX).toBe(1);
    expect(settings.rosterPositions.FLEX).toBe(1);
    expect(settings.taxiSlots).toBe(4);
    expect(settings.benchSlots).toBe(8);
  });

  it("parses 1QB Half-PPR correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbHalfPpr);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertHalfPpr(settings);

    expect(settings.rosterPositions.FLEX).toBe(1);
    expect(settings.taxiSlots).toBe(2);
  });

  it("parses 1QB PPR TEP correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixture1qbPprTep);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);
    assertTEP(settings);

    // Sleeper stores TE premium as te_rec_bonus
    expect(settings.scoringRules.te_rec_bonus).toBe(0.5);
    expect(settings.scoringRules.rec).toBe(1.0);
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
    expect(settings.positionMappings).toBeDefined();
    expect(settings.positionMappings!.DL).toContain("EDR");

    // Regression: these keys were previously mapped to wrong aliases
    expect(settings.scoringRules.tackle_loss).toBe(1.5);
    expect(settings.scoringRules.fum_force).toBe(2.0);
    expect(settings.scoringRules.pass_def).toBe(1.5);

    // Verify old aliases are NOT present
    expect(settings.scoringRules).not.toHaveProperty("tfl");
    expect(settings.scoringRules).not.toHaveProperty("ff");
    expect(settings.scoringRules).not.toHaveProperty("pd");
  });

  it("parses bonus/PPA scoring correctly", async () => {
    const adapter = createAdapter();
    mockFetch(adapter, fixtureBonus);
    const settings = await adapter.getLeagueSettings("12345");

    assertValidSettings(settings);

    // Sleeper doesn't have threshold bonuses, but has PPA
    expect(settings.scoringRules.pass_td).toBe(6);
    expect(settings.scoringRules.rec).toBe(1.0);
    // Points per attempt fields
    expect(Number.isFinite(settings.scoringRules.pass_att)).toBe(true);
  });
});
