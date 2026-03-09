import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { leagues, teams, userTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  createSleeperAdapter,
  createFleaflickerAdapter,
  createESPNAdapter,
  createYahooAdapter,
} from "@/lib/adapters";
import { syncLeagueData } from "@/lib/sync/sync-league-data";
import { computeAggregatedValues } from "@/lib/value-engine/aggregate";
import { computeUnifiedValues } from "@/lib/value-engine/compute-unified";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Provider, AdapterLeague } from "@/types";

interface ConnectRequest {
  provider: Provider;
  identifier: string;
  season: number;
  leagueId?: string; // For Sleeper, optional league selection
  // ESPN-specific
  espnS2?: string;   // espn_s2 cookie for private leagues
  swid?: string;     // SWID cookie for private leagues
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowed } = await checkRateLimit(session.user.id, "connect", 5, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly." },
        { status: 429 },
      );
    }

    const body: ConnectRequest = await request.json();
    const { provider, identifier, season, leagueId } = body;

    // Validate input
    if (
      !provider ||
      !identifier ||
      typeof identifier !== "string" ||
      identifier.trim().length === 0 ||
      !season
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    let targetLeague: AdapterLeague | null = null;
    let externalLeagueId: string;

    // Handle provider-specific logic
    if (provider === "sleeper") {
      const adapter = createSleeperAdapter(identifier);

      // Get user's leagues
      const userLeagues = await adapter.getUserLeagues(season);

      if (userLeagues.length === 0) {
        return NextResponse.json(
          { error: `No leagues found for user "${identifier}" in ${season}` },
          { status: 404 }
        );
      }

      // If multiple leagues and no specific one selected, return list
      if (userLeagues.length > 1 && !leagueId) {
        return NextResponse.json({
          selectLeague: true,
          leagues: userLeagues.map((l) => ({
            id: l.externalLeagueId,
            name: l.name,
            teams: l.totalTeams,
          })),
        });
      }

      // Select the league
      if (leagueId) {
        targetLeague =
          userLeagues.find((l) => l.externalLeagueId === leagueId) || null;
      } else {
        targetLeague = userLeagues[0];
      }

      if (!targetLeague) {
        return NextResponse.json({ error: "League not found" }, { status: 404 });
      }

      externalLeagueId = targetLeague.externalLeagueId;
    } else if (provider === "fleaflicker") {
      const adapter = createFleaflickerAdapter();

      // For Fleaflicker, the identifier IS the league ID
      targetLeague = await adapter.getLeagueById(identifier, season);

      if (!targetLeague) {
        return NextResponse.json(
          { error: `League ${identifier} not found on Fleaflicker` },
          { status: 404 }
        );
      }

      externalLeagueId = identifier;
    } else if (provider === "espn") {
      // ESPN: identifier is the league ID, optionally with cookies for private leagues
      const adapter = createESPNAdapter({
        espnS2: body.espnS2,
        swid: body.swid,
        leagueId: identifier,
        season,
      });

      targetLeague = await adapter.getLeagueById(identifier, season);

      if (!targetLeague) {
        return NextResponse.json(
          { error: `League ${identifier} not found on ESPN. For private leagues, provide espn_s2 and SWID cookies.` },
          { status: 404 }
        );
      }

      externalLeagueId = identifier;

      // Persist ESPN cookies for re-sync
      if (body.espnS2 && body.swid) {
        await db
          .insert(userTokens)
          .values({
            userId: session.user.id,
            provider: "espn",
            accessToken: body.espnS2,
            refreshToken: body.swid,
          })
          .onConflictDoUpdate({
            target: [userTokens.userId, userTokens.provider],
            set: {
              accessToken: body.espnS2,
              refreshToken: body.swid,
              updatedAt: new Date(),
            },
          });
      }
    } else if (provider === "yahoo") {
      // Yahoo: must have OAuth token stored first
      const [token] = await db
        .select()
        .from(userTokens)
        .where(
          and(
            eq(userTokens.userId, session.user.id),
            eq(userTokens.provider, "yahoo")
          )
        )
        .limit(1);

      if (!token) {
        return NextResponse.json(
          { error: "Yahoo not connected. Please authorize with Yahoo first.", requiresOAuth: true },
          { status: 400 }
        );
      }

      const adapter = createYahooAdapter({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken || undefined,
        expiresAt: token.expiresAt || undefined,
        onTokenRefresh: async (tokens) => {
          // Save refreshed tokens to database
          await db
            .update(userTokens)
            .set({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: tokens.expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(userTokens.id, token.id));
        },
      });

      // If no league ID specified, get user's leagues for selection
      if (!leagueId) {
        const userLeagues = await adapter.getUserLeagues(season);

        if (userLeagues.length === 0) {
          return NextResponse.json(
            { error: `No Yahoo leagues found for ${season}` },
            { status: 404 }
          );
        }

        if (userLeagues.length > 1) {
          return NextResponse.json({
            selectLeague: true,
            leagues: userLeagues.map((l) => ({
              id: l.externalLeagueId,
              name: l.name,
              teams: l.totalTeams,
            })),
          });
        }

        targetLeague = userLeagues[0];
      } else {
        targetLeague = await adapter.getLeagueById(leagueId, season);
      }

      if (!targetLeague) {
        return NextResponse.json(
          { error: `Yahoo league not found` },
          { status: 404 }
        );
      }

      externalLeagueId = targetLeague.externalLeagueId;
    } else {
      return NextResponse.json(
        { error: `Provider "${provider}" not supported` },
        { status: 400 }
      );
    }

    // Check if league already connected
    const [existingLeague] = await db
      .select()
      .from(leagues)
      .where(
        and(
          eq(leagues.userId, session.user.id),
          eq(leagues.provider, provider),
          eq(leagues.externalLeagueId, externalLeagueId),
          eq(leagues.season, season)
        )
      )
      .limit(1);

    if (existingLeague) {
      // Return teams so the user can still select their team
      const existingTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.leagueId, existingLeague.id));

      return NextResponse.json({
        leagueId: existingLeague.id,
        message: "League already connected",
        selectTeam: true,
        teams: existingTeams.map((t) => ({
          id: t.id,
          name: t.teamName,
          owner: t.ownerName,
        })),
      });
    }

    // Create league record
    const [newLeague] = await db
      .insert(leagues)
      .values({
        userId: session.user.id,
        provider,
        externalLeagueId,
        name: targetLeague.name,
        season,
        totalTeams: targetLeague.totalTeams,
        draftType: targetLeague.draftType,
        syncStatus: "syncing",
      })
      .returning();

    // Start sync in background (for MVP, we'll do it synchronously)
    try {
      await syncLeagueData({
        leagueId: newLeague.id,
        provider,
        externalLeagueId,
        identifier,
        userId: session.user.id,
        espnS2: body.espnS2,
        swid: body.swid,
        season,
      });

      // Compute values immediately so rankings are ready
      await computeAggregatedValues(newLeague.id);
      await computeUnifiedValues(newLeague.id);

      // Update sync status
      await db
        .update(leagues)
        .set({ syncStatus: "success", lastSyncedAt: new Date() })
        .where(eq(leagues.id, newLeague.id));
    } catch (syncError) {
      console.error("Sync error:", syncError);

      // Update with error
      await db
        .update(leagues)
        .set({
          syncStatus: "failed",
          syncError:
            syncError instanceof Error ? syncError.message : "Sync failed",
        })
        .where(eq(leagues.id, newLeague.id));
    }

    // Fetch teams for team selection
    const leagueTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.leagueId, newLeague.id));

    return NextResponse.json({
      leagueId: newLeague.id,
      message: "League connected successfully",
      // Return teams for user to select their team
      selectTeam: true,
      teams: leagueTeams.map((t) => ({
        id: t.id,
        name: t.teamName,
        owner: t.ownerName,
      })),
    });
  } catch (error) {
    console.error("Connect league error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

