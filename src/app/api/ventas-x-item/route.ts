import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";
import {
  buildDateNotFoundError,
  getVentasXItemDateAvailability,
  validateVentasXItemDateRange,
} from "@/lib/ventas-x-item-date-range";
import { normalizeEmpresa } from "@/lib/ventas-x-item";

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

const parseList = (raw: string | null) =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const buildEmpresaWhereClause = (
  columnPrefix: string,
  params: unknown[],
  empresas: string[],
) => {
  if (empresas.length === 0) return null;
  params.push(empresas);
  return `COALESCE(NULLIF(${columnPrefix}empresa_norm, ''), ${columnPrefix}empresa) = ANY($${params.length}::text[])`;
};

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
    (!canAccessPortalSection(allowedDashboards, "venta") ||
      !canAccessPortalSubsection(
        session.user.allowedSubdashboards,
        "ventas-x-item",
      ))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
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
  const mode = (url.searchParams.get("mode") ?? "").trim().toLowerCase();
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
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
      const empresaClause = buildEmpresaWhereClause("", metaParams, empresas);
      if (empresaClause) metaWhere.push(empresaClause);

      const availability = await getVentasXItemDateAvailability(client, {
        whereClauses: metaWhere,
        params: metaParams,
      });

      return withSession(
        NextResponse.json(
          {
            minDate: availability.minDate,
            maxDate: availability.maxDate,
            totalRows: availability.totalRows,
            source: "database",
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    const validatedRange = validateVentasXItemDateRange(start, end);
    if (!validatedRange.ok) {
      return withSession(
        NextResponse.json(validatedRange.error, { status: 400 }),
      );
    }

    const availabilityParams: unknown[] = [];
    const availabilityWhere: string[] = [];
    const availabilityEmpresaClause = buildEmpresaWhereClause(
      "",
      availabilityParams,
      empresas,
    );
    if (availabilityEmpresaClause) {
      availabilityWhere.push(availabilityEmpresaClause);
    }

    const availability = await getVentasXItemDateAvailability(
      client,
      {
        whereClauses: availabilityWhere,
        params: availabilityParams,
      },
      {
        startCompact: validatedRange.startCompact,
        endCompact: validatedRange.endCompact,
      },
    );

    const missingDateError = buildDateNotFoundError(
      availability,
      validatedRange.start,
      validatedRange.end,
    );
    if (missingDateError) {
      return withSession(
        NextResponse.json(missingDateError, { status: 400 }),
      );
    }

    if (mode === "summary") {
      const summaryParams: unknown[] = [
        validatedRange.startCompact,
        validatedRange.endCompact,
      ];
      const summaryWhere: string[] = [
        "base.fecha_dcto >= $1",
        "base.fecha_dcto <= $2",
      ];

      const empresaClause = buildEmpresaWhereClause("base.", summaryParams, empresas);
      if (empresaClause) summaryWhere.push(empresaClause);

      if (itemIds.length > 0) {
        summaryParams.push(itemIds);
        summaryWhere.push(`base.id_item = ANY($${summaryParams.length}::text[])`);
      }

      const summaryResult = await client.query(
        `
        SELECT
          base.empresa,
          base.fecha_dcto,
          base.id_co,
          base.id_item,
          MAX(base.descripcion) AS descripcion,
          MAX(base.linea) AS linea,
          SUM(COALESCE(base.und_dia::numeric, 0))::float8 AS und_dia,
          SUM(COALESCE(base.venta_sin_impuesto_dia::numeric, 0))::float8 AS venta_sin_impuesto_dia,
          0::float8 AS und_acum,
          0::float8 AS venta_sin_impuesto_acum
        FROM ventas_item_diario base
        WHERE ${summaryWhere.join(" AND ")}
        GROUP BY base.empresa, base.fecha_dcto, base.id_co, base.id_item
        ORDER BY base.fecha_dcto DESC, base.empresa, base.id_co, base.id_item
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
            range: { start: validatedRange.start, end: validatedRange.end },
            source: "database-summary",
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
      );
    }

    const params: unknown[] = [
      validatedRange.startCompact,
      validatedRange.endCompact,
    ];
    const where: string[] = ["base.fecha_dcto >= $1", "base.fecha_dcto <= $2"];

    const empresaClause = buildEmpresaWhereClause("base.", params, empresas);
    if (empresaClause) where.push(empresaClause);

    params.push(maxRows);
    const limitParamIndex = params.length;
    params.push(offset);
    const offsetParamIndex = params.length;

    const result = await client.query(
      `
      SELECT
        base.empresa,
        base.fecha_dcto,
        base.id_co,
        base.id_item,
        base.descripcion,
        base.linea,
        base.und_dia,
        base.venta_sin_impuesto_dia,
        base.und_acum,
        base.venta_sin_impuesto_acum
      FROM ventas_item_diario base
      WHERE ${where.join(" AND ")}
      ORDER BY
        base.fecha_dcto DESC,
        base.empresa,
        base.id_co,
        base.id_item,
        base.descripcion,
        base.linea,
        base.id DESC
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
          range: { start: validatedRange.start, end: validatedRange.end },
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
