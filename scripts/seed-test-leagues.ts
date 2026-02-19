#!/usr/bin/env tsx
/**
 * Seed test leagues for the Test02-2026 user.
 *
 * Creates the user (or finds existing), connects 12 diverse
 * Sleeper dynasty leagues, syncs data, and computes values.
 */

import { db } from "../lib/db/client";
import {
  users,
  leagues,
  leagueSettings,
  teams,
  rosters,
  draftPicks,
  rawPayloads,
} from "../lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createSleeperAdapter } from "../lib/adapters";
import { getPlayersByProviderIds } from "../lib/player-mapping";
import { computeAggregatedValues } from "../lib/value-engine/aggregate";
import { computeUnifiedValues } from "../lib/value-engine/compute-unified";
import { randomUUID } from "crypto";

// 12 leagues chosen for format diversity
const TARGET_LEAGUES = [
  // 6t  | IDP(2)  | TEP | non-SF
  { id: "1257115661486804993", name: "Boom or Bust", via: "DrParger" },
  // 8t  | non-IDP | non-TEP | non-SF
  { id: "1194499206747930624", name: "Heads Will Roll", via: "ManaLeak" },
  // 10t | IDP(12) | TEP | SF
  { id: "1277695347002474496", name: "Full Spectrum League", via: "strategysavage" },
  // 10t | non-IDP | TEP | SF
  { id: "1178824408348856320", name: "Real Man's Football", via: "bhandlez" },
  // 12t | IDP(11) | TEP | SF
  { id: "1193234676063137792", name: "DFL", via: "NinerJay" },
  // 12t | non-IDP | TEP | SF
  { id: "1180238573755572224", name: "The Yuk", via: "SlightlyJason" },
  // 14t | non-IDP | TEP | SF
  { id: "1184185593402159104", name: "NFL Contraction League", via: "SlightlyJason" },
  // 14t | non-IDP | TEP | SF
  { id: "1180235073928445952", name: "Chilly Willy Nut Dust", via: "Illinihoops" },
  // 16t | IDP(14) | TEP | SF
  { id: "1187790426106163200", name: "SuperSetSixteen", via: "PADeviLL" },
  // 16t | non-IDP | TEP | non-SF
  { id: "1202328515500834816", name: "The Empire Strikes Back", via: "ManaLeak" },
  // 24t | non-IDP | TEP | SF
  { id: "1221861025108738048", name: "dynoBall Survivor S1:E3", via: "ManaLeak" },
  // 32t | IDP(8)  | TEP | SF
  { id: "1185414429298802688", name: "Zeus League", via: "PADeviLL" },
];

async function getOrCreateUser(): Promise<string> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, "test02@dynastyranks.dev"))
    .limit(1);

  if (existing) {
    console.log(`Found existing user: ${existing.id}`);
    return existing.id;
  }

  const [newUser] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: "test02@dynastyranks.dev",
      name: "Test02-2026",
      passwordHash: "test-account-no-login",
    })
    .returning();

  console.log(`Created user: ${newUser.id}`);
  return newUser.id;
}

