/**
 * Blend weight computation for the unified value engine.
 *
 * Determines the consensus vs league-signal split based on
 * format complexity and user-selected blend mode.
 *
 * AUTO mode: consensus = 0.70 - (complexity * 0.35)
 * Range: consensus [0.35, 0.70], league [0.30, 0.65]
 */

export type BlendMode =
  | "auto"
  | "market_anchored"
  | "balanced"
  | "league_driven";

export interface BlendWeights {
  consensus: number;
  league: number;
}

const FIXED_MODES: Record<
  Exclude<BlendMode, "auto">,
  BlendWeights
> = {
  market_anchored: { consensus: 0.65, league: 0.35 },
  balanced: { consensus: 0.50, league: 0.50 },
  league_driven: { consensus: 0.35, league: 0.65 },
};

/**
 * Compute blend weights from format complexity and mode.
 *
 * @param complexity - 0-1 score from computeFormatComplexity
 * @param mode - user-selected blend mode (default "auto")
 * @returns consensus and league weight (sum to 1.0)
 */
export function computeBlendWeights(
  complexity: number,
  mode: BlendMode = "auto",
): BlendWeights {
  if (mode !== "auto") {
    return { ...FIXED_MODES[mode] };
  }

  // AUTO: linear interpolation from 0.70 down to 0.35
  const consensus = 0.70 - complexity * 0.35;
  return {
    consensus,
    league: 1 - consensus,
  };
}
