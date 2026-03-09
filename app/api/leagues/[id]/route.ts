import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, leagueSettings, teams, rosters, draftPicks, playerValues } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leagueId = params.id;

    // Verify ownership
    const [league] = await db
      .select()
      .from(leagues)
      .where(and(eq(leagues.id, leagueId), eq(leagues.userId, session.user.id)))
      .limit(1);

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Delete all league data in a single transaction
    await db.transaction(async (tx) => {
      await tx.delete(playerValues).where(eq(playerValues.leagueId, leagueId));
      await tx.delete(draftPicks).where(eq(draftPicks.leagueId, leagueId));

      const leagueTeams = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.leagueId, leagueId));
      for (const team of leagueTeams) {
        await tx.delete(rosters).where(eq(rosters.teamId, team.id));
      }

      await tx.delete(teams).where(eq(teams.leagueId, leagueId));
      await tx
        .delete(leagueSettings)
        .where(eq(leagueSettings.leagueId, leagueId));
      await tx.delete(leagues).where(eq(leagues.id, leagueId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete league error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete league" },
      { status: 500 }
    );
  }
}
