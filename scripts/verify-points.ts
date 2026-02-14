#!/usr/bin/env npx tsx
/**
 * Verify Points Against Fleaflicker
 *
 * Compares calculated points against expected Fleaflicker values.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, like, or, sql } from "drizzle-orm";
import * as schema from "../lib/db/schema";

// Target values from Fleaflicker
const TARGETS: Array<{ name: string; expected: number; position: string }> = [
  // QB
  { name: "Matthew Stafford", expected: 558.63, position: "QB" },
  { name: "Drake Maye", expected: 522.21, position: "QB" },
  { name: "Jared Goff", expected: 468.06, position: "QB" },
  // WR
  { name: "Puka Nacua", expected: 414.5, position: "WR" },
  { name: "Ja'Marr Chase", expected: 343.35, position: "WR" },
  { name: "Zay Flowers", expected: 258.8, position: "WR" },
  // RB
  { name: "Christian McCaffrey", expected: 504.35, position: "RB" },
  { name: "Jonathan Taylor", expected: 475.05, position: "RB" },
  { name: "James Cook", expected: 417.45, position: "RB" },
  // TE
  { name: "Trey McBride", expected: 324, position: "TE" },
  { name: "Kyle Pitts", expected: 216.8, position: "TE" },
  { name: "Tyler Warren", expected: 189, position: "TE" },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });

  console.log("=== Points Verification ===\n");
  console.log("Comparing calculated points vs Fleaflicker targets\n");

  // Get the league
  const leagues = await db.select().from(schema.leagues);
  if (leagues.length === 0) {
    console.log("No leagues found.");
    return;
  }
  const league = leagues[0];
  console.log(`League: ${league.name}\n`);

  // Results by position
  const results: Array<{
    name: string;
    position: string;
    expected: number;
    actual: number | null;
    diff: number | null;
    pctDiff: number | null;
  }> = [];

  for (const target of TARGETS) {
    // Find player by name
    const nameParts = target.name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");

    const players = await db
      .select()
      .from(schema.canonicalPlayers)
      .where(
        and(
          like(schema.canonicalPlayers.name, `%${firstName}%`),
          like(schema.canonicalPlayers.name, `%${lastName}%`),
          eq(schema.canonicalPlayers.position, target.position)
        )
      );

    if (players.length === 0) {
      results.push({
        name: target.name,
        position: target.position,
        expected: target.expected,
        actual: null,
        diff: null,
        pctDiff: null,
      });
      continue;
    }

    const player = players[0];

    // Get their player value
    const [value] = await db
      .select()
      .from(schema.playerValues)
      .where(
        and(
          eq(schema.playerValues.leagueId, league.id),
          eq(schema.playerValues.canonicalPlayerId, player.id)
        )
      );

    if (!value) {
      results.push({
        name: target.name,
        position: target.position,
        expected: target.expected,
        actual: null,
        diff: null,
        pctDiff: null,
      });
      continue;
    }

    const actual = value.projectedPoints ?? 0;
    const diff = actual - target.expected;
    const pctDiff = (diff / target.expected) * 100;

    results.push({
      name: target.name,
      position: target.position,
      expected: target.expected,
      actual,
      diff,
      pctDiff,
    });
  }

  // Print results grouped by position
  const positions = ["QB", "RB", "WR", "TE"];
  for (const pos of positions) {
    console.log(`--- ${pos} ---`);
    const posResults = results.filter((r) => r.position === pos);
    for (const r of posResults) {
      if (r.actual === null) {
        console.log(`  ${r.name}: NOT FOUND (expected ${r.expected})`);
      } else {
        const diffStr = r.diff! >= 0 ? `+${r.diff!.toFixed(2)}` : r.diff!.toFixed(2);
        const pctStr = r.pctDiff! >= 0 ? `+${r.pctDiff!.toFixed(1)}%` : `${r.pctDiff!.toFixed(1)}%`;
        const status = Math.abs(r.pctDiff!) <= 5 ? "✓" : "⚠";
        console.log(
          `  ${status} ${r.name}: ${r.actual.toFixed(2)} (expected ${r.expected}, ${diffStr}, ${pctStr})`
        );
      }
    }
    console.log();
  }

  // Summary
  const found = results.filter((r) => r.actual !== null);
  const avgPctDiff =
    found.length > 0
      ? found.reduce((sum, r) => sum + Math.abs(r.pctDiff!), 0) / found.length
      : 0;

  console.log("=== Summary ===");
  console.log(`Players verified: ${found.length}/${results.length}`);
  console.log(`Average absolute difference: ${avgPctDiff.toFixed(2)}%`);

  if (avgPctDiff <= 5) {
    console.log("\n✓ Points are within acceptable range for MVP");
  } else {
    console.log("\n⚠ Points have significant deviation - investigate further");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
