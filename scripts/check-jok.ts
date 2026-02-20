#!/usr/bin/env tsx
import { db } from "../lib/db/client";
import {
  playerValues,
  canonicalPlayers,
  leagues,
} from "../lib/db/schema";
import { eq, and, like } from "drizzle-orm";

async function main() {
  const [player] = await db
    .select()
    .from(canonicalPlayers)
    .where(like(canonicalPlayers.name, "%Owusu-Koramoah%"))
    .limit(1);

  if (!player) {
    console.log("JOK not found");
    return;
  }
  console.log(
    `Found: ${player.name} (${player.position}, age ${player.age})\n`,
  );

  const values = await db
    .select({
      leagueName: leagues.name,
      rank: playerValues.rank,
      rankInPosition: playerValues.rankInPosition,
      value: playerValues.value,
      projectedPoints: playerValues.projectedPoints,
      lastSeasonPoints: playerValues.lastSeasonPoints,
      valueSource: playerValues.valueSource,
      lowConfidence: playerValues.lowConfidence,
    })
    .from(playerValues)
    .innerJoin(leagues, eq(playerValues.leagueId, leagues.id))
    .where(eq(playerValues.canonicalPlayerId, player.id));

  for (const v of values) {
    console.log(
      `${(v.leagueName ?? "").padEnd(35)} ` +
        `rank=${String(v.rank).padEnd(5)} ` +
        `LB#${String(v.rankInPosition).padEnd(4)} ` +
        `val=${String(Math.round(v.value ?? 0)).padEnd(6)} ` +
        `pts=${String(Math.round(v.projectedPoints ?? 0)).padEnd(5)} ` +
        `lastSzn=${String(Math.round(v.lastSeasonPoints ?? 0)).padEnd(4)} ` +
        `src=${v.valueSource} ` +
        `${v.lowConfidence ? "[LOW CONF]" : ""}`,
    );
  }
}

main();
