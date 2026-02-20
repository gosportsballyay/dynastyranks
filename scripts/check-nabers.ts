#!/usr/bin/env tsx
import { db } from "../lib/db/client";
import { historicalStats, canonicalPlayers } from "../lib/db/schema";
import { eq, like } from "drizzle-orm";

async function main() {
  const [p] = await db
    .select()
    .from(canonicalPlayers)
    .where(like(canonicalPlayers.name, "%Nabers%"))
    .limit(1);

  if (!p) {
    console.log("Not found");
    return;
  }

  const rows = await db
    .select({
      season: historicalStats.season,
      gamesPlayed: historicalStats.gamesPlayed,
    })
    .from(historicalStats)
    .where(eq(historicalStats.canonicalPlayerId, p.id));

  console.log(`${p.name} (${p.position}, age ${p.age}):`);
  for (const r of rows.sort((a, b) => a.season - b.season)) {
    console.log(`  ${r.season}: ${r.gamesPlayed} GP`);
  }
}

main();
