/**
 * Shared adapter contract assertions.
 *
 * Every AdapterSettings returned by any adapter must satisfy these
 * structural invariants regardless of platform or league type.
 */

import { expect } from "vitest";
import type { AdapterSettings, IDPStructure } from "@/types";
import {
  CANONICAL_STAT_KEYS,
  VALID_STAT_KEYS,
} from "@/lib/stats/canonical-keys";

/**
 * Assert universal structural invariants on AdapterSettings.
 */
export function assertValidSettings(
  settings: AdapterSettings,
): void {
  // 1. scoringRules is non-empty, all values are finite numbers
  const rules = settings.scoringRules as Record<string, number>;
  const ruleKeys = Object.keys(rules);
  expect(ruleKeys.length).toBeGreaterThan(0);
  for (const key of ruleKeys) {
    expect(Number.isFinite(rules[key])).toBe(true);
  }

  // 2. rosterPositions has at least QB + one skill position
  expect(settings.rosterPositions).toHaveProperty("QB");
  const hasSkill = ["RB", "WR", "TE"].some(
    (p) => settings.rosterPositions[p] !== undefined,
  );
  expect(hasSkill).toBe(true);

  // 3. Every flexRules[].slot exists in rosterPositions
  for (const rule of settings.flexRules) {
    expect(settings.rosterPositions).toHaveProperty(rule.slot);
  }

  // 4. idpStructure is one of the valid enum values
  const validIdp: IDPStructure[] = [
    "none",
    "consolidated",
    "granular",
    "mixed",
  ];
  expect(validIdp).toContain(settings.idpStructure);

  // 5. benchSlots, taxiSlots, irSlots are non-negative integers
  expect(settings.benchSlots).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(settings.benchSlots)).toBe(true);
  expect(settings.taxiSlots).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(settings.taxiSlots)).toBe(true);
  expect(settings.irSlots).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(settings.irSlots)).toBe(true);

  // 6. All scoring rule keys must be canonical
  assertCanonicalScoringKeys(settings);

  // 7. If idpStructure !== "none", at least one IDP scoring rule exists
  if (settings.idpStructure !== "none") {
    const canonicalIdp = CANONICAL_STAT_KEYS.idp as readonly string[];
    const hasIdpScoring =
      ruleKeys.some((k) => canonicalIdp.includes(k)) ||
      (settings.positionScoringOverrides &&
        Object.values(settings.positionScoringOverrides).some(
          (overrides) =>
            Object.keys(overrides).some((k) =>
              canonicalIdp.includes(k),
            ),
        ));
    expect(hasIdpScoring).toBe(true);
  }

  // 7. If positionMappings exists, values are arrays of strings
  if (settings.positionMappings) {
    for (const [key, value] of Object.entries(settings.positionMappings)) {
      expect(typeof key).toBe("string");
      expect(Array.isArray(value)).toBe(true);
      for (const item of value) {
        expect(typeof item).toBe("string");
      }
    }
  }
}

/**
 * Assert 1QB PPR league shape.
 */
export function assert1QBPpr(settings: AdapterSettings): void {
  expect(settings.scoringRules.rec).toBe(1.0);
  expect(settings.rosterPositions.QB).toBe(1);
  expect(settings.rosterPositions.SUPERFLEX).toBeUndefined();
  expect(settings.idpStructure).toBe("none");
}

/**
 * Assert SuperFlex league shape.
 */
export function assertSuperFlex(settings: AdapterSettings): void {
  expect(settings.rosterPositions.SUPERFLEX).toBeGreaterThanOrEqual(1);
  const sfRule = settings.flexRules.find((r) => r.slot === "SUPERFLEX");
  expect(sfRule).toBeDefined();
  expect(sfRule!.eligible).toContain("QB");
  expect(settings.scoringRules.rec).toBe(1.0);
}

/**
 * Assert Half-PPR league shape.
 */
export function assertHalfPpr(settings: AdapterSettings): void {
  expect(settings.scoringRules.rec).toBe(0.5);
  expect(settings.rosterPositions.SUPERFLEX).toBeUndefined();
}

/**
 * Assert TEP (TE Premium) league shape.
 */
export function assertTEP(settings: AdapterSettings): void {
  // TE gets a per-reception bonus above the base rec value
  const baseRec = settings.scoringRules.rec ?? 0;
  const teOverride = settings.positionScoringOverrides?.TE?.rec;
  const teRecBonus = settings.scoringRules.te_rec_bonus;

  // Either TE has a position scoring override OR a te_rec_bonus exists
  const hasTEP = (teOverride !== undefined && teOverride > baseRec) ||
    (teRecBonus !== undefined && teRecBonus > 0);
  expect(hasTEP).toBe(true);
}

/**
 * Assert IDP consolidated league shape.
 */
export function assertIdpConsolidated(settings: AdapterSettings): void {
  expect(settings.idpStructure).toBe("consolidated");
  const hasIdpSlot = ["DL", "LB", "DB", "IDP_FLEX"].some(
    (p) => settings.rosterPositions[p] !== undefined,
  );
  expect(hasIdpSlot).toBe(true);
  expect(settings.positionMappings).toBeDefined();
}

/**
 * Assert IDP granular league shape.
 */
export function assertIdpGranular(settings: AdapterSettings): void {
  expect(["granular", "mixed"]).toContain(settings.idpStructure);
  const hasGranular = ["EDR", "IL", "CB", "S", "DE", "DT"].some(
    (p) => settings.rosterPositions[p] !== undefined,
  );
  expect(hasGranular).toBe(true);
}

/**
 * Assert bonus scoring league shape.
 */
export function assertBonusScoring(settings: AdapterSettings): void {
  expect(settings.metadata?.bonusThresholds).toBeDefined();
  const thresholds = settings.metadata!.bonusThresholds as Record<
    string,
    unknown[]
  >;
  expect(Object.keys(thresholds).length).toBeGreaterThan(0);
}

/**
 * Assert all scoring keys are in the canonical registry.
 *
 * Catches non-canonical aliases (e.g. "pd" instead of "pass_def")
 * at test time rather than silently scoring 0 at runtime.
 */
export function assertCanonicalScoringKeys(
  settings: AdapterSettings,
): void {
  const unknownKeys = Object.keys(settings.scoringRules)
    .filter((k) => !VALID_STAT_KEYS.has(k));
  expect(
    unknownKeys,
    `Non-canonical scoring keys: ${unknownKeys.join(", ")}`,
  ).toHaveLength(0);

  if (settings.positionScoringOverrides) {
    for (const [pos, overrides] of Object.entries(
      settings.positionScoringOverrides,
    )) {
      const bad = Object.keys(overrides)
        .filter((k) => !VALID_STAT_KEYS.has(k));
      expect(
        bad,
        `Non-canonical override keys for ${pos}: ${bad.join(", ")}`,
      ).toHaveLength(0);
    }
  }
}
