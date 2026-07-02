import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { applySessionCookies, requireAdminSession } from "@/lib/auth";
import {
  buildActivityFilterSql,
  parseTableroUsageFilters,
} from "@/lib/admin/tablero-usage-filters";
import { getLoginLogDateRangeForShortcut } from "@/lib/admin/login-logs-utils";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export type TableroUsagePathRow = {
  path: string;
  uniqueUsers: number;
  observations: number;
  activeMinutes: number;
  sharePercent: number;
};

export type TableroUsageKpis = {
  uniqueUsers: number;
  uniquePaths: number;
  totalObservations: number;
  totalActiveMinutes: number;
};

export type TableroUsageResponse = {
  generatedAt: string;
  period: { from: string; to: string };
  kpis: TableroUsageKpis;
  paths: TableroUsagePathRow[];
};

const parseInteger = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-uso-tableros-get",
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

  const { searchParams } = new URL(req.url);
  const filters = parseTableroUsageFilters(searchParams);
  const defaultRange = getLoginLogDateRangeForShortcut("last30");
  const periodFrom = filters.dateFrom ?? defaultRange.from;
  const periodTo = filters.dateTo ?? defaultRange.to;

  const effectiveFilters = {
    ...filters,
    dateFrom: periodFrom,
    dateTo: periodTo,
  };

  const sortRaw = searchParams.get("sort") ?? "activeMinutes";
  const orderRaw = searchParams.get("order") ?? "desc";
  const sortColumn =
    sortRaw === "uniqueUsers"
      ? "unique_users"
      : sortRaw === "observations"
        ? "observations"
        : "active_minutes";
  const orderDir = orderRaw === "asc" ? "ASC" : "DESC";

  const { conds, params } = buildActivityFilterSql(effectiveFilters);
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const client = await (await getDbPool()).connect();
  try {
    const [kpiResult, pathsResult] = await Promise.all([
      client.query<{
        unique_users: string;
        unique_paths: string;
        total_observations: string;
        total_active_minutes: string;
      }>(
        `
        SELECT
          COUNT(DISTINCT a.user_id)::text AS unique_users,
          COUNT(DISTINCT a.path)::text AS unique_paths,
          COUNT(*)::text AS total_observations,
          COUNT(DISTINCT (a.user_id, date_trunc('minute', a.observed_at)))::text
            AS total_active_minutes
        FROM app_user_activity_log a
        JOIN app_users u ON u.id = a.user_id
        ${whereSql}
        `,
        params,
      ),
      client.query<{
        path: string;
        unique_users: string;
        observations: string;
        active_minutes: string;
      }>(
        `
        WITH filtered AS (
          SELECT a.user_id, a.path, a.observed_at
          FROM app_user_activity_log a
          JOIN app_users u ON u.id = a.user_id
          ${whereSql}
        ),
        path_agg AS (
          SELECT
            path,
            COUNT(DISTINCT user_id)::int AS unique_users,
            COUNT(*)::int AS observations,
            COUNT(DISTINCT date_trunc('minute', observed_at))::int AS active_minutes
          FROM filtered
          GROUP BY path
        ),
        totals AS (
          SELECT COALESCE(SUM(active_minutes), 0)::numeric AS total_minutes
          FROM path_agg
        )
        SELECT
          p.path,
          p.unique_users::text,
          p.observations::text,
          p.active_minutes::text
        FROM path_agg p
        CROSS JOIN totals t
        ORDER BY p.${sortColumn} ${orderDir}, p.path ASC
        LIMIT 100
        `,
        params,
      ),
    ]);

    const kpiRow = kpiResult.rows[0];
    const totalActiveMinutes = parseInteger(kpiRow?.total_active_minutes);

    const paths: TableroUsagePathRow[] = pathsResult.rows.map((row) => {
      const activeMinutes = parseInteger(row.active_minutes);
      return {
        path: row.path,
        uniqueUsers: parseInteger(row.unique_users),
        observations: parseInteger(row.observations),
        activeMinutes,
        sharePercent:
          totalActiveMinutes > 0
            ? Math.round((activeMinutes / totalActiveMinutes) * 1000) / 10
            : 0,
      };
    });

    const payload: TableroUsageResponse = {
      generatedAt: new Date().toISOString(),
      period: { from: periodFrom, to: periodTo },
      kpis: {
        uniqueUsers: parseInteger(kpiRow?.unique_users),
        uniquePaths: parseInteger(kpiRow?.unique_paths),
        totalObservations: parseInteger(kpiRow?.total_observations),
        totalActiveMinutes,
      },
      paths,
    };

    return withSession(NextResponse.json(payload));
  } catch (error) {
    console.error("[admin/uso-tableros] error", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo cargar el uso de tableros." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
