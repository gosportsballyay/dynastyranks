/**
 * Value Engine Diff Tool
 *
 * Snapshots player rankings before/after a value engine change and
 * produces a summary diff. Standard gate for all value engine changes.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | xargs)
 *
 *   # Step 1: Snapshot current state
 *   npx tsx scripts/value-engine-diff.ts --snapshot
 *
 *   # Step 2: Make code changes, then diff
 *   npx tsx scripts/value-engine-diff.ts --diff
 */

import { db } from "../lib/db/client";
import {
  leagues,
  leagueSettings,
  playerValues,
  canonicalPlayers,
} from "../lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import {
  computeUnifiedValues,
  ENGINE_VERSION,
} from "../lib/value-engine";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SNAPSHOT_PATH = path.join(
  os.tmpdir(),
  "value-engine-snapshot.json",
);
const TOP_N = 20;
const SIGNIFICANT_RANK_CHANGE = 10;

interface PlayerSnapshot {
  playerId: string;
  name: string;
  position: string;
  value: number;
  rankInPosition: number;
}

interface LeagueSnapshot {
  leagueId: string;
  leagueName: string;
  provider: string;
  tag: string;
  positions: Record<string, PlayerSnapshot[]>;
}

type Snapshot = LeagueSnapshot[];

/**
 * Selects a representative set of leagues from the DB.
 *
 * Picks one league per category:
 * - Sleeper with IDP
 * - Fleaflicker with IDP
 * - ESPN with IDP
 * - Non-IDP (offense-only)
 * - Superflex
 */
async function selectRepresentativeLeagues(): Promise<
  Array<{
    id: string;
    name: string;
    provider: string;
    tag: string;
  }>
> {
  const allLeagues = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      provider: leagues.provider,
      idpStructure: leagueSettings.idpStructure,
      rosterPositions: leagueSettings.rosterPositions,
    })
    .from(leagues)
    .innerJoin(
      leagueSettings,
      eq(leagues.id, leagueSettings.leagueId),
    );

  const result: Array<{
    id: string;
    name: string;
    provider: string;
    tag: string;
  }> = [];
  const used = new Set<string>();

  const hasIdp = (
    l: (typeof allLeagues)[0],
  ): boolean =>
    l.idpStructure !== "none" && l.idpStructure !== null;

  const hasSf = (
    l: (typeof allLeagues)[0],
  ): boolean => {
    const rp = l.rosterPositions ?? {};
    return (rp["SF"] ?? 0) > 0 || (rp["SUPER_FLEX"] ?? 0) > 0;
  };

  const pick = (
    filter: (l: (typeof allLeagues)[0]) => boolean,
    tag: string,
  ) => {
    const match = allLeagues.find(
      (l) => filter(l) && !used.has(l.id),
    );
    if (match) {
      result.push({
        id: match.id,
        name: match.name,
        provider: match.provider,
        tag,
      });
      used.add(match.id);
    }
  };

  // IDP leagues by provider
  pick(
    (l) => l.provider === "sleeper" && hasIdp(l),
    "Sleeper IDP",
  );
  pick(
    (l) => l.provider === "fleaflicker" && hasIdp(l),
    "Fleaflicker IDP",
  );
  pick(
    (l) => l.provider === "espn" && hasIdp(l),
    "ESPN IDP",
  );

  // Non-IDP
  pick((l) => !hasIdp(l) && !hasSf(l), "Offense-only");

  // Superflex
  pick((l) => hasSf(l), "Superflex");

  // Fallback: if we got nothing, just take first 3
  if (result.length === 0) {
    for (const l of allLeagues.slice(0, 3)) {
      result.push({
        id: l.id,
        name: l.name,
        provider: l.provider,
        tag: hasIdp(l)
          ? "IDP"
          : hasSf(l)
            ? "Superflex"
            : "Standard",
      });
    }
  }

  return result;
}

/**
 * Queries top-N players per position for a league.
 */
