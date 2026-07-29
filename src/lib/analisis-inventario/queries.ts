import type { PoolClient } from "pg";
import { calculateDiMetrics, calendarDaysInclusive } from "@/lib/analisis-inventario/di";
import {
  nextDrillLevel,
  nextHeatmapRowLevel,
} from "@/lib/analisis-inventario/drill-path";
import { buildSedePairSqlFilter } from "@/lib/analisis-inventario/scope";
import type {
  AnalisisInventarioDrillRow,
  AnalisisInventarioDrillStep,
  AnalisisInventarioHeatmapCell,
  AnalisisInventarioHeatmapPayload,
  AnalisisInventarioHeatmapRow,
  AnalisisInventarioLevel,
  AnalisisInventarioSedeColumn,
} from "@/lib/analisis-inventario/types";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";
import { sedeKey } from "@/lib/margenes/margen-final-query";

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const toIsoDate = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return null;
};

type AggDbRow = {
  group_id: string;
  group_label: string;
  description?: string | null;
  empresa?: string | null;
  sede_id?: string | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  sold_units: string | number | null;
  cost_of_sales: string | number | null;
  tracked_days: string | number | null;
  child_count: string | number | null;
};

type HeatCellDbRow = AggDbRow & {
  row_id: string;
  row_label: string;
  empresa: string;
  sede_id: string;
};

const DIM_SQL = {
  categoriaId: `COALESCE(NULLIF(TRIM(categoria_key), ''), '__sin_cat__')`,
  categoriaLabel: `COALESCE(NULLIF(TRIM(nombre_categoria), ''), 'Sin categoría')`,
  lineaId: `COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__')`,
  lineaLabel: `COALESCE(NULLIF(TRIM(linea), ''), 'Sin línea')`,
  sublineaId: `COALESCE(NULLIF(TRIM(linea_n2_codigo), ''), '__sin_n2__')`,
  sublineaLabel: `COALESCE(NULLIF(TRIM(sublinea), ''), 'Sin sublínea')`,
  itemId: `COALESCE(NULLIF(TRIM(item), ''), '__sin_item__')`,
  itemLabel: `COALESCE(
    NULLIF(TRIM(descripcion), ''),
    NULLIF(TRIM(item), ''),
    'Sin ítem'
  )`,
} as const;

const pathFiltersSql = (
  path: AnalisisInventarioDrillStep[],
  params: unknown[],
): string[] => {
  const parts: string[] = [];
  for (const step of path) {
    if (step.type === "sede") {
      params.push(step.empresa.trim().toLowerCase(), step.sedeId.padStart(3, "0"));
      parts.push(
        `(LOWER(TRIM(empresa)) = $${params.length - 1} AND LPAD(TRIM(sede_id::text), 3, '0') = $${params.length})`,
      );
      continue;
    }
    if (step.type === "categoria") {
      params.push(step.id);
      parts.push(`${DIM_SQL.categoriaId} = $${params.length}`);
      continue;
    }
    if (step.type === "linea") {
      params.push(step.id);
      parts.push(`${DIM_SQL.lineaId} = $${params.length}`);
      continue;
    }
    if (step.type === "sublinea") {
      params.push(step.id);
      parts.push(`${DIM_SQL.sublineaId} = $${params.length}`);
      continue;
    }
    if (step.type === "item") {
      params.push(step.id);
      parts.push(`${DIM_SQL.itemId} = $${params.length}`);
    }
  }
  return parts;
};

/** Filtros de path excluyendo sede (para heatmap multi-sede). */
const pathFiltersWithoutSedeSql = (
  path: AnalisisInventarioDrillStep[],
  params: unknown[],
): string[] =>
  pathFiltersSql(
    path.filter((step) => step.type !== "sede"),
    params,
  );

const groupExprsForLevel = (
  level: AnalisisInventarioLevel,
): { id: string; label: string; child: string } => {
  switch (level) {
    case "sede":
      return {
        id: `LOWER(TRIM(empresa)) || '|' || LPAD(TRIM(sede_id::text), 3, '0')`,
        label: `COALESCE(NULLIF(TRIM(MAX(sede_name)), ''), 'Sin sede')`,
        child: DIM_SQL.categoriaId,
      };
    case "categoria":
      return {
        id: DIM_SQL.categoriaId,
        label: `MAX(${DIM_SQL.categoriaLabel})`,
        child: DIM_SQL.lineaId,
      };
    case "linea":
      return {
        id: DIM_SQL.lineaId,
        label: `MAX(${DIM_SQL.lineaLabel})`,
        child: DIM_SQL.sublineaId,
      };
    case "sublinea":
      return {
        id: DIM_SQL.sublineaId,
        label: `MAX(${DIM_SQL.sublineaLabel})`,
        child: DIM_SQL.itemId,
      };
    case "item":
      return {
        id: DIM_SQL.itemId,
        label: `MAX(${DIM_SQL.itemLabel})`,
        child: DIM_SQL.itemId,
      };
  }
};

