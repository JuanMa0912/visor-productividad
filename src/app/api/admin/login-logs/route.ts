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
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 300);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  const sortRaw = searchParams.get("sort") ?? "logged_at";
  const orderRaw = searchParams.get("order") ?? "desc";
  const sortBy =
    sortRaw === "username" ? "username" : "logged_at";
  const orderDir = orderRaw === "asc" ? "ASC" : "DESC";
  const orderBySql =
    sortBy === "username"
      ? `u.username ${orderDir}, l.logged_at DESC`
      : `l.logged_at ${orderDir}`;

  const parseYmd = (value: string | null): string | null => {
    if (!value) return null;
    const t = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
    const [y, m, d] = t.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null;
    }
    return t;
  };

  let dateFrom = parseYmd(searchParams.get("from"));
  let dateTo = parseYmd(searchParams.get("to"));
  if (dateFrom && dateTo && dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  const userRaw = (searchParams.get("user") ?? "").trim().slice(0, 128);
  const userPattern =
    userRaw.length > 0
      ? `%${userRaw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`
      : null;

  const client = await (await getDbPool()).connect();
  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (dateFrom) {
      conds.push(
        `(l.logged_at AT TIME ZONE 'America/Bogota')::date >= $${i}::date`,
      );
      params.push(dateFrom);
      i += 1;
    }
    if (dateTo) {
      conds.push(
        `(l.logged_at AT TIME ZONE 'America/Bogota')::date <= $${i}::date`,
      );
      params.push(dateTo);
      i += 1;
    }
    if (userPattern) {
      conds.push(`u.username ILIKE $${i} ESCAPE '\\'`);
      params.push(userPattern);
      i += 1;
    }

    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    params.push(limit, offset);
    const limitIdx = i;
    const offsetIdx = i + 1;

    const [countResult, rowsResult] = await Promise.all([
      client.query<{ c: string }>(
        `
        SELECT COUNT(*)::text AS c
        FROM app_user_login_logs l
        JOIN app_users u ON u.id = l.user_id
        ${whereSql}
        `,
        params.slice(0, -2),
      ),
      client.query(
        `
        SELECT l.id, l.logged_at, l.ip, l.user_agent, u.id as user_id, u.username
        FROM app_user_login_logs l
        JOIN app_users u ON u.id = l.user_id
        ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `,
        params,
      ),
    ]);

    const total = Number(countResult.rows?.[0]?.c ?? 0);
    return withSession(
      NextResponse.json({
        logs: rowsResult.rows ?? [],
        total: Number.isFinite(total) ? total : 0,
      }),
    );
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
