import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  requireAdminSession,
  verifyCsrf,
} from "@/lib/auth";
import {
  buildLoginLogFilterSql,
  currentMonthKeyBogota,
  loginLogFiltersAreScoped,
  monthRangeBounds,
  parseLoginLogFilters,
  parseMonthKey,
} from "@/lib/admin/login-logs-filters";
import { checkRateLimit } from "@/lib/shared/rate-limit";

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
  const summaryMode = searchParams.get("summary") ?? "";
  const filters = parseLoginLogFilters(searchParams);

  const sortRaw = searchParams.get("sort") ?? "logged_at";
  const orderRaw = searchParams.get("order") ?? "desc";
  const sortBy = sortRaw === "username" ? "username" : "logged_at";
  const orderDir = orderRaw === "asc" ? "ASC" : "DESC";
  const orderBySql =
    sortBy === "username"
      ? `u.username ${orderDir}, l.logged_at DESC`
      : `l.logged_at ${orderDir}`;

  const client = await (await getDbPool()).connect();
  try {
    const { conds, params } = buildLoginLogFilterSql(filters);
    const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    if (summaryMode === "kpis") {
      const kpiResult = await client.query<{
        logins_today: string;
        logins_7d: string;
        unique_users_7d: string;
        unique_users_30d: string;
        users_active: string;
        users_total: string;
        online_now: string;
      }>(
        `
        SELECT
          (
            SELECT COUNT(*)::text
            FROM app_user_login_logs
            WHERE (logged_at AT TIME ZONE 'America/Bogota')::date =
              (now() AT TIME ZONE 'America/Bogota')::date
          ) AS logins_today,
          (
            SELECT COUNT(*)::text
            FROM app_user_login_logs
            WHERE logged_at >= now() - interval '7 days'
          ) AS logins_7d,
          (
            SELECT COUNT(DISTINCT user_id)::text
            FROM app_user_login_logs
            WHERE logged_at >= now() - interval '7 days'
          ) AS unique_users_7d,
          (
            SELECT COUNT(DISTINCT user_id)::text
            FROM app_user_login_logs
            WHERE logged_at >= now() - interval '30 days'
          ) AS unique_users_30d,
          (
            SELECT COUNT(*)::text FROM app_users WHERE is_active = true
          ) AS users_active,
          (
            SELECT COUNT(*)::text FROM app_users
          ) AS users_total,
          (
            SELECT COUNT(DISTINCT user_id)::text
            FROM app_user_sessions
            WHERE revoked_at IS NULL
              AND expires_at > now()
              AND last_activity_at >= now() - interval '10 minutes'
          ) AS online_now
        `,
      );
      const row = kpiResult.rows[0];
      const usersActive = Number(row?.users_active ?? 0);
      const usersTotal = Number(row?.users_total ?? 0);
      return withSession(
        NextResponse.json({
          loginsToday: Number(row?.logins_today ?? 0),
          logins7d: Number(row?.logins_7d ?? 0),
          uniqueUsers7d: Number(row?.unique_users_7d ?? 0),
          uniqueUsers30d: Number(row?.unique_users_30d ?? 0),
          usersActive,
          usersTotal,
          usersInactive: Math.max(0, usersTotal - usersActive),
          activeAccountRate:
            usersTotal > 0 ? Math.round((usersActive / usersTotal) * 100) : 0,
          onlineNow: Number(row?.online_now ?? 0),
        }),
      );
    }

    const monthFilter =
      parseMonthKey(searchParams.get("month")) ?? currentMonthKeyBogota();
    const monthBounds = monthRangeBounds(monthFilter);

    if (summaryMode === "monthly_days" || summaryMode === "monthly_stats") {
      const summaryConds = [...conds];
      const summaryParams = [...params];
      const monthFromIdx = summaryParams.length + 1;
      summaryConds.push(
        `(l.logged_at AT TIME ZONE 'America/Bogota')::date >= $${monthFromIdx}::date`,
      );
      summaryParams.push(monthBounds.from);
      const monthToIdx = summaryParams.length + 1;
      summaryConds.push(
        `(l.logged_at AT TIME ZONE 'America/Bogota')::date < $${monthToIdx}::date`,
      );
      summaryParams.push(monthBounds.toExclusive);

      const summaryWhereSql = summaryConds.length
        ? `WHERE ${summaryConds.join(" AND ")}`
        : "";

      const summaryResult = await client.query<{
        user_id: string;
        username: string;
        days_count: number;
        login_count: number;
        active_minutes: number;
        top_path: string | null;
      }>(
        `
        WITH filtered_logins AS (
          SELECT l.user_id, l.logged_at
          FROM app_user_login_logs l
          JOIN app_users u ON u.id = l.user_id
          ${summaryWhereSql}
        ),
        login_agg AS (
          SELECT
            user_id,
            LEAST(
              31,
              COUNT(DISTINCT (logged_at AT TIME ZONE 'America/Bogota')::date)
            )::int AS days_count,
            COUNT(*)::int AS login_count
          FROM filtered_logins
          GROUP BY user_id
        ),
        activity_agg AS (
          SELECT
            a.user_id,
            COUNT(DISTINCT date_trunc('minute', a.observed_at))::int AS active_minutes
          FROM app_user_activity_log a
          WHERE (a.observed_at AT TIME ZONE 'America/Bogota')::date >= $${monthFromIdx}::date
            AND (a.observed_at AT TIME ZONE 'America/Bogota')::date < $${monthToIdx}::date
            AND a.user_id IN (SELECT user_id FROM login_agg)
          GROUP BY a.user_id
        ),
        path_rank AS (
          SELECT
            a.user_id,
            a.path,
            ROW_NUMBER() OVER (
              PARTITION BY a.user_id
              ORDER BY COUNT(*) DESC, a.path ASC
            ) AS rn
          FROM app_user_activity_log a
          WHERE (a.observed_at AT TIME ZONE 'America/Bogota')::date >= $${monthFromIdx}::date
            AND (a.observed_at AT TIME ZONE 'America/Bogota')::date < $${monthToIdx}::date
            AND a.user_id IN (SELECT user_id FROM login_agg)
          GROUP BY a.user_id, a.path
        )
        SELECT
          u.id AS user_id,
          u.username,
          la.days_count,
          la.login_count,
          COALESCE(aa.active_minutes, 0) AS active_minutes,
          pr.path AS top_path
        FROM login_agg la
        JOIN app_users u ON u.id = la.user_id
        LEFT JOIN activity_agg aa ON aa.user_id = la.user_id
        LEFT JOIN path_rank pr ON pr.user_id = la.user_id AND pr.rn = 1
        ORDER BY la.days_count DESC, la.login_count DESC, u.username ASC
        `,
        summaryParams,
      );

      return withSession(
        NextResponse.json({
          month: monthFilter,
          users: summaryResult.rows ?? [],
        }),
      );
    }

    const listParams = [...params, limit, offset];
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [countResult, rowsResult] = await Promise.all([
      client.query<{ c: string }>(
        `
        SELECT COUNT(*)::text AS c
        FROM app_user_login_logs l
        JOIN app_users u ON u.id = l.user_id
        ${whereSql}
        `,
        params,
      ),
      client.query(
        `
        SELECT
          l.id,
          l.logged_at,
          host(l.ip::inet) AS ip,
          l.user_agent,
          u.id AS user_id,
          u.username,
          u.sede,
          COALESCE(u.portal_profile, 'personalizado') AS portal_profile
        FROM app_user_login_logs l
        JOIN app_users u ON u.id = l.user_id
        ${whereSql}
        ORDER BY ${orderBySql}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `,
        listParams,
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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const confirmAll = body.confirmAll === true;
  const filters = parseLoginLogFilters(body);

  if (!confirmAll && !loginLogFiltersAreScoped(filters)) {
    return withSession(
      NextResponse.json(
        {
          error:
            "Indica un alcance (fechas, usuario, sede o perfil) o confirma explícitamente confirmAll.",
        },
        { status: 400 },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    if (confirmAll) {
      const result = await client.query("DELETE FROM app_user_login_logs");
      return withSession(NextResponse.json({ deleted: result.rowCount ?? 0 }));
    }

    const { conds, params } = buildLoginLogFilterSql(filters);
    const result = await client.query(
      `
      DELETE FROM app_user_login_logs l
      USING app_users u
      WHERE l.user_id = u.id
        ${conds.length ? `AND ${conds.join(" AND ")}` : ""}
      `,
      params,
    );
    return withSession(NextResponse.json({ deleted: result.rowCount ?? 0 }));
  } finally {
    client.release();
  }
}
