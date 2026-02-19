import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, leagueSettings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { computeUnifiedValues } from "@/lib/value-engine";

const VALID_MODES = new Set([
  "auto",
  "market_anchored",
  "balanced",
  "league_driven",
]);

interface ValuationModeRequest {
  valuationMode: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body: ValuationModeRequest = await request.json();
    const { valuationMode } = body;

    if (!valuationMode || !VALID_MODES.has(valuationMode)) {
      return NextResponse.json(
        { error: "Invalid valuation mode" },
        { status: 400 },
      );
    }

    // Verify the league belongs to the user
    const [league] = await db
      .select()
      .from(leagues)
      .where(
        and(
          eq(leagues.id, params.id),
          eq(leagues.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!league) {
      return NextResponse.json(
        { error: "League not found" },
        { status: 404 },
      );
    }

    // Fetch current settings
    const [settings] = await db
      .select()
      .from(leagueSettings)
      .where(eq(leagueSettings.leagueId, league.id))
      .limit(1);

    if (!settings) {
      return NextResponse.json(
        { error: "League settings not found" },
        { status: 404 },
      );
    }

    // Merge valuationMode into metadata JSONB
    const currentMeta =
      (settings.metadata as Record<string, unknown>) ?? {};
    const updatedMeta = { ...currentMeta, valuationMode };

    await db
      .update(leagueSettings)
      .set({
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(leagueSettings.id, settings.id));

    // Trigger recompute with new blend weights
    const result = await computeUnifiedValues(league.id);

    return NextResponse.json({
      success: true,
      valuationMode,
      recompute: {
        playerCount: result.playerCount,
        durationMs: result.durationMs,
      },
    });
  } catch (error) {
    console.error("Valuation mode error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal error",
      },
      { status: 500 },
    );
  }
}
