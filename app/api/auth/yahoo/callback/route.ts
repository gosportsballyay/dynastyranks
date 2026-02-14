/**
 * Yahoo OAuth2 Callback Handler
 *
 * Exchanges authorization code for access/refresh tokens and
 * stores them in the userTokens table.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { userTokens } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");  // User ID
  const error = searchParams.get("error");

  // Handle OAuth errors
  if (error) {
    console.error("Yahoo OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/dashboard/connect?error=${encodeURIComponent(error)}`, process.env.NEXTAUTH_URL)
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/connect?error=missing_params", process.env.NEXTAUTH_URL)
    );
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/dashboard/connect?error=yahoo_not_configured", process.env.NEXTAUTH_URL)
    );
  }

  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/yahoo/callback`;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(YAHOO_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Yahoo token exchange failed:", errorText);
      return NextResponse.redirect(
        new URL("/dashboard/connect?error=token_exchange_failed", process.env.NEXTAUTH_URL)
      );
    }

    const tokens = await tokenResponse.json();

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Upsert token in database
    const userId = state;

    // Check if token already exists
    const [existingToken] = await db
      .select()
      .from(userTokens)
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.provider, "yahoo")
        )
      )
      .limit(1);

    if (existingToken) {
      // Update existing token
      await db
        .update(userTokens)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existingToken.refreshToken,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(userTokens.id, existingToken.id));
    } else {
      // Insert new token
      await db.insert(userTokens).values({
        userId,
        provider: "yahoo",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: "fspt-r",
      });
    }

    // Redirect back to connect page with success indicator
    return NextResponse.redirect(
      new URL("/dashboard/connect?yahoo=connected", process.env.NEXTAUTH_URL)
    );
  } catch (error) {
    console.error("Yahoo OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/dashboard/connect?error=oauth_failed", process.env.NEXTAUTH_URL)
    );
  }
}
