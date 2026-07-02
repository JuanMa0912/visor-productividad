import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/shared/rate-limit";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 120,
    keyPrefix: "admin-login-log-context-get",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const { id: rawId } = await params;
  const logId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(logId) || logId <= 0) {
    return withSession(
      NextResponse.json({ error: "Identificador de acceso inválido." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const logResult = await client.query<{
      id: number;
      user_id: string;
      username: string;
      logged_at: Date;
      ip: string | null;
      user_agent: string | null;
    }>(
      `
      SELECT l.id, l.user_id, u.username, l.logged_at, host(l.ip::inet) AS ip, l.user_agent
      FROM app_user_login_logs l
      JOIN app_users u ON u.id = l.user_id
      WHERE l.id = $1
      LIMIT 1
      `,
      [logId],
    );
    const logRow = logResult.rows[0];
    if (!logRow) {
      return withSession(
        NextResponse.json({ error: "Acceso no encontrado." }, { status: 404 }),
      );
    }

    const nextLoginResult = await client.query<{ logged_at: Date }>(
      `
      SELECT logged_at
      FROM app_user_login_logs
      WHERE user_id = $1
        AND logged_at > $2
      ORDER BY logged_at ASC
      LIMIT 1
      `,
      [logRow.user_id, logRow.logged_at],
    );
    const nextLoginAt = nextLoginResult.rows[0]?.logged_at ?? null;

    const sessionResult = await client.query<{
      session_id: string;
      session_ip: string | null;
      session_started_at: Date;
    }>(
      `
      SELECT
        s.id::text AS session_id,
        host(s.ip::inet) AS session_ip,
        s.created_at AS session_started_at
      FROM app_user_sessions s
      WHERE s.user_id = $1
        AND s.created_at BETWEEN $2::timestamptz - interval '10 minutes'
                            AND $2::timestamptz + interval '2 hours'
      ORDER BY ABS(EXTRACT(EPOCH FROM (s.created_at - $2::timestamptz))) ASC
      LIMIT 1
      `,
      [logRow.user_id, logRow.logged_at],
    );
    const sessionRow = sessionResult.rows[0] ?? null;

    const activityResult = await client.query<{
      observation_count: string;
      active_minutes: string;
      first_path: string | null;
      last_path: string | null;
      first_observed_at: Date | null;
      last_observed_at: Date | null;
    }>(
      `
      SELECT
        COUNT(*)::text AS observation_count,
        COUNT(DISTINCT date_trunc('minute', observed_at))::text AS active_minutes,
        (ARRAY_AGG(path ORDER BY observed_at ASC))[1] AS first_path,
        (ARRAY_AGG(path ORDER BY observed_at DESC))[1] AS last_path,
        MIN(observed_at) AS first_observed_at,
        MAX(observed_at) AS last_observed_at
      FROM app_user_activity_log
      WHERE user_id = $1
        AND observed_at >= $2::timestamptz
        AND observed_at < COALESCE($3::timestamptz, $2::timestamptz + interval '12 hours')
      `,
      [logRow.user_id, logRow.logged_at, nextLoginAt],
    );
    const activity = activityResult.rows[0];

    const toIso = (value: Date | null | undefined) =>
      value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null;

    return withSession(
      NextResponse.json({
        log: {
          id: logRow.id,
          userId: logRow.user_id,
          username: logRow.username,
          loggedAt: toIso(logRow.logged_at),
          ip: logRow.ip,
          userAgent: logRow.user_agent,
        },
        session: sessionRow
          ? {
              id: sessionRow.session_id,
              ip: sessionRow.session_ip,
              startedAt: toIso(sessionRow.session_started_at),
            }
          : null,
        activityWindow: {
          endsAt: toIso(nextLoginAt),
          observationCount: Number(activity?.observation_count ?? 0),
          activeMinutes: Number(activity?.active_minutes ?? 0),
          firstPath: activity?.first_path ?? null,
          lastPath: activity?.last_path ?? null,
          firstObservedAt: toIso(activity?.first_observed_at ?? null),
          lastObservedAt: toIso(activity?.last_observed_at ?? null),
        },
      }),
    );
  } catch (error) {
    console.error("[admin/login-logs/context] error", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo cargar el detalle del acceso." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
