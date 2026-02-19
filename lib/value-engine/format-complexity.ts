/**
 * Format complexity scoring for dynamic blend weights.
 *
 * Maps league configuration into a 0-1 complexity score that
 * determines how much weight league-specific signals receive
 * vs market consensus in the unified value engine.
 *
 * Higher complexity = more divergence from "standard" format =
 * more weight to league signals.
 */

/**
 * Lightweight input for complexity calculation.
 *
 * Avoids coupling to the full LeagueSettings schema.
 * Note: totalTeams lives on the leagues table, not leagueSettings.
 */
export interface FormatInput {
  totalTeams: number;
  rosterPositions: Record<string, number>;
  scoringRules: Partial<Record<string, number>>;
}

/**
 * Clamp a value to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const IDP_SLOT_NAMES = new Set([
  "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT", "IDP_FLEX",
]);

const SUPERFLEX_SLOT_NAMES = new Set(["SUPERFLEX", "SF"]);

/**
 * Compute format complexity on a continuous 0-1 scale.
 *
 * Factors:
 *  - sizeFactor:    smooth scaling from 12-team baseline
 *  - superflexFactor: SF/2QB bump
 *  - idpFactor:     any IDP starter slots
 *  - flexFactor:    flex-to-starter ratio above 15%
 *  - tePremium:     TE reception bonus >= 1.5
 *  - heavyTackle:   tackle scoring >= 2
 *
 * All factors are additive; final result clamped to [0, 1].
 */
export function computeFormatComplexity(input: FormatInput): number {
  const { totalTeams, rosterPositions, scoringRules } = input;

  // --- Size factor: baseline 12, smooth +-0.25 over 8-team range ---
  const sizeFactor = clamp((totalTeams - 12) / 8, -0.25, 0.25);

  // --- SuperFlex factor ---
  let hasSuperFlex = false;
  for (const slot of Object.keys(rosterPositions)) {
    if (SUPERFLEX_SLOT_NAMES.has(slot) && rosterPositions[slot] > 0) {
      hasSuperFlex = true;
      break;
    }
  }
  const superflexFactor = hasSuperFlex ? 0.15 : 0;

  // --- IDP factor ---
  let hasIdp = false;
  for (const slot of Object.keys(rosterPositions)) {
    if (IDP_SLOT_NAMES.has(slot) && rosterPositions[slot] > 0) {
      hasIdp = true;
      break;
    }
  }
  const idpFactor = hasIdp ? 0.20 : 0;

  // --- Flex ratio factor ---
  // Only count non-standard flex slots. Plain FLEX (RB/WR/TE) is
  // universal and shouldn't contribute to complexity.
  let totalStarters = 0;
  let complexFlex = 0;
  for (const [slot, count] of Object.entries(rosterPositions)) {
    totalStarters += count;
    if (
      slot === "IDP_FLEX" ||
      slot === "REC_FLEX" ||
      SUPERFLEX_SLOT_NAMES.has(slot)
    ) {
      complexFlex += count;
    }
  }
  const flexRatio =
    totalStarters > 0 ? complexFlex / totalStarters : 0;
  const flexFactor = clamp(flexRatio, 0, 0.15);

  // --- TE premium factor ---
  const teRec = scoringRules["te_rec"] ?? scoringRules["rec"] ?? 0;
  const tePremium = teRec >= 1.5 ? 0.10 : 0;

  // --- Heavy tackle factor ---
  const tackleSolo = scoringRules["tackle_solo"] ?? 0;
  const heavyTackle = tackleSolo >= 2 ? 0.10 : 0;

  const rawScore =
    sizeFactor +
    superflexFactor +
    idpFactor +
    flexFactor +
    tePremium +
    heavyTackle;

  return clamp(rawScore, 0, 1);
}
