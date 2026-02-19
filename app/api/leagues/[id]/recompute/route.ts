import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { computeUnifiedValues, ENGINE_VERSION } from "@/lib/value-engine";

/**
 * Recompute player values for a league.
 *
 * Runs the unified value engine without re-syncing platform data.
 * Use this when the engine version changes or blend weights update.
 */
export async function POST(
  _request: NextRequest,
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

    const result = await computeUnifiedValues(league.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.errors.join(", ") },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      playerCount: result.playerCount,
      durationMs: result.durationMs,
      engineVersion: ENGINE_VERSION,
    });
  } catch (error) {
    console.error("Recompute error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Internal error",
      },
      { status: 500 },
    );
  }
}
