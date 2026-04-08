import { NextResponse } from "next/server";
import { applySessionCookies, getUserSession } from "@/lib/auth";

export async function GET() {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const response = NextResponse.json({ user: session.user });
  return applySessionCookies(response, session);
}