const mapAgg = (
  row: AggDbRow,
  level: AnalisisInventarioLevel,
  periodDays: number,
): Omit<AnalisisInventarioDrillRow, "drillStep" | "id" | "label" | "level"> & {
  id: string;
  label: string;
  level: AnalisisInventarioLevel;
  description?: string | null;
  empresa?: string;
  sedeId?: string;
} => {
  const trackedDays = periodDays > 0 ? periodDays : toNum(row.tracked_days);
  const metrics = calculateDiMetrics({
    inventoryUnits: toNum(row.inventory_units),
    inventoryValue: toNum(row.inventory_value),
    soldUnits: toNum(row.sold_units),
    costOfSales: toNum(row.cost_of_sales),
    trackedDays,
  });
  return {
    id: String(row.group_id ?? ""),
    label: String(row.group_label ?? row.group_id ?? ""),
    level,
    description: row.description ?? null,
    empresa: row.empresa ? String(row.empresa) : undefined,
    sedeId: row.sede_id ? String(row.sede_id).padStart(3, "0") : undefined,
    inventoryUnits: toNum(row.inventory_units),
    inventoryValue: toNum(row.inventory_value),
    soldUnits: toNum(row.sold_units),
    costOfSales: toNum(row.cost_of_sales),
    trackedDays,
    diUnits: metrics.diUnits,
    diValue: metrics.diValue,
    childCount: toNum(row.child_count),
  };
};

const toDrillStep = (
  row: ReturnType<typeof mapAgg>,
): AnalisisInventarioDrillStep => {
  if (row.level === "sede") {
    const [empresa, sedeId] = row.id.split("|");
    return {
      type: "sede",
      id: row.id,
      label: row.label,
      empresa: (empresa ?? row.empresa ?? "").toLowerCase(),
      sedeId: (sedeId ?? row.sedeId ?? "").padStart(3, "0"),
    };
  }
  return {
    type: row.level,
    id: row.id,
    label: row.label,
  };
};

