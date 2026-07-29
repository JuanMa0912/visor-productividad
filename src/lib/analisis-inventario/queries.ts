import type { Pool, PoolClient } from "pg";
import { calculateDiMetrics, calendarDaysInclusive } from "@/lib/analisis-inventario/di";
import {
  nextDrillLevel,
  nextHeatmapRowLevel,
} from "@/lib/analisis-inventario/drill-path";
import { lineFamilySqlFilter } from "@/lib/analisis-inventario/line-family";
import type { AnalisisInventarioLineFamily } from "@/lib/analisis-inventario/line-family";
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
import {
  getRotacionPeriodoStdMeta,
  matchesRotacionPeriodoStdRange,
  probeRotacionPeriodoStdReady,
} from "@/lib/rotacion/periodo-std-server";
import type { RotacionSourceTable } from "@/lib/rotacion/source-tables";
import { resolveRotacionPeriodoStdTable } from "@/lib/rotacion/source-tables";
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
  child_count: string | number | null;
};

type HeatCellDbRow = {
  row_id: string;
  row_label: string;
  empresa: string;
  sede_id: string;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  sold_units: string | number | null;
  cost_of_sales: string | number | null;
  child_count: string | number | null;
};

/** Expresiones de dimensión (mismas columnas en clean y periodo_std). */
const DIM = {
  empresa: `empresa`,
  sedeId: `LPAD(TRIM(sede_id::text), 3, '0')`,
  sedeIdRaw: `sede_id`,
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

const BOUNDS_CACHE_TTL_MS = 30 * 60 * 1000;
const boundsCache = new Map<
  string,
  { value: { min: string | null; max: string | null }; expiresAt: number }
>();
const matviewExistsCache = new Map<
  string,
  { exists: boolean; expiresAt: number }
>();

const pathFiltersSql = (
  path: AnalisisInventarioDrillStep[],
  params: unknown[],
): string[] => {
  const parts: string[] = [];
  for (const step of path) {
    if (step.type === "sede") {
      params.push(
        step.empresa.trim().toLowerCase(),
        step.sedeId.padStart(3, "0"),
      );
      parts.push(
        `(empresa = $${params.length - 1} AND (sede_id = $${params.length} OR LPAD(TRIM(sede_id::text), 3, '0') = $${params.length}))`,
      );
      continue;
    }
    if (step.type === "categoria") {
      params.push(step.id);
      parts.push(`${DIM.categoriaId} = $${params.length}`);
      continue;
    }
    if (step.type === "linea") {
      params.push(step.id);
      parts.push(`${DIM.lineaId} = $${params.length}`);
      continue;
    }
    if (step.type === "sublinea") {
      params.push(step.id);
      parts.push(`${DIM.sublineaId} = $${params.length}`);
      continue;
    }
    if (step.type === "item") {
      params.push(step.id);
      parts.push(`${DIM.itemId} = $${params.length}`);
    }
  }
  return parts;
};

const pathFiltersWithoutSedeSql = (
  path: AnalisisInventarioDrillStep[],
  params: unknown[],
): string[] =>
  pathFiltersSql(
    path.filter((step) => step.type !== "sede"),
    params,
  );

type LevelGroup = {
  idExpr: string;
  labelExpr: string;
  childExpr: string;
  groupBy: string[];
};

const levelGroup = (level: AnalisisInventarioLevel): LevelGroup => {
  switch (level) {
    case "sede":
      return {
        idExpr: `${DIM.empresa} || '|' || ${DIM.sedeId}`,
        labelExpr: `COALESCE(NULLIF(TRIM(MAX(sede_name)), ''), 'Sin sede')`,
        childExpr: DIM.categoriaId,
        groupBy: [DIM.empresa, DIM.sedeId],
      };
    case "categoria":
      return {
        idExpr: DIM.categoriaId,
        labelExpr: `MAX(${DIM.categoriaLabel})`,
        childExpr: DIM.lineaId,
        groupBy: [DIM.categoriaId],
      };
    case "linea":
      return {
        idExpr: DIM.lineaId,
        labelExpr: `MAX(${DIM.lineaLabel})`,
        childExpr: DIM.sublineaId,
        groupBy: [DIM.lineaId],
      };
    case "sublinea":
      return {
        idExpr: DIM.sublineaId,
        labelExpr: `MAX(${DIM.sublineaLabel})`,
        childExpr: DIM.itemId,
        groupBy: [DIM.sublineaId],
      };
    case "item":
      return {
        idExpr: DIM.itemId,
        labelExpr: `MAX(${DIM.itemLabel})`,
        childExpr: DIM.itemId,
        groupBy: [DIM.itemId],
      };
  }
};

const mapAgg = (
  row: AggDbRow,
  level: AnalisisInventarioLevel,
  periodDays: number,
) => {
  const metrics = calculateDiMetrics({
    inventoryUnits: toNum(row.inventory_units),
    inventoryValue: toNum(row.inventory_value),
    soldUnits: toNum(row.sold_units),
    costOfSales: toNum(row.cost_of_sales),
    trackedDays: periodDays,
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
    trackedDays: periodDays,
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

async function withStatementTimeout<T>(
  client: PoolClient,
  ms: number,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, ms)}`);
    const value = await run();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  }
}

async function probeMatview(
  client: PoolClient,
  matview: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = matviewExistsCache.get(matview);
  if (cached && cached.expiresAt > now) return cached.exists;
  const result = await client.query(
    `
    SELECT 1
    FROM pg_matviews
    WHERE matviewname = $1
    LIMIT 1
    `,
    [matview],
  );
  const exists = (result.rowCount ?? 0) > 0;
  matviewExistsCache.set(matview, {
    exists,
    expiresAt: now + 5 * 60 * 1000,
  });
  return exists;
}

export async function queryAnalisisInventarioDateBounds(
  client: PoolClient,
  matview: string,
  sourceTable?: RotacionSourceTable,
): Promise<{ min: string | null; max: string | null }> {
  const now = Date.now();
  const cached = boundsCache.get(matview);
  if (cached && cached.expiresAt > now) return cached.value;

  // Preferir meta del snapshot rolling para el tope (barato).
  // El mínimo se abre ~13 meses atrás para permitir rangos custom (live matview).
  if (sourceTable) {
    const periodoMeta = await getRotacionPeriodoStdMeta(client, sourceTable);
    if (periodoMeta?.periodoEnd) {
      const max = periodoMeta.periodoEnd;
      const end = new Date(`${max}T12:00:00`);
      end.setDate(end.getDate() - 400);
      const y = end.getFullYear();
      const m = String(end.getMonth() + 1).padStart(2, "0");
      const d = String(end.getDate()).padStart(2, "0");
      const value = { min: `${y}-${m}-${d}`, max };
      boundsCache.set(matview, {
        value,
        expiresAt: now + BOUNDS_CACHE_TTL_MS,
      });
      return value;
    }
  }

  const exists = await probeMatview(client, matview);
  if (!exists) {
    const empty = { min: null, max: null };
    boundsCache.set(matview, {
      value: empty,
      expiresAt: now + BOUNDS_CACHE_TTL_MS,
    });
    return empty;
  }

  // Solo MAX (índice fecha); min = max - ~62d como cota práctica de UI.
  const result = await client.query(
    `
    SELECT TO_CHAR(MAX(fecha), 'YYYY-MM-DD') AS max_date
    FROM ${matview}
    `,
  );
  const max = toIsoDate(
    (result.rows[0] as { max_date: string | null } | undefined)?.max_date,
  );
  let min = max;
  if (max) {
    const end = new Date(`${max}T12:00:00`);
    end.setDate(end.getDate() - 62);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, "0");
    const d = String(end.getDate()).padStart(2, "0");
    min = `${y}-${m}-${d}`;
  }
  const value = { min, max };
  boundsCache.set(matview, { value, expiresAt: now + BOUNDS_CACHE_TTL_MS });
  return value;
}

export function resolveDefaultAnalisisDateRange(
  min: string,
  max: string,
  referenceDate: Date = new Date(),
): { start: string; end: string } {
  return getRollingMonthBackRange(min, max, referenceDate);
}

type SourceMode = "periodo_std" | "matview";

type QueryArgs = {
  matview: string;
  periodoStdTable: string;
  sourceTable: RotacionSourceTable;
  dateStart: string;
  dateEnd: string;
  sedePairs: Array<{ empresa: string; sedeId: string }> | null;
  /** Filtro perecederos / manufactura (línea N1). */
  lineFamily?: AnalisisInventarioLineFamily;
};

async function resolveSourceMode(
  client: PoolClient,
  args: QueryArgs,
): Promise<SourceMode> {
  const ready = await probeRotacionPeriodoStdReady(client, args.sourceTable);
  if (!ready) return "matview";
  const meta = await getRotacionPeriodoStdMeta(client, args.sourceTable);
  if (matchesRotacionPeriodoStdRange(meta, args.dateStart, args.dateEnd)) {
    return "periodo_std";
  }
  return "matview";
}

/**
 * Snapshot periodo_std: una sola pasada sobre filas ya agregadas ítem×sede.
 */
const buildPeriodoStdAggSql = (args: {
  table: string;
  idExpr: string;
  labelExpr: string;
  childExpr: string;
  groupBy: string[];
  sedeFilter: string;
  pathSql: string;
  invSelectExtras?: string;
  outerSelectExtras?: string;
  idAlias?: string;
  labelAlias?: string;
  limit: number;
}) => {
  const groupBySql = args.groupBy.join(", ");
  const idAlias = args.idAlias ?? "group_id";
  const labelAlias = args.labelAlias ?? "group_label";
  return `
    SELECT
      ${args.idExpr} AS ${idAlias},
      ${args.labelExpr} AS ${labelAlias}
      ${args.outerSelectExtras ?? args.invSelectExtras ?? ""},
      SUM(COALESCE(inventory_units, 0))::numeric AS inventory_units,
      SUM(COALESCE(inventory_value, 0))::numeric AS inventory_value,
      SUM(COALESCE(total_units, 0))::numeric AS sold_units,
      SUM(COALESCE(total_cost, 0))::numeric AS cost_of_sales,
      COUNT(DISTINCT ${args.childExpr})::int AS child_count
    FROM ${args.table}
    WHERE NULLIF(TRIM(item), '') IS NOT NULL
      AND ${args.sedeFilter}
      ${args.pathSql}
    GROUP BY ${groupBySql}
    ORDER BY SUM(COALESCE(inventory_value, 0)) DESC NULLS LAST, 2 ASC
    LIMIT ${args.limit}
  `;
};

/** Live: inventario día fin + ventas del rango (matview diaria). */
const buildMatviewPairedAggSql = (args: {
  matview: string;
  idExpr: string;
  labelExpr: string;
  childExpr: string;
  groupBy: string[];
  sedeFilter: string;
  pathSql: string;
  invSelectExtras?: string;
  salesSelectExtras?: string;
  outerSelectExtras?: string;
  joinExtras?: string;
  idAlias?: string;
  labelAlias?: string;
  limit: number;
}) => {
  const groupBySql = args.groupBy.join(", ");
  const idAlias = args.idAlias ?? "group_id";
  const labelAlias = args.labelAlias ?? "group_label";
  return `
    WITH inv AS (
      SELECT
        ${args.idExpr} AS group_id,
        ${args.labelExpr} AS group_label
        ${args.invSelectExtras ?? ""},
        SUM(COALESCE(inventory_units_dia, 0))::numeric AS inventory_units,
        SUM(COALESCE(inventory_value_dia, 0))::numeric AS inventory_value,
        COUNT(DISTINCT ${args.childExpr})::int AS child_count
      FROM ${args.matview}
      WHERE fecha = $2::date
        AND NULLIF(TRIM(item), '') IS NOT NULL
        AND ${args.sedeFilter}
        ${args.pathSql}
      GROUP BY ${groupBySql}
    ),
    sales AS (
      SELECT
        ${args.idExpr} AS group_id
        ${args.salesSelectExtras ?? ""},
        SUM(COALESCE(unidades_vendidas_dia, 0))::numeric AS sold_units,
        SUM(COALESCE(cost_value_dia, 0))::numeric AS cost_of_sales
      FROM ${args.matview}
      WHERE fecha BETWEEN $1::date AND $2::date
        AND NULLIF(TRIM(item), '') IS NOT NULL
        AND ${args.sedeFilter}
        ${args.pathSql}
      GROUP BY ${groupBySql}
    )
    SELECT
      i.group_id AS ${idAlias},
      i.group_label AS ${labelAlias}
      ${args.outerSelectExtras ?? ""},
      i.inventory_units,
      i.inventory_value,
      COALESCE(s.sold_units, 0)::numeric AS sold_units,
      COALESCE(s.cost_of_sales, 0)::numeric AS cost_of_sales,
      i.child_count
    FROM inv i
    LEFT JOIN sales s
      ON s.group_id = i.group_id
      ${args.joinExtras ?? ""}
    ORDER BY i.inventory_value DESC NULLS LAST, i.group_label ASC
    LIMIT ${args.limit}
  `;
};

const buildDrillSql = (
  mode: SourceMode,
  level: AnalisisInventarioLevel,
  table: string,
  sedeFilter: string,
  pathSql: string,
) => {
  const group = levelGroup(level);
  const sedeExtras = {
    invSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
    salesSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
    outerSelectExtras: `, i.empresa, i.sede_id`,
    joinExtras: `AND s.empresa = i.empresa AND s.sede_id = i.sede_id`,
  };

  if (mode === "periodo_std") {
    if (level === "sede") {
      return buildPeriodoStdAggSql({
        table,
        idExpr: `${DIM.empresa} || '|' || ${DIM.sedeId}`,
        labelExpr: `COALESCE(NULLIF(TRIM(MAX(sede_name)), ''), 'Sin sede')`,
        childExpr: DIM.categoriaId,
        groupBy: [DIM.empresa, DIM.sedeId],
        sedeFilter,
        pathSql,
        outerSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
        limit: 100,
      });
    }
    if (level === "item") {
      return buildPeriodoStdAggSql({
        table,
        idExpr: group.idExpr,
        labelExpr: group.labelExpr,
        childExpr: group.childExpr,
        groupBy: group.groupBy,
        sedeFilter,
        pathSql,
        outerSelectExtras: `, MAX(descripcion) AS description`,
        limit: 400,
      });
    }
    return buildPeriodoStdAggSql({
      table,
      idExpr: group.idExpr,
      labelExpr: group.labelExpr,
      childExpr: group.childExpr,
      groupBy: group.groupBy,
      sedeFilter,
      pathSql,
      limit: 300,
    });
  }

  if (level === "sede") {
    return buildMatviewPairedAggSql({
      matview: table,
      idExpr: `${DIM.empresa} || '|' || ${DIM.sedeId}`,
      labelExpr: `COALESCE(NULLIF(TRIM(MAX(sede_name)), ''), 'Sin sede')`,
      childExpr: DIM.categoriaId,
      groupBy: [DIM.empresa, DIM.sedeId],
      sedeFilter,
      pathSql,
      ...sedeExtras,
      limit: 100,
    });
  }
  if (level === "item") {
    return buildMatviewPairedAggSql({
      matview: table,
      idExpr: group.idExpr,
      labelExpr: group.labelExpr,
      childExpr: group.childExpr,
      groupBy: group.groupBy,
      sedeFilter,
      pathSql,
      invSelectExtras: `, MAX(descripcion) AS description`,
      outerSelectExtras: `, i.description`,
      limit: 400,
    });
  }
  return buildMatviewPairedAggSql({
    matview: table,
    idExpr: group.idExpr,
    labelExpr: group.labelExpr,
    childExpr: group.childExpr,
    groupBy: group.groupBy,
    sedeFilter,
    pathSql,
    limit: 300,
  });
};

export async function queryAnalisisInventarioDrill(
  client: PoolClient,
  args: QueryArgs & { path: AnalisisInventarioDrillStep[] },
): Promise<{
  level: AnalisisInventarioLevel;
  rows: AnalisisInventarioDrillRow[];
  sourceMode: SourceMode;
}> {
  const level = nextDrillLevel(args.path);
  const mode = await resolveSourceMode(client, args);

  if (mode === "matview") {
    const exists = await probeMatview(client, args.matview);
    if (!exists) return { level, rows: [], sourceMode: mode };
  }

  const params: unknown[] =
    mode === "periodo_std" ? [] : [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersSql(args.path, params);
  const familySql = lineFamilySqlFilter(
    args.lineFamily ?? "all",
    DIM.lineaId,
  );
  const pathSql =
    pathParts.length > 0
      ? `AND ${pathParts.join("\n        AND ")}${familySql ? `\n        ${familySql}` : ""}`
      : familySql ? `\n        ${familySql}` : "";

  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;
  const sql = buildDrillSql(mode, level, table, sedeFilter, pathSql);

  const periodDays = calendarDaysInclusive(args.dateStart, args.dateEnd);
  const result = await withStatementTimeout(client, 30_000, () =>
    client.query(sql, params),
  );
  const rows = ((result.rows ?? []) as AggDbRow[]).map((row) => {
    const mapped = mapAgg(row, level, periodDays);
    return { ...mapped, drillStep: toDrillStep(mapped) };
  });

  return { level, rows, sourceMode: mode };
}

export async function queryAnalisisInventarioHeatmap(
  client: PoolClient,
  args: QueryArgs & {
    path: AnalisisInventarioDrillStep[];
    columns: AnalisisInventarioSedeColumn[];
  },
): Promise<AnalisisInventarioHeatmapPayload & { sourceMode: SourceMode }> {
  const rowLevel = nextHeatmapRowLevel(args.path);
  const empty = {
    rowLevel,
    rows: [] as AnalisisInventarioHeatmapRow[],
    columns: args.columns,
    cells: [] as AnalisisInventarioHeatmapCell[],
    path: args.path,
    sourceMode: "matview" as SourceMode,
  };

  const mode = await resolveSourceMode(client, args);
  if (mode === "matview") {
    const exists = await probeMatview(client, args.matview);
    if (!exists) return empty;
  }

  const params: unknown[] =
    mode === "periodo_std" ? [] : [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersWithoutSedeSql(args.path, params);
  const familySql = lineFamilySqlFilter(
    args.lineFamily ?? "all",
    DIM.lineaId,
  );
  const pathSql =
    pathParts.length > 0
      ? `AND ${pathParts.join("\n        AND ")}${familySql ? `\n        ${familySql}` : ""}`
      : familySql ? `\n        ${familySql}` : "";
  const group = levelGroup(rowLevel);
  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;
  const limit = rowLevel === "item" ? 800 : 600;

  const sql =
    mode === "periodo_std"
      ? buildPeriodoStdAggSql({
          table,
          idExpr: group.idExpr,
          labelExpr: group.labelExpr,
          childExpr: group.childExpr,
          groupBy: [...group.groupBy, DIM.empresa, DIM.sedeId],
          sedeFilter,
          pathSql,
          outerSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
          idAlias: "row_id",
          labelAlias: "row_label",
          limit,
        })
      : buildMatviewPairedAggSql({
          matview: table,
          idExpr: group.idExpr,
          labelExpr: group.labelExpr,
          childExpr: group.childExpr,
          groupBy: [...group.groupBy, DIM.empresa, DIM.sedeId],
          sedeFilter,
          pathSql,
          invSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
          salesSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
          outerSelectExtras: `, i.empresa, i.sede_id`,
          joinExtras: `AND s.empresa = i.empresa AND s.sede_id = i.sede_id`,
          idAlias: "row_id",
          labelAlias: "row_label",
          limit,
        });

  const periodDays = calendarDaysInclusive(args.dateStart, args.dateEnd);
  const result = await withStatementTimeout(client, 30_000, () =>
    client.query(sql, params),
  );
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
      rowMap.set(rowId, {
        id: rowId,
        label,
        level: rowLevel,
        drillStep: { type: rowLevel, id: rowId, label },
      });
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

  const rowTotals = new Map<string, number>();
  for (const cell of cells) {
    rowTotals.set(
      cell.rowId,
      (rowTotals.get(cell.rowId) ?? 0) + cell.inventoryValue,
    );
  }
  const topRowIds = [...rowTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rowLevel === "item" ? 30 : 40)
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
    sourceMode: mode,
  };
}

/** Drill + heatmap en paralelo (dos clientes del pool). */
export async function queryAnalisisInventarioBoard(
  pool: Pool,
  args: QueryArgs & {
    path: AnalisisInventarioDrillStep[];
    heatmapPath: AnalisisInventarioDrillStep[];
    columns: AnalisisInventarioSedeColumn[];
  },
) {
  const [drillClient, heatClient] = await Promise.all([
    pool.connect(),
    pool.connect(),
  ]);
  try {
    const [drill, heatmap] = await Promise.all([
      queryAnalisisInventarioDrill(drillClient, {
        ...args,
        path: args.path,
      }),
      queryAnalisisInventarioHeatmap(heatClient, {
        ...args,
        path: args.heatmapPath,
        columns: args.columns,
      }),
    ]);
    return { drill, heatmap };
  } finally {
    drillClient.release();
    heatClient.release();
  }
}

export function resolvePeriodoStdTableName(
  sourceTable: RotacionSourceTable,
): string {
  return resolveRotacionPeriodoStdTable(sourceTable);
}
