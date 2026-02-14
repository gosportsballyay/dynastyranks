import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { LeagueLayout } from "@/components/layout/league-layout";

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

  // Fetch all user's leagues for the switcher
  const userLeagues = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      provider: leagues.provider,
    })
    .from(leagues)
    .where(eq(leagues.userId, session.user.id));

  // Verify current league exists and belongs to user
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
