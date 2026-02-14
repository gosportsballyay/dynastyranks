/**
 * Yahoo OAuth2 Authorization Redirect
 *
 * Redirects users to Yahoo's OAuth authorization page.
 * After authorization, Yahoo redirects back to /api/auth/yahoo/callback.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

const YAHOO_AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";

export async function GET() {
  // Verify user is logged in
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const clientId = process.env.YAHOO_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Yahoo OAuth not configured" },
      { status: 500 }
    );
  }

  // Build callback URL
  const callbackUrl = `${process.env.NEXTAUTH_URL}/api/auth/yahoo/callback`;

  // Build authorization URL with required scopes
  const authUrl = new URL(YAHOO_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "fspt-r");  // Fantasy Sports read access
  authUrl.searchParams.set("state", session.user.id);  // Pass user ID for callback

  return NextResponse.redirect(authUrl.toString());
}
