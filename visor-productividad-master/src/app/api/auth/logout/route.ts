import { NextResponse } from "next/server";
import {
  getExpiredSessionCookieOptions,
  getSessionToken,
  revokeSessionByToken,
} from "@/lib/auth";

export async function POST() {
  const token = await getSessionToken();
  if (token) {
    await revokeSessionByToken(token);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("vp_session", "", getExpiredSessionCookieOptions());
  return response;
}
