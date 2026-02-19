/**
 * Canonical Stat Key Registry
 *
 * Single source of truth for every valid stat key used across
 * adapters, scoring rules, projections, and historical stats.
 * Prevents silent zero-scoring from mismatched stat key names.
 */

export const CANONICAL_STAT_KEYS = {
  passing: [
    "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_air_yd",
    "pass_yac", "pass_fd", "pass_2pt", "pass_inc", "pass_sack",
    "pass_int_td", "int",
  ] as const,
  rushing: [
    "rush_att", "rush_yd", "rush_td", "rush_fd", "rush_2pt",
    "rush_fum", "rush_fum_lost",
  ] as const,
  receiving: [
    "rec", "rec_tgt", "rec_yd", "rec_td", "rec_fd", "rec_2pt",
    "rec_air_yd", "rec_yac", "rec_fum", "rec_fum_lost",
  ] as const,
  fumbles: ["fum", "fum_lost"] as const,
  idp: [
    "tackle", "tackle_solo", "tackle_assist", "tackle_ast",
    "tackle_loss", "tackle_loss_yd", "sack", "sack_yd",
    "qb_hit", "def_int", "def_int_yd", "int_ret_yd",
    "fum_force", "fum_rec", "fum_rec_yd", "fum_ret_yd",
    "pass_def", "def_td", "def_fum", "def_2pt", "safety",
    "blk_kick",
  ] as const,
  kicking: [
    "fg", "fg_0_19", "fg_0_39", "fg_20_29", "fg_30_39",
    "fg_40_49", "fg_50_plus", "fg_50_59", "fg_60_plus",
    "fg_miss", "fg_ret_yd", "fgm_yds", "fgm_yds_over_30",
    "xp", "xp_miss",
  ] as const,
  returns: [
    "kr_yd", "kr_td", "pr_yd", "pr_td", "conv_ret",
    "def_kr_yd", "def_pr_yd",
  ] as const,
  special_teams: [
    "st_ff", "st_fum_rec", "st_tkl_solo",
    "def_st_ff", "def_st_td", "def_st_fum_rec",
    "blk_kick_ret_yd",
  ] as const,
  dst: [
    "dst_td", "dst_int", "dst_fum_rec", "dst_blk_kick",
    "dst_safety", "dst_sack", "dst_pts_allowed",
    "dst_yds_allowed", "dst_ret_td",
    "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13",
    "pts_allow_14_20", "pts_allow_28_34", "pts_allow_35p",
    "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299",
    "yds_allow_300_349",
    "def_3_and_out", "def_4_and_stop",
  ] as const,
  bonuses: [
    "te_rec_bonus", "bonus_rec_rb", "bonus_rec_wr",
    "fum_rec_td", "st_td",
    "rec_5_9", "rec_10_19", "rec_20_29", "rec_30_39",
    "rec_40p", "rec_td_40p", "rec_td_50p",
    "rush_40p", "rush_td_40p", "rush_td_50p",
    "pass_td_40p", "pass_td_50p", "pass_cmp_40p",
    "bonus_sack_2p", "bonus_tkl_10p",
    "bonus_rec_yd_100", "bonus_rec_yd_200",
    "bonus_rush_yd_100", "bonus_rush_yd_200",
    "bonus_pass_yd_300", "bonus_pass_yd_400",
    "bonus_rush_rec_yd_100", "bonus_rush_rec_yd_200",
    "bonus_def_fum_td_50p", "bonus_def_int_td_50p",
    "idp_pass_def_3p",
  ] as const,
} as const;

/** Union type of every valid stat key. */
export type CanonicalStatKey =
  typeof CANONICAL_STAT_KEYS[
    keyof typeof CANONICAL_STAT_KEYS
  ][number];

/** Flat Set for O(1) runtime validation. */
export const VALID_STAT_KEYS: ReadonlySet<string> = new Set(
  Object.values(CANONICAL_STAT_KEYS).flat(),
);

/**
 * Known aliases from platform-specific abbreviations
 * to their canonical stat key equivalents.
 *
 * These cover Fleaflicker abbreviations and other common
 * platform-specific names that should resolve to canonical keys.
 */
export const STAT_KEY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["tfl", "tackle_loss"],
  ["ff", "fum_force"],
  ["pd", "pass_def"],
  ["tkl", "tackle"],
  ["tkl_solo", "tackle_solo"],
  ["tkl_ast", "tackle_assist"],
  ["idp_tkl", "tackle"],
  ["idp_tkl_solo", "tackle_solo"],
  ["idp_tkl_ast", "tackle_assist"],
  ["idp_tkl_loss", "tackle_loss"],
  ["idp_sack", "sack"],
  ["idp_qb_hit", "qb_hit"],
  ["idp_ff", "fum_force"],
  ["idp_fr", "fum_rec"],
  ["idp_int", "def_int"],
  ["idp_pd", "pass_def"],
  ["idp_def_td", "def_td"],
  ["idp_safe", "safety"],
  ["idp_blk_kick", "blk_kick"],
  // Sleeper IDP aliases
  ["idp_fum_rec", "fum_rec"],
  ["idp_pass_def", "pass_def"],
  ["idp_sack_yd", "sack_yd"],
  ["idp_fum_ret_yd", "fum_ret_yd"],
  ["idp_int_ret_yd", "int_ret_yd"],
  // Sleeper kicking aliases
  ["xpm", "xp"],
  ["xpmiss", "xp_miss"],
  ["fgmiss", "fg_miss"],
  ["fgm_0_19", "fg_0_19"],
  ["fgm_20_29", "fg_20_29"],
  ["fgm_30_39", "fg_30_39"],
  ["fgm_40_49", "fg_40_49"],
  ["fgm_50_59", "fg_50_59"],
  ["fgm_50p", "fg_50_plus"],
  ["fgm_60p", "fg_60_plus"],
]);

/**
 * Normalize a stat key to its canonical form.
 *
 * Returns the canonical key if an alias is found,
 * otherwise returns the key unchanged.
 */
export function normalizeStatKey(key: string): string {
  return STAT_KEY_ALIASES.get(key) ?? key;
}

/**
 * Normalize all keys in a stats record to canonical form.
 *
 * Merges values when two aliases resolve to the same key.
 */
export function normalizeStatKeys(
  stats: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const canonical = normalizeStatKey(key);
    result[canonical] = (result[canonical] ?? 0) + value;
  }
  return result;
}

/** Returns stat keys that are NOT in the canonical registry. */
export function findUnknownKeys(keys: string[]): string[] {
  return keys.filter((k) => !VALID_STAT_KEYS.has(k));
}
