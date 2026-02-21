import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { computeUnifiedValues, ENGINE_VERSION } from "@/lib/value-engine";
import { checkRateLimit } from "@/lib/rate-limit";

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

    const { allowed } = await checkRateLimit(
      session.user.id, "recompute", 10, 60,
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly." },
        { status: 429 },
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

    // Per-league daily recompute cap (5/day)
    const todayUTC = new Date().toISOString().slice(0, 10);
    const isNewDay = league.recomputeDate !== todayUTC;
    const currentCount = isNewDay ? 0 : league.recomputeCountToday;

    if (currentCount >= 5) {
      return NextResponse.json(
        {
          error:
            "Daily recompute limit reached. Try again tomorrow.",
        },
        { status: 429 },
      );
    }

    await db
      .update(leagues)
      .set({
        recomputeCountToday: currentCount + 1,
        recomputeDate: todayUTC,
      })
      .where(eq(leagues.id, league.id));

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
