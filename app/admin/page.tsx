import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { isAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { users, leagues, userFeedback } from "@/lib/db/schema";
import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!isAdmin(session.user.email)) {
    notFound();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [allUsers, allLeagues, feedback, feedbackTotal] =
    await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt)),
      db
        .select({
          id: leagues.id,
          userId: leagues.userId,
          name: leagues.name,
          provider: leagues.provider,
          totalTeams: leagues.totalTeams,
          season: leagues.season,
        })
        .from(leagues),
      db
        .select({
          id: userFeedback.id,
          userId: userFeedback.userId,
          message: userFeedback.message,
          page: userFeedback.page,
          createdAt: userFeedback.createdAt,
        })
        .from(userFeedback)
        .orderBy(desc(userFeedback.createdAt)),
      db
        .select({ count: count() })
        .from(userFeedback),
    ]);

  // Group leagues by user
  const userLeaguesMap = new Map<
    string,
    Array<{ id: string; name: string; provider: string; totalTeams: number; season: number }>
  >();
  for (const l of allLeagues) {
    const existing = userLeaguesMap.get(l.userId) ?? [];
    existing.push(l);
    userLeaguesMap.set(l.userId, existing);
  }

  const userEmailMap = new Map(
    allUsers.map((u) => [u.id, u.email]),
  );

  const totalUsers = allUsers.length;
  const signupsToday = allUsers.filter(
    (u) => u.createdAt >= today,
  ).length;
  const totalLeagues = allLeagues.length;
  const totalFeedback = feedbackTotal[0]?.count ?? 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-slate-400 mt-1">
            Beta user activity &amp; feedback
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Users" value={totalUsers} />
          <StatCard
            label="Signups Today"
            value={signupsToday}
          />
          <StatCard
            label="Leagues Connected"
            value={totalLeagues}
          />
          <StatCard
            label="Feedback Submissions"
            value={totalFeedback}
          />
        </div>

        {/* Users table */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Users</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/80 text-slate-300">
                <tr>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">
                    Signed Up
                  </th>
                  <th className="text-left px-4 py-3">
                    Last Login
                  </th>
                  <th className="text-left px-4 py-3">
                    Leagues
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {allUsers.map((u) => {
                  const userLeagues =
                    userLeaguesMap.get(u.id) ?? [];
                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-slate-800/40 align-top"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {u.email}
                      </td>
                      <td className="px-4 py-2 text-slate-300">
                        {u.name ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {formatDateTime(u.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {u.lastLoginAt
                          ? formatDateTime(u.lastLoginAt)
                          : "Never"}
                      </td>
                      <td className="px-4 py-2">
                        {userLeagues.length === 0 ? (
                          <span className="text-slate-500">
                            None
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {userLeagues.map((l) => (
                              <Link
                                key={l.id}
                                href={`/league/${l.id}/rankings`}
                                className="group flex items-center gap-1.5 text-xs hover:text-blue-400 transition-colors"
                              >
                                <ProviderBadge
                                  provider={l.provider}
                                />
                                <span className="text-slate-300 group-hover:text-blue-400 truncate max-w-[200px]">
                                  {l.name}
                                </span>
                                <span className="text-slate-500">
                                  {l.totalTeams}T
                                </span>
                              </Link>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Feedback table */}
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Feedback
          </h2>
          {feedback.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No feedback yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/80 text-slate-300">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Page</th>
                    <th className="text-left px-4 py-3">
                      Message
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {feedback.map((f) => (
                    <tr
                      key={f.id}
                      className="hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {formatDateTime(f.createdAt)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {userEmailMap.get(f.userId) ??
                          f.userId}
                      </td>
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs">
                        {f.page
                          ? f.page.replace(
                              /\/league\/[a-f0-9-]+/,
                              "/league/…"
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-300 max-w-xl">
                        {f.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    sleeper: "bg-purple-500/20 text-purple-300",
    fleaflicker: "bg-green-500/20 text-green-300",
    espn: "bg-red-500/20 text-red-300",
    yahoo: "bg-violet-500/20 text-violet-300",
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${colors[provider] ?? "bg-slate-700 text-slate-300"}`}
    >
      {provider}
    </span>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <p className="text-slate-400 text-sm">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