async function snapshotLeague(
  leagueId: string,
): Promise<Record<string, PlayerSnapshot[]>> {
  const rows = await db
    .select({
      playerId: playerValues.canonicalPlayerId,
      name: canonicalPlayers.name,
      position: canonicalPlayers.position,
      value: playerValues.value,
      rankInPosition: playerValues.rankInPosition,
    })
    .from(playerValues)
    .innerJoin(
      canonicalPlayers,
      eq(
        playerValues.canonicalPlayerId,
        canonicalPlayers.id,
      ),
    )
    .where(eq(playerValues.leagueId, leagueId))
    .orderBy(desc(playerValues.value));

  const byPos: Record<string, PlayerSnapshot[]> = {};
  for (const row of rows) {
    const pos = row.position;
    if (!byPos[pos]) byPos[pos] = [];
    if (byPos[pos].length < TOP_N) {
      byPos[pos].push({
        playerId: row.playerId,
        name: row.name,
        position: pos,
        value: row.value,
        rankInPosition: row.rankInPosition,
      });
    }
  }

  return byPos;
}

/**
 * Creates a full snapshot of representative leagues.
 */
async function createSnapshot(): Promise<Snapshot> {
  const repLeagues = await selectRepresentativeLeagues();

  console.log(
    `Selected ${repLeagues.length} representative leagues:`,
  );
  for (const l of repLeagues) {
    console.log(`  ${l.name} (${l.provider}, ${l.tag})`);
  }

  const snapshot: Snapshot = [];
  for (const l of repLeagues) {
    const positions = await snapshotLeague(l.id);
    snapshot.push({
      leagueId: l.id,
      leagueName: l.name,
      provider: l.provider,
      tag: l.tag,
      positions,
    });
  }

  return snapshot;
}

/**
 * Compares before/after snapshots and prints a summary.
 */
