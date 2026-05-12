import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  buildInventarioLineKey,
  getInventarioLineLabel,
  getInventarioSubcategory,
  INVENTARIO_X_ITEM_SOURCE_TABLE,
  parseInventarioLineKey,
  type InventarioSubcategoryKey,
} from "@/lib/inventario/x-item";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  resolveRotacionBaseSqlFields,
  type RotacionBaseDateColumn,
} from "@/lib/rotacion/base-fields";

type DateRangeRow = {
  min_date: string | null;
  max_date: string | null;
};

type InventoryFilterDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
};

type InventorySummaryDbRow = {
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  total_units: string | number | null;
  tracked_days: string | number | null;
  rotation_days: string | number | null;
  company_count: string | number | null;
  sede_count: string | number | null;
};

type InventoryMatrixDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  total_units: string | number | null;
  tracked_days: string | number | null;
  rotation_days: string | number | null;
};

type InventorySummaryRow = {
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
  companyCount: number;
  sedeCount: number;
};

type InventoryMatrixRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
};

type InventoryFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
};

type InventoryLineFilter = {
  lineaN1Codigo: string | null;
  lineaName: string;
};

const CACHE_CONTROL = "no-store";
const META_CACHE_TTL_MS = 5 * 60 * 1000;

const HIDDEN_SEDE_KEYS = new Set([
  "adm",
  "cedicavasa",
  "centrodistribucioncavasa",
  "importados",
]);

let dateRangeCache:
  | { value: { min: string | null; max: string | null }; expiresAt: number }
  | null = null;
