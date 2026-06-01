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
import { getCanonicalSedeName } from "@/lib/shared/sede-names";
import {
  resolveRotacionBaseSqlFields,
  type RotacionBaseDateColumn,
  type RotacionBaseSqlFields,
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

/**
 * Filtro SQL equivalente a `HIDDEN_SEDE_KEYS` (sedes administrativas / centros de distribucion
 * que el usuario nunca quiere ver). Aplicarlo en SQL evita procesar y transferir filas que
 * luego se descartan en Node, ademas de aligerar window functions y aggregations.
 *
 * Recibe la expresion textual que produce `sedeNameExpr` (ya viene COALESCE'd y casteada).
 */
const buildHiddenSedeWhereClause = (sedeNameExpr: string) =>
  `LOWER(REGEXP_REPLACE(
    TRANSLATE(
      ${sedeNameExpr},
      'áéíóúÁÉÍÓÚñÑ',
      'aeiouAEIOUnN'
    ),
    '[^a-zA-Z0-9]+',
    '',
    'g'
  )) NOT IN ('adm', 'cedicavasa', 'centrodistribucioncavasa', 'importados')`;

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
  precomputedFields?: RotacionBaseSqlFields,
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
    const fields = precomputedFields ?? (await resolveRotacionBaseSqlFields(client));
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
        AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
      `,
      [dateRangeCompact.start, dateRangeCompact.end],
    );

    // 1. Red de seguridad: el WHERE SQL ya filtra las sedes ocultas, pero
    //    conservamos este filter como defensa por si alguna sede futura cae
    //    fuera del TRANSLATE basico.
    // 2. Resolucion del nombre y deduplicacion por `(empresa, sedeId)`:
    //    a) Si la combinacion esta en el catalogo canonico de la app
    //       (`getCanonicalSedeName`), usamos ese nombre como verdad oficial
    //       (ej. "001|mercamio" → "Calle 5ta"). Asi se ven nombres lindos
    //       aunque la BD traiga `nombre_sede` NULL o solo el ID.
    //    b) Si no esta en el catalogo (sedes nuevas o codigos como PPT),
    //       caemos al `sede_name` de la BD y conservamos la variante MAS
    //       LARGA (es la mas descriptiva: "Mercamio 001 Principal" > "001").
    //
    //    Sin esta dedup el cliente repetia filas con la misma clave React
    //    `${empresa}::${sedeId}` y mostraba warnings tipo
    //    "Encountered two children with the same key, mercamio::003".
    const sedeByKey = new Map<string, { empresa: string; sedeId: string; sedeName: string }>();
    for (const row of (result.rows ?? []) as InventoryFilterDbRow[]) {
      if (HIDDEN_SEDE_KEYS.has(normalizeKey(row.sede_name))) continue;
      const key = `${row.empresa}::${row.sede_id}`;
      // El canonico depende solo de `(empresa, sedeId)`, asi que todas las
      // filas con la misma clave producen el MISMO `sedeName` y la dedup por
      // longitud no afecta. Solo cuando no hay canonico (sedes nuevas no
      // catalogadas) la comparacion por longitud decide cual variante de la
      // BD conservar: la mas larga = mas descriptiva.
      const sedeName = getCanonicalSedeName(row.sede_id, row.empresa) ?? row.sede_name;
      const current = sedeByKey.get(key);
      if (!current || sedeName.length > current.sedeName.length) {
        sedeByKey.set(key, {
          empresa: row.empresa,
          sedeId: row.sede_id,
          sedeName,
        });
      }
    }
    const sedes = Array.from(sedeByKey.values());

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
  precomputedFields,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
  precomputedFields?: RotacionBaseSqlFields;
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields =
      precomputedFields ?? (await resolveRotacionBaseSqlFields(client));
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
        AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
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
  precomputedFields,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
  precomputedFields?: RotacionBaseSqlFields;
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields =
      precomputedFields ?? (await resolveRotacionBaseSqlFields(client));
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
          AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      ),
      ranked AS (
        SELECT
          *,
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
  precomputedFields,
}: {
  dateRangeCompact: { start: string; end: string };
  empresas: string[];
  sedes: string[];
  lines: InventoryLineFilter[];
  subcategory: InventarioSubcategoryKey | null;
  items: string[];
  precomputedFields?: RotacionBaseSqlFields;
}): Promise<InventoryMatrixRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const fields =
      precomputedFields ?? (await resolveRotacionBaseSqlFields(client));
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
      // Excluye sedes administrativas / centros de distribucion antes del window function,
      // alineado con HIDDEN_SEDE_KEYS y el filtro defensivo posterior en Node.
      buildHiddenSedeWhereClause(fields.sedeNameExpr),
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

    // Cuando el usuario ya filtro por items concretos, no tiene sentido evaluar el
    // CTE `top_items` (un GROUP BY + ORDER BY SUM(...) DESC sobre `ranked`).
    // En ese caso lo omitimos por completo y filtramos directo en `aggregated`.
    const topItemsCte = itemFilterParam
      ? ""
      : `,
      top_items AS (
        SELECT item
        FROM ranked
        WHERE consulta_date = latest_consulta_date
        GROUP BY item
        ORDER BY SUM(inventory_value) DESC NULLS LAST, item ASC
        LIMIT 10
      )`;

    const itemMembershipClause = itemFilterParam
      ? `item = ANY($${itemFilterParam}::text[])`
      : "item IN (SELECT item FROM top_items)";

    // Window function: para el dataset real (millones de filas con muchos PARTITION BY),
    // resulta mas rapida que un GROUP BY + INNER JOIN porque Postgres resuelve MAX OVER
    // en un solo pass ordenado y evita el hash join sobre tablas materializadas grandes.
    // Probamos la variante con CTE `latest_dates` + JOIN y resulto 6x mas lenta.
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
          MAX(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS latest_consulta_date
        FROM scoped
      )${topItemsCte},
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
        WHERE ${itemMembershipClause}
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
        // Mismo override que en `getFilterCatalog`: el nombre canonico de la
        // app gana sobre `nombre_sede` de la BD. Asi la tabla de la matriz
        // muestra "Calle 5ta" en vez de "001" cuando la columna nombre_sede
        // viene NULL o pobre.
        const sedeName =
          getCanonicalSedeName(row.sede_id, row.empresa) ?? row.sede_name;
        return {
          empresa: row.empresa,
          sedeId: row.sede_id,
          sedeName,
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

    // Resolvemos los exprs de la tabla rotacion_base_item_dia_sede una sola vez por
    // request. Antes cada helper abria su propio cliente y los resolvia, lo que
    // implicaba 3 lookups y 3 reconstrucciones de exprs cuando se llamaba a las 3 en
    // paralelo. La cache interna de columnas (5 min) ya estaba, pero el armado de
    // expresiones se repetia y los pool.connect() de cada llamada se acumulaban.
    const pool = await getDbPool();
    const fieldsClient = await pool.connect();
    let precomputedFields: RotacionBaseSqlFields;
    try {
      precomputedFields = await resolveRotacionBaseSqlFields(fieldsClient);
    } finally {
      fieldsClient.release();
    }

    const [filters, rows, matrixRows] = await Promise.all([
      getInventoryFilterCatalog(
        { start: dateStartCompact, end: dateEndCompact },
        precomputedFields,
      ),
      mode === "catalog"
        ? queryInventoryCatalogRows({
            dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
            empresas: requestedCompanies,
            sedes: requestedSedes,
            precomputedFields,
          })
        : mode === "table" || mode === "filters"
          ? Promise.resolve<InventorySummaryRow[]>([])
          : queryInventorySummaryRows({
              dateRangeCompact: { start: dateStartCompact, end: dateEndCompact },
              empresas: requestedCompanies,
              sedes: requestedSedes,
              precomputedFields,
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
            precomputedFields,
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