async function probeMatview(
  client: PoolClient,
  matview: string,
): Promise<boolean> {
  const result = await client.query(
    `
    SELECT 1
    FROM pg_matviews
    WHERE matviewname = $1
    LIMIT 1
    `,
    [matview],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function queryAnalisisInventarioDateBounds(
  client: PoolClient,
  matview: string,
): Promise<{ min: string | null; max: string | null }> {
  const exists = await probeMatview(client, matview);
  if (!exists) return { min: null, max: null };
  const result = await client.query(
    `
    SELECT
      TO_CHAR(MIN(fecha), 'YYYY-MM-DD') AS min_date,
      TO_CHAR(MAX(fecha), 'YYYY-MM-DD') AS max_date
    FROM ${matview}
    `,
  );
  const row = result.rows[0] as
    | { min_date: string | null; max_date: string | null }
    | undefined;
  return {
    min: toIsoDate(row?.min_date) ,
    max: toIsoDate(row?.max_date),
  };
}

export function resolveDefaultAnalisisDateRange(
  min: string,
  max: string,
  referenceDate: Date = new Date(),
): { start: string; end: string } {
  return getRollingMonthBackRange(min, max, referenceDate);
}

/**
 * Agrega inventario al último día con dato por (empresa, sede, item),
 * y ventas/costo/días sobre todo el periodo.
 */
const buildAggCte = (matview: string) => `
scoped AS (
  SELECT
    fecha,
    LOWER(TRIM(empresa)) AS empresa,
    LPAD(TRIM(sede_id::text), 3, '0') AS sede_id,
    MAX(sede_name) AS sede_name,
    item,
    MAX(descripcion) AS descripcion,
    MAX(linea) AS linea,
    MAX(linea_n1_codigo) AS linea_n1_codigo,
    MAX(sublinea) AS sublinea,
    MAX(linea_n2_codigo) AS linea_n2_codigo,
    MAX(categoria) AS categoria,
    MAX(nombre_categoria) AS nombre_categoria,
    MAX(categoria_key) AS categoria_key,
    SUM(COALESCE(inventory_units_dia, 0))::numeric AS inventory_units_dia,
    SUM(COALESCE(inventory_value_dia, 0))::numeric AS inventory_value_dia,
    SUM(COALESCE(unidades_vendidas_dia, 0))::numeric AS unidades_vendidas_dia,
    SUM(COALESCE(cost_value_dia, 0))::numeric AS cost_value_dia
  FROM ${matview}
  WHERE fecha BETWEEN $1::date AND $2::date
    AND NULLIF(TRIM(item), '') IS NOT NULL
    AND __SEDE_FILTER__
    __PATH_FILTERS__
  GROUP BY 1, 2, 3, 5
),
ranked AS (
  SELECT
    *,
    MAX(fecha) OVER (PARTITION BY empresa, sede_id, item) AS latest_fecha
  FROM scoped
),
latest_inv AS (
  SELECT
    empresa,
    sede_id,
    MAX(sede_name) AS sede_name,
    item,
    MAX(descripcion) AS descripcion,
    MAX(linea) AS linea,
    MAX(linea_n1_codigo) AS linea_n1_codigo,
    MAX(sublinea) AS sublinea,
    MAX(linea_n2_codigo) AS linea_n2_codigo,
    MAX(categoria) AS categoria,
    MAX(nombre_categoria) AS nombre_categoria,
    MAX(categoria_key) AS categoria_key,
    SUM(CASE WHEN fecha = latest_fecha THEN inventory_units_dia ELSE 0 END)::numeric AS inventory_units,
    SUM(CASE WHEN fecha = latest_fecha THEN inventory_value_dia ELSE 0 END)::numeric AS inventory_value
  FROM ranked
  GROUP BY empresa, sede_id, item
),
sales_agg AS (
  SELECT
    empresa,
    sede_id,
    item,
    SUM(unidades_vendidas_dia)::numeric AS sold_units,
    SUM(cost_value_dia)::numeric AS cost_of_sales,
    COUNT(DISTINCT fecha)::int AS tracked_days
  FROM scoped
  GROUP BY empresa, sede_id, item
),
base AS (
  SELECT
    l.empresa,
    l.sede_id,
    l.sede_name,
    l.item,
    l.descripcion,
    l.linea,
    l.linea_n1_codigo,
    l.sublinea,
    l.linea_n2_codigo,
    l.categoria,
    l.nombre_categoria,
    l.categoria_key,
    l.inventory_units,
    l.inventory_value,
    COALESCE(s.sold_units, 0)::numeric AS sold_units,
    COALESCE(s.cost_of_sales, 0)::numeric AS cost_of_sales,
    COALESCE(s.tracked_days, 0)::int AS tracked_days
  FROM latest_inv l
  LEFT JOIN sales_agg s
    ON s.empresa = l.empresa
   AND s.sede_id = l.sede_id
   AND s.item = l.item
)
`;

export async function queryAnalisisInventarioDrill(
  client: PoolClient,
  args: {
    matview: string;
    dateStart: string;
    dateEnd: string;
    sedePairs: Array<{ empresa: string; sedeId: string }> | null;
    path: AnalisisInventarioDrillStep[];
  },
): Promise<{ level: AnalisisInventarioLevel; rows: AnalisisInventarioDrillRow[] }> {
  const exists = await probeMatview(client, args.matview);
  if (!exists) {
    return { level: nextDrillLevel(args.path), rows: [] };
  }

  const level = nextDrillLevel(args.path);
  const params: unknown[] = [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersSql(args.path, params);
  const pathSql =
    pathParts.length > 0 ? `AND ${pathParts.join("\n    AND ")}` : "";

  const group = groupExprsForLevel(level);
  const selectExtra =
    level === "sede"
      ? `, MAX(empresa) AS empresa, MAX(sede_id) AS sede_id`
      : level === "item"
        ? `, MAX(descripcion) AS description`
        : ``;

  const groupByExtra =
    level === "sede" ? `, empresa, sede_id` : ``;

  // For sede level, group id already includes empresa|sede; still group by those.
  const sql = `
    WITH ${buildAggCte(args.matview)
      .replace("__SEDE_FILTER__", sedeFilter)
      .replace("__PATH_FILTERS__", pathSql)}
    SELECT
      ${group.id} AS group_id,
      ${group.label} AS group_label
      ${selectExtra},
      SUM(inventory_units)::numeric AS inventory_units,
      SUM(inventory_value)::numeric AS inventory_value,
      SUM(sold_units)::numeric AS sold_units,
      SUM(cost_of_sales)::numeric AS cost_of_sales,
      MAX(tracked_days)::int AS tracked_days,
      COUNT(DISTINCT ${group.child})::int AS child_count
    FROM base
    GROUP BY ${group.id}${groupByExtra}
    ORDER BY SUM(inventory_value) DESC NULLS LAST, group_label ASC
    LIMIT ${level === "item" ? 500 : 300}
  `;

  const periodDays = calendarDaysInclusive(args.dateStart, args.dateEnd);
  const result = await client.query(sql, params);
  const rows = ((result.rows ?? []) as AggDbRow[]).map((row) => {
    const mapped = mapAgg(row, level, periodDays);
    return {
      ...mapped,
      drillStep: toDrillStep(mapped),
    };
  });

  return { level, rows };
}

export async function queryAnalisisInventarioHeatmap(
  client: PoolClient,
  args: {
    matview: string;
    dateStart: string;
    dateEnd: string;
    sedePairs: Array<{ empresa: string; sedeId: string }> | null;
    path: AnalisisInventarioDrillStep[];
    columns: AnalisisInventarioSedeColumn[];
  },
): Promise<AnalisisInventarioHeatmapPayload> {
  const rowLevel = nextHeatmapRowLevel(args.path);
  const empty: AnalisisInventarioHeatmapPayload = {
    rowLevel,
    rows: [],
    columns: args.columns,
    cells: [],
    path: args.path,
  };

  const exists = await probeMatview(client, args.matview);
  if (!exists) return empty;

  const params: unknown[] = [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersWithoutSedeSql(args.path, params);
  const pathSql =
    pathParts.length > 0 ? `AND ${pathParts.join("\n    AND ")}` : "";

  const group = groupExprsForLevel(rowLevel);

  const sql = `
    WITH ${buildAggCte(args.matview)
      .replace("__SEDE_FILTER__", sedeFilter)
      .replace("__PATH_FILTERS__", pathSql)}
    SELECT
      ${group.id} AS row_id,
      ${group.label} AS row_label,
      empresa,
      sede_id,
      SUM(inventory_units)::numeric AS inventory_units,
      SUM(inventory_value)::numeric AS inventory_value,
      SUM(sold_units)::numeric AS sold_units,
      SUM(cost_of_sales)::numeric AS cost_of_sales,
      MAX(tracked_days)::int AS tracked_days,
      COUNT(DISTINCT ${group.child})::int AS child_count
    FROM base
    GROUP BY ${group.id}, empresa, sede_id
    ORDER BY SUM(inventory_value) DESC NULLS LAST, row_label ASC
    LIMIT 2000
  `;

  const periodDays = calendarDaysInclusive(args.dateStart, args.dateEnd);
  const result = await client.query(sql, params);
  const dbRows = (result.rows ?? []) as HeatCellDbRow[];

  const rowMap = new Map<string, AnalisisInventarioHeatmapRow>();
  const cells: AnalisisInventarioHeatmapCell[] = [];

  for (const row of dbRows) {
    const metrics = calculateDiMetrics({
      inventoryUnits: toNum(row.inventory_units),
      inventoryValue: toNum(row.inventory_value),
      soldUnits: toNum(row.sold_units),
      costOfSales: toNum(row.cost_of_sales),
      trackedDays: periodDays,
    });
    const rowId = String(row.row_id ?? "");
    const label = String(row.row_label ?? rowId);
    if (!rowMap.has(rowId)) {
      const drillStep: AnalisisInventarioDrillStep = {
        type: rowLevel,
        id: rowId,
        label,
      };
      rowMap.set(rowId, { id: rowId, label, level: rowLevel, drillStep });
    }
    cells.push({
      rowId,
      sedeKey: sedeKey(String(row.empresa), String(row.sede_id)),
      inventoryUnits: toNum(row.inventory_units),
      inventoryValue: toNum(row.inventory_value),
      soldUnits: toNum(row.sold_units),
      costOfSales: toNum(row.cost_of_sales),
      trackedDays: periodDays,
      diUnits: metrics.diUnits,
      diValue: metrics.diValue,
      childCount: toNum(row.child_count),
    });
  }

  // Limitar filas del heatmap a top 40 por valor de inventario total.
  const rowTotals = new Map<string, number>();
  for (const cell of cells) {
    rowTotals.set(
      cell.rowId,
      (rowTotals.get(cell.rowId) ?? 0) + cell.inventoryValue,
    );
  }
  const topRowIds = [...rowTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([id]) => id);
  const topSet = new Set(topRowIds);

  return {
    rowLevel,
    rows: topRowIds
      .map((id) => rowMap.get(id))
      .filter((row): row is AnalisisInventarioHeatmapRow => Boolean(row)),
    columns: args.columns,
    cells: cells.filter((cell) => topSet.has(cell.rowId)),
    path: args.path,
  };
}
