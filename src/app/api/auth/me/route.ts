import { NextResponse } from "next/server";
import { getSessionCookieOptions, getUserSession } from "@/lib/auth";

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const response = NextResponse.json({ user: session.user });
  response.cookies.set(
    "vp_session",
    session.token,
    getSessionCookieOptions(session.expiresAt),
  );
  return response;
}
