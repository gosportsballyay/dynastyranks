import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { userFeedback } from "@/lib/db/schema";

/** Capture user feedback. */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { message, leagueId, engineVersion, page } = body;

    if (
      typeof message !== "string" ||
      message.trim().length < 5
    ) {
      return NextResponse.json(
        { error: "Message must be at least 5 characters." },
        { status: 400 },
      );
    }

    await db.insert(userFeedback).values({
      userId: session.user.id,
      leagueId: leagueId ?? null,
      engineVersion: engineVersion ?? null,
      message: message.trim(),
      page: page ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Feedback error:", error);
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
