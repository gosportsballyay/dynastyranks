/**
 * Find dynasty leagues from Sleeper usernames.
 *
 * Uses the raw Sleeper API to discover dynasty leagues (type=2)
 * from users found in existing connected leagues.
 */

const usernames = [
  "SlightlyJason", "NinerJay", "strategysavage",
  "bhandlez", "BlakeBhop", "halek28", "DrParger",
  "ADanishMan", "kdhazey", "mthofmann88",
  "ace5869", "Cruzn27", "ManaLeak", "PADeviLL",
  "Illinihoops", "CubswinTX", "bigbluetexan72",
];

interface SleeperUser {
  user_id: string;
}

interface SleeperLeague {
  league_id: string;
  name: string;
  settings: { type: number; num_teams: number };
  previous_league_id: string | null;
}

async function findDynasty(
  username: string,
): Promise<
  Array<{ id: string; name: string; teams: number; hasPrev: boolean }>
> {
  const userRes = await fetch(
    `https://api.sleeper.app/v1/user/${username}`,
  );
  if (userRes.status !== 200) return [];
  const user = (await userRes.json()) as SleeperUser;

  const leaguesRes = await fetch(
    `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`,
  );
  const leagues = (await leaguesRes.json()) as SleeperLeague[];

  return leagues
    .filter((l) => l.settings.type === 2)
    .map((l) => ({
      id: l.league_id,
      name: l.name,
      teams: l.settings.num_teams,
      hasPrev: l.previous_league_id !== null,
    }));
}

async function main() {
  const seen = new Set<string>();
  // Exclude already-connected leagues
  seen.add("1312945123855720448"); // Top Dawg
  seen.add("1312151895581671424"); // One League to Rule Them All

  const results: Array<{
    id: string;
    name: string;
    teams: number;
    hasPrev: boolean;
    foundVia: string;
  }> = [];

  for (const u of usernames) {
    const dynastyLeagues = await findDynasty(u);
    const newCount = dynastyLeagues.filter(
      (l) => !seen.has(l.id),
    ).length;
    console.log(
      `${u.padEnd(20)}: ${dynastyLeagues.length} dynasty, ${newCount} new`,
    );

    for (const l of dynastyLeagues) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      results.push({ ...l, foundVia: u });
      console.log(
        `  ${l.id.padEnd(22)} | ${l.name.padEnd(45)} | ${l.teams}t${l.hasPrev ? " [multi-yr]" : ""}`,
      );
    }
  }

  console.log(`\n=== Found ${results.length} unique dynasty leagues ===`);
  for (const r of results) {
    console.log(
      `${r.id} | ${r.name} | ${r.teams}t | via ${r.foundVia}`,
    );
  }
}

main();
