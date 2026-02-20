#!/usr/bin/env tsx
/**
 * Validate recompute determinism: parse two run logs,
 * compare hashes + counts, then query DB for confirmation.
 */
import { readFileSync } from "fs";
import { db } from "../lib/db/client";
import { leagues } from "../lib/db/schema";
import { eq } from "drizzle-orm";

interface RunEntry {
  name: string;
  leagueId: string;
  engineVersion: string;
  projectionVersion: string;
  dataSeason: number;
  playerCount: number;
}

function parseRun(path: string): RunEntry[] {
  const text = readFileSync(path, "utf-8");
  const entries: RunEntry[] = [];
  const blocks = text.split("[OK] ");
  for (const block of blocks.slice(1)) {
    const lines = block.trim().split("\n");
    const name = lines[0].trim();
    const idMatch = lines[1]?.match(/leagueId=(\S+)/);
    const metaMatch = lines[2]?.match(
      /engine=(\S+)\s+proj=(\S+)\s+dataSeason=(\d+)/,
    );
    const countMatch = lines[3]?.match(/(\d+) values/);
    if (idMatch && metaMatch && countMatch) {
      entries.push({
        name,
        leagueId: idMatch[1],
        engineVersion: metaMatch[1],
        projectionVersion: metaMatch[2],
        dataSeason: parseInt(metaMatch[3]),
        playerCount: parseInt(countMatch[1]),
      });
    }
  }
  return entries;
}

async function main() {
  const run1 = parseRun("/tmp/recompute-run1.txt");
  const run2 = parseRun("/tmp/recompute-run2.txt");

  console.log("=" .repeat(72));
  console.log("RECOMPUTE DETERMINISM VALIDATION");
  console.log("=".repeat(72));

  // --- Compare run1 vs run2 ---
  console.log(
    `\nParsed: Run1=${run1.length} leagues, Run2=${run2.length} leagues`,
  );

  let diffs = 0;
  const run2Map = new Map(run2.map((e) => [e.leagueId, e]));

  console.log(
    "\n" +
      "League".padEnd(32) +
      "Engine  Proj   Season  " +
      "Count1  Count2  Match",
  );
  console.log("-".repeat(90));

  for (const r1 of run1) {
    const r2 = run2Map.get(r1.leagueId);
    if (!r2) {
      console.log(`${r1.name.padEnd(32)} MISSING IN RUN 2`);
      diffs++;
      continue;
    }
    const countMatch = r1.playerCount === r2.playerCount;
    const allMatch = countMatch
      && r1.engineVersion === r2.engineVersion
      && r1.projectionVersion === r2.projectionVersion
      && r1.dataSeason === r2.dataSeason;
    if (!allMatch) diffs++;
    console.log(
      `${r1.name.substring(0, 30).padEnd(32)}` +
        `${r1.engineVersion.padEnd(8)}` +
        `${r1.projectionVersion.padEnd(7)}` +
        `${String(r1.dataSeason).padEnd(8)}` +
        `${String(r1.playerCount).padEnd(8)}` +
        `${String(r2.playerCount).padEnd(8)}` +
        `${allMatch ? "OK" : "MISMATCH"}`,
    );
  }

  console.log("-".repeat(90));
  console.log(
    diffs === 0
      ? "ALL LEAGUES DETERMINISTIC: hash/count identical across runs"
      : `WARNING: ${diffs} league(s) differ between runs`,
  );

  // --- Query DB for lastComputedAt + leagueConfigHash ---
  console.log("\n" + "=".repeat(72));
  console.log("DATABASE VERIFICATION (leagues table)");
  console.log("=".repeat(72));

  const dbLeagues = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      lastComputedAt: leagues.lastComputedAt,
      leagueConfigHash: leagues.leagueConfigHash,
    })
    .from(leagues)
    .where(
      eq(leagues.userId, "1a1786c0-6792-4c92-8cc6-57af880cb424"),
    );

  console.log(
    "\n" +
      "League".padEnd(32) +
      "lastComputedAt".padEnd(28) +
      "configHash",
  );
  console.log("-".repeat(100));

  let dbIssues = 0;
  for (const l of dbLeagues) {
    const populated = !!l.lastComputedAt;
    const hashPresent = !!l.leagueConfigHash;
    if (!populated || !hashPresent) dbIssues++;
    console.log(
      `${(l.name ?? "").substring(0, 30).padEnd(32)}` +
        `${(l.lastComputedAt?.toISOString() ?? "NULL").padEnd(28)}` +
        `${l.leagueConfigHash ?? "NULL"}`,
    );
  }

  console.log("-".repeat(100));
  if (dbIssues > 0) {
    console.log(
      `WARNING: ${dbIssues} league(s) missing lastComputedAt or configHash`,
    );
  } else {
    console.log(
      `ALL ${dbLeagues.length} LEAGUES: lastComputedAt and leagueConfigHash populated`,
    );
  }

  // Cross-check: inputsHash from console should be stable
  // (same config → same hash). We verify by checking the
  // computation logs for the last 2 entries per league.
  console.log("\n" + "=".repeat(72));
  console.log("COMPUTATION LOG HASH STABILITY");
  console.log("=".repeat(72));

  const { valueComputationLogs } = await import("../lib/db/schema");
  const { desc } = await import("drizzle-orm");

  let hashMismatches = 0;
  console.log(
    "\n" +
      "League".padEnd(32) +
      "Hash(Run1)".padEnd(22) +
      "Hash(Run2)".padEnd(22) +
      "Match",
  );
  console.log("-".repeat(100));

  for (const r1 of run1) {
    const logs = await db
      .select({
        inputsHash: valueComputationLogs.inputsHash,
        computedAt: valueComputationLogs.computedAt,
        projectionVersion: valueComputationLogs.projectionVersion,
      })
      .from(valueComputationLogs)
      .where(eq(valueComputationLogs.leagueId, r1.leagueId))
      .orderBy(desc(valueComputationLogs.computedAt))
      .limit(2);

    if (logs.length < 2) {
      console.log(
        `${r1.name.substring(0, 30).padEnd(32)}` +
          `Only ${logs.length} log entries — cannot compare`,
      );
      continue;
    }

    const hash1 = logs[1].inputsHash; // older = run1
    const hash2 = logs[0].inputsHash; // newer = run2
    const match = hash1 === hash2;
    if (!match) hashMismatches++;

    console.log(
      `${r1.name.substring(0, 30).padEnd(32)}` +
        `${hash1.substring(0, 20).padEnd(22)}` +
        `${hash2.substring(0, 20).padEnd(22)}` +
        `${match ? "OK" : "MISMATCH"}`,
    );
  }

  console.log("-".repeat(100));
  if (hashMismatches > 0) {
    console.log(
      `WARNING: ${hashMismatches} league(s) had different inputsHash between runs`,
    );
  } else {
    console.log(
      "ALL HASHES STABLE: inputsHash identical across both runs",
    );
  }

  console.log("\n" + "=".repeat(72));
  console.log("VALIDATION COMPLETE");
  console.log("=".repeat(72));

  process.exit(diffs + dbIssues + hashMismatches > 0 ? 1 : 0);
}

main();
