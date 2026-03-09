import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, teams } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { syncLeagueData } from "@/lib/sync/sync-league-data";
import { computeAggregatedValues } from "@/lib/value-engine/aggregate";
import { computeUnifiedValues } from "@/lib/value-engine/compute-unified";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Provider } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed } = await checkRateLimit(session.user.id, "sync", 5, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly." },
        { status: 429 },
      );
    }

    const leagueId = params.id;

    // Verify ownership and get league details
    const [league] = await db
      .select()
      .from(leagues)
      .where(and(eq(leagues.id, leagueId), eq(leagues.userId, session.user.id)))
      .limit(1);

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Atomically mark as syncing — rejects if already syncing
    const [updated] = await db
      .update(leagues)
      .set({ syncStatus: "syncing", syncError: null })
      .where(
        and(
          eq(leagues.id, leagueId),
          ne(leagues.syncStatus, "syncing"),
        ),
      )
      .returning({ id: leagues.id });

    if (!updated) {
      return NextResponse.json(
        { error: "Sync already in progress" },
        { status: 409 },
      );
    }

    try {
      // Parse optional ESPN cookie override from body
      let espnS2: string | undefined;
      let swid: string | undefined;
      try {
        const body = await request.json();
        espnS2 = body.espnS2;
        swid = body.swid;
      } catch {
        // Empty body is fine — cookies are optional
      }

      // Re-sync (deletes old + inserts new in a transaction)
      await syncLeagueData({
        leagueId,
        provider: league.provider as Provider,
        externalLeagueId: league.externalLeagueId,
        identifier: league.externalLeagueId,
        userId: session.user.id,
        espnS2,
        swid,
        season: league.season,
        isResync: true,
      });

      // Recompute values with unified engine
      await computeAggregatedValues(leagueId);
      await computeUnifiedValues(leagueId);

      // Update sync status
      await db
        .update(leagues)
        .set({ syncStatus: "success", lastSyncedAt: new Date() })
        .where(eq(leagues.id, leagueId));

      // Fetch teams for response
      const newTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.leagueId, leagueId));

      return NextResponse.json({
        success: true,
        message: "League synced successfully",
        teams: newTeams.map((t) => ({
          id: t.id,
          name: t.teamName,
          owner: t.ownerName,
        })),
      });
    } catch (syncError) {
      console.error("Sync error:", syncError);

      await db
        .update(leagues)
        .set({
          syncStatus: "failed",
          syncError: syncError instanceof Error ? syncError.message : "Sync failed",
        })
        .where(eq(leagues.id, leagueId));

      return NextResponse.json(
        { error: syncError instanceof Error ? syncError.message : "Sync failed" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Sync league error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

