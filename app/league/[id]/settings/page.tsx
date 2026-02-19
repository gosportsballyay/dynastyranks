export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, teams, leagueSettings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { TeamSelector } from "./team-selector";
import { ValuationModeSelector } from "./valuation-mode-selector";
import { LeagueActions } from "./league-actions";

interface PageProps {
  params: { id: string };
}

export default async function LeagueSettingsPage({ params }: PageProps) {
  const session = await auth();

  if (!session?.user) {
    notFound();
  }

  // Fetch league
  const [league] = await db
    .select()
    .from(leagues)
    .where(and(eq(leagues.id, params.id), eq(leagues.userId, session!.user.id)))
    .limit(1);

  if (!league) {
    notFound();
  }

  // Fetch teams and settings in parallel
  const [leagueTeams, [settings]] = await Promise.all([
    db.select().from(teams).where(eq(teams.leagueId, league.id)),
    db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, league.id))
      .limit(1),
  ]);

  const currentValuationMode =
    ((settings?.metadata as Record<string, unknown> | null)
      ?.valuationMode as string) ?? "auto";

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">League Settings</h1>

      <div className="space-y-6">
        {/* Team Selection */}
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">My Team</h2>
          {leagueTeams.length > 0 ? (
            <>
              <p className="text-slate-400 text-sm mb-4">
                Select which team is yours in this league. This determines what shows
                on the &quot;My Team&quot; page.
              </p>
              <TeamSelector
                leagueId={league.id}
                teams={leagueTeams.map((t) => ({
                  id: t.id,
                  name: t.teamName,
                  owner: t.ownerName,
                }))}
                currentTeamId={league.userTeamId}
              />
            </>
          ) : (
            <p className="text-slate-400 text-sm">
              No teams found. Use &quot;Force Re-sync&quot; below to fetch league data.
            </p>
          )}
        </div>

        {/* League Info */}
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">League Info</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-slate-400">Name</dt>
              <dd className="text-white">{league.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Platform</dt>
              <dd className="text-white capitalize">{league.provider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Season</dt>
              <dd className="text-white">{league.season}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Teams</dt>
              <dd className="text-white">{league.totalTeams}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Sync Status</dt>
              <dd className={`${
                league.syncStatus === "success" ? "text-green-400" :
                league.syncStatus === "failed" ? "text-red-400" :
                league.syncStatus === "syncing" ? "text-blue-400" :
                "text-slate-400"
              }`}>
                {league.syncStatus || "Never synced"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Last Synced</dt>
              <dd className="text-white">
                {league.lastSyncedAt
                  ? new Date(league.lastSyncedAt).toLocaleString()
                  : "Never"}
              </dd>
            </div>
            {league.syncError && (
              <div className="pt-2 border-t border-slate-700">
                <dt className="text-red-400 text-sm">Last Error</dt>
                <dd className="text-red-300 text-sm mt-1">{league.syncError}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Valuation Emphasis */}
        <div className="bg-slate-800/50 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Valuation Emphasis
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Control how player values blend market consensus with your
            league&apos;s specific scoring. Changing this recomputes all values.
          </p>
          <ValuationModeSelector
            leagueId={league.id}
            currentMode={currentValuationMode as "auto" | "market_anchored" | "balanced" | "league_driven"}
          />
        </div>

        {/* League Actions (Sync & Delete) */}
        <LeagueActions
          leagueId={league.id}
          leagueName={league.name}
          syncStatus={league.syncStatus || "pending"}
        />
      </div>
    </div>
  );
}
