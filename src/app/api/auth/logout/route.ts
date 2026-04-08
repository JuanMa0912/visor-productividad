import { NextResponse } from "next/server";
import {
  getExpiredCsrfCookieOptions,
  getExpiredSessionCookieOptions,
  getSessionToken,
  revokeSessionByToken,
  verifyCsrf,
} from "@/lib/auth";

export async function POST(req: Request) {
  if (!(await verifyCsrf(req))) {
    return NextResponse.json({ error: "CSRF inválido." }, { status: 403 });
  }

  const token = await getSessionToken();
  if (token) {
    await revokeSessionByToken(token);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("vp_session", "", getExpiredSessionCookieOptions());
  response.cookies.set("vp_csrf", "", getExpiredCsrfCookieOptions());
  return response;
}
