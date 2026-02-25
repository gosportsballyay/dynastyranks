import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/beta", "/api/beta", "/terms", "/privacy", "/how-it-works", "/login", "/signup", "/api/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip beta gate if no code is configured (open mode)
  if (!process.env.BETA_ACCESS_CODE) {
    return NextResponse.next();
  }

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|svg|css|js)$/)
  ) {
    return NextResponse.next();
  }

  // Check for beta access cookie
  const betaCookie = request.cookies.get("beta_access");
  if (betaCookie?.value === "granted") {
    return NextResponse.next();
  }

  // Redirect to beta gate
  const url = request.nextUrl.clone();
  url.pathname = "/beta";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
