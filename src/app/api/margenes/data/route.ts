import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  buildMargenWhereClause,
  compactDateToIso,
  empresaLabel,
  margenMetricSelect,
  parseMargenFilters,
  sedeKey,
  sedeLabel,
  toMargenPct,
  type MargenQueryFilters,
  type MargenViewMode,
} from "@/lib/margenes/margen-final-query";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";

const CACHE_CONTROL = "no-store, private";
const TABLE_ROW_LIMIT = 1000;

type DataMode = "summary" | "filters" | MargenViewMode;

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const ensureMargenTable = async (client: PoolClient) => {
  const tableCheck = await client.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'margen_final'
    LIMIT 1
  `);
  return Boolean(tableCheck.rows?.length);
};

const querySummary = async (
  client: PoolClient,
  filters: MargenQueryFilters,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(filters, params);
  const result = await client.query<{
    ventas_netas: string;
    costo_total: string;
    margen_pesos: string;
    row_count: string;
  }>(
    `
    SELECT
      ${margenMetricSelect},
      COUNT(*)::bigint AS row_count
    FROM margen_final
    WHERE ${where}
    `,
    params,
  );
  const row = result.rows[0];
  const ventasNetas = toNumber(row?.ventas_netas);
  const costoTotal = toNumber(row?.costo_total);
  const margenPesos = toNumber(row?.margen_pesos);
  return {
    ventasNetas,
    costoTotal,
    margenPesos,
    margenPct: toMargenPct(ventasNetas, margenPesos),
    rowCount: Number(row?.row_count ?? 0),
    from: compactDateToIso(filters.fromCompact),
    to: compactDateToIso(filters.toCompact),
  };
};

const queryFilters = async (
  client: PoolClient,
  filters: MargenQueryFilters,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(
    {
      ...filters,
      categorias: [],
      lineas: [],
      sublineas: [],
      items: [],
    },
    params,
  );

  const [empresas, sedes, fechas, categorias, lineas, sublineas, items] =
    await Promise.all([
      client.query<{ value: string }>(
        `
        SELECT DISTINCT LOWER(TRIM(COALESCE(empresa, ''))) AS value
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(empresa, '')) <> ''
        ORDER BY 1
        `,
        params,
      ),
      client.query<{
        empresa: string;
        id_co: string;
      }>(
        `
        SELECT DISTINCT
          LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
          LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(empresa, '')) <> ''
          AND TRIM(COALESCE(id_co, '')) <> ''
        ORDER BY 1, 2
        `,
        params,
      ),
      client.query<{ value: string }>(
        `
        SELECT DISTINCT fecha_dcto AS value
        FROM margen_final
        WHERE ${where}
        ORDER BY 1 DESC
        `,
        params,
      ),
      client.query<{ value: string; label: string }>(
        `
        SELECT DISTINCT
          TRIM(COALESCE(id_tipo::text, '')) AS value,
          TRIM(COALESCE(id_tipo::text, '')) AS label
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(id_tipo::text, '')) <> ''
        ORDER BY 1
        `,
        params,
      ),
      client.query<{ value: string; label: string }>(
        `
        SELECT DISTINCT
          TRIM(COALESCE(id_linea1::text, '')) AS value,
          COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS label
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(id_linea1::text, '')) <> ''
        ORDER BY 2
        `,
        params,
      ),
      client.query<{ value: string; label: string }>(
        `
        SELECT DISTINCT
          TRIM(COALESCE(id_linea2::text, '')) AS value,
          COALESCE(NULLIF(TRIM(nombre_linea2), ''), TRIM(COALESCE(id_linea2::text, ''))) AS label
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(id_linea2::text, '')) <> ''
        ORDER BY 2
        `,
        params,
      ),
      client.query<{ value: string; label: string }>(
        `
        SELECT DISTINCT
          TRIM(COALESCE(id_item::text, '')) AS value,
          COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS label
        FROM margen_final
        WHERE ${where}
          AND TRIM(COALESCE(id_item::text, '')) <> ''
        ORDER BY 2
        LIMIT 500
        `,
        params,
      ),
    ]);

  return {
    empresas: empresas.rows.map((row) => ({
      value: row.value,
      label: empresaLabel(row.value),
    })),
    sedes: sedes.rows.map((row) => ({
      value: sedeKey(row.empresa, row.id_co),
      label: sedeLabel(row.empresa, row.id_co),
      empresa: row.empresa,
      idCo: row.id_co,
    })),
    fechas: fechas.rows.map((row) => ({
      value: row.value,
      label: compactDateToIso(row.value) ?? row.value,
    })),
    categorias: categorias.rows,
    lineas: lineas.rows,
    sublineas: sublineas.rows,
    items: items.rows,
  };
};

const queryTable = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  mode: MargenViewMode,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(filters, params);

  if (mode === "producto") {
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(id_item::text, '')) AS id_item,
        COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS descripcion,
        COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS linea,
        COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
        ${margenMetricSelect}
      FROM margen_final
      WHERE ${where}
      GROUP BY 1, 2, 3
      ORDER BY ventas_netas DESC
      LIMIT ${TABLE_ROW_LIMIT}
      `,
      params,
    );
    return result.rows.map((row) => {
      const ventasNetas = toNumber(row.ventas_netas);
      const margenPesos = toNumber(row.margen_pesos);
      return {
        idItem: row.id_item,
        descripcion: row.descripcion,
        linea: row.linea,
        cantidad: toNumber(row.cantidad),
        ventasNetas,
        costoTotal: toNumber(row.costo_total),
        margenPesos,
        margenPct: toMargenPct(ventasNetas, margenPesos),
      };
    });
  }

  if (mode === "factura") {
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(documento_fc::text, '')) AS documento,
        TRIM(COALESCE(id_tipdoc_fc::text, '')) AS tipdoc,
        fecha_dcto,
        LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
        LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co,
        ${margenMetricSelect}
      FROM margen_final
      WHERE ${where}
        AND TRIM(COALESCE(documento_fc::text, '')) <> ''
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY ventas_netas DESC
      LIMIT ${TABLE_ROW_LIMIT}
      `,
      params,
    );
    return result.rows.map((row) => {
      const ventasNetas = toNumber(row.ventas_netas);
      const margenPesos = toNumber(row.margen_pesos);
      return {
        documento: row.documento,
        tipdoc: row.tipdoc,
        fecha: compactDateToIso(row.fecha_dcto) ?? row.fecha_dcto,
        sede: sedeLabel(row.empresa, row.id_co),
        ventasNetas,
        costoTotal: toNumber(row.costo_total),
        margenPesos,
        margenPct: toMargenPct(ventasNetas, margenPesos),
      };
    });
  }

  const result = await client.query(
    `
    SELECT
      LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
      LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co,
      ${margenMetricSelect},
      COUNT(*)::bigint AS lineas
    FROM margen_final
    WHERE ${where}
    GROUP BY 1, 2
    ORDER BY ventas_netas DESC
  `,
    params,
  );
  return result.rows.map((row) => {
    const ventasNetas = toNumber(row.ventas_netas);
    const margenPesos = toNumber(row.margen_pesos);
    return {
      empresa: row.empresa,
      idCo: row.id_co,
      sede: sedeLabel(row.empresa, row.id_co),
      lineas: Number(row.lineas ?? 0),
      ventasNetas,
      costoTotal: toNumber(row.costo_total),
      margenPesos,
      margenPct: toMargenPct(ventasNetas, margenPesos),
    };
  });
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "margenes"))
  ) {
    return NextResponse.json(
      { error: "No tienes permisos para esta seccion." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "summary") as DataMode;
  const allowedModes: DataMode[] = [
    "summary",
    "filters",
    "producto",
    "factura",
    "sede",
  ];
  if (!allowedModes.includes(mode)) {
    return NextResponse.json(
      { error: "Modo invalido." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const parsed = parseMargenFilters(url.searchParams);
  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const tableExists = await ensureMargenTable(client);
    if (!tableExists) {
      return NextResponse.json(
        {
          error:
            "Tabla margen_final no existe. Aplica db/migrations/20260622_margen_final.sql.",
        },
        { status: 503, headers: { "Cache-Control": CACHE_CONTROL } },
      );
    }

    let payload: unknown;
    if (mode === "summary") {
      payload = await querySummary(client, parsed);
    } else if (mode === "filters") {
      payload = await queryFilters(client, parsed);
    } else {
      payload = {
        rows: await queryTable(client, parsed, mode),
        limit: mode === "sede" ? null : TABLE_ROW_LIMIT,
      };
    }

    const response = NextResponse.json(payload, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  } catch (error) {
    console.error("[margenes/data] error", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Error consultando margen_final." },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } finally {
    client.release();
  }
}
