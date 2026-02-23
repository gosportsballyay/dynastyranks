import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { code } = body;

  if (!code || code !== process.env.BETA_ACCESS_CODE) {
    return NextResponse.json(
      { error: "Invalid access code" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("beta_access", "granted", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return response;
}
