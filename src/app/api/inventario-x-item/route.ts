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
} from "@/lib/inventario-x-item";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";

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
let inventoryDateColumnCache:
  | "fecha_dia"
  | "fecha_consulta"
  | "fecha"
  | "fecha_carga"
  | null = null;
let inventoryUnitsSoldExprCache: string | null = null;
let inventoryClosingUnitsExprCache: string | null = null;
let inventoryValueExprCache: string | null = null;
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

type InventoryQueryClient = {
  query: (
    queryText: string,
    values?: unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
};

const resolveInventoryDateColumn = async (
  client: InventoryQueryClient,
): Promise<"fecha_dia" | "fecha_consulta" | "fecha" | "fecha_carga"> => {
  if (inventoryDateColumnCache) return inventoryDateColumnCache;
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name IN ('fecha_dia', 'fecha_consulta', 'fecha', 'fecha_carga')
    `,
  );
  const columns = new Set(
    (result.rows ?? []).map((row) => String(row.column_name ?? "")),
  );
  if (columns.has("fecha_dia")) {
    inventoryDateColumnCache = "fecha_dia";
    return inventoryDateColumnCache;
  }
  if (columns.has("fecha_consulta")) {
    inventoryDateColumnCache = "fecha_consulta";
    return inventoryDateColumnCache;
  }
  if (columns.has("fecha")) {
    inventoryDateColumnCache = "fecha";
    return inventoryDateColumnCache;
  }
  if (columns.has("fecha_carga")) {
    inventoryDateColumnCache = "fecha_carga";
    return inventoryDateColumnCache;
  }
  throw new Error(
    "No existe una columna de fecha valida en rotacion_base_item_dia_sede (esperadas: fecha_dia, fecha_consulta, fecha o fecha_carga).",
  );
};

const resolveInventoryUnitsSoldExpr = async (
  client: InventoryQueryClient,
): Promise<string> => {
  if (inventoryUnitsSoldExprCache) return inventoryUnitsSoldExprCache;
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name IN ('unidades_vendidas_dia', 'unidades_vendidas', 'cantidad_vendida', 'unidades')
    `,
  );
  const columns = new Set(
    (result.rows ?? []).map((row) => String(row.column_name ?? "")),
  );
  if (columns.has("unidades_vendidas_dia")) {
    inventoryUnitsSoldExprCache = "COALESCE(unidades_vendidas_dia, 0)";
    return inventoryUnitsSoldExprCache;
  }
  if (columns.has("unidades_vendidas")) {
    inventoryUnitsSoldExprCache = "COALESCE(unidades_vendidas, 0)";
    return inventoryUnitsSoldExprCache;
  }
  if (columns.has("cantidad_vendida")) {
    inventoryUnitsSoldExprCache = "COALESCE(cantidad_vendida, 0)";
    return inventoryUnitsSoldExprCache;
  }
  if (columns.has("unidades")) {
    inventoryUnitsSoldExprCache = "COALESCE(unidades, 0)";
    return inventoryUnitsSoldExprCache;
  }
  inventoryUnitsSoldExprCache = "0::numeric";
  return inventoryUnitsSoldExprCache;
};

