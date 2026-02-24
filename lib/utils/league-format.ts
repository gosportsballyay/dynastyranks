/** Build a human-readable league format string like "12-team SF IDP TEP PPR". */
export function leagueFormatString(opts: {
  totalTeams: number;
  rosterPositions: Record<string, number>;
  idpStructure: string | null;
  scoringRules: Record<string, number>;
}): string {
  const parts: string[] = [`${opts.totalTeams}-team`];

  const rp = opts.rosterPositions;
  const hasSF =
    (rp["SUPERFLEX"] ?? 0) > 0 ||
    (rp["SUPER_FLEX"] ?? 0) > 0 ||
    (rp["SF"] ?? 0) > 0 ||
    (rp["QB"] ?? 0) >= 2;
  if (hasSF) parts.push("SF");

  if (opts.idpStructure && opts.idpStructure !== "none") {
    parts.push("IDP");
  }

  const sr = opts.scoringRules;
  const hasTEP =
    (sr["te_rec_bonus"] ?? 0) > 0 ||
    (sr["bonus_rec_te"] ?? 0) > 0;
  if (hasTEP) parts.push("TEP");

  const rec = sr["rec"] ?? 0;
  if (rec >= 1) parts.push("PPR");
  else if (rec >= 0.5) parts.push("Half PPR");

  return parts.join(" ");
}
