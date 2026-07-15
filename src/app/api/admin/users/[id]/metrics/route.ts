import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { applySessionCookies, requireAdminSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/shared/rate-limit";
import { isAuditSensitivePath } from "@/lib/admin/user-admin-audit";

type Params = { params: Promise<{ id: string }> };

export type UserMetricsPeriodStats = {
  activeMinutes: number;
  activeDays: number;
  sessions: number;
  observations: number;
};

export type UserMetricsTopPath = {
  path: string;
  observations: number;
  activeMinutes: number;
};

export type UserMetricsDailyActivity = {
  day: string;
  activeMinutes: number;
};

export type UserMetricsDevice = {
  browser: string;
  browserVersion: string | null;
  os: string;
  device: string;
  userAgent: string;
  lastSeenAt: string;
  loginCount: number;
};

export type UserMetricsAuditSignals = {
  failedLogins30d: number;
  adminChanges30d: number;
  sensitivePaths30d: string[];
  newDeviceLast7d: boolean;
};

export type UserMetricsResponse = {
  user: {
    id: string;
    username: string;
    role: "admin" | "user";
    sede: string | null;
    isActive: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  generatedAt: string;
  lastActivity: {
    observedAt: string | null;
    path: string | null;
  };
  periods: {
    last7Days: UserMetricsPeriodStats;
    last30Days: UserMetricsPeriodStats;
    last90Days: UserMetricsPeriodStats;
  };
  topPaths: UserMetricsTopPath[];
  dailyActivity: UserMetricsDailyActivity[];
  devices: UserMetricsDevice[];
  auditSignals: UserMetricsAuditSignals;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toIsoString = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const parseInteger = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const fingerprintUserAgent = (
  ua: string | null,
): {
  browser: string;
  browserVersion: string | null;
  os: string;
  device: string;
} => {
  const raw = ua?.trim();
  if (!raw) {
    return {
      browser: "Desconocido",
      browserVersion: null,
      os: "Desconocido",
      device: "Escritorio",
    };
  }

  let browser = "Desconocido";
  let browserVersion: string | null = null;
  if (/EdgA?\/(\d+)/i.test(raw)) {
    browser = "Edge";
    browserVersion = raw.match(/EdgA?\/(\d+)/i)?.[1] ?? null;
  } else if (/OPR\/(\d+)/i.test(raw)) {
    browser = "Opera";
    browserVersion = raw.match(/OPR\/(\d+)/i)?.[1] ?? null;
  } else if (/Firefox\/(\d+)/i.test(raw)) {
    browser = "Firefox";
    browserVersion = raw.match(/Firefox\/(\d+)/i)?.[1] ?? null;
  } else if (/CriOS\/(\d+)/i.test(raw)) {
    browser = "Chrome";
    browserVersion = raw.match(/CriOS\/(\d+)/i)?.[1] ?? null;
  } else if (/Chrome\/(\d+)/i.test(raw) && !/Chromium/i.test(raw)) {
    browser = "Chrome";
    browserVersion = raw.match(/Chrome\/(\d+)/i)?.[1] ?? null;
  } else if (/Version\/(\d+)/i.test(raw) && /Safari/i.test(raw)) {
    browser = "Safari";
    browserVersion = raw.match(/Version\/(\d+)/i)?.[1] ?? null;
  } else if (/MSIE (\d+)/i.test(raw) || /Trident/i.test(raw)) {
    browser = "Internet Explorer";
    browserVersion = raw.match(/MSIE (\d+)/i)?.[1] ?? null;
  }

  let os = "Desconocido";
  if (/Windows NT 10\.0/i.test(raw)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/i.test(raw)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/i.test(raw)) os = "Windows 7";
  else if (/Windows/i.test(raw)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(raw)) {
    const iosVer = raw.match(/OS (\d+(?:_\d+)?)/i)?.[1];
    os = iosVer ? `iOS ${iosVer.replace(/_/g, ".")}` : "iOS";
  } else if (/Android/i.test(raw)) {
    const androidVer = raw.match(/Android (\d+(?:\.\d+)?)/i)?.[1];
    os = androidVer ? `Android ${androidVer}` : "Android";
  } else if (/CrOS/i.test(raw)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/i.test(raw)) os = "macOS";
  else if (/Linux/i.test(raw)) os = "Linux";

  let device = "Escritorio";
  if (/iPad|Tablet|PlayBook/i.test(raw)) device = "Tablet";
  else if (/Mobile|iPhone|Android.*Mobile/i.test(raw)) device = "Móvil";

  return { browser, browserVersion, os, device };
};

export async function GET(req: Request, { params }: Params) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-user-metrics",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        {
          status: 429,
          headers: { "Retry-After": retryAfterSeconds.toString() },
        },
      ),
    );
  }

  const { id } = await params;
  if (!UUID_REGEX.test(id)) {
    return withSession(
      NextResponse.json({ error: "ID inválido." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const userResult = await client.query<{
      id: string;
      username: string;
      role: "admin" | "user";
      sede: string | null;
      is_active: boolean;
      created_at: Date;
      last_login_at: Date | null;
    }>(
      `
      SELECT id::text AS id, username, role, sede, is_active, created_at, last_login_at
      FROM app_users
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      return withSession(
        NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 }),
      );
    }

    const [
      periodStatsResult,
      topPathsResult,
      dailyActivityResult,
      devicesResult,
      lastActivityResult,
    ] = await Promise.all([
      client.query<{
        period_days: number;
        active_minutes: string;
        active_days: string;
        sessions: string;
        observations: string;
      }>(
        `
        WITH periods AS (
          SELECT unnest(ARRAY[7, 30, 90]) AS period_days
        ),
        activity AS (
          SELECT
            p.period_days,
            COUNT(DISTINCT date_trunc('minute', a.observed_at))::text AS active_minutes,
            COUNT(DISTINCT (a.observed_at AT TIME ZONE 'America/Bogota')::date)::text AS active_days,
            COUNT(*)::text AS observations
          FROM periods p
          LEFT JOIN app_user_activity_log a
            ON a.user_id = $1
           AND a.observed_at >= now() - make_interval(days => p.period_days)
          GROUP BY p.period_days
        ),
        sessions AS (
          SELECT
            p.period_days,
            COUNT(*)::text AS sessions
          FROM periods p
          LEFT JOIN app_user_login_logs l
            ON l.user_id = $1
           AND l.logged_at >= now() - make_interval(days => p.period_days)
          GROUP BY p.period_days
        )
        SELECT
          a.period_days,
          a.active_minutes,
          a.active_days,
          a.observations,
          s.sessions
        FROM activity a
        JOIN sessions s USING (period_days)
        ORDER BY a.period_days
        `,
        [id],
      ),
      client.query<{
        path: string;
        observations: string;
        active_minutes: string;
      }>(
        `
        SELECT
          path,
          COUNT(*)::text AS observations,
          COUNT(DISTINCT date_trunc('minute', observed_at))::text AS active_minutes
        FROM app_user_activity_log
        WHERE user_id = $1
          AND observed_at >= now() - interval '30 days'
        GROUP BY path
        ORDER BY active_minutes DESC, observations DESC
        LIMIT 10
        `,
        [id],
      ),
      client.query<{ day: string; active_minutes: string }>(
        `
        SELECT
          to_char((observed_at AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS day,
          COUNT(DISTINCT date_trunc('minute', observed_at))::text AS active_minutes
        FROM app_user_activity_log
        WHERE user_id = $1
          AND observed_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1
        `,
        [id],
      ),
      client.query<{
        user_agent: string;
        login_count: string;
        last_seen_at: Date;
      }>(
        `
        SELECT
          user_agent,
          COUNT(*)::text AS login_count,
          MAX(logged_at) AS last_seen_at
        FROM app_user_login_logs
        WHERE user_id = $1
          AND logged_at >= now() - interval '60 days'
          AND user_agent IS NOT NULL
        GROUP BY user_agent
        ORDER BY last_seen_at DESC
        LIMIT 20
        `,
        [id],
      ),
      client.query<{ observed_at: Date | null; path: string | null }>(
        `
        SELECT observed_at, path
        FROM app_user_activity_log
        WHERE user_id = $1
        ORDER BY observed_at DESC
        LIMIT 1
        `,
        [id],
      ),
    ]);

    const statsByDays = new Map<number, UserMetricsPeriodStats>();
    for (const row of periodStatsResult.rows ?? []) {
      statsByDays.set(Number(row.period_days), {
        activeMinutes: parseInteger(row.active_minutes),
        activeDays: parseInteger(row.active_days),
        sessions: parseInteger(row.sessions),
        observations: parseInteger(row.observations),
      });
    }
    const emptyStats: UserMetricsPeriodStats = {
      activeMinutes: 0,
      activeDays: 0,
      sessions: 0,
      observations: 0,
    };

    const topPaths: UserMetricsTopPath[] = (topPathsResult.rows ?? []).map(
      (row) => ({
        path: row.path,
        observations: parseInteger(row.observations),
        activeMinutes: parseInteger(row.active_minutes),
      }),
    );

    const dailyActivity: UserMetricsDailyActivity[] = (
      dailyActivityResult.rows ?? []
    ).map((row) => ({
      day: row.day,
      activeMinutes: parseInteger(row.active_minutes),
    }));

    const devicesMap = new Map<string, UserMetricsDevice>();
    for (const row of devicesResult.rows ?? []) {
      const fp = fingerprintUserAgent(row.user_agent);
      const key = `${fp.browser}|${fp.browserVersion ?? ""}|${fp.os}|${fp.device}`;
      const existing = devicesMap.get(key);
      const lastSeen = toIsoString(row.last_seen_at) ?? "";
      if (existing) {
        existing.loginCount += parseInteger(row.login_count);
        if (lastSeen > existing.lastSeenAt) {
          existing.lastSeenAt = lastSeen;
          existing.userAgent = row.user_agent;
        }
      } else {
        devicesMap.set(key, {
          browser: fp.browser,
          browserVersion: fp.browserVersion,
          os: fp.os,
          device: fp.device,
          userAgent: row.user_agent,
          lastSeenAt: lastSeen,
          loginCount: parseInteger(row.login_count),
        });
      }
    }
    const devices = Array.from(devicesMap.values()).sort((a, b) =>
      b.lastSeenAt.localeCompare(a.lastSeenAt),
    );

    const lastActivityRow = lastActivityResult.rows?.[0] ?? null;

    let failedLogins30d = 0;
    let adminChanges30d = 0;
    const sensitivePaths30d: string[] = [];
    let newDeviceLast7d = false;

    try {
      const failResult = await client.query<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n
        FROM app_user_login_attempt_log
        WHERE user_id = $1
          AND logged_at >= now() - interval '30 days'
        `,
        [id],
      );
      failedLogins30d = parseInteger(failResult.rows[0]?.n);
    } catch {
      /* migracion pendiente */
    }

    try {
      const auditResult = await client.query<{ n: string }>(
        `
        SELECT COUNT(*)::text AS n
        FROM app_user_admin_audit
        WHERE target_user_id = $1
          AND created_at >= now() - interval '30 days'
        `,
        [id],
      );
      adminChanges30d = parseInteger(auditResult.rows[0]?.n);
    } catch {
      /* migracion pendiente */
    }

    const sensitiveSeen = new Set<string>();
    for (const path of topPaths.map((p) => p.path)) {
      if (isAuditSensitivePath(path) && !sensitiveSeen.has(path)) {
        sensitiveSeen.add(path);
        sensitivePaths30d.push(path);
      }
    }
    try {
      const sensResult = await client.query<{ path: string }>(
        `
        SELECT DISTINCT path
        FROM app_user_activity_log
        WHERE user_id = $1
          AND observed_at >= now() - interval '30 days'
        `,
        [id],
      );
      for (const row of sensResult.rows ?? []) {
        if (isAuditSensitivePath(row.path) && !sensitiveSeen.has(row.path)) {
          sensitiveSeen.add(row.path);
          sensitivePaths30d.push(row.path);
        }
      }
    } catch {
      /* ignore */
    }

    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const olderDevices = devices.filter(
      (d) => new Date(d.lastSeenAt).getTime() < cutoff7d,
    );
    const recentDevices = devices.filter(
      (d) => new Date(d.lastSeenAt).getTime() >= cutoff7d,
    );
    if (olderDevices.length > 0 && recentDevices.length > 0) {
      const olderKeys = new Set(
        olderDevices.map(
          (d) => `${d.browser}|${d.browserVersion ?? ""}|${d.os}|${d.device}`,
        ),
      );
      newDeviceLast7d = recentDevices.some(
        (d) =>
          !olderKeys.has(
            `${d.browser}|${d.browserVersion ?? ""}|${d.os}|${d.device}`,
          ),
      );
    } else if (olderDevices.length === 0 && recentDevices.length > 0 && devices.length === recentDevices.length) {
      // Solo dispositivos recientes: no marcar como "nuevo" si no hay historial.
      newDeviceLast7d = false;
    }

    const payload: UserMetricsResponse = {
      user: {
        id: userRow.id,
        username: userRow.username,
        role: userRow.role,
        sede: userRow.sede,
        isActive: userRow.is_active,
        createdAt: toIsoString(userRow.created_at) ?? "",
        lastLoginAt: toIsoString(userRow.last_login_at),
      },
      generatedAt: new Date().toISOString(),
      lastActivity: {
        observedAt: toIsoString(lastActivityRow?.observed_at ?? null),
        path: lastActivityRow?.path ?? null,
      },
      periods: {
        last7Days: statsByDays.get(7) ?? emptyStats,
        last30Days: statsByDays.get(30) ?? emptyStats,
        last90Days: statsByDays.get(90) ?? emptyStats,
      },
      topPaths,
      dailyActivity,
      devices,
      auditSignals: {
        failedLogins30d,
        adminChanges30d,
        sensitivePaths30d: sensitivePaths30d.slice(0, 12),
        newDeviceLast7d,
      },
    };

    return applySessionCookies(NextResponse.json(payload), session);
  } catch (error) {
    console.error("[admin/users/[id]/metrics] error", error);
    return applySessionCookies(
      NextResponse.json(
        { error: "No se pudieron obtener las métricas del usuario." },
        { status: 500 },
      ),
      session,
    );
  } finally {
    client.release();
  }
}