const resolveInventoryClosingUnitsExpr = async (
  client: InventoryQueryClient,
): Promise<string> => {
  if (inventoryClosingUnitsExprCache) return inventoryClosingUnitsExprCache;
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name IN ('inventario_cierre', 'inv_cierre_dia_ayer', 'inventario_unidades', 'inv_cierre')
    `,
  );
  const columns = new Set(
    (result.rows ?? []).map((row) => String(row.column_name ?? "")),
  );
  if (columns.has("inventario_cierre")) {
    inventoryClosingUnitsExprCache = "GREATEST(COALESCE(inventario_cierre, 0), 0)";
    return inventoryClosingUnitsExprCache;
  }
  if (columns.has("inv_cierre_dia_ayer")) {
    inventoryClosingUnitsExprCache = "GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0)";
    return inventoryClosingUnitsExprCache;
  }
  if (columns.has("inventario_unidades")) {
    inventoryClosingUnitsExprCache = "GREATEST(COALESCE(inventario_unidades, 0), 0)";
    return inventoryClosingUnitsExprCache;
  }
  if (columns.has("inv_cierre")) {
    inventoryClosingUnitsExprCache = "GREATEST(COALESCE(inv_cierre, 0), 0)";
    return inventoryClosingUnitsExprCache;
  }
  inventoryClosingUnitsExprCache = "0::numeric";
  return inventoryClosingUnitsExprCache;
};

const resolveInventoryValueExpr = async (
  client: InventoryQueryClient,
): Promise<string> => {
  if (inventoryValueExprCache) return inventoryValueExprCache;
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'rotacion_base_item_dia_sede'
      AND column_name IN ('valor_inventario', 'inventario_valor', 'valor_inv')
    `,
  );
  const columns = new Set(
    (result.rows ?? []).map((row) => String(row.column_name ?? "")),
  );
  if (columns.has("valor_inventario")) {
    inventoryValueExprCache = "GREATEST(COALESCE(valor_inventario, 0), 0)";
    return inventoryValueExprCache;
  }
  if (columns.has("inventario_valor")) {
    inventoryValueExprCache = "GREATEST(COALESCE(inventario_valor, 0), 0)";
    return inventoryValueExprCache;
  }
  if (columns.has("valor_inv")) {
    inventoryValueExprCache = "GREATEST(COALESCE(valor_inv, 0), 0)";
    return inventoryValueExprCache;
  }
  inventoryValueExprCache = "0::numeric";
  return inventoryValueExprCache;
};

