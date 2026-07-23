import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  compactDateToIso,
  parseMargenFilters,
  sedeKey,
  sedeLabel,
  toMargenPct,
  type MargenQueryFilters,
  type MargenViewMode,
} from "@/lib/margenes/margen-final-query";
import {
  buildMargenWhereForTable,
  clienteSelectSql,
  isRollTable,
  resolveMargenDataSource,
  sedeSelectSql,
  type MargenDataTable,
} from "@/lib/margenes/margen-data-source";
import {
  buildMargenOrderBy,
  summaryMetricsSqlFor,
} from "@/lib/margenes/metrics";
import { parseDrillPath } from "@/lib/margenes/drill-path";
import { parseFactPath, factPathToInvoiceKpiDrillPath } from "@/lib/margenes/fact-path";
import {
  queryClienteCompare,
  queryClienteFacturas,
  queryDrillBoard,
  queryFactListRows,
  queryFactNavRows,
  queryFilterOptions,
  queryFilterItemSearch,
  queryKpi,
  querySedeCompare,
} from "@/lib/margenes/drill-queries";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  assertMargenSedesAllowed,
  filterMargenSedeCatalogForUser,
} from "@/lib/margenes/margen-sede-scope";
import {
  applyMargenCategoriaScope,
  applyMargenLineaScope,
  resolveSessionLineCategoryScope,
  scopeExcludedTiposCacheSuffix,
  scopeLineasCacheSuffix,
  scopeTiposCacheSuffix,
} from "@/lib/shared/line-category-scope";
import { getCachedQuery, setCachedQuery } from "@/lib/margenes/query-cache";

const CACHE_CONTROL = "no-store, private";
const TABLE_ROW_LIMIT = 1000;

type DataMode =
  | "sedes"
  | "summary"
  | "filters"
  | "filter-items"
  | "kpi"
  | "drill"
  | "fact-nav"
  | "fact-list"
  | "cliente"
  | "cliente-facturas"
  | MargenViewMode;

