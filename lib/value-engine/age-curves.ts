/**
 * Age Curves for Dynasty Value Calculation
 *
 * Age curves model the expected production trajectory for players
 * at each position. Dynasty value weights future production heavily,
 * so younger players at positions with sharp declines (RB) get premiums.
 *
 * Research sources:
 * - Fantasy Points: "Age Curves: When Players Break Out/Fall Off" (2023)
 * - ESPN: "What age do players peak/decline?" (2023)
 * - PFF: "Aging curves: How years in the league impact flex players"
 * - The Dynasty Edge: "NFL Age Curve Study: EPA Trends by Position"
 *
 * Key findings:
 * - RB: Peak 25-27, steep cliff after 28 (Year 7+)
 * - WR: Peak Year 3-5 (ages 24-27), gradual decline, productive into early 30s
 * - QB: Peak 28-33, maintain elite production longest
 * - TE: Slow developers, peak Year 5-6, steep decline Year 7+
 */

/**
 * Peak age ranges by position
 * Players in peak range get multiplier of 1.0
 */
const PEAK_AGES: Record<string, { start: number; end: number }> = {
  // Offense - based on industry research
  QB: { start: 28, end: 33 }, // QBs peak later, maintain longer
  RB: { start: 24, end: 27 }, // RBs peak early, decline fast
  WR: { start: 24, end: 28 }, // WRs peak Year 3-5
  TE: { start: 26, end: 29 }, // TEs slow to develop, peak Year 5-6
  K: { start: 25, end: 38 },
  // IDP - generally ages more gracefully
  LB: { start: 25, end: 30 },
  DL: { start: 25, end: 29 },
  DB: { start: 25, end: 30 },
  EDR: { start: 25, end: 29 },
  IL: { start: 25, end: 29 },
  CB: { start: 25, end: 30 },
  S: { start: 25, end: 31 },
};

/**
 * Decline rate per year after peak
 * Higher = faster decline
 *
 * Research shows:
 * - RBs: ~10% decline per year after peak, with cliff effect after 28
 * - WRs: Gradual decline, maintain value into early 30s
 * - QBs: Very slow decline, productive into mid-30s
 * - TEs: Similar to WR but with steeper Year 7+ decline
 */
const DECLINE_RATES: Record<string, number> = {
  QB: 0.025, // QBs decline very slowly (productive into mid-30s)
  RB: 0.10, // RBs decline ~10%/year after peak
  WR: 0.04, // WRs decline slowly, productive into early 30s
  TE: 0.05, // TEs moderate decline, steep after Year 7
  K: 0.02, // Kickers last forever
  LB: 0.05,
  DL: 0.06,
  DB: 0.04,
  EDR: 0.06,
  IL: 0.05,
  CB: 0.04,
  S: 0.04,
};

/**
 * Improvement rate per year before peak
 * Models young player development
 *
 * Research shows:
 * - RBs: Big leap Year 1→2 (42% improvement), then steady
 * - WRs: Sophomore breakout common, improve through Year 5
 * - TEs: Slow developers, sophomore breakout is "most reliable law of fantasy"
 * - QBs: 77% break out by Year 4, 55% by Year 2
 */
const IMPROVEMENT_RATES: Record<string, number> = {
  QB: 0.08, // QBs improve significantly with experience
  RB: 0.06, // RBs improve Year 1→2, then relatively flat
  WR: 0.07, // WRs need route-running development, big Year 2 leap
  TE: 0.08, // TEs are notoriously slow developers (sophomore breakout)
  K: 0.02,
  LB: 0.04,
  DL: 0.04,
  DB: 0.04,
  EDR: 0.04,
  IL: 0.04,
  CB: 0.05,
  S: 0.04,
};

/**
 * Calculate age curve multiplier for a player
 *
 * @param position - Player's position
 * @param age - Player's current age
 * @returns Multiplier (0.5 - 1.1) to apply to player value
 */
export function getAgeCurveMultiplier(position: string, age: number): number {
  const peak = PEAK_AGES[position] || { start: 26, end: 30 };
  const declineRate = DECLINE_RATES[position] || 0.05;
  const improvementRate = IMPROVEMENT_RATES[position] || 0.04;

  // In peak range
  if (age >= peak.start && age <= peak.end) {
    return 1.0;
  }

  // Before peak - player still developing
  if (age < peak.start) {
    const yearsToGo = peak.start - age;
    // Young players get slight discount (uncertainty) but also upside
    // Net effect: slight premium for youth at RB, neutral elsewhere
    const developmentDiscount = Math.pow(1 - improvementRate, yearsToGo);
    const youthPremium = position === "RB" ? 1.05 : 1.0;
    return Math.min(1.1, developmentDiscount * youthPremium);
  }

  // After peak - declining
  const yearsPastPeak = age - peak.end;
  const declineMultiplier = Math.pow(1 - declineRate, yearsPastPeak);

  // RB cliff - extra harsh after 28
  if (position === "RB" && age > 28) {
    const cliffYears = age - 28;
    const cliffPenalty = Math.pow(0.85, cliffYears);
    return Math.max(0.3, declineMultiplier * cliffPenalty);
  }

  // Floor at 0.4 (even old players have some value)
  return Math.max(0.4, declineMultiplier);
}

