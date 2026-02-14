/**
 * Debug API Route - League Data Extraction
 *
 * Fetches and returns raw league data from Fleaflicker or Sleeper
 * for verification purposes. No auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { createFleaflickerAdapter } from "@/lib/adapters/fleaflicker";
import { SleeperAdapter } from "@/lib/adapters/sleeper";
import type { AdapterSettings, RawPayload } from "@/types";

interface DebugResponse {
  platform: string;
  leagueId: string;
  settings: AdapterSettings | null;
  rawPayloads: RawPayload[];
  error?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const platform = searchParams.get("platform");
  const leagueId = searchParams.get("leagueId");

  if (!platform || !leagueId) {
    return NextResponse.json(
      { error: "Missing required params: platform, leagueId" },
      { status: 400 }
    );
  }

  if (!["fleaflicker", "sleeper"].includes(platform)) {
    return NextResponse.json(
      { error: "Platform must be 'fleaflicker' or 'sleeper'" },
      { status: 400 }
    );
  }

  const response: DebugResponse = {
    platform,
    leagueId,
    settings: null,
    rawPayloads: [],
  };

  try {
    if (platform === "fleaflicker") {
      const adapter = createFleaflickerAdapter();
      response.settings = await adapter.getLeagueSettings(leagueId);
      response.rawPayloads = adapter.getRawPayloads();
    } else if (platform === "sleeper") {
      // For Sleeper, we can fetch league settings directly with just the league ID
      // Create adapter with a dummy username since we're not listing user leagues
      const adapter = new SleeperAdapter({ username: "_debug_" });
      response.settings = await adapter.getLeagueSettings(leagueId);
      response.rawPayloads = adapter.getRawPayloads();
    }

    return NextResponse.json(response);
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
    return NextResponse.json(response, { status: 500 });
  }
}
