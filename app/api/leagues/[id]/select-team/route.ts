import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, teams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface SelectTeamRequest {
  teamId: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: SelectTeamRequest = await request.json();
    const { teamId } = body;

    if (!teamId) {
      return NextResponse.json(
        { error: "Team ID is required" },
        { status: 400 }
      );
    }

    // Verify the league belongs to the user
    const [league] = await db
      .select()
      .from(leagues)
      .where(
        and(eq(leagues.id, params.id), eq(leagues.userId, session.user.id))
      )
      .limit(1);

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Verify the team belongs to this league
    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.leagueId, league.id)))
      .limit(1);

    if (!team) {
      return NextResponse.json(
        { error: "Team not found in this league" },
        { status: 404 }
      );
    }

    // Update the league with the selected team
    await db
      .update(leagues)
      .set({ userTeamId: teamId, updatedAt: new Date() })
      .where(eq(leagues.id, league.id));

    return NextResponse.json({
      success: true,
      teamId,
      teamName: team.teamName,
    });
  } catch (error) {
    console.error("Select team error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