let filterCatalogCache:
  | { dateKey: string; value: InventoryFilterCatalog; expiresAt: number }
  | null = null;

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const compactToIsoDate = (value: string | null) => {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const isoToCompactDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value.replace(/-/g, "");
};

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const buildCompactDateRangeSql = (
  column: RotacionBaseDateColumn,
  startParam = "$1",
  endParam = "$2",
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date BETWEEN TO_DATE(${startParam}::text, 'YYYYMMDD') AND TO_DATE(${endParam}::text, 'YYYYMMDD')`
    : `${column} BETWEEN ${startParam} AND ${endParam}
        AND ${column} ~ '^[0-9]{8}$'`;

/** Fecha por fila para ultimo corte y conteo de dias con dato (DI). */
const buildConsultaDateSql = (column: RotacionBaseDateColumn) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date`
    : `TO_DATE(${column}, 'YYYYMMDD')`;

/** Solo fecha fin del rango: catalogo de lineas sin escanear todo el periodo. */
const buildEndDateEqualsSql = (
  column: RotacionBaseDateColumn,
  endParam = "$1",
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date = TO_DATE(${endParam}::text, 'YYYYMMDD')`
    : `${column} = ${endParam}::text
        AND ${column} ~ '^[0-9]{8}$'`;

const getAvailableDateRange = async () => {
  const now = Date.now();
  if (dateRangeCache && dateRangeCache.expiresAt > now) {
    return dateRangeCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const { dateColumn } = await resolveRotacionBaseSqlFields(client);
    const result = await client.query(
      `
      SELECT
        MIN(${dateColumn === "fecha_carga" || dateColumn === "fecha_dia" ? `TO_CHAR(${dateColumn}::date, 'YYYYMMDD')` : dateColumn}) AS min_date,
        MAX(${dateColumn === "fecha_carga" || dateColumn === "fecha_dia" ? `TO_CHAR(${dateColumn}::date, 'YYYYMMDD')` : dateColumn}) AS max_date
      FROM rotacion_base_item_dia_sede
      WHERE ${
        dateColumn === "fecha_carga" || dateColumn === "fecha_dia"
          ? `${dateColumn} IS NOT NULL`
          : `${dateColumn} ~ '^[0-9]{8}$'`
      }
      `,
    );

    const row = (result.rows?.[0] as DateRangeRow | undefined) ?? null;
    const value = {
      min: row?.min_date ?? null,
      max: row?.max_date ?? null,
    };
    dateRangeCache = {
      value,
      expiresAt: now + META_CACHE_TTL_MS,
    };
    return value;
  } finally {
    client.release();
  }
};

const getInventoryFilterCatalog = async (
  dateRangeCompact: { start: string; end: string },
): Promise<InventoryFilterCatalog> => {
  const now = Date.now();
  const dateKey = `${dateRangeCompact.start}-${dateRangeCompact.end}`;
  if (
    filterCatalogCache &&
    filterCatalogCache.dateKey === dateKey &&
    filterCatalogCache.expiresAt > now
  ) {
    return filterCatalogCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const result = await client.query(
      `
      SELECT DISTINCT
        ${fields.empresaExpr} AS empresa,
        ${fields.sedeIdExpr} AS sede_id,
        ${fields.sedeNameExpr} AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE ${buildCompactDateRangeSql(dateColumn)}
        AND ${fields.itemPresentCondition}
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
      `,
      [dateRangeCompact.start, dateRangeCompact.end],
    );

    const sedes = ((result.rows ?? []) as InventoryFilterDbRow[])
      .map((row) => ({
        empresa: row.empresa,
        sedeId: row.sede_id,
        sedeName: row.sede_name,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));

    const companies = Array.from(new Set(sedes.map((row) => row.empresa))).sort(
      (left, right) => left.localeCompare(right, "es"),
    );

    const value = { companies, sedes };
    filterCatalogCache = {
      dateKey,
      value,
      expiresAt: now + META_CACHE_TTL_MS,
    };
    return value;
  } finally {
    client.release();
  }
};

const mapInventorySummaryDbRow = (
  row: InventorySummaryDbRow,
): InventorySummaryRow => {
  const subcategory = getInventarioSubcategory(row.linea_n1_codigo);
  return {
    lineKey: buildInventarioLineKey({
      linea: row.linea,
      lineaN1Codigo: row.linea_n1_codigo,
    }),
    lineLabel: getInventarioLineLabel({
      linea: row.linea,
      lineaN1Codigo: row.linea_n1_codigo,
    }),
    linea: row.linea,
    lineaN1Codigo: row.linea_n1_codigo,
    subcategory,
    item: row.item,
    descripcion: row.descripcion,
    unidad: row.unidad,
    inventoryUnits: toNumber(row.inventory_units),
    inventoryValue: toNumber(row.inventory_value),
    totalUnits: toNumber(row.total_units),
    trackedDays: toNumber(row.tracked_days),
    rotationDays: toNumber(row.rotation_days),
    companyCount: toNumber(row.company_count),
    sedeCount: toNumber(row.sede_count),
  };
};

/**
 * Listado liviano para mode=catalog: un solo dia (fecha fin del rango) sin CTEs
 * ni ventanas; alimenta lineas/ítems sin bloquear la UI.
 */
const queryInventoryCatalogRows = async ({
  dateRangeCompact,
  empresas,
  sedes,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const result = await client.query(
      `
      SELECT
        ${fields.lineExpr} AS linea,
        ${fields.n1CodeExpr} AS linea_n1_codigo,
        ${fields.itemExpr} AS item,
        ${fields.descriptionExpr} AS descripcion,
        ${fields.unitExpr} AS unidad,
        SUM(${fields.closingUnitsExpr})::numeric AS inventory_units,
        SUM(${fields.inventoryValueExpr})::numeric AS inventory_value,
        SUM(${fields.unitsSoldExpr})::numeric AS total_units,
        1::int AS tracked_days,
        CASE
          WHEN SUM(${fields.closingUnitsExpr}) <= 0
            OR SUM(${fields.inventoryValueExpr}) <= 0
            THEN 0::numeric
          WHEN SUM(${fields.unitsSoldExpr}) <= 0
            THEN 999999::numeric
          ELSE
            SUM(${fields.closingUnitsExpr})::numeric
              / NULLIF(SUM(${fields.unitsSoldExpr}), 0)
        END AS rotation_days,
        COUNT(DISTINCT ${fields.empresaExpr})::int AS company_count,
        COUNT(DISTINCT ${fields.sedeIdExpr})::int AS sede_count
      FROM rotacion_base_item_dia_sede
      WHERE ${buildEndDateEqualsSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ($2::text[] IS NULL OR ${fields.empresaExpr} = ANY($2::text[]))
        AND ($3::text[] IS NULL OR ${fields.sedeIdExpr} = ANY($3::text[]))
      GROUP BY
        ${fields.lineExpr},
        ${fields.n1CodeExpr},
        ${fields.itemExpr},
        ${fields.descriptionExpr},
        ${fields.unitExpr}
      HAVING
        SUM(${fields.closingUnitsExpr}) > 0
        OR SUM(${fields.inventoryValueExpr}) > 0
      ORDER BY
        inventory_value DESC,
        item ASC
      `,
      [
        dateRangeCompact.end,
        empresas.length > 0 ? empresas : null,
        sedes.length > 0 ? sedes : null,
      ],
    );

    return ((result.rows ?? []) as InventorySummaryDbRow[]).map(
      mapInventorySummaryDbRow,
    );
  } finally {
    client.release();
  }
};

const queryInventorySummaryRows = async ({
  dateRangeCompact,
  empresas,
  sedes,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const result = await client.query(
      `
      WITH scoped AS (
        SELECT
          ${fields.lineExpr} AS linea,
          ${fields.n1CodeExpr} AS linea_n1_codigo,
          ${fields.itemExpr} AS item,
          ${fields.descriptionExpr} AS descripcion,
          ${fields.unitExpr} AS unidad,
          ${fields.empresaExpr} AS empresa,
          ${fields.sedeIdExpr} AS sede_id,
          ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value,
          ${fields.unitsSoldExpr} AS total_units,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date,
          ${fields.loadTimestampExpr} AS carga_ts
        FROM rotacion_base_item_dia_sede
        WHERE ${buildCompactDateRangeSql(dateColumn)}
          AND ${fields.itemPresentCondition}
          AND ($3::text[] IS NULL OR ${fields.empresaExpr} = ANY($3::text[]))
          AND ($4::text[] IS NULL OR ${fields.sedeIdExpr} = ANY($4::text[]))
      ),
      ranked AS (
        SELECT
          *,
          MIN(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS first_consulta_date,
          MAX(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS latest_consulta_date
        FROM scoped
      ),
      sales_agg AS (
        SELECT
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          SUM(total_units)::numeric AS total_units,
          COUNT(DISTINCT consulta_date)::int AS tracked_days
        FROM scoped
        GROUP BY
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      ),
      latest_inv AS (
        SELECT
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_units
              ELSE 0
            END
          )::numeric AS inventory_units,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_value
              ELSE 0
            END
          )::numeric AS inventory_value
        FROM ranked
        GROUP BY
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      ),
      key_counts AS (
        SELECT
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          COUNT(DISTINCT empresa)::int AS company_count,
          COUNT(DISTINCT sede_id)::int AS sede_count
        FROM scoped
        GROUP BY
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      )
      SELECT
        s.linea,
        s.linea_n1_codigo,
        s.item,
        s.descripcion,
        s.unidad,
        l.inventory_units,
        l.inventory_value,
        s.total_units,
        s.tracked_days,
        CASE
          WHEN l.inventory_units <= 0 OR l.inventory_value <= 0 THEN 0::numeric
          WHEN s.total_units <= 0 OR s.tracked_days <= 0 THEN 999999::numeric
          ELSE
            (l.inventory_units * s.tracked_days::numeric) / NULLIF(s.total_units, 0)
        END AS rotation_days,
        k.company_count,
        k.sede_count
      FROM sales_agg s
      INNER JOIN latest_inv l
        ON l.linea IS NOT DISTINCT FROM s.linea
        AND l.linea_n1_codigo IS NOT DISTINCT FROM s.linea_n1_codigo
        AND l.item IS NOT DISTINCT FROM s.item
        AND l.descripcion IS NOT DISTINCT FROM s.descripcion
        AND l.unidad IS NOT DISTINCT FROM s.unidad
      INNER JOIN key_counts k
        ON k.linea IS NOT DISTINCT FROM s.linea
        AND k.linea_n1_codigo IS NOT DISTINCT FROM s.linea_n1_codigo
        AND k.item IS NOT DISTINCT FROM s.item
        AND k.descripcion IS NOT DISTINCT FROM s.descripcion
        AND k.unidad IS NOT DISTINCT FROM s.unidad
      WHERE
        l.inventory_units > 0
        OR l.inventory_value > 0
      ORDER BY
        l.inventory_value DESC,
        s.item ASC
      `,
      [
        dateRangeCompact.start,
        dateRangeCompact.end,
        empresas.length > 0 ? empresas : null,
        sedes.length > 0 ? sedes : null,
      ],
    );

    return ((result.rows ?? []) as InventorySummaryDbRow[]).map(
      mapInventorySummaryDbRow,
    );
  } finally {
    client.release();
  }
};

const queryInventoryMatrixRows = async ({
  dateRangeCompact,
  empresas,
  sedes,
  lines,
  subcategory,
  items,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
  lines: InventoryLineFilter[];
  subcategory: InventarioSubcategoryKey | null;
  items: string[];
}): Promise<InventoryMatrixRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const params: Array<string | string[] | null> = [
      dateRangeCompact.start,
      dateRangeCompact.end,
      empresas.length > 0 ? empresas : null,
      sedes.length > 0 ? sedes : null,
    ];

    const whereClauses = [
      buildCompactDateRangeSql(dateColumn),
      fields.itemPresentCondition,
      `($3::text[] IS NULL OR ${fields.empresaExpr} = ANY($3::text[]))`,
      `($4::text[] IS NULL OR ${fields.sedeIdExpr} = ANY($4::text[]))`,
    ];

    if (subcategory === "perecederos") {
      whereClauses.push(
        `COALESCE(${fields.n1CodeExpr}, 'sin_codigo') IN ('01', '02', '03', '04', '12')`,
      );
    } else if (subcategory === "manufacturas") {
      whereClauses.push(
        `COALESCE(${fields.n1CodeExpr}, 'sin_codigo') NOT IN ('01', '02', '03', '04', '12')`,
      );
    }

    if (lines.length > 0) {
      const lineConditions = lines.map((line) => {
        params.push(line.lineaName.toLowerCase());
        const lineNameParam = params.length;

        if (line.lineaN1Codigo) {
          params.push(line.lineaN1Codigo);
          const lineCodeParam = params.length;
          return `(
            LOWER(${fields.lineExpr}) = $${lineNameParam}
            AND COALESCE(${fields.n1CodeExpr}, 'sin_codigo') = $${lineCodeParam}
          )`;
        }

        return `(
          LOWER(${fields.lineExpr}) = $${lineNameParam}
          AND ${fields.n1CodeExpr} IS NULL
        )`;
      });

      whereClauses.push(`(${lineConditions.join(" OR ")})`);
    }

    const itemFilterParam =
      items.length > 0 ? (() => {
        params.push(items);
        return params.length;
      })() : null;

    const result = await client.query(
      `
      WITH scoped AS (
        SELECT
          ${fields.empresaExpr} AS empresa,
          ${fields.sedeIdExpr} AS sede_id,
          ${fields.sedeNameExpr} AS sede_name,
          ${fields.lineExpr} AS linea,
          ${fields.n1CodeExpr} AS linea_n1_codigo,
          ${fields.itemExpr} AS item,
          ${fields.descriptionExpr} AS descripcion,
          ${fields.unitExpr} AS unidad,
          ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value,
          ${fields.unitsSoldExpr} AS total_units,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date,
          ${fields.loadTimestampExpr} AS carga_ts
        FROM rotacion_base_item_dia_sede
        WHERE ${whereClauses.join("\n          AND ")}
      ),
      ranked AS (
        SELECT
          *,
          MIN(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS first_consulta_date,
          MAX(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS latest_consulta_date
        FROM scoped
      ),
      top_items AS (
        SELECT item
        FROM ranked
        WHERE consulta_date = latest_consulta_date
        GROUP BY item
        ORDER BY SUM(inventory_value) DESC NULLS LAST, item ASC
        LIMIT ${itemFilterParam ? "999999" : "10"}
      ),
      aggregated AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          SUM(total_units)::numeric AS total_units,
          COUNT(DISTINCT consulta_date)::int AS tracked_days,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_units
              ELSE 0
            END
          )::numeric AS inventory_units,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_value
              ELSE 0
            END
          )::numeric AS inventory_value
        FROM ranked
        WHERE ${
          itemFilterParam
            ? `item = ANY($${itemFilterParam}::text[])`
            : "item IN (SELECT item FROM top_items)"
        }
        GROUP BY
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      )
      SELECT
        empresa,
        sede_id,
        sede_name,
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad,
        inventory_units,
        inventory_value,
        total_units,
        tracked_days,
        CASE
          WHEN inventory_units <= 0 OR inventory_value <= 0 THEN 0::numeric
          WHEN total_units <= 0 OR tracked_days <= 0 THEN 999999::numeric
          ELSE (inventory_units * tracked_days::numeric) / NULLIF(total_units, 0)
        END AS rotation_days
      FROM aggregated
      WHERE
        inventory_units > 0
        OR inventory_value > 0
      ORDER BY
        empresa ASC,
        sede_name ASC,
        inventory_units DESC,
        item ASC
      `,
      params,
    );

    return ((result.rows ?? []) as InventoryMatrixDbRow[])
      .map((row) => {
        const subcategory = getInventarioSubcategory(row.linea_n1_codigo);
        return {
          empresa: row.empresa,
          sedeId: row.sede_id,
          sedeName: row.sede_name,
          lineKey: buildInventarioLineKey({
            linea: row.linea,
            lineaN1Codigo: row.linea_n1_codigo,
          }),
          lineLabel: getInventarioLineLabel({
            linea: row.linea,
            lineaN1Codigo: row.linea_n1_codigo,
          }),
          linea: row.linea,
          lineaN1Codigo: row.linea_n1_codigo,
          subcategory,
          item: row.item,
          descripcion: row.descripcion,
          unidad: row.unidad,
          inventoryUnits: toNumber(row.inventory_units),
          inventoryValue: toNumber(row.inventory_value),
          totalUnits: toNumber(row.total_units),
          trackedDays: toNumber(row.tracked_days),
          rotationDays: toNumber(row.rotation_days),
        };
      })
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));
  } finally {
    client.release();
  }
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "venta") ||
      !canAccessPortalSubsection(
        session.user.allowedSubdashboards,
        "inventario-x-item",
      ))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    const availableRange = await getAvailableDateRange();
    const minDateCompact = availableRange.min;
    const maxDateCompact = availableRange.max;
    const availableDateStart = compactToIsoDate(minDateCompact);
    const availableDateEnd = compactToIsoDate(maxDateCompact);

    if (!minDateCompact || !maxDateCompact || !availableDateStart || !availableDateEnd) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            matrixRows: [],
            filters: {
              companies: [],
              sedes: [],
            },
            meta: {
              availableDate: "",
              availableDateStart: "",
              availableDateEnd: "",
              selectedDateStart: "",
              selectedDateEnd: "",
              sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
            },
            message: "La tabla de inventario por item todavia no tiene datos.",
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const url = new URL(request.url);
    const requestMode = url.searchParams.get("mode");
    const mode =
      requestMode === "filters" ||
      requestMode === "catalog" ||
      requestMode === "table"
        ? requestMode
        : "full";
    const requestedDateStart = isoToCompactDate(
      url.searchParams.get("dateStart"),
    );
    const requestedDateEnd = isoToCompactDate(url.searchParams.get("dateEnd"));
    let dateStartCompact = requestedDateStart ?? maxDateCompact;
    let dateEndCompact = requestedDateEnd ?? dateStartCompact;
    if (!requestedDateStart && requestedDateEnd) {
      dateStartCompact = dateEndCompact;
    }
    if (dateStartCompact < minDateCompact) dateStartCompact = minDateCompact;
    if (dateEndCompact > maxDateCompact) dateEndCompact = maxDateCompact;
    if (dateStartCompact > dateEndCompact) {
      const temp = dateStartCompact;
      dateStartCompact = dateEndCompact;
      dateEndCompact = temp;
    }
    const selectedDateStart = compactToIsoDate(dateStartCompact) ?? availableDateEnd;
    const selectedDateEnd = compactToIsoDate(dateEndCompact) ?? availableDateEnd;
    const requestedCompanies = Array.from(
      new Set(
        url.searchParams
          .getAll("empresa")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const requestedSedes = Array.from(
      new Set(
        url.searchParams
          .getAll("sede")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const requestedSubcategory = url.searchParams.get("subcategory");
    const subcategory =
      requestedSubcategory === "perecederos" ||
      requestedSubcategory === "manufacturas"
        ? requestedSubcategory
        : null;
    const lines = Array.from(
      new Set(
        url.searchParams
          .getAll("line")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
      .map((value) => parseInventarioLineKey(value))
      .filter((value) => value.lineaName.length > 0)
      .map((value) => ({
        lineaN1Codigo: value.lineaN1Codigo,
        lineaName: value.lineaName,
      }));
    const items = Array.from(
      new Set(
        url.searchParams
          .getAll("item")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).slice(0, 10);

    const [filters, rows, matrixRows] = await Promise.all([
      getInventoryFilterCatalog({
        start: dateStartCompact,
        end: dateEndCompact,
      }),
      mode === "catalog"
        ? queryInventoryCatalogRows({
            dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
            empresas: requestedCompanies,
            sedes: requestedSedes,
          })
        : mode === "table" || mode === "filters"
          ? Promise.resolve<InventorySummaryRow[]>([])
          : queryInventorySummaryRows({
              dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
              empresas: requestedCompanies,
              sedes: requestedSedes,
            }),
      mode === "catalog" || mode === "filters"
        ? Promise.resolve<InventoryMatrixRow[]>([])
        : queryInventoryMatrixRows({
            dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
            empresas: requestedCompanies,
            sedes: requestedSedes,
            lines,
            subcategory,
            items,
          }),
    ]);

    return withSession(
      NextResponse.json(
        {
          rows,
          matrixRows,
          filters,
          meta: {
            availableDate: availableDateEnd,
            availableDateStart,
            availableDateEnd,
            selectedDateStart,
            selectedDateEnd,
            sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
            selectedCompany:
              requestedCompanies.length === 1 ? requestedCompanies[0] : null,
            selectedSede: requestedSedes.length === 1 ? requestedSedes[0] : null,
          },
        },
        {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "database",
          },
        },
      ),
    );
  } catch (error) {
    console.error("Error en endpoint de inventario x item:", error);
    return withSession(
      NextResponse.json(
        {
          rows: [],
          matrixRows: [],
          filters: {
            companies: [],
            sedes: [],
          },
          meta: {
            availableDate: "",
            availableDateStart: "",
            availableDateEnd: "",
            selectedDateStart: "",
            selectedDateEnd: "",
            sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
          },
          error:
            "Error de conexion: " +
            (error instanceof Error ? error.message : String(error)),
        },
        {
          status: 500,
          headers: { "Cache-Control": CACHE_CONTROL },
        },
      ),
    );
  }
}
