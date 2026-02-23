import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, like, and, desc } from "drizzle-orm";
import * as schema from "../lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function diagnose() {
  // 1. Find player (pass name as CLI arg or default)
  const searchName = process.argv[2] || "Schwesinger";
  const [player] = await db.select()
    .from(schema.canonicalPlayers)
    .where(like(schema.canonicalPlayers.name, `%${searchName}%`))
    .limit(1);

  if (!player) { console.log("Player not found"); return; }

  console.log("=".repeat(70));
  console.log("DIAGNOSTIC: " + player.name);
  console.log("=".repeat(70));
  console.log(`ID: ${player.id}`);
  console.log(`Position: ${player.position}`);
  console.log(`Age: ${player.age}`);
  console.log(`NFL Team: ${player.nflTeam}`);
  console.log();

  // 2. Get all leagues
  const leagues = await db.select().from(schema.leagues);
  console.log(`Found ${leagues.length} leagues`);

  for (const league of leagues) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`League: ${league.name} (${league.totalTeams} teams)`);
    console.log(`${"─".repeat(70)}`);

    // 3. Get league settings
    const [settings] = await db.select()
      .from(schema.leagueSettings)
      .where(eq(schema.leagueSettings.leagueId, league.id))
      .limit(1);

    if (!settings) { console.log("  No settings"); continue; }

    // Roster positions
    const rosterPos = settings.rosterPositions as Record<string, number>;
    const idpSlots = Object.entries(rosterPos)
      .filter(([k]) => ["LB", "DL", "DB", "EDR", "IL", "CB", "S", "IDP_FLEX"].includes(k));
    console.log(`  IDP roster slots: ${JSON.stringify(Object.fromEntries(idpSlots))}`);

    // Full scoring rules
    const rules = settings.scoringRules as Record<string, number>;
    console.log(`  ALL scoring rules: ${JSON.stringify(rules)}`);

    // Normalize scoring rules (same as engine does)
    const { normalizeStatKeys } = await import("../lib/stats/canonical-keys");
    const normalizedRules = normalizeStatKeys(rules);
    console.log(`  NORMALIZED scoring rules: ${JSON.stringify(normalizedRules)}`);

    // Show only IDP-relevant after normalization
    const idpKeys = ["tackle", "tackle_solo", "tackle_assist", "tackle_loss",
      "sack", "def_int", "fum_force", "fum_rec", "pass_def",
      "qb_hit", "safety", "def_td", "blk_kick"];
    const idpRules: Record<string, number> = {};
    for (const k of idpKeys) {
      if (normalizedRules[k] !== undefined) idpRules[k] = normalizedRules[k];
    }
    console.log(`  IDP normalized rules: ${JSON.stringify(idpRules)}`);

    // 4. Get consensus value
    const [consensus] = await db.select()
      .from(schema.aggregatedValues)
      .where(and(
        eq(schema.aggregatedValues.leagueId, league.id),
        eq(schema.aggregatedValues.canonicalPlayerId, player.id),
      ))
      .limit(1);

    console.log();
    console.log("  CONSENSUS:");
    if (consensus) {
      console.log(`    aggregatedValue: ${consensus.aggregatedValue}`);
      console.log(`    ktcValue: ${consensus.ktcValue}`);
      console.log(`    fcValue: ${consensus.fcValue}`);
      console.log(`    dpValue: ${consensus.dpValue}`);
      console.log(`    fpValue: ${consensus.fpValue}`);
      console.log(`    idpValue: ${consensus.idpValue}`);
      console.log(`    aggregatedRank: ${consensus.aggregatedRank}`);
      console.log(`    aggregatedPositionRank: ${consensus.aggregatedPositionRank}`);
    } else {
      console.log("    NO consensus data");
    }

    // 5. Get player value
    const [pv] = await db.select()
      .from(schema.playerValues)
      .where(and(
        eq(schema.playerValues.leagueId, league.id),
        eq(schema.playerValues.canonicalPlayerId, player.id),
      ))
      .limit(1);

    console.log();
    console.log("  PLAYER VALUE:");
    if (pv) {
      console.log(`    value (final): ${pv.value}`);
      console.log(`    rank: ${pv.rank}`);
      console.log(`    rankInPosition: ${pv.rankInPosition}`);
      console.log(`    tier: ${pv.tier}`);
      console.log(`    projectedPoints: ${pv.projectedPoints}`);
      console.log(`    replacementPoints: ${pv.replacementPoints}`);
      console.log(`    vorp: ${pv.vorp}`);
      console.log(`    normalizedVorp: ${pv.normalizedVorp}`);
      console.log(`    scarcityMultiplier: ${pv.scarcityMultiplier}`);
      console.log(`    ageCurveMultiplier: ${pv.ageCurveMultiplier}`);
      console.log(`    dynastyPremium: ${pv.dynastyPremium}`);
      console.log(`    riskDiscount: ${pv.riskDiscount}`);
      console.log(`    lastSeasonPoints: ${pv.lastSeasonPoints}`);
      console.log(`    valueSource: ${pv.valueSource}`);
      console.log(`    lowConfidence: ${pv.lowConfidence}`);
      console.log(`    consensusValue: ${pv.consensusValue}`);
      console.log(`    ktcValue: ${pv.ktcValue}`);
      console.log(`    fcValue: ${pv.fcValue}`);
      console.log(`    dpValue: ${pv.dpValue}`);
      console.log(`    fpValue: ${pv.fpValue}`);
      console.log(`    consensusComponent: ${pv.consensusComponent}`);
      console.log(`    leagueSignalComponent: ${pv.leagueSignalComponent}`);
      console.log(`    engineVersion: ${pv.engineVersion}`);
      console.log(`    computedAt: ${pv.computedAt}`);

      // Check position scoring overrides and bonus thresholds
      const overrides = settings.positionScoringOverrides;
      console.log(`    positionScoringOverrides: ${JSON.stringify(overrides)}`);
      const metadata = settings.metadata as Record<string, unknown> | null;
      console.log(`    bonusThresholds: ${JSON.stringify(metadata?.bonusThresholds ?? null)}`);

      // (fresh calculation deferred to after stats fetch)
    } else {
      console.log("    NO player value");
    }

    // 6. Get historical stats (2025)
    const [stats2025] = await db.select()
      .from(schema.historicalStats)
      .where(and(
        eq(schema.historicalStats.canonicalPlayerId, player.id),
        eq(schema.historicalStats.season, 2025),
      ))
      .limit(1);

    console.log();
    console.log("  HISTORICAL STATS (2025):");
    if (stats2025) {
      console.log(`    gamesPlayed: ${stats2025.gamesPlayed}`);
      const s = stats2025.stats as Record<string, number>;
      const relevantStats: Record<string, number> = {};
      for (const [k, v] of Object.entries(s)) {
        if (v !== 0) relevantStats[k] = v;
      }
      console.log(`    raw non-zero stats: ${JSON.stringify(relevantStats)}`);

      // Normalize stats (same as engine does)
      const normStats = normalizeStatKeys(s);
      const normRelevant: Record<string, number> = {};
      for (const [k, v] of Object.entries(normStats)) {
        if (v !== 0) normRelevant[k] = v;
      }
      console.log(`    normalized non-zero stats: ${JSON.stringify(normRelevant)}`);

      // Manual calc with RAW rules + RAW stats
      let rawPts = 0;
      for (const [stat, value] of Object.entries(s)) {
        const rulePts = rules[stat] || 0;
        if (rulePts !== 0 && value !== 0) {
          rawPts += value * rulePts;
        }
      }
      console.log(`    manual fantasy pts (raw): ${rawPts.toFixed(1)}`);

      // Manual calc with NORMALIZED rules + NORMALIZED stats (engine method)
      let normPts = 0;
      const breakdown: string[] = [];
      for (const [stat, value] of Object.entries(normStats)) {
        const rulePts = normalizedRules[stat] || 0;
        if (rulePts !== 0 && value !== 0) {
          normPts += value * rulePts;
          breakdown.push(`${stat}: ${value} × ${rulePts} = ${(value * rulePts).toFixed(1)}`);
        }
      }
      console.log(`    manual fantasy pts (normalized): ${normPts.toFixed(1)}`);
      console.log(`    scoring breakdown:`);
      for (const b of breakdown) {
        console.log(`      ${b}`);
      }

      // Scale to 17 games (engine does this)
      const gp = stats2025.gamesPlayed || 17;
      let scaledPts = normPts;
      if (gp < 17 && gp > 0) {
        scaledPts = normPts * (17 / gp);
        console.log(`    scaled to 17g: ${scaledPts.toFixed(1)} (from ${gp}g)`);
      }
      console.log(`    per game: ${(normPts / gp).toFixed(1)}`);

      // Fresh calculation with position overrides + bonus thresholds
      if (pv) {
        const overrides = settings.positionScoringOverrides;
        const metadata = settings.metadata as Record<string, unknown> | null;
        const { calculateFantasyPoints } = await import("../lib/value-engine/vorp");
        try {
          const freshPts = calculateFantasyPoints(
            normStats as any,
            normalizedRules as any,
            overrides?.[player.position] as any,
            metadata?.bonusThresholds as any,
            gp,
          );
          console.log(`    FRESH calculateFantasyPoints (with overrides+bonuses): ${freshPts.toFixed(3)}`);
          // Also show without bonuses
          const noBonusPts = calculateFantasyPoints(
            normStats as any,
            normalizedRules as any,
            overrides?.[player.position] as any,
            undefined,
            gp,
          );
          console.log(`    WITHOUT bonuses: ${noBonusPts.toFixed(3)}`);
          // Without overrides too
          const basePts = calculateFantasyPoints(
            normStats as any,
            normalizedRules as any,
            undefined,
            undefined,
            gp,
          );
          console.log(`    BASE only (no overrides, no bonuses): ${basePts.toFixed(3)}`);
        } catch (e: any) {
          console.log(`    FRESH calculateFantasyPoints ERROR: ${e.message}`);
        }
      }
    } else {
      console.log("    NO 2025 stats");
    }

    // 7. Get all historical stats to see trajectory
    const allStats = await db.select()
      .from(schema.historicalStats)
      .where(eq(schema.historicalStats.canonicalPlayerId, player.id))
      .orderBy(desc(schema.historicalStats.season));

    console.log();
    console.log("  HISTORICAL TRAJECTORY:");
    for (const s of allStats) {
      const stats = normalizeStatKeys(s.stats as Record<string, number>);
      let pts = 0;
      for (const [stat, value] of Object.entries(stats)) {
        pts += value * (normalizedRules[stat] || 0);
      }
      console.log(`    ${s.season}: ${s.gamesPlayed}g, ${pts.toFixed(1)} pts (${(pts / (s.gamesPlayed || 17)).toFixed(1)} ppg)`);
    }

    // 8. Compare to other LBs
    console.log();
    console.log("  LB COMPARISON (top 20 by value in this league):");
    const topLBs = await db.select({
      name: schema.canonicalPlayers.name,
      age: schema.canonicalPlayers.age,
      value: schema.playerValues.value,
      rank: schema.playerValues.rank,
      rankInPosition: schema.playerValues.rankInPosition,
      vorp: schema.playerValues.vorp,
      projectedPoints: schema.playerValues.projectedPoints,
      replacementPoints: schema.playerValues.replacementPoints,
      scarcityMultiplier: schema.playerValues.scarcityMultiplier,
      lastSeasonPoints: schema.playerValues.lastSeasonPoints,
      valueSource: schema.playerValues.valueSource,
      lowConfidence: schema.playerValues.lowConfidence,
      consensusComponent: schema.playerValues.consensusComponent,
      leagueSignalComponent: schema.playerValues.leagueSignalComponent,
    }).from(schema.playerValues)
      .innerJoin(schema.canonicalPlayers,
        eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id))
      .where(and(
        eq(schema.playerValues.leagueId, league.id),
        eq(schema.canonicalPlayers.position, "LB"),
      ))
      .orderBy(desc(schema.playerValues.value))
      .limit(20);

    for (const lb of topLBs) {
      const marker = lb.name.includes(searchName) ? " <<<" : "";
      console.log(
        `    LB${String(lb.rankInPosition).padStart(3)}: ` +
        `${lb.name.padEnd(25)} age=${String(lb.age ?? "?").padStart(2)} ` +
        `value=${String(Math.round(lb.value)).padStart(5)} ` +
        `vorp=${String(lb.vorp?.toFixed(1) ?? "–").padStart(6)} ` +
        `proj=${String(lb.projectedPoints?.toFixed(1) ?? "–").padStart(6)} ` +
        `repl=${String(lb.replacementPoints?.toFixed(1) ?? "–").padStart(6)} ` +
        `scar=${lb.scarcityMultiplier?.toFixed(2) ?? "–"} ` +
        `cons=${String(Math.round(lb.consensusComponent ?? 0)).padStart(5)} ` +
        `sig=${String(Math.round(lb.leagueSignalComponent ?? 0)).padStart(5)} ` +
        `src=${lb.valueSource}${lb.lowConfidence ? " [LOW]" : ""}${marker}`
      );
    }
  }
}

diagnose().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