const buildCompactDateRangeSql = (
  column: "fecha_dia" | "fecha_consulta" | "fecha" | "fecha_carga",
  startParam = "$1",
  endParam = "$2",
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `TO_CHAR(${column}::date, 'YYYYMMDD') BETWEEN ${startParam} AND ${endParam}`
    : `${column} BETWEEN ${startParam} AND ${endParam}
        AND ${column} ~ '^[0-9]{8}$'`;

const getAvailableDateRange = async () => {
  const now = Date.now();
  if (dateRangeCache && dateRangeCache.expiresAt > now) {
    return dateRangeCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const dateColumn = await resolveInventoryDateColumn(client);
    const unitsSoldExpr = await resolveInventoryUnitsSoldExpr(client);
    const closingUnitsExpr = await resolveInventoryClosingUnitsExpr(client);
    const inventoryValueExpr = await resolveInventoryValueExpr(client);
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
    const dateColumn = await resolveInventoryDateColumn(client);
    const result = await client.query(
      `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
        COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE ${buildCompactDateRangeSql(dateColumn)}
        AND item IS NOT NULL
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

const queryInventorySummaryRows = async ({
  dateRangeCompact,
  empresa,
  sedeId,
}: {
  dateRangeCompact: { start: string; end: string };
  empresa: string | null;
  sedeId: string | null;
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const dateColumn = await resolveInventoryDateColumn(client);
    const result = await client.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(linea), ''), 'Sin linea') AS linea,
        NULLIF(TRIM(linea_n1_codigo), '') AS linea_n1_codigo,
        COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
        COALESCE(
          NULLIF(TRIM(descripcion), ''),
          COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')
        ) AS descripcion,
        NULLIF(TRIM(unidad), '') AS unidad,
        SUM(${closingUnitsExpr})::numeric AS inventory_units,
        SUM(${inventoryValueExpr})::numeric AS inventory_value,
        SUM(${unitsSoldExpr})::numeric AS total_units,
        COUNT(*)::int AS tracked_days,
        CASE
          WHEN SUM(${closingUnitsExpr}) <= 0
            OR SUM(${inventoryValueExpr}) <= 0
            THEN 0::numeric
          WHEN SUM(${unitsSoldExpr}) <= 0
            THEN 999999::numeric
          ELSE
            (
              SUM(${closingUnitsExpr}) *
              COUNT(*)::numeric
            ) / NULLIF(SUM(${unitsSoldExpr}), 0)
        END AS rotation_days,
        COUNT(
          DISTINCT COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa')
        )::int AS company_count,
        COUNT(
          DISTINCT COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede')
        )::int AS sede_count
      FROM rotacion_base_item_dia_sede
      WHERE ${buildCompactDateRangeSql(dateColumn)}
        AND item IS NOT NULL
        AND ($3::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $3)
        AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $4)
      GROUP BY
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad
      HAVING
        SUM(${closingUnitsExpr}) > 0
        OR SUM(${inventoryValueExpr}) > 0
      ORDER BY
        inventory_value DESC,
        item ASC
      `,
      [dateRangeCompact.start, dateRangeCompact.end, empresa, sedeId],
    );

    return ((result.rows ?? []) as InventorySummaryDbRow[]).map((row) => {
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
    });
  } finally {
    client.release();
  }
};

const queryInventoryMatrixRows = async ({
  dateRangeCompact,
  empresa,
  sedeId,
  lines,
  subcategory,
  items,
}: {
  dateRangeCompact: { start: string; end: string };
  empresa: string | null;
  sedeId: string | null;
  lines: InventoryLineFilter[];
  subcategory: InventarioSubcategoryKey | null;
  items: string[];
}): Promise<InventoryMatrixRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const dateColumn = await resolveInventoryDateColumn(client);
    const unitsSoldExpr = await resolveInventoryUnitsSoldExpr(client);
    const closingUnitsExpr = await resolveInventoryClosingUnitsExpr(client);
    const inventoryValueExpr = await resolveInventoryValueExpr(client);
    const params: Array<string | string[] | null> = [
      dateRangeCompact.start,
      dateRangeCompact.end,
      empresa,
      sedeId,
    ];

    const whereClauses = [
      buildCompactDateRangeSql(dateColumn),
      "item IS NOT NULL",
      "($3::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $3)",
      "($4::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $4)",
    ];

    if (subcategory === "perecederos") {
      whereClauses.push(
        "COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') IN ('01', '02', '03', '04', '12')",
      );
    } else if (subcategory === "manufacturas") {
      whereClauses.push(
        "COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') NOT IN ('01', '02', '03', '04', '12')",
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
            LOWER(COALESCE(NULLIF(TRIM(linea), ''), 'sin linea')) = $${lineNameParam}
            AND COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') = $${lineCodeParam}
          )`;
        }

        return `(
          LOWER(COALESCE(NULLIF(TRIM(linea), ''), 'sin linea')) = $${lineNameParam}
          AND NULLIF(TRIM(linea_n1_codigo), '') IS NULL
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
          COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
          COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
          COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name,
          COALESCE(NULLIF(TRIM(linea), ''), 'Sin linea') AS linea,
          NULLIF(TRIM(linea_n1_codigo), '') AS linea_n1_codigo,
          COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
          COALESCE(
            NULLIF(TRIM(descripcion), ''),
            COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')
          ) AS descripcion,
          NULLIF(TRIM(unidad), '') AS unidad,
          ${closingUnitsExpr} AS inventory_units,
          ${inventoryValueExpr} AS inventory_value,
          ${unitsSoldExpr} AS total_units
        FROM rotacion_base_item_dia_sede
        WHERE ${whereClauses.join("\n          AND ")}
      ),
      top_items AS (
        SELECT item
        FROM scoped
        GROUP BY item
        ORDER BY SUM(inventory_value) DESC, item ASC
        LIMIT ${itemFilterParam ? "999999" : "10"}
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
        SUM(inventory_units)::numeric AS inventory_units,
        SUM(inventory_value)::numeric AS inventory_value,
        SUM(total_units)::numeric AS total_units,
        COUNT(*)::int AS tracked_days,
        CASE
          WHEN SUM(inventory_units) <= 0 OR SUM(inventory_value) <= 0 THEN 0::numeric
          WHEN SUM(total_units) <= 0 THEN 999999::numeric
          ELSE (SUM(inventory_units) * COUNT(*)::numeric) / NULLIF(SUM(total_units), 0)
        END AS rotation_days
      FROM scoped
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
      HAVING
        SUM(inventory_units) > 0
        OR SUM(inventory_value) > 0
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
    const requestedCompany = url.searchParams.get("empresa")?.trim() || null;
    const requestedSede = url.searchParams.get("sede")?.trim() || null;
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
      mode === "table" || mode === "filters"
        ? Promise.resolve<InventorySummaryRow[]>([])
        : queryInventorySummaryRows({
            dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
            empresa: requestedCompany,
            sedeId: requestedSede,
          }),
      mode === "catalog" || mode === "filters"
        ? Promise.resolve<InventoryMatrixRow[]>([])
        : queryInventoryMatrixRows({
            dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
            empresa: requestedCompany,
            sedeId: requestedSede,
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
            selectedCompany: requestedCompany,
            selectedSede: requestedSede,
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
