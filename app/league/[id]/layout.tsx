import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { LeagueLayout } from "@/components/layout/league-layout";
import { isAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

interface LayoutProps {
  children: React.ReactNode;
  params: { id: string };
}

export default async function LeagueLayoutPage({ children, params }: LayoutProps) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const admin = isAdmin(session.user.email);

  // Fetch leagues for the switcher — admins see the viewed
  // league's owner's leagues, regular users see their own.
  let userLeagues;
  if (admin) {
    // Admin: fetch the target league first, then all leagues
    // for that league's owner so the switcher works
    const [targetLeague] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, params.id))
      .limit(1);

    if (!targetLeague) {
      redirect("/dashboard");
    }

    userLeagues = await db
      .select({
        id: leagues.id,
        name: leagues.name,
        provider: leagues.provider,
      })
      .from(leagues)
      .where(eq(leagues.userId, targetLeague.userId));
  } else {
    userLeagues = await db
      .select({
        id: leagues.id,
        name: leagues.name,
        provider: leagues.provider,
      })
      .from(leagues)
      .where(eq(leagues.userId, session.user.id));
  }

  // Verify current league exists and belongs to user (or admin)
  const currentLeague = userLeagues.find((l) => l.id === params.id);

  if (!currentLeague) {
    redirect("/dashboard");
  }

  return (
    <LeagueLayout
      leagues={userLeagues}
      currentLeagueId={params.id}
      userEmail={session.user.email || ""}
    >
      {children}
    </LeagueLayout>
  );
}
