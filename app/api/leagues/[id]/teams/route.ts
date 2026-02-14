import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, teams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const [league] = await db
      .select()
      .from(leagues)
      .where(
        and(
          eq(leagues.id, params.id),
          eq(leagues.userId, session.user.id)
        )
      )
      .limit(1);

    if (!league) {
      return NextResponse.json(
        { error: "League not found" },
        { status: 404 }
      );
    }

    const leagueTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.leagueId, league.id));

    return NextResponse.json({
      teams: leagueTeams.map((t) => ({
        id: t.id,
        name: t.teamName,
        owner: t.ownerName,
      })),
    });
  } catch (error) {
    console.error("Fetch teams error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
