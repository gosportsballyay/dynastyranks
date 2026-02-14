#!/usr/bin/env npx tsx
/**
 * Check QB position ranks match projected points order
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../lib/db/schema";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });

  const qbs = await db
    .select({
      name: schema.canonicalPlayers.name,
      projectedPoints: schema.playerValues.projectedPoints,
      lastSeasonPoints: schema.playerValues.lastSeasonPoints,
      rankInPosition: schema.playerValues.rankInPosition,
      rank: schema.playerValues.rank,
      dataSource: schema.playerValues.dataSource,
    })
    .from(schema.playerValues)
    .innerJoin(
      schema.canonicalPlayers,
      eq(schema.playerValues.canonicalPlayerId, schema.canonicalPlayers.id)
    )
    .where(
      and(
        eq(
          schema.playerValues.leagueId,
          "b3f73fc1-3260-46c4-8487-d52fab7fbd8d"
        ),
        eq(schema.canonicalPlayers.position, "QB")
      )
    )
    .orderBy(desc(schema.playerValues.projectedPoints))
    .limit(25);

  console.log("QBs sorted by projectedPoints:");
  console.log(
    "OK? | PosRank | OvRank | Name                | ProjPts | LastSzn | Source"
  );
  console.log("-".repeat(90));

  qbs.forEach((qb, idx) => {
    const expected = idx + 1;
    const match = expected === qb.rankInPosition ? " Y" : " N";
    const pp = (qb.projectedPoints || 0).toFixed(1);
    const ls = qb.lastSeasonPoints
      ? qb.lastSeasonPoints.toFixed(1)
      : "-";
    console.log(
      `${match}  | ${String(qb.rankInPosition).padStart(7)} | ${String(qb.rank).padStart(6)} | ${qb.name.padEnd(19)} | ${pp.padStart(7)} | ${ls.padStart(7)} | ${qb.dataSource}`
    );
  });
}

main().catch(console.error);