function printDiff(
  before: Snapshot,
  after: Snapshot,
): void {
  let totalBigMovers = 0;
  let top5Changes: string[] = [];
  const platformEffects: Record<string, number> = {};

  for (const beforeLeague of before) {
    const afterLeague = after.find(
      (a) => a.leagueId === beforeLeague.leagueId,
    );
    if (!afterLeague) {
      console.log(
        `\n--- League: ${beforeLeague.leagueName} ` +
          `(${beforeLeague.provider}, ${beforeLeague.tag}) ---`,
      );
      console.log("  [League not found in after snapshot]");
      continue;
    }

    console.log(
      `\n--- League: ${beforeLeague.leagueName} ` +
        `(${beforeLeague.provider}, ${beforeLeague.tag}) ---`,
    );

    const allPositions = new Set([
      ...Object.keys(beforeLeague.positions),
      ...Object.keys(afterLeague.positions),
    ]);

    let leagueHasMovement = false;

    for (const pos of [...allPositions].sort()) {
      const beforePlayers = beforeLeague.positions[pos] ?? [];
      const afterPlayers = afterLeague.positions[pos] ?? [];

      // Build lookup by playerId
      const beforeMap = new Map(
        beforePlayers.map((p) => [p.playerId, p]),
      );
      const afterMap = new Map(
        afterPlayers.map((p) => [p.playerId, p]),
      );

      const movers: Array<{
        name: string;
        beforeRank: number;
        afterRank: number;
        rankDelta: number;
        valueDelta: number;
      }> = [];

      // Check all players in after snapshot
      for (const [pid, ap] of afterMap) {
        const bp = beforeMap.get(pid);
        if (bp) {
          const rankDelta = bp.rankInPosition - ap.rankInPosition;
          const valueDelta = ap.value - bp.value;
          if (Math.abs(rankDelta) >= SIGNIFICANT_RANK_CHANGE) {
            movers.push({
              name: ap.name,
              beforeRank: bp.rankInPosition,
              afterRank: ap.rankInPosition,
              rankDelta,
              valueDelta,
            });
          }
        }
      }

      // Check top-5 composition change
      const beforeTop5 = new Set(
        beforePlayers
          .slice(0, 5)
          .map((p) => p.playerId),
      );
      const afterTop5 = new Set(
        afterPlayers
          .slice(0, 5)
          .map((p) => p.playerId),
      );
      const top5Same =
        beforeTop5.size === afterTop5.size &&
        [...beforeTop5].every((id) => afterTop5.has(id));

      if (movers.length > 0 || !top5Same) {
        leagueHasMovement = true;
        console.log(`  Position ${pos} (top ${TOP_N}):`);

        // Sort movers: biggest risers first, then biggest fallers
        movers.sort((a, b) => b.rankDelta - a.rankDelta);

        for (const m of movers) {
          const arrow = m.rankDelta > 0 ? "↑" : "↓";
          const sign = m.valueDelta >= 0 ? "+" : "";
          console.log(
            `    ${arrow} ${m.name.padEnd(22)} ` +
              `${pos}${m.beforeRank} → ${pos}${m.afterRank}  ` +
              `(${m.rankDelta > 0 ? "+" : ""}${m.rankDelta} ranks, ` +
              `${sign}${Math.round(m.valueDelta)} value)`,
          );
          totalBigMovers++;
        }

        if (!top5Same) {
          top5Changes.push(
            `${pos} (${beforeLeague.leagueName})`,
          );
          console.log("    [Top-5 composition changed]");
        }

        if (movers.length === 0) {
          console.log("    [No 10+ rank movers]");
        }
      } else {
        console.log(
          `  Position ${pos} (top ${TOP_N}): ` +
            `[no significant movement]`,
        );
      }
    }

    if (leagueHasMovement) {
      platformEffects[beforeLeague.provider] =
        (platformEffects[beforeLeague.provider] ?? 0) + 1;
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(
    `Total players with ${SIGNIFICANT_RANK_CHANGE}+ rank change: ` +
      `${totalBigMovers}`,
  );

  if (top5Changes.length > 0) {
    console.log(
      `Positions with top-5 composition change: ` +
        `${top5Changes.join(", ")}`,
    );
  } else {
    console.log("No top-5 composition changes.");
  }

  if (Object.keys(platformEffects).length > 0) {
    const parts = Object.entries(platformEffects)
      .map(([p, n]) => `${p} (${n})`)
      .join(", ");
    console.log(`Platforms affected: ${parts}`);
  } else {
    console.log("No platforms affected.");
  }

  if (totalBigMovers === 0 && top5Changes.length === 0) {
    console.log(
      "No unexpected category shifts detected. ✓",
    );
  }
}

async function main() {
  const mode = process.argv[2];

  if (mode === "--snapshot") {
    console.log("=== VALUE ENGINE SNAPSHOT ===\n");
    console.log(`Engine version: ${ENGINE_VERSION}`);
    const snapshot = await createSnapshot();
    fs.writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify(snapshot, null, 2),
    );
    console.log(`\nSnapshot saved to ${SNAPSHOT_PATH}`);
    console.log(
      "Make your code changes, then run with --diff",
    );
    process.exit(0);
  }

  if (mode === "--diff") {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      console.error(
        "No snapshot found. Run with --snapshot first.",
      );
      process.exit(1);
    }

    const before: Snapshot = JSON.parse(
      fs.readFileSync(SNAPSHOT_PATH, "utf-8"),
    );

    console.log("=== VALUE ENGINE DIFF ===\n");
    console.log(`Engine version: ${ENGINE_VERSION}`);

    // Recompute all representative leagues
    const leagueIds = before.map((l) => l.leagueId);
    console.log(
      `Recomputing ${leagueIds.length} leagues...`,
    );
    for (const lid of leagueIds) {
      const result = await computeUnifiedValues(lid);
      if (!result.success) {
        console.error(
          `  Failed to recompute ${lid}: ` +
            `${result.errors.join("; ")}`,
        );
      }
    }

    // Create after snapshot
    const after: Snapshot = [];
    for (const bl of before) {
      const positions = await snapshotLeague(bl.leagueId);
      after.push({
        leagueId: bl.leagueId,
        leagueName: bl.leagueName,
        provider: bl.provider,
        tag: bl.tag,
        positions,
      });
    }

    printDiff(before, after);

    // Clean up
    fs.unlinkSync(SNAPSHOT_PATH);
    console.log(`\nSnapshot cleaned up.`);
    process.exit(0);
  }

  console.error(
    "Usage: npx tsx scripts/value-engine-diff.ts " +
      "[--snapshot | --diff]",
  );
  process.exit(1);
}

main();
