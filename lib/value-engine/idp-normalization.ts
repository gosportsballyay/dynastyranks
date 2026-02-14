/**
 * IDP Value Normalization
 *
 * Post-processing step that scales IDP values up if they are
 * suppressed relative to offensive values. In IDP-heavy leagues
 * the unified engine may undercount IDP because consensus sources
 * have sparse IDP coverage. This detects that gap and corrects it.
 */

/** IDP positions. */
const IDP_POSITIONS = new Set([
  "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
]);

/** Player value row shape needed for normalization. */
export interface NormalizableValue {
  canonicalPlayerId: string;
  position: string;
  value: number;
}

/**
 * Normalize IDP values relative to offensive values.
 *
 * If the median IDP value is below 60% of the expected ratio
 * (based on starter slot proportions), scale all IDP values up
 * proportionally. The scale factor is capped at 2.0× to avoid
 * overcorrection.
 *
 * @param values - Array of player value rows (mutated in place)
 * @param idpStarterSlots - Total IDP starter slots per team
 * @param offenseStarterSlots - Total offense starter slots per team
 * @returns The same array, with IDP values adjusted
 */
export function normalizeIdpValues<T extends NormalizableValue>(
  values: T[],
  idpStarterSlots: number,
  offenseStarterSlots: number,
): T[] {
  if (idpStarterSlots === 0 || offenseStarterSlots === 0) {
    return values;
  }

  // Split into offense and IDP
  const offenseValues: number[] = [];
  const idpValues: number[] = [];

  for (const v of values) {
    if (IDP_POSITIONS.has(v.position)) {
      idpValues.push(v.value);
    } else if (v.position !== "K") {
      offenseValues.push(v.value);
    }
  }

  if (idpValues.length === 0 || offenseValues.length === 0) {
    return values;
  }

  // Sort for median calculation
  offenseValues.sort((a, b) => a - b);
  idpValues.sort((a, b) => a - b);

  const medianOffense = offenseValues[
    Math.floor(offenseValues.length / 2)
  ];
  const medianIdp = idpValues[Math.floor(idpValues.length / 2)];

  if (medianOffense <= 0) return values;

  // Expected ratio: IDP should be proportional to slot count
  const expectedRatio = idpStarterSlots / offenseStarterSlots;
  const actualRatio = medianIdp / medianOffense;

  // If IDP median is below 60% of expected, scale up
  const suppressionThreshold = expectedRatio * 0.6;

  if (actualRatio >= suppressionThreshold) {
    return values;
  }

  // Scale factor to bring IDP up to expected ratio
  const scaleFactor = Math.min(
    2.0,
    (expectedRatio * medianOffense) / Math.max(1, medianIdp),
  );

  for (const v of values) {
    if (IDP_POSITIONS.has(v.position)) {
      v.value = Math.round(v.value * scaleFactor);
    }
  }

  return values;
}
