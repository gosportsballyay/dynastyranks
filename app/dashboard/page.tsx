export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth/config";
import Link from "next/link";
import { db } from "@/lib/db/client";
import {
  leagues,
  leagueSettings,
  valueComputationLogs,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { FeedbackButton } from "@/components/feedback-button";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Fetch user's leagues with settings for format detection
  const leagueRows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      provider: leagues.provider,
      season: leagues.season,
      totalTeams: leagues.totalTeams,
      syncStatus: leagues.syncStatus,
      lastSyncedAt: leagues.lastSyncedAt,
      lastComputedAt: leagues.lastComputedAt,
      leagueConfigHash: leagues.leagueConfigHash,
      idpStructure: leagueSettings.idpStructure,
      rosterPositions: leagueSettings.rosterPositions,
    })
    .from(leagues)
    .leftJoin(
      leagueSettings,
      eq(leagueSettings.leagueId, leagues.id),
    )
    .where(eq(leagues.userId, session.user.id));

  // Fetch latest computation log per league for version info
  const logRows = await db
    .select({
      leagueId: valueComputationLogs.leagueId,
      engineVersion: valueComputationLogs.engineVersion,
      projectionVersion: valueComputationLogs.projectionVersion,
    })
    .from(valueComputationLogs)
    .orderBy(desc(valueComputationLogs.computedAt));

  const logMap = new Map<
    string,
    { engineVersion: string; projectionVersion: string | null }
  >();
  for (const log of logRows) {
    if (!logMap.has(log.leagueId)) {
      logMap.set(log.leagueId, {
        engineVersion: log.engineVersion,
        projectionVersion: log.projectionVersion,
      });
    }
  }

  // Build enriched league list
  const userLeagues = leagueRows.map((l) => {
    const rp = (l.rosterPositions ?? {}) as Record<string, number>;
    const hasSF =
      (rp["SUPERFLEX"] ?? 0) > 0 ||
      (rp["SUPER_FLEX"] ?? 0) > 0 ||
      (rp["SF"] ?? 0) > 0 ||
      (rp["QB"] ?? 0) >= 2;
    const hasIdp =
      !!l.idpStructure && l.idpStructure !== "none";
    const log = logMap.get(l.id);

    const formatParts: string[] = [
      `${l.totalTeams}-team`,
    ];
    if (hasSF) formatParts.push("SF");
    if (hasIdp) formatParts.push("IDP");

    return {
      ...l,
      format: formatParts.join(" "),
      engineVersion: log?.engineVersion ?? null,
      projectionVersion: log?.projectionVersion ?? null,
    };
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800">
      <nav className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-white">
                DynastyRanks
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-300">{session.user.email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="text-slate-300 hover:text-white transition-colors"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white">My Leagues</h1>
          <Link
            href="/dashboard/connect"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            Connect League
          </Link>
        </div>

        {userLeagues.length === 0 ? (
          <div className="text-center py-16">
            <div className="mx-auto w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center mb-4">
              <svg
                className="w-12 h-12 text-slate-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              No leagues connected
            </h2>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Connect your Sleeper or Fleaflicker league to get started with
              league-specific dynasty rankings.
            </p>
            <Link
              href="/dashboard/connect"
              className="inline-flex items-center rounded-md bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Connect Your First League
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {userLeagues.map((league) => (
              <Link
                key={league.id}
                href={`/league/${league.id}/summary`}
                className="block rounded-xl bg-slate-800/50 p-6 ring-1 ring-slate-700 hover:ring-blue-500 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {league.name}
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                      {league.provider.charAt(0).toUpperCase() +
                        league.provider.slice(1)}{" "}
                      &bull; {league.season} &bull; {league.format}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      league.syncStatus === "success"
                        ? "bg-green-500/10 text-green-400"
                        : league.syncStatus === "syncing"
                          ? "bg-yellow-500/10 text-yellow-400"
                          : league.syncStatus === "failed"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-slate-500/10 text-slate-400"
                    }`}
                  >
                    {league.syncStatus === "success"
                      ? "Synced"
                      : league.syncStatus === "syncing"
                        ? "Syncing..."
                        : league.syncStatus === "failed"
                          ? "Sync Failed"
                          : "Pending"}
                  </span>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500 space-y-1">
                  {league.lastComputedAt ? (
                    <>
                      <div className="flex justify-between">
                        <span>Last computed</span>
                        <span className="text-slate-400">
                          {new Date(league.lastComputedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Engine</span>
                        <span className="text-slate-400 font-mono">
                          v{league.engineVersion ?? "?"}
                          {league.projectionVersion
                            ? ` / proj v${league.projectionVersion}`
                            : ""}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-600">
                      Not yet computed
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <FeedbackButton />
    </div>
  );
}
