import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  requireAdminSession,
  verifyCsrf,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-login-logs-get",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta más tarde." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT l.id, l.logged_at, l.ip, l.user_agent, u.id as user_id, u.username
      FROM app_user_login_logs l
      JOIN app_users u ON u.id = l.user_id
      ORDER BY l.logged_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return withSession(NextResponse.json({ logs: result.rows ?? [] }));
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => applySessionCookies(response, session);

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 10,
    keyPrefix: "admin-login-logs-delete",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta más tarde." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query("DELETE FROM app_user_login_logs");
    return withSession(NextResponse.json({ deleted: result.rowCount ?? 0 }));
  } finally {
    client.release();
  }
}
