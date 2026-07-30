import type { Pool, PoolClient } from "pg";
import {
  nextParticipacionLevel,
  nextParticipacionMatrixRowLevel,
  sharePct,
} from "@/lib/participacion-comercial/format";
import type {
  ParticipacionDrillStep,
  ParticipacionLevel,
  ParticipacionMatrixCell,
  ParticipacionMatrixPayload,
  ParticipacionMatrixRow,
  ParticipacionOrientation,
  ParticipacionRow,
  ParticipacionSedeColumn,
} from "@/lib/participacion-comercial/types";
import { buildSedePairSqlFilter } from "@/lib/analisis-inventario/scope";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";
import {
  getRotacionPeriodoStdMeta,
  matchesRotacionPeriodoStdRange,
  probeRotacionPeriodoStdReady,
} from "@/lib/rotacion/periodo-std-server";
import type { RotacionSourceTable } from "@/lib/rotacion/source-tables";
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

const DIM = {
  empresa: `empresa`,
  sedeId: `LPAD(TRIM(sede_id::text), 3, '0')`,
  sedeKey: `empresa || '|' || LPAD(TRIM(sede_id::text), 3, '0')`,
  almacenId: `COALESCE(NULLIF(TRIM(bodega), ''), '__sin_alm__')`,
  almacenLabel: `COALESCE(
    NULLIF(TRIM(nombre_bodega), ''),
    NULLIF(TRIM(bodega), ''),
    'Sin almacén'
  )`,
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

const BOUNDS_TTL_MS = 30 * 60 * 1000;
const boundsCache = new Map<
  string,
  { value: { min: string | null; max: string | null }; expiresAt: number }
>();

type AggDbRow = {
  group_id: string;
  group_label: string;
  sales: string | number | null;
  units: string | number | null;
  child_count: string | number | null;
  description?: string | null;
  empresa?: string | null;
  sede_id?: string | null;
};

const levelGroup = (
  level: ParticipacionLevel,
): { idExpr: string; labelExpr: string; childExpr: string; groupBy: string[] } => {
  switch (level) {
    case "sede":
      return {
        idExpr: DIM.sedeKey,
        labelExpr: `COALESCE(NULLIF(TRIM(MAX(sede_name)), ''), 'Sin sede')`,
        childExpr: DIM.almacenId,
        groupBy: [DIM.empresa, DIM.sedeId],
      };
    case "linea":
      return {
        idExpr: DIM.lineaId,
        labelExpr: `MAX(${DIM.lineaLabel})`,
        childExpr: DIM.sedeKey,
        groupBy: [DIM.lineaId],
      };
    case "almacen":
      return {
        idExpr: DIM.almacenId,
        labelExpr: `MAX(${DIM.almacenLabel})`,
        childExpr: DIM.categoriaId,
        groupBy: [DIM.almacenId],
      };
    case "categoria":
      return {
        idExpr: DIM.categoriaId,
        labelExpr: `MAX(${DIM.categoriaLabel})`,
        childExpr: DIM.lineaId,
        groupBy: [DIM.categoriaId],
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

const pathFiltersSql = (
  path: ParticipacionDrillStep[],
  params: unknown[],
): string[] => {
  const parts: string[] = [];
  for (const step of path) {
    if (step.type === "sede") {
      params.push(step.empresa.trim().toLowerCase(), step.sedeId.padStart(3, "0"));
      parts.push(
        `(empresa = $${params.length - 1} AND (sede_id = $${params.length} OR LPAD(TRIM(sede_id::text), 3, '0') = $${params.length}))`,
      );
      continue;
    }
    if (step.type === "linea") {
      params.push(step.id);
      parts.push(`${DIM.lineaId} = $${params.length}`);
      continue;
    }
    if (step.type === "almacen") {
      params.push(step.id);
      parts.push(`${DIM.almacenId} = $${params.length}`);
      continue;
    }
    if (step.type === "categoria") {
      params.push(step.id);
      parts.push(`${DIM.categoriaId} = $${params.length}`);
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

const toDrillStep = (
  level: ParticipacionLevel,
  id: string,
  label: string,
  empresa?: string,
  sedeId?: string,
): ParticipacionDrillStep => {
  if (level === "sede") {
    const [emp, sid] = id.split("|");
    return {
      type: "sede",
      id,
      label,
      empresa: (emp ?? empresa ?? "").toLowerCase(),
      sedeId: (sid ?? sedeId ?? "").padStart(3, "0"),
    };
  }
  return { type: level, id, label };
};

async function withTimeout<T>(
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

type QueryArgs = {
  matview: string;
  periodoStdTable: string;
  sourceTable: RotacionSourceTable;
  dateStart: string;
  dateEnd: string;
  sedePairs: Array<{ empresa: string; sedeId: string }> | null;
};

type SourceMode = "periodo_std" | "matview";

async function resolveSourceMode(
  client: PoolClient,
  args: QueryArgs,
): Promise<SourceMode> {
  const ready = await probeRotacionPeriodoStdReady(client, args.sourceTable);
  if (!ready) return "matview";
  const meta = await getRotacionPeriodoStdMeta(client, args.sourceTable);
  return matchesRotacionPeriodoStdRange(meta, args.dateStart, args.dateEnd)
    ? "periodo_std"
    : "matview";
}

export async function queryParticipacionDateBounds(
  client: PoolClient,
  matview: string,
  sourceTable: RotacionSourceTable,
): Promise<{ min: string | null; max: string | null }> {
  const now = Date.now();
  const cached = boundsCache.get(matview);
  if (cached && cached.expiresAt > now) return cached.value;

  const periodoMeta = await getRotacionPeriodoStdMeta(client, sourceTable);
  if (periodoMeta?.periodoEnd) {
    const max = periodoMeta.periodoEnd;
    const end = new Date(`${max}T12:00:00`);
    end.setDate(end.getDate() - 400);
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, "0");
    const d = String(end.getDate()).padStart(2, "0");
    const value = { min: `${y}-${m}-${d}`, max };
    boundsCache.set(matview, { value, expiresAt: now + BOUNDS_TTL_MS });
    return value;
  }

  const result = await client.query(
    `SELECT TO_CHAR(MAX(fecha), 'YYYY-MM-DD') AS max_date FROM ${matview}`,
  );
  const max = toIsoDate(
    (result.rows[0] as { max_date: string | null } | undefined)?.max_date,
  );
  let min = max;
  if (max) {
    const end = new Date(`${max}T12:00:00`);
    end.setDate(end.getDate() - 62);
    min = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }
  const value = { min, max };
  boundsCache.set(matview, { value, expiresAt: now + BOUNDS_TTL_MS });
  return value;
}

export function resolveDefaultParticipacionDateRange(
  min: string,
  max: string,
  referenceDate: Date = new Date(),
) {
  return getRollingMonthBackRange(min, max, referenceDate);
}

const buildAggSql = (args: {
  mode: SourceMode;
  table: string;
  idExpr: string;
  labelExpr: string;
  childExpr: string;
  groupBy: string[];
  sedeFilter: string;
  pathSql: string;
  extras?: string;
  limit: number;
}) => {
  const groupBySql = args.groupBy.join(", ");
  if (args.mode === "periodo_std") {
    return `
      SELECT
        ${args.idExpr} AS group_id,
        ${args.labelExpr} AS group_label
        ${args.extras ?? ""},
        SUM(COALESCE(total_sales, 0))::numeric AS sales,
        SUM(COALESCE(total_units, 0))::numeric AS units,
        COUNT(DISTINCT ${args.childExpr})::int AS child_count
      FROM ${args.table}
      WHERE NULLIF(TRIM(item), '') IS NOT NULL
        AND ${args.sedeFilter}
        ${args.pathSql}
      GROUP BY ${groupBySql}
      ORDER BY SUM(COALESCE(total_sales, 0)) DESC NULLS LAST, 2 ASC
      LIMIT ${args.limit}
    `;
  }
  return `
    SELECT
      ${args.idExpr} AS group_id,
      ${args.labelExpr} AS group_label
      ${args.extras ?? ""},
      SUM(COALESCE(venta_sin_impuesto_dia, 0))::numeric AS sales,
      SUM(COALESCE(unidades_vendidas_dia, 0))::numeric AS units,
      COUNT(DISTINCT ${args.childExpr})::int AS child_count
    FROM ${args.table}
    WHERE fecha BETWEEN $1::date AND $2::date
      AND NULLIF(TRIM(item), '') IS NOT NULL
      AND ${args.sedeFilter}
      ${args.pathSql}
    GROUP BY ${groupBySql}
    ORDER BY SUM(COALESCE(venta_sin_impuesto_dia, 0)) DESC NULLS LAST, 2 ASC
    LIMIT ${args.limit}
  `;
};

export async function queryParticipacionDrill(
  client: PoolClient,
  args: QueryArgs & {
    orientation: ParticipacionOrientation;
    path: ParticipacionDrillStep[];
  },
): Promise<{
  level: ParticipacionLevel;
  rows: ParticipacionRow[];
  parentTotalSales: number;
  sourceMode: SourceMode;
}> {
  const level = nextParticipacionLevel(args.orientation, args.path);
  const mode = await resolveSourceMode(client, args);
  const params: unknown[] =
    mode === "periodo_std" ? [] : [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersSql(args.path, params);
  const pathSql =
    pathParts.length > 0 ? `AND ${pathParts.join("\n        AND ")}` : "";
  const group = levelGroup(level);
  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;

  let extras = "";
  if (level === "sede") {
    extras = `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`;
  } else if (level === "item") {
    extras = `, MAX(descripcion) AS description`;
  }

  // Child expr for "linea" root should count sedes; for almacen under linea-orientation count sublineas
  let childExpr = group.childExpr;
  if (args.orientation === "linea" && level === "almacen") {
    childExpr = DIM.sublineaId;
  }
  if (args.orientation === "sede" && level === "linea") {
    childExpr = DIM.sublineaId;
  }

  const sql = buildAggSql({
    mode,
    table,
    idExpr: group.idExpr,
    labelExpr: group.labelExpr,
    childExpr,
    groupBy: group.groupBy,
    sedeFilter,
    pathSql,
    extras,
    limit: level === "item" ? 400 : 300,
  });

  const result = await withTimeout(client, 30_000, () =>
    client.query(sql, params),
  );
  const dbRows = (result.rows ?? []) as AggDbRow[];
  const parentTotalSales = dbRows.reduce(
    (sum, row) => sum + toNum(row.sales),
    0,
  );

  const rows: ParticipacionRow[] = dbRows.map((row) => {
    const id = String(row.group_id ?? "");
    const label = String(row.group_label ?? id);
    const sales = toNum(row.sales);
    return {
      id,
      label,
      level,
      drillStep: toDrillStep(
        level,
        id,
        label,
        row.empresa ? String(row.empresa) : undefined,
        row.sede_id ? String(row.sede_id) : undefined,
      ),
      sales,
      units: toNum(row.units),
      sharePct: sharePct(sales, parentTotalSales),
      childCount: toNum(row.child_count),
      description: row.description ?? null,
      empresa: row.empresa ? String(row.empresa) : undefined,
      sedeId: row.sede_id ? String(row.sede_id).padStart(3, "0") : undefined,
    };
  });

  return { level, rows, parentTotalSales, sourceMode: mode };
}

export async function queryParticipacionMatrix(
  client: PoolClient,
  args: QueryArgs & {
    columns: ParticipacionSedeColumn[];
    path?: ParticipacionDrillStep[];
    itemSearch?: string;
  },
): Promise<ParticipacionMatrixPayload & { sourceMode: SourceMode }> {
  const matrixPath = (args.path ?? []).filter(
    (step) => step.type === "linea" || step.type === "sublinea",
  );
  const itemSearch = (args.itemSearch ?? "").trim();
  const searchActive = itemSearch.length >= 2;
  const rowLevel = searchActive
    ? "item"
    : nextParticipacionMatrixRowLevel(matrixPath);
  const mode = await resolveSourceMode(client, args);
  const params: unknown[] =
    mode === "periodo_std" ? [] : [args.dateStart, args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const pathParts = pathFiltersSql(matrixPath, params);
  const pathSql =
    pathParts.length > 0 ? `AND ${pathParts.join("\n      AND ")}` : "";
  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;

  const salesExpr =
    mode === "periodo_std"
      ? "COALESCE(total_sales, 0)"
      : "COALESCE(venta_sin_impuesto_dia, 0)";
  const unitsExpr =
    mode === "periodo_std"
      ? "COALESCE(total_units, 0)"
      : "COALESCE(unidades_vendidas_dia, 0)";
  const dateFilter =
    mode === "periodo_std" ? "" : "AND fecha BETWEEN $1::date AND $2::date";

  let itemSearchSql = "";
  if (searchActive) {
    params.push(`%${itemSearch.toLowerCase()}%`);
    const p = params.length;
    itemSearchSql = `AND (
      LOWER(TRIM(COALESCE(item, ''))) LIKE $${p}
      OR LOWER(TRIM(COALESCE(descripcion, ''))) LIKE $${p}
    )`;
  }

  const rowDim =
    rowLevel === "linea"
      ? { id: DIM.lineaId, label: DIM.lineaLabel }
      : rowLevel === "sublinea"
        ? { id: DIM.sublineaId, label: DIM.sublineaLabel }
        : { id: DIM.itemId, label: DIM.itemLabel };

  const topLimit = searchActive ? 80 : rowLevel === "item" ? 60 : 40;
  const residualLabel =
    rowLevel === "linea"
      ? "Otras líneas"
      : rowLevel === "sublinea"
        ? "Otras sublíneas"
        : "Otros ítems";
  const residualId = `__otras_${rowLevel}__`;

  const sql = `
    SELECT
      ${rowDim.id} AS row_id,
      MAX(${rowDim.label}) AS row_label,
      ${DIM.empresa} AS empresa,
      ${DIM.sedeId} AS sede_id,
      SUM(${salesExpr})::numeric AS sales,
      SUM(${unitsExpr})::numeric AS units
    FROM ${table}
    WHERE NULLIF(TRIM(item), '') IS NOT NULL
      ${dateFilter}
      AND ${sedeFilter}
      ${pathSql}
      ${itemSearchSql}
    GROUP BY ${rowDim.id}, ${DIM.empresa}, ${DIM.sedeId}
    ORDER BY SUM(${salesExpr}) DESC NULLS LAST
  `;

  const result = await withTimeout(client, 30_000, () =>
    client.query(sql, params),
  );
  type CellDb = {
    row_id: string;
    row_label: string;
    empresa: string;
    sede_id: string;
    sales: string | number | null;
    units: string | number | null;
  };
  const dbRows = (result.rows ?? []) as CellDb[];

  /** Con búsqueda de ítem, % = participación real en la sede (total sin filtro de texto). */
  const sedeTotals = new Map<string, { sales: number; units: number }>();
  if (searchActive) {
    const totParams: unknown[] =
      mode === "periodo_std" ? [] : [args.dateStart, args.dateEnd];
    const totSedeFilter = buildSedePairSqlFilter(totParams, args.sedePairs);
    const totPathParts = pathFiltersSql(matrixPath, totParams);
    const totPathSql =
      totPathParts.length > 0
        ? `AND ${totPathParts.join("\n      AND ")}`
        : "";
    const totSql = `
      SELECT
        ${DIM.empresa} AS empresa,
        ${DIM.sedeId} AS sede_id,
        SUM(${salesExpr})::numeric AS sales,
        SUM(${unitsExpr})::numeric AS units
      FROM ${table}
      WHERE NULLIF(TRIM(item), '') IS NOT NULL
        ${dateFilter}
        AND ${totSedeFilter}
        ${totPathSql}
      GROUP BY ${DIM.empresa}, ${DIM.sedeId}
    `;
    const totResult = await withTimeout(client, 30_000, () =>
      client.query(totSql, totParams),
    );
    for (const row of (totResult.rows ?? []) as Array<{
      empresa: string;
      sede_id: string;
      sales: string | number | null;
      units: string | number | null;
    }>) {
      const key = sedeKey(String(row.empresa), String(row.sede_id));
      sedeTotals.set(key, {
        sales: toNum(row.sales),
        units: toNum(row.units),
      });
    }
  } else {
    for (const row of dbRows) {
      const sales = toNum(row.sales);
      const units = toNum(row.units);
      const key = sedeKey(String(row.empresa), String(row.sede_id));
      const prev = sedeTotals.get(key) ?? { sales: 0, units: 0 };
      sedeTotals.set(key, {
        sales: prev.sales + sales,
        units: prev.units + units,
      });
    }
  }

  let grandTotal = 0;
  for (const tot of sedeTotals.values()) grandTotal += tot.sales;

  const rowMap = new Map<string, ParticipacionMatrixRow>();
  const cells: ParticipacionMatrixCell[] = [];
  const rowTotals = new Map<string, number>();

  for (const row of dbRows) {
    const rowId = String(row.row_id ?? "");
    const label = String(row.row_label ?? rowId);
    const sales = toNum(row.sales);
    const key = sedeKey(String(row.empresa), String(row.sede_id));
    if (!rowMap.has(rowId)) {
      rowMap.set(rowId, {
        id: rowId,
        label,
        drillStep: { type: rowLevel, id: rowId, label },
      });
    }
    rowTotals.set(rowId, (rowTotals.get(rowId) ?? 0) + sales);
    const sedeTotal = sedeTotals.get(key)?.sales ?? 0;
    cells.push({
      rowId,
      sedeKey: key,
      sales,
      units: toNum(row.units),
      shareOfSedePct: sharePct(sales, sedeTotal),
      shareOfTotalPct: sharePct(sales, grandTotal),
    });
  }

  const topIds = [...rowTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topLimit)
    .map(([id]) => id);
  const topSet = new Set(topIds);

  const visibleCells = cells.filter((cell) => topSet.has(cell.rowId));
  const visibleSalesBySede = new Map<string, number>();
  const visibleUnitsBySede = new Map<string, number>();
  for (const cell of visibleCells) {
    visibleSalesBySede.set(
      cell.sedeKey,
      (visibleSalesBySede.get(cell.sedeKey) ?? 0) + cell.sales,
    );
    visibleUnitsBySede.set(
      cell.sedeKey,
      (visibleUnitsBySede.get(cell.sedeKey) ?? 0) + cell.units,
    );
  }

  let hasResidual = false;
  if (!searchActive) {
    for (const col of args.columns) {
      const sedeTotal = sedeTotals.get(col.key)?.sales ?? 0;
      const visible = visibleSalesBySede.get(col.key) ?? 0;
      const rest = Math.max(0, sedeTotal - visible);
      if (rest <= 0.009) continue;
      hasResidual = true;
      const restUnits = Math.max(
        0,
        (sedeTotals.get(col.key)?.units ?? 0) -
          (visibleUnitsBySede.get(col.key) ?? 0),
      );
      cells.push({
        rowId: residualId,
        sedeKey: col.key,
        sales: rest,
        units: restUnits,
        shareOfSedePct: sharePct(rest, sedeTotal),
        shareOfTotalPct: sharePct(rest, grandTotal),
      });
    }
  }

  const rows: ParticipacionMatrixRow[] = topIds
    .map((id) => rowMap.get(id))
    .filter((row): row is ParticipacionMatrixRow => Boolean(row));

  if (hasResidual) {
    rows.push({
      id: residualId,
      label: residualLabel,
      residual: true,
      drillStep: { type: rowLevel, id: residualId, label: residualLabel },
    });
  }

  return {
    rows,
    columns: args.columns,
    cells: cells.filter(
      (cell) => topSet.has(cell.rowId) || cell.rowId === residualId,
    ),
    grandTotalSales: grandTotal,
    sedeTotals: args.columns.map((col) => ({
      sedeKey: col.key,
      sales: sedeTotals.get(col.key)?.sales ?? 0,
      units: sedeTotals.get(col.key)?.units ?? 0,
    })),
    rowLevel,
    path: matrixPath,
    itemSearch: searchActive ? itemSearch : undefined,
    sourceMode: mode,
  };
}

export async function queryParticipacionBoard(
  pool: Pool,
  args: QueryArgs & {
    orientation: ParticipacionOrientation;
    path: ParticipacionDrillStep[];
    matrixPath?: ParticipacionDrillStep[];
    matrixItemSearch?: string;
    columns: ParticipacionSedeColumn[];
  },
) {
  const [a, b] = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const [drill, matrix] = await Promise.all([
      queryParticipacionDrill(a, {
        ...args,
        orientation: args.orientation,
        path: args.path,
      }),
      queryParticipacionMatrix(b, {
        ...args,
        columns: args.columns,
        path: args.matrixPath ?? [],
        itemSearch: args.matrixItemSearch,
      }),
    ]);
    return { drill, matrix };
  } finally {
    a.release();
    b.release();
  }
}
