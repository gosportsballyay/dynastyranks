import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { users, leagues, userFeedback } from "@/lib/db/schema";
import { count, desc, sql, eq } from "drizzle-orm";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (
    ADMIN_EMAILS.length > 0 &&
    !ADMIN_EMAILS.includes(
      (session.user.email ?? "").toLowerCase(),
    )
  ) {
    notFound();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [allUsers, leagueCounts, feedback, feedbackTotal] =
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
          userId: leagues.userId,
          count: count(),
        })
        .from(leagues)
        .groupBy(leagues.userId),
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

  const leagueCountMap = new Map(
    leagueCounts.map((r) => [r.userId, r.count]),
  );

  const userEmailMap = new Map(
    allUsers.map((u) => [u.id, u.email]),
  );

  const totalUsers = allUsers.length;
  const signupsToday = allUsers.filter(
    (u) => u.createdAt >= today,
  ).length;
  const totalLeagues = leagueCounts.reduce(
    (sum, r) => sum + r.count,
    0,
  );
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
                  <th className="text-right px-4 py-3">
                    Leagues
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {allUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {u.email}
                    </td>
                    <td className="px-4 py-2 text-slate-300">
                      {u.name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-400">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-slate-400">
                      {u.lastLoginAt
                        ? formatDate(u.lastLoginAt)
                        : "Never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {leagueCountMap.get(u.id) ?? 0}
                    </td>
                  </tr>
                ))}
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
                        {formatDate(f.createdAt)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {userEmailMap.get(f.userId) ??
                          f.userId}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {f.page ? (
                          <a
                            href={f.page}
                            className="text-blue-400 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {f.page.replace(/^\/league\/[^/]+/, "…")}
                          </a>
                        ) : (
                          "—"
                        )}
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

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