/**
 * Calculate dynasty premium for young players
 * This is the extra value from having more productive years ahead
 *
 * Research-backed premiums:
 * - RBs on rookie contracts: Maximize value during Years 1-4
 * - WRs/TEs: Sophomore breakout premium (Year 2 is most reliable breakout)
 * - Draft capital: High picks are more certain to produce
 *
 * @param position - Player's position
 * @param age - Player's current age
 * @param yearsExperience - Years in NFL (for rookie detection)
 * @param draftRound - Round drafted (1-7, undefined for UDFA)
 * @returns Premium multiplier (0.5 - 1.4)
 */
export function getDynastyPremium(
  position: string,
  age: number,
  yearsExperience?: number,
  draftRound?: number
): number {
  let premium = 1.0;

  // Base age curve
  premium *= getAgeCurveMultiplier(position, age);

  // Rookie/sophomore boost - this is where most breakouts happen
  if (yearsExperience !== undefined && yearsExperience <= 2) {
    const peak = PEAK_AGES[position] || { start: 26, end: 30 };

    // High draft capital = more certain future, but ONLY if the
    // player is still below peak age. A 26-year-old rookie LB is
    // already in peak range — no development upside to price in.
    // IDP draft capital is less predictive than offense — use a
    // larger divisor to reduce the bonus magnitude.
    if (draftRound !== undefined && age < peak.start) {
      const IDP_CAPITAL_POSITIONS = new Set([
        "LB", "DL", "DB", "EDR", "IL", "CB", "S", "DE", "DT",
      ]);
      const divisor = IDP_CAPITAL_POSITIONS.has(position) ? 30 : 20;
      const capitalBonus = Math.max(0, (8 - draftRound) / divisor);
      premium += capitalBonus;
    }

    // Position-specific rookie premiums based on research
    if (position === "RB" && age <= 24) {
      // RBs: Best value during rookie contract (Years 1-4)
      // Peak is early, so maximize their value window
      premium *= 1.12;
    } else if ((position === "WR" || position === "TE") && yearsExperience === 1) {
      // WR/TE: Sophomore breakout is the "most reliable law of fantasy"
      // Year 2 players get premium for expected improvement
      premium *= 1.08;
    }
  }

  // Years 3-4 boost for players still ascending
  if (yearsExperience !== undefined && yearsExperience >= 3 && yearsExperience <= 4) {
    if (position === "WR") {
      // WRs peak Year 3-5, still ascending
      premium *= 1.05;
    } else if (position === "TE") {
      // TEs are still developing through Year 4-5
      premium *= 1.06;
    }
  }

  // Cap the premium
  return Math.min(1.4, Math.max(0.5, premium));
}

/**
 * Calculate expected remaining productive years
 * Used for multi-year value projections
 */
export function getExpectedProductiveYears(
  position: string,
  age: number
): number {
  const peak = PEAK_AGES[position] || { start: 26, end: 30 };
  const declineRate = DECLINE_RATES[position] || 0.05;

  // Years until production falls below 50% of peak
  const halfLifeYears = Math.log(0.5) / Math.log(1 - declineRate);

  if (age < peak.start) {
    // Young player: years to peak + peak years + decline years
    return (peak.start - age) + (peak.end - peak.start) + halfLifeYears;
  }

  if (age <= peak.end) {
    // In peak: remaining peak + decline years
    return (peak.end - age) + halfLifeYears;
  }

  // Past peak: remaining productive years based on current age
  const yearsPastPeak = age - peak.end;
  const remainingDecline = Math.max(0, halfLifeYears - yearsPastPeak);

  return remainingDecline;
}

/**
 * Calculate a dampened dynasty modifier for the unified value engine.
 *
 * The full getDynastyPremium can swing values too much (0.5–1.4) when
 * applied multiplicatively on top of consensus data that already bakes
 * in youth premiums (KTC especially). This version halves the deviation
 * from 1.0 and clamps to [0.8, 1.2].
 *
 * @param position - Player position
 * @param age - Player's current age
 * @param yearsExperience - Years in NFL
 * @param draftRound - Round drafted (1-7)
 * @returns Modifier in [0.8, 1.2]
 */
export function getDampenedDynastyMod(
  position: string,
  age: number,
  yearsExperience?: number,
  draftRound?: number,
): number {
  const fullPremium = getDynastyPremium(
    position,
    age,
    yearsExperience,
    draftRound,
  );
  // Halve the deviation from 1.0
  const dampened = 1 + (fullPremium - 1) * 0.5;
  return Math.min(1.2, Math.max(0.8, dampened));
}

/**
 * Get age-based tier for display
 */
export function getAgeTier(position: string, age: number): string {
  const peak = PEAK_AGES[position] || { start: 26, end: 30 };

  if (age < peak.start - 2) return "developing";
  if (age < peak.start) return "ascending";
  if (age <= peak.end) return "prime";
  if (age <= peak.end + 2) return "declining";
  return "aging";
}
