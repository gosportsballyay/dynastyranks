#!/usr/bin/env tsx
import { db } from "../lib/db/client";
import { historicalStats, leagues } from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  // What seasons exist in historical_stats?
  const seasons = await db
    .select({
      season: historicalStats.season,
      count: sql<number>`count(*)`,
    })
    .from(historicalStats)
    .groupBy(historicalStats.season)
    .orderBy(historicalStats.season);

  console.log("Historical stats season coverage:");
  for (const s of seasons) {
    console.log(`  ${s.season}: ${s.count} rows`);
  }

  // What targetSeason are leagues using?
  const leagueSeasons = await db
    .select({
      name: leagues.name,
      season: leagues.season,
    })
    .from(leagues)
    .where(eq(leagues.userId, "1a1786c0-6792-4c92-8cc6-57af880cb424"));

  console.log("\nTest league seasons:");
  for (const l of leagueSeasons) {
    console.log(`  ${l.name}: season=${l.season} (targetSeason=${l.season})`);
  }
}

main();