async function connectLeague(
  userId: string,
  leagueExtId: string,
  leagueName: string,
  via: string,
): Promise<boolean> {
  // Check if already connected
  const [existing] = await db
    .select()
    .from(leagues)
    .where(
      and(
        eq(leagues.userId, userId),
        eq(leagues.provider, "sleeper"),
        eq(leagues.externalLeagueId, leagueExtId),
      ),
    )
    .limit(1);

  if (existing) {
    console.log(`  [SKIP] Already connected: ${leagueName}`);
    return false;
  }

  // Fetch league info from Sleeper
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${leagueExtId}`,
  );
  const data = (await res.json()) as {
    name: string;
    settings: { num_teams: number };
    season: string;
  };

  const season = parseInt(data.season, 10) || 2025;

  // Create league record
  const [newLeague] = await db
    .insert(leagues)
    .values({
      userId,
      provider: "sleeper",
      externalLeagueId: leagueExtId,
      name: data.name || leagueName,
      season: season + 1, // rankings season
      totalTeams: data.settings.num_teams,
      draftType: "dynasty",
      syncStatus: "syncing",
    })
    .returning();

  // Sync data using adapter
  const adapter = createSleeperAdapter(via);

  const settings = await adapter.getLeagueSettings(leagueExtId);
  await db.insert(leagueSettings).values({
    leagueId: newLeague.id,
    scoringRules: settings.scoringRules,
    positionScoringOverrides: settings.positionScoringOverrides,
    rosterPositions: settings.rosterPositions,
    flexRules: settings.flexRules,
    positionMappings: settings.positionMappings,
    idpStructure: settings.idpStructure,
    benchSlots: settings.benchSlots,
    taxiSlots: settings.taxiSlots,
    irSlots: settings.irSlots,
    metadata: settings.metadata,
  });

  const adapterTeams = await adapter.getTeams(leagueExtId);
  const insertedTeams = await db
    .insert(teams)
    .values(
      adapterTeams.map((t) => ({
        leagueId: newLeague.id,
        externalTeamId: t.externalTeamId,
        ownerName: t.ownerName,
        teamName: t.teamName,
        standingRank: t.standingRank,
        totalPoints: t.totalPoints,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
      })),
    )
    .returning();

  const teamIdMap = new Map<string, string>();
  for (const team of insertedTeams) {
    teamIdMap.set(team.externalTeamId, team.id);
  }

  const adapterPlayers = await adapter.getRosters(leagueExtId);
  const externalPlayerIds = adapterPlayers.map(
    (p) => p.externalPlayerId,
  );
  const playerInfoMap = new Map<
    string,
    { name: string; position: string }
  >();
  for (const p of adapterPlayers) {
    playerInfoMap.set(p.externalPlayerId, {
      name: p.playerName || "",
      position: p.playerPosition || "",
    });
  }
  const playerMap = await getPlayersByProviderIds(
    "sleeper",
    externalPlayerIds,
    playerInfoMap,
  );

  if (adapterPlayers.length > 0) {
    await db.insert(rosters).values(
      adapterPlayers.map((p) => ({
        teamId: teamIdMap.get(p.teamExternalId)!,
        canonicalPlayerId: playerMap.get(p.externalPlayerId)?.id || null,
        externalPlayerId: p.externalPlayerId,
        slotPosition: p.slotPosition,
        playerName: p.playerName,
        playerPosition: p.playerPosition,
      })),
    );
  }

  const adapterPicks = await adapter.getDraftPicks(leagueExtId);
  if (adapterPicks.length > 0) {
    await db.insert(draftPicks).values(
      adapterPicks.map((p) => ({
        leagueId: newLeague.id,
        ownerTeamId: teamIdMap.get(p.ownerTeamExternalId)!,
        originalTeamId: p.originalTeamExternalId
          ? teamIdMap.get(p.originalTeamExternalId)
          : null,
        season: p.season,
        round: p.round,
        pickNumber: p.pickNumber,
      })),
    );
  }

  adapter.clearRawPayloads();

  // Update sync status
  await db
    .update(leagues)
    .set({ syncStatus: "success", lastSyncedAt: new Date() })
    .where(eq(leagues.id, newLeague.id));

  // Compute values
  await computeAggregatedValues(newLeague.id);
  const result = await computeUnifiedValues(newLeague.id);

  console.log(
    `  [OK] ${data.name} (${data.settings.num_teams}t) → ${result.playerCount} values (${result.durationMs}ms)`,
  );

  return true;
}

async function main() {
  console.log("=== Seed Test Leagues ===\n");

  const userId = await getOrCreateUser();
  let connected = 0;
  let failed = 0;

  for (const league of TARGET_LEAGUES) {
    console.log(`\nConnecting: ${league.name}...`);
    try {
      const isNew = await connectLeague(
        userId,
        league.id,
        league.name,
        league.via,
      );
      if (isNew) connected++;
    } catch (err) {
      failed++;
      console.log(
        `  [FAIL] ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `\n=== Done: ${connected} connected, ${failed} failed ===`,
  );
}

main();
