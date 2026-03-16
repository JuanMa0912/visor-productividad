import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";

type VentasXItemDbRow = {
  empresa: string | null;
  fecha_dcto: string | null;
  id_co: string | null;
  id_item: string | null;
  descripcion: string | null;
  linea: string | null;
  und_dia: string | number | null;
  venta_sin_impuesto_dia: string | number | null;
  und_acum: string | number | null;
  venta_sin_impuesto_acum: string | number | null;
};

type DbMetaRow = {
  min_fecha: string | null;
  max_fecha: string | null;
  total_rows: string | number | null;
};
type DbMaxDateRow = {
  max_fecha: string | null;
};

const parsedDateExpr = `
  CASE
    WHEN REGEXP_REPLACE(REPLACE(fecha_dcto::text, '-', ''), '\\.0$', '') ~ '^[0-9]{8}$'
      THEN TO_DATE(REGEXP_REPLACE(REPLACE(fecha_dcto::text, '-', ''), '\\.0$', ''), 'YYYYMMDD')
    ELSE NULL::date
  END
`;

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 90;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
};

const checkRateLimit = (request: Request) => {
  const now = Date.now();
  const clientIp = getClientIp(request);
  const entry = rateLimitStore.get(clientIp);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }
  if (entry.count >= RATE_LIMIT_MAX) return entry.resetAt;
  entry.count += 1;
  return null;
};

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const parseList = (raw: string | null) =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const normalizeEmpresa = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };

  const allowedDashboards = session.user.allowedDashboards;
  if (
    session.user.role !== "admin" &&
    Array.isArray(allowedDashboards) &&
    !allowedDashboards.includes("ventas-x-item")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para este tablero." },
        { status: 403 },
      ),
    );
  }

  const limitedUntil = checkRateLimit(request);
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta mas tarde." },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  }

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const mode = url.searchParams.get("mode");
  const empresas = parseList(url.searchParams.get("empresa")).map(normalizeEmpresa);
  const itemIds = parseList(url.searchParams.get("itemIds"));
  const maxRowsParam = Number(url.searchParams.get("maxRows") ?? 500000);
  const maxRows = Number.isFinite(maxRowsParam)
    ? Math.max(1000, Math.min(1000000, Math.floor(maxRowsParam)))
    : 500000;
  const offsetParam = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(offsetParam)
    ? Math.max(0, Math.floor(offsetParam))
    : 0;

  if (start && !isDateKey(start)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de start invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  if (end && !isDateKey(end)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de end invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const tableCheck = await client.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'ventas_item_diario'
      LIMIT 1
      `,
    );
    if (!tableCheck.rows || tableCheck.rows.length === 0) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            total: 0,
            error:
              "Falta aplicar migracion de Ventas X item (db/migrations/20260303_ventas_x_item.sql).",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    if (mode === "meta") {
      const metaParams: unknown[] = [];
      const metaWhere: string[] = [];
      if (empresas.length > 0) {
        metaParams.push(empresas);
        metaWhere.push(
          `LOWER(COALESCE(base.empresa, '')) = ANY($${metaParams.length}::text[])`,
        );
      }
      const metaResult = await client.query(
        `
        WITH base AS (
          SELECT empresa, fecha_dcto
          FROM ventas_item_diario
          ${metaWhere.length > 0 ? `WHERE ${metaWhere.join(" AND ")}` : ""}
        ),
        parsed AS (
          SELECT
            CASE
              WHEN REGEXP_REPLACE(REPLACE(base.fecha_dcto::text, '-', ''), '\.0$', '') ~ '^[0-9]{8}$'
                THEN TO_DATE(REGEXP_REPLACE(REPLACE(base.fecha_dcto::text, '-', ''), '\.0$', ''), 'YYYYMMDD')
              ELSE NULL::date
            END AS fecha_norm
          FROM base
        )
        SELECT
          MIN(fecha_norm)::text AS min_fecha,
          MAX(fecha_norm)::text AS max_fecha,
          COUNT(*) FILTER (WHERE fecha_norm IS NOT NULL) AS total_rows
        FROM parsed
        `,
        metaParams,
      );
      const meta = (metaResult.rows?.[0] ?? null) as DbMetaRow | null;
      return withSession(
        NextResponse.json(
          {
            minDate: meta?.min_fecha ?? null,
            maxDate: meta?.max_fecha ?? null,
            totalRows: Number(meta?.total_rows ?? 0),
            source: "database",
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    let effectiveStart = start;
    let effectiveEnd = end;

    if (!effectiveStart && !effectiveEnd) {
      const defaultRangeResult = await client.query(
        `
        WITH parsed AS (
          SELECT ${parsedDateExpr} AS fecha_norm
          FROM ventas_item_diario
        )
        SELECT MAX(fecha_norm)::text AS max_fecha
        FROM parsed
        `,
      );
      const maxRow = (defaultRangeResult.rows?.[0] ?? null) as DbMaxDateRow | null;
      const maxFecha = String(maxRow?.max_fecha ?? "");
      if (!maxFecha) {
        return withSession(
          NextResponse.json(
            { error: "No hay fechas validas en la base de datos." },
            { status: 400 },
          ),
        );
      }
      const maxDate = new Date(`${maxFecha}T00:00:00Z`);
      maxDate.setUTCDate(maxDate.getUTCDate() - 6);
      effectiveEnd = maxFecha;
      effectiveStart = maxDate.toISOString().slice(0, 10);
    } else if (!effectiveStart || !effectiveEnd) {
      return withSession(
        NextResponse.json(
          { error: "Debes enviar start y end, o ninguno para usar la ultima semana." },
          { status: 400 },
        ),
      );
    }
    if (effectiveStart > effectiveEnd) {
      return withSession(
        NextResponse.json(
          { error: "start no puede ser mayor que end." },
          { status: 400 },
        ),
      );
    }

    if (mode === "summary") {
      const summaryParams: unknown[] = [];
      const summaryWhere: string[] = ["parsed.fecha_norm IS NOT NULL"];

      summaryParams.push(effectiveStart);
      summaryWhere.push(`parsed.fecha_norm >= $${summaryParams.length}::date`);
      summaryParams.push(effectiveEnd);
      summaryWhere.push(`parsed.fecha_norm <= $${summaryParams.length}::date`);

      if (empresas.length > 0) {
        summaryParams.push(empresas);
        summaryWhere.push(
          `LOWER(COALESCE(parsed.empresa, '')) = ANY($${summaryParams.length}::text[])`,
        );
      }
      if (itemIds.length > 0) {
        summaryParams.push(itemIds);
        summaryWhere.push(`parsed.id_item = ANY($${summaryParams.length}::text[])`);
      }

      const summaryResult = await client.query(
        `
        WITH base AS (
          SELECT
            empresa,
            fecha_dcto::text AS fecha_dcto,
            id_co::text AS id_co,
            id_item::text AS id_item,
            descripcion,
            linea,
            und_dia,
            venta_sin_impuesto_dia
          FROM ventas_item_diario
        ),
        parsed AS (
          SELECT
            base.*,
            CASE
              WHEN REGEXP_REPLACE(REPLACE(base.fecha_dcto, '-', ''), '\.0$', '') ~ '^[0-9]{8}$'
                THEN TO_DATE(REGEXP_REPLACE(REPLACE(base.fecha_dcto, '-', ''), '\.0$', ''), 'YYYYMMDD')
              ELSE NULL::date
            END AS fecha_norm
          FROM base
        )
        SELECT
          parsed.empresa,
          TO_CHAR(parsed.fecha_norm, 'YYYYMMDD') AS fecha_dcto,
          parsed.id_co,
          parsed.id_item,
          MAX(parsed.descripcion) AS descripcion,
          MAX(parsed.linea) AS linea,
          SUM(COALESCE(parsed.und_dia::numeric, 0))::float8 AS und_dia,
          SUM(COALESCE(parsed.venta_sin_impuesto_dia::numeric, 0))::float8 AS venta_sin_impuesto_dia,
          0::float8 AS und_acum,
          0::float8 AS venta_sin_impuesto_acum
        FROM parsed
        WHERE ${summaryWhere.join(" AND ")}
        GROUP BY parsed.empresa, parsed.fecha_norm, parsed.id_co, parsed.id_item
        ORDER BY parsed.fecha_norm DESC, parsed.empresa, parsed.id_co, parsed.id_item
        `,
        summaryParams,
      );

      const rows = ((summaryResult.rows ?? []) as VentasXItemDbRow[]).map((row) => ({
        empresa: row.empresa ?? "",
        fecha_dcto: row.fecha_dcto ?? "",
        id_co: row.id_co ?? "",
        id_item: row.id_item ?? "",
        descripcion: row.descripcion ?? "",
        linea: row.linea ?? "",
        und_dia: toNumber(row.und_dia),
        venta_sin_impuesto_dia: toNumber(row.venta_sin_impuesto_dia),
        und_acum: toNumber(row.und_acum),
        venta_sin_impuesto_acum: toNumber(row.venta_sin_impuesto_acum),
      }));

      return withSession(
        NextResponse.json(
          {
            rows,
            total: rows.length,
            range: { start: effectiveStart, end: effectiveEnd },
            source: "database-summary",
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    const params: unknown[] = [];
    const where: string[] = ["parsed.fecha_norm IS NOT NULL"];

    params.push(effectiveStart);
    where.push(`parsed.fecha_norm >= $${params.length}::date`);
    params.push(effectiveEnd);
    where.push(`parsed.fecha_norm <= $${params.length}::date`);
    if (empresas.length > 0) {
      params.push(empresas);
      where.push(`LOWER(COALESCE(parsed.empresa, '')) = ANY($${params.length}::text[])`);
    }
    params.push(maxRows);
    const limitParamIndex = params.length;
    params.push(offset);
    const offsetParamIndex = params.length;

    const result = await client.query(
      `
      WITH base AS (
        SELECT
          ctid::text AS row_id,
          empresa,
          fecha_dcto::text AS fecha_dcto,
          id_co::text AS id_co,
          id_item::text AS id_item,
          descripcion,
          linea,
          und_dia,
          venta_sin_impuesto_dia,
          und_acum,
          venta_sin_impuesto_acum
        FROM ventas_item_diario
      ),
      parsed AS (
        SELECT
          base.*,
          CASE
            WHEN REGEXP_REPLACE(REPLACE(base.fecha_dcto, '-', ''), '\.0$', '') ~ '^[0-9]{8}$'
              THEN TO_DATE(REGEXP_REPLACE(REPLACE(base.fecha_dcto, '-', ''), '\.0$', ''), 'YYYYMMDD')
            ELSE NULL::date
          END AS fecha_norm
        FROM base
      )
      SELECT
        parsed.empresa,
        parsed.fecha_dcto,
        parsed.id_co,
        parsed.id_item,
        parsed.descripcion,
        parsed.linea,
        parsed.und_dia,
        parsed.venta_sin_impuesto_dia,
        parsed.und_acum,
        parsed.venta_sin_impuesto_acum
      FROM parsed
      WHERE ${where.join(" AND ")}
      ORDER BY
        parsed.fecha_norm DESC,
        parsed.empresa,
        parsed.id_co,
        parsed.id_item,
        parsed.descripcion,
        parsed.linea,
        parsed.fecha_dcto,
        parsed.row_id
      LIMIT $${limitParamIndex}
      OFFSET $${offsetParamIndex}
      `,
      params,
    );

    const rows = ((result.rows ?? []) as VentasXItemDbRow[]).map((row) => ({
      empresa: row.empresa ?? "",
      fecha_dcto: row.fecha_dcto ?? "",
      id_co: row.id_co ?? "",
      id_item: row.id_item ?? "",
      descripcion: row.descripcion ?? "",
      linea: row.linea ?? "",
      und_dia: toNumber(row.und_dia),
      venta_sin_impuesto_dia: toNumber(row.venta_sin_impuesto_dia),
      und_acum: toNumber(row.und_acum),
      venta_sin_impuesto_acum: toNumber(row.venta_sin_impuesto_acum),
    }));

    return withSession(
      NextResponse.json(
        {
          rows,
          total: rows.length,
          hasMore: rows.length === maxRows,
          nextOffset: offset + rows.length,
          range: { start: effectiveStart, end: effectiveEnd },
          source: "database",
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  } catch (error) {
    return withSession(
      NextResponse.json(
        {
          rows: [],
          total: 0,
          error:
            "No se pudieron cargar los datos de ventas x item: " +
            (error instanceof Error ? error.message : String(error)),
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      ),
    );
  } finally {
    client.release();
  }
}