const HEAVY_MODES: DataMode[] = [
  "summary",
  "filters",
  "filter-items",
  "kpi",
  "drill",
  "fact-nav",
  "fact-list",
  "cliente",
  "cliente-facturas",
  "producto",
  "factura",
  "sede",
];

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
  table: MargenDataTable,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereForTable(filters, params, table);
  const metrics = summaryMetricsSqlFor(table);
  const result = await client.query<{
    ventas_netas: string;
    costo_total: string;
    margen_pesos: string;
    row_count: string;
  }>(
    `
    SELECT
      ${metrics},
      COUNT(*)::bigint AS row_count
    FROM ${table}
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

const querySedesCatalog = async (
  client: PoolClient,
  table: MargenDataTable,
) => {
  const roll = isRollTable(table);
  const result = await client.query<{
    empresa: string;
    id_co: string;
  }>(
    roll
      ? `
    SELECT DISTINCT empresa_norm AS empresa, id_co_norm AS id_co
    FROM ${table}
    WHERE fecha_dcto IS NOT NULL
      AND fecha_dcto ~ '^[0-9]{8}$'
      AND empresa_norm <> ''
      AND id_co_norm <> ''
    ORDER BY 1, 2
    `
      : `
    SELECT DISTINCT
      LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
      LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co
    FROM ${table}
    WHERE fecha_dcto IS NOT NULL
      AND fecha_dcto ~ '^[0-9]{8}$'
      AND TRIM(COALESCE(empresa, '')) <> ''
      AND TRIM(COALESCE(id_co, '')) <> ''
    ORDER BY 1, 2
    `,
  );

  return {
    sedes: result.rows.map((row) => ({
      value: sedeKey(row.empresa, row.id_co),
      label: sedeLabel(row.empresa, row.id_co),
      empresa: row.empresa,
      idCo: row.id_co,
      rowCount: 0,
    })),
  };
};

const queryTable = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  mode: MargenViewMode,
  table: MargenDataTable,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereForTable(filters, params, table);
  const metrics = summaryMetricsSqlFor(table);
  const roll = isRollTable(table);

  if (mode === "producto") {
    const result = await client.query(
      roll
        ? `
      SELECT
        id_item,
        COALESCE(NULLIF(MAX(item_descripcion), ''), id_item) AS descripcion,
        COALESCE(NULLIF(MAX(nombre_linea1), ''), MAX(id_linea1)) AS linea,
        COALESCE(SUM(cantidad), 0) AS cantidad,
        ${metrics}
      FROM ${table}
      WHERE ${where}
      GROUP BY id_item
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC", ["ventasNetas", "costoTotal", "margenPesos", "cantidad"])}
      LIMIT ${TABLE_ROW_LIMIT}
      `
        : `
      SELECT
        TRIM(COALESCE(id_item::text, '')) AS id_item,
        COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS descripcion,
        COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS linea,
        COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
        ${metrics}
      FROM ${table}
      WHERE ${where}
      GROUP BY 1, 2, 3
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC", ["ventasNetas", "costoTotal", "margenPesos", "cantidad"])}
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
    const sedeCols = sedeSelectSql(table);
    const docFilter = roll
      ? `documento_fc <> ''`
      : `TRIM(COALESCE(documento_fc::text, '')) <> ''`;
    const result = await client.query(
      roll
        ? `
      SELECT
        documento_fc AS documento,
        id_tipdoc_fc AS tipdoc,
        fecha_dcto,
        ${sedeCols},
        ${clienteSelectSql(table)},
        ${metrics}
      FROM ${table}
      WHERE ${where}
        AND ${docFilter}
      GROUP BY 1, 2, 3, 4, 5
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC", ["ventasNetas", "costoTotal", "margenPesos"])}
      LIMIT ${TABLE_ROW_LIMIT}
      `
        : `
      SELECT
        TRIM(COALESCE(documento_fc::text, '')) AS documento,
        TRIM(COALESCE(id_tipdoc_fc::text, '')) AS tipdoc,
        fecha_dcto,
        ${sedeCols},
        ${clienteSelectSql(table)},
        ${metrics}
      FROM ${table}
      WHERE ${where}
        AND ${docFilter}
      GROUP BY 1, 2, 3, 4, 5
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC", ["ventasNetas", "costoTotal", "margenPesos"])}
      LIMIT ${TABLE_ROW_LIMIT}
      `,
      params,
    );
    return result.rows.map((row) => {
      const ventasNetas = toNumber(row.ventas_netas);
      const margenPesos = toNumber(row.margen_pesos);
      const clean = (value: unknown) => {
        const text = value == null ? "" : String(value).trim();
        return text === "" ? undefined : text;
      };
      return {
        documento: row.documento,
        tipdoc: row.tipdoc,
        documentoDocfc: clean(row.documento_docfc),
        idTerc: clean(row.id_terc),
        nombreTerc: clean(row.nombre_terc),
        idCaja: clean(row.id_caja),
        vendCc: clean(row.vend_cc),
        vendCcDesc: clean(row.vend_cc_desc),
        fecha: compactDateToIso(row.fecha_dcto) ?? row.fecha_dcto,
        sede: sedeLabel(row.empresa, row.id_co),
        ventasNetas,
        costoTotal: toNumber(row.costo_total),
        margenPesos,
        margenPct: toMargenPct(ventasNetas, margenPesos),
      };
    });
  }

  const sedeCols = sedeSelectSql(table);
  const result = await client.query(
    `
    SELECT
      ${sedeCols},
      ${metrics},
      COUNT(*)::bigint AS lineas
    FROM ${table}
    WHERE ${where}
    GROUP BY 1, 2
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC", ["ventasNetas", "costoTotal", "margenPesos"])}
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
  const allowedModes: DataMode[] = ["sedes", ...HEAVY_MODES];
  if (!allowedModes.includes(mode)) {
    return NextResponse.json(
      { error: "Modo invalido." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (mode === "sedes") {
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

      const dataTable = await resolveMargenDataSource(client);
      const payload = await querySedesCatalog(client, dataTable);
      const allowedCatalog = filterMargenSedeCatalogForUser(session.user);
      const allowedValues =
        allowedCatalog.length > 0
          ? new Set(allowedCatalog.map((option) => option.value))
          : null;
      const scopedPayload =
        allowedValues === null
          ? payload
          : {
              sedes: payload.sedes.filter((option) =>
                allowedValues.has(option.value),
              ),
            };
      const response = NextResponse.json(scopedPayload, {
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

  const parsed = parseMargenFilters(url.searchParams);
  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const lineScope = resolveSessionLineCategoryScope(session.user);
  parsed.categorias = applyMargenCategoriaScope(parsed.categorias, lineScope);
  parsed.lineas = applyMargenLineaScope(parsed.lineas, lineScope);
  if (lineScope.excludedMargenTipos?.length) {
    parsed.excludedCategorias = [...lineScope.excludedMargenTipos];
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

    if (HEAVY_MODES.includes(mode) && parsed.sedes.length === 0) {
      return NextResponse.json(
        { error: "Selecciona una sede antes de consultar datos." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      );
    }

    const sedeAccess = assertMargenSedesAllowed(parsed.sedes, session.user);
    if (!sedeAccess.ok) {
      return NextResponse.json(
        { error: sedeAccess.error },
        { status: sedeAccess.status, headers: { "Cache-Control": CACHE_CONTROL } },
      );
    }

    // Incluir scope de línea/categoría en la clave: admin vs asadero/fruver
    // no deben compartir payload aunque la URL sea idéntica.
    const cacheKey = `${url.search}${scopeTiposCacheSuffix(lineScope.forcedMargenTipos)}${scopeLineasCacheSuffix(lineScope.forcedMargenLineas)}${scopeExcludedTiposCacheSuffix(lineScope.excludedMargenTipos)}`;
    const cachedPayload = getCachedQuery(cacheKey);
    if (cachedPayload !== null) {
      const cachedResponse = NextResponse.json(cachedPayload, {
        headers: { "Cache-Control": CACHE_CONTROL },
      });
      cachedResponse.cookies.set(
        "vp_session",
        session.token,
        getSessionCookieOptions(session.expiresAt),
      );
      return cachedResponse;
    }

    // Sube work_mem solo para estas consultas pesadas (LOCAL se revierte al COMMIT).
    await client.query("BEGIN");
    await client.query("SET LOCAL work_mem = '256MB'");

    const dataTable = await resolveMargenDataSource(client);

    let payload: unknown;
    if (mode === "summary") {
      payload = await querySummary(client, parsed, dataTable);
    } else if (mode === "filters") {
      payload = await queryFilterOptions(client, parsed, dataTable);
    } else if (mode === "filter-items") {
      const itemSearch = url.searchParams.get("itemSearch") ?? "";
      payload = await queryFilterItemSearch(
        client,
        parsed,
        dataTable,
        itemSearch,
      );
    } else if (mode === "kpi") {
      const drillPath = parseDrillPath(url.searchParams.get("drillPath"));
      const mercadoOnly = url.searchParams.get("mercadoOnly") !== "false";
      payload = await queryKpi(client, parsed, drillPath, dataTable, {
        mercadoOnly,
      });
    } else if (mode === "drill") {
      const drillPath = parseDrillPath(url.searchParams.get("drillPath"));
      const search = url.searchParams.get("search") ?? undefined;
      payload = await queryDrillBoard(client, parsed, drillPath, dataTable, search);
    } else if (mode === "fact-nav") {
      const factPath = parseFactPath(url.searchParams.get("factPath"));
      const search = url.searchParams.get("search") ?? undefined;
      const kpiPath = factPathToInvoiceKpiDrillPath(factPath);
      const [kpi, table] = await Promise.all([
        queryKpi(client, parsed, kpiPath, dataTable, { mercadoOnly: false }),
        queryFactNavRows(client, parsed, factPath, dataTable, search),
      ]);
      payload = { kpi, ...table };
    } else if (mode === "fact-list") {
      const search = url.searchParams.get("search") ?? undefined;
      const factPath = parseFactPath(url.searchParams.get("factPath"));
      const mercadoOnly = false;
      if (factPath.some((step) => step.type === "factura")) {
        const kpiPath = factPathToInvoiceKpiDrillPath(factPath);
        const [kpi, table] = await Promise.all([
          queryKpi(client, parsed, kpiPath, dataTable, { mercadoOnly }),
          queryFactNavRows(client, parsed, factPath, dataTable, search),
        ]);
        payload = { kpi, ...table };
      } else {
        const [kpi, rows] = await Promise.all([
          queryKpi(client, parsed, [], dataTable, { mercadoOnly }),
          queryFactListRows(client, parsed, dataTable, search),
        ]);
        payload = {
          kpi,
          level: 0,
          levelName: "Factura",
          rows,
        };
      }
    } else if (mode === "sede") {
      const [kpi, rows] = await Promise.all([
        queryKpi(client, parsed, [], dataTable, { mercadoOnly: false }),
        querySedeCompare(client, parsed, dataTable),
      ]);
      payload = { kpi, rows };
    } else if (mode === "cliente") {
      const search = url.searchParams.get("search") ?? undefined;
      payload = await queryClienteCompare(client, parsed, dataTable, search);
      payload = {
        ...payload,
        level: 0,
        levelName: "Cliente",
      };
    } else if (mode === "cliente-facturas") {
      const idTerc = url.searchParams.get("idTerc") ?? "";
      const search = url.searchParams.get("search") ?? undefined;
      const factPath = parseFactPath(url.searchParams.get("factPath"));
      if (factPath.some((step) => step.type === "factura")) {
        const kpiPath = factPathToInvoiceKpiDrillPath(factPath);
        const [kpi, table] = await Promise.all([
          queryKpi(client, parsed, kpiPath, dataTable, { mercadoOnly: false }),
          queryFactNavRows(client, parsed, factPath, dataTable, search),
        ]);
        payload = { kpi, ...table };
      } else {
        payload = {
          ...(await queryClienteFacturas(
            client,
            parsed,
            dataTable,
            idTerc,
            search,
          )),
          level: 1,
          levelName: "Factura",
        };
      }
    } else {
      payload = {
        rows: await queryTable(client, parsed, mode, dataTable),
        limit: TABLE_ROW_LIMIT,
      };
    }

    await client.query("COMMIT");

    setCachedQuery(cacheKey, payload);

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
    await client.query("ROLLBACK").catch(() => {});
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[margenes/data] error", {
      mode,
      error: detail,
    });
    return NextResponse.json(
      {
        error: "Error consultando margen_final.",
        detail:
          process.env.NODE_ENV !== "production" ? detail : undefined,
      },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } finally {
    client.release();
  }
}
