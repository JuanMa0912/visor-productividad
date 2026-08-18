import type { Pool, PoolClient } from "pg";
import { calculateDiFromRates, calendarDaysInclusive } from "@/lib/analisis-inventario/di";
import {
  nextDrillLevel,
  nextHeatmapRowLevel,
} from "@/lib/analisis-inventario/drill-path";
import { lineFamilySqlFilter } from "@/lib/analisis-inventario/line-family";
import type { AnalisisInventarioLineFamily } from "@/lib/analisis-inventario/line-family";
import { lookupProveedorByItemIds } from "@/lib/analisis-inventario/item-proveedor";
import {
  dimensionPathSql,
  passesDiMinFilter,
  type AnalisisInventarioDimensionFilters,
  type AnalisisInventarioFilterCatalog,
} from "@/lib/analisis-inventario/filters";
import { buildSedePairSqlFilter } from "@/lib/analisis-inventario/scope";
import type {
  AnalisisInventarioDrillRow,
  AnalisisInventarioDrillStep,
  AnalisisInventarioHeatmapCell,
  AnalisisInventarioHeatmapPayload,
  AnalisisInventarioHeatmapRow,
  AnalisisInventarioLevel,
  AnalisisInventarioMetric,
  AnalisisInventarioSedeColumn,
} from "@/lib/analisis-inventario/types";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";
import {
  getRotacionPeriodoStdMeta,
  matchesRotacionPeriodoStdRange,
  probeRotacionPeriodoStdReady,
} from "@/lib/rotacion/periodo-std-server";
import type { RotacionSourceTable } from "@/lib/rotacion/source-tables";
import {
  resolveRotacionPeriodoStdTable,
  resolveRotacionSalidasDiaTable,
} from "@/lib/rotacion/source-tables";
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
  /** Σ (unidades_i / dias_activos_i): tasa diaria del grupo. Divisor del DI. */
  units_per_day: string | number | null;
  /**
   * Σ (uds_equivalentes_i / dias_activos_i): consumo por ensamble de kit (doc `EK`).
   * Llega 0 cuando la BD no tiene `rotacion_salidas_dia` ni las columnas del snapshot.
   */
  equiv_per_day?: string | number | null;
  /** Σ (costo_i / dias_activos_i). */
  cost_per_day: string | number | null;
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
  units_per_day: string | number | null;
  equiv_per_day?: string | number | null;
  cost_per_day: string | number | null;
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
const periodoStdEquivColumnCache = new Map<
  string,
  { hasEquiv: boolean; expiresAt: number }
>();
const salidasDiaExistsCache = new Map<
  string,
  { exists: boolean; expiresAt: number }
>();
const SCHEMA_PROBE_TTL_MS = 5 * 60 * 1000;

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

/**
 * Solo las clausulas de SEDE del path, para acotar la CTE de consumo por kit.
 * `rotacion_salidas_dia` no tiene categoria ni linea, y tampoco hacen falta: un
 * item que no pase esos filtros no llega a `sales_item` y el LEFT JOIN lo descarta
 * igual. Se reutilizan los strings YA generados por `pathFiltersSql` (mismo orden
 * que `path`) en vez de volver a llamarla: una segunda llamada empujaria parametros
 * duplicados y correria la numeracion de los `$n` del resto de la consulta.
 */
const sedePathFiltersSql = (
  path: AnalisisInventarioDrillStep[],
  pathParts: string[],
): string =>
  path
    .map((step, index) => (step.type === "sede" ? pathParts[index] : null))
    .filter((part): part is string => Boolean(part))
    .map((part) => `AND ${part}`)
    .join("\n        ");

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
  // DI a partir de tasas diarias por ítem (units_per_day / cost_per_day), no de
  // `periodDays`: un ítem que llegó a mitad de periodo tenía el divisor del
  // periodo completo y su DI salía inflado ~10x. Ver calculateDiFromRates.
  const metrics = calculateDiFromRates({
    inventoryUnits: toNum(row.inventory_units),
    inventoryValue: toNum(row.inventory_value),
    unitsPerDay: toNum(row.units_per_day),
    equivUnitsPerDay: toNum(row.equiv_per_day),
    costPerDay: toNum(row.cost_per_day),
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

/**
 * `uds_equivalentes` llega con `db/migrations/20260814_rotacion_periodo_std_demanda.sql`.
 * Mientras no este aplicada hay que seguir sirviendo el snapshot viejo sin romper el
 * SELECT: un tablero no puede devolver 500 por una columna que aun no existe.
 * Se lee esa columna y no `demanda_units` a proposito: entre la migracion y el primer
 * refresh, `demanda_units` vale 0 (DEFAULT del ALTER) mientras `total_units` sigue con
 * dato, asi que sumar `uds_equivalentes` (tambien 0) repite el numero de hoy en vez de
 * marcar todo el tablero como "Sin venta".
 */
async function probePeriodoStdHasEquivColumn(
  client: PoolClient,
  table: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = periodoStdEquivColumnCache.get(table);
  if (cached && cached.expiresAt > now) return cached.hasEquiv;
  try {
    const result = await client.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = $1
        AND column_name = 'uds_equivalentes'
        AND table_schema = ANY(current_schemas(false))
      LIMIT 1
      `,
      [table],
    );
    const hasEquiv = (result.rowCount ?? 0) > 0;
    periodoStdEquivColumnCache.set(table, {
      hasEquiv,
      expiresAt: now + SCHEMA_PROBE_TTL_MS,
    });
    return hasEquiv;
  } catch {
    return false;
  }
}

/**
 * `rotacion_salidas_dia` puede no existir todavia (la BD del entorno puede ir por
 * detras del repo). Devolver `null` deja el DI exactamente como esta hoy en vez de
 * reventar la consulta en vivo. Para dinastia
 * `resolveRotacionSalidasDiaTable` ya devuelve `null`: ese tenant no se carga.
 */
async function probeSalidasDiaTable(
  client: PoolClient,
  sourceTable: RotacionSourceTable,
): Promise<string | null> {
  const table = resolveRotacionSalidasDiaTable(sourceTable);
  if (!table) return null;
  const now = Date.now();
  const cached = salidasDiaExistsCache.get(table);
  if (cached && cached.expiresAt > now) return cached.exists ? table : null;
  try {
    const result = await client.query(
      "SELECT to_regclass($1) IS NOT NULL AS exists",
      [table],
    );
    const exists = Boolean(
      (result.rows?.[0] as { exists?: boolean } | undefined)?.exists,
    );
    salidasDiaExistsCache.set(table, {
      exists,
      expiresAt: now + SCHEMA_PROBE_TTL_MS,
    });
    return exists ? table : null;
  } catch (error) {
    console.warn(
      `[analisis-inventario] probe ${table} falló (DI sigue sin consumo por kit):`,
      error,
    );
    return null;
  }
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
  /** Filtros multi-select (línea / sublínea / ítem / DI mín). */
  dimFilters?: Pick<
    AnalisisInventarioDimensionFilters,
    "empresas" | "lineas" | "sublineas" | "items" | "diMinDays"
  >;
  /** Métrica DI usada por el filtro diMinDays. */
  metric?: AnalisisInventarioMetric;
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
  /** false = BD sin la migracion de demanda; el DI queda como estaba. */
  hasEquivColumn: boolean;
  invSelectExtras?: string;
  outerSelectExtras?: string;
  havingSql?: string;
  idAlias?: string;
  labelAlias?: string;
  limit: number;
}) => {
  const groupBySql = args.groupBy.join(", ");
  const idAlias = args.idAlias ?? "group_id";
  const labelAlias = args.labelAlias ?? "group_label";
  // `sold_units` sigue siendo la venta PDV: es lo que la tabla titula "Venta und.".
  // El consumo por kit entra solo al DENOMINADOR del DI, igual que en /rotacion.
  const equivPerDaySql = args.hasEquivColumn
    ? `SUM(COALESCE(uds_equivalentes, 0) / NULLIF(dias_activos, 0))::numeric`
    : `0::numeric`;
  return `
    SELECT
      ${args.idExpr} AS ${idAlias},
      ${args.labelExpr} AS ${labelAlias}
      ${args.outerSelectExtras ?? args.invSelectExtras ?? ""},
      SUM(COALESCE(inventory_units, 0))::numeric AS inventory_units,
      SUM(COALESCE(inventory_value, 0))::numeric AS inventory_value,
      SUM(COALESCE(total_units, 0))::numeric AS sold_units,
      SUM(COALESCE(total_cost, 0))::numeric AS cost_of_sales,
      -- Tasas diarias por ítem, sumadas: cada ítem se divide por SU ventana de
      -- exposición (dias_activos), no por los días calendario del periodo.
      -- Ver calculateDiFromRates y la migración 20260731_rotacion_periodo_std_dias_activos.
      SUM(COALESCE(total_units, 0) / NULLIF(dias_activos, 0))::numeric AS units_per_day,
      ${equivPerDaySql} AS equiv_per_day,
      SUM(COALESCE(total_cost, 0) / NULLIF(dias_activos, 0))::numeric AS cost_per_day,
      COUNT(DISTINCT ${args.childExpr})::int AS child_count
    FROM ${args.table}
    WHERE NULLIF(TRIM(item), '') IS NOT NULL
      AND ${args.sedeFilter}
      ${args.pathSql}
    GROUP BY ${groupBySql}
    ${args.havingSql ?? ""}
    ORDER BY SUM(COALESCE(inventory_value, 0)) DESC NULLS LAST, 2 ASC
    LIMIT ${args.limit}
  `;
};

/**
 * CTE `equiv`: consumo por ENSAMBLE DE KIT (documento `EK`) en el rango pedido.
 * Misma definicion que `db/migrations/20260814_rotacion_periodo_std_demanda.sql` y
 * que el SQL en vivo de `/api/rotacion`: si las tres no coinciden, el mismo item da
 * un DI distinto segun el tablero o el rango. `unidades` viene FIRMADO del ERP
 * (salidas negativas), de ahi el signo cambiado.
 *
 * Sin la tabla se emite una CTE vacia en vez de bifurcar el resto del SQL: el
 * LEFT JOIN devuelve NULL, `equiv_per_day` queda en 0 y el DI es el de hoy.
 *
 * La sede se normaliza con LPAD en AMBOS lados. `rotacion_salidas_dia.sede` sale de
 * `LEFT(id_local, 3)` del ERP y la matview trae `sede_id` unas veces con ceros y
 * otras sin ellos (por eso los filtros de sede ya comparan las dos formas). Sin
 * normalizar, el join fallaria en silencio y la correccion de kits seria un no-op.
 */
const buildEquivCteSql = (args: {
  salidasTable: string | null;
  sedeFilter: string;
  sedePathSql: string;
}) => {
  if (!args.salidasTable) {
    return `
    equiv AS (
      SELECT
        NULL::text AS eq_empresa,
        NULL::text AS eq_sede,
        NULL::text AS eq_item,
        0::numeric AS uds_equivalentes
      WHERE false
    )`;
  }
  return `
    equiv AS (
      SELECT
        empresa AS eq_empresa,
        ${DIM.sedeId} AS eq_sede,
        item AS eq_item,
        GREATEST(SUM(-unidades), 0)::numeric AS uds_equivalentes
      FROM (
        SELECT
          s.empresa,
          s.sede AS sede_id,
          s.id_item AS item,
          s.unidades
        FROM ${args.salidasTable} s
        WHERE s.fecha_dia BETWEEN $1::date AND $2::date
          AND s.doc_inv_tipo = 'EK'
          AND s.ind_es = 2
      ) sal
      WHERE ${args.sedeFilter}
        ${args.sedePathSql}
      GROUP BY 1, 2, 3
    )`;
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
  /** CTE `equiv` ya resuelta (vacia si no hay tabla de salidas). */
  equivCteSql: string;
  invSelectExtras?: string;
  salesSelectExtras?: string;
  /**
   * Alias (no expresiones) de las columnas extra de `sales`, para el GROUP BY
   * del segundo nivel de agregación. Si `salesSelectExtras` trae
   * `, empresa AS empresa, ... AS sede_id`, aquí va `, empresa, sede_id`.
   */
  salesGroupExtras?: string;
  outerSelectExtras?: string;
  joinExtras?: string;
  /** Filtro post-join (p. ej. inventario mínimo). */
  outerWhereSql?: string;
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
    ${args.equivCteSql},
    -- Paso intermedio por ÍTEM: aquí se calcula la ventana de exposición de cada
    -- uno dentro del rango pedido. Es el equivalente en vivo de la columna
    -- dias_activos del snapshot (migración 20260731). Hace falta porque la
    -- matview es DENSA: trae fila con ceros aunque el ítem no exista todavía en
    -- esa sede, así que dividir por los días del rango infla el DI de todo ítem
    -- que llegó a mitad de periodo.
    --
    -- El GROUP BY baja hasta (empresa, sede) SOLO para poder colgar el consumo por
    -- kit, que viene por (empresa, sede, item). No cambia ningun numero: las sumas
    -- se vuelven a colapsar en \`sales\` y la ventana de exposicion se sigue midiendo
    -- al grano del grupo (el MIN() de \`sales_item_rated\`), no al de la sede.
    sales_item AS (
      SELECT
        ${args.idExpr} AS group_id
        ${args.salesSelectExtras ?? ""},
        ${DIM.itemId} AS di_item,
        ${DIM.empresa} AS di_empresa,
        ${DIM.sedeId} AS di_sede,
        SUM(COALESCE(unidades_vendidas_dia, 0))::numeric AS item_units,
        SUM(COALESCE(cost_value_dia, 0))::numeric AS item_cost,
        MIN(fecha) FILTER (
          WHERE COALESCE(unidades_vendidas_dia, 0) > 0
             OR COALESCE(inventory_units_dia, 0) > 0
        ) AS item_first_fecha
      FROM ${args.matview}
      WHERE fecha BETWEEN $1::date AND $2::date
        AND NULLIF(TRIM(item), '') IS NOT NULL
        AND ${args.sedeFilter}
        ${args.pathSql}
      GROUP BY ${groupBySql}, ${DIM.itemId}, ${DIM.empresa}, ${DIM.sedeId}
    ),
    sales_item_rated AS (
      SELECT
        si.*,
        LEAST(
          GREATEST(
            ($2::date - MIN(si.item_first_fecha) OVER (
              PARTITION BY si.group_id${args.salesGroupExtras ?? ""}, si.di_item
            )) + 1,
            1
          ),
          ($2::date - $1::date) + 1
        )::numeric AS item_dias
      FROM sales_item si
    ),
    sales AS (
      SELECT
        group_id
        ${args.salesGroupExtras ?? ""},
        SUM(item_units)::numeric AS sold_units,
        SUM(item_cost)::numeric AS cost_of_sales,
        SUM(item_units / NULLIF(item_dias, 0))::numeric AS units_per_day,
        -- Consumo por kit del item EN ESA SEDE, dividido por la misma ventana de
        -- exposicion que sus unidades vendidas.
        SUM(
          COALESCE(eq.uds_equivalentes, 0) / NULLIF(item_dias, 0)
        )::numeric AS equiv_per_day,
        SUM(item_cost / NULLIF(item_dias, 0))::numeric AS cost_per_day
      FROM sales_item_rated
      LEFT JOIN equiv eq
        ON  eq.eq_empresa = di_empresa
        AND eq.eq_sede    = di_sede
        AND eq.eq_item    = di_item
      GROUP BY group_id ${args.salesGroupExtras ?? ""}
    )
    SELECT
      i.group_id AS ${idAlias},
      i.group_label AS ${labelAlias}
      ${args.outerSelectExtras ?? ""},
      i.inventory_units,
      i.inventory_value,
      COALESCE(s.sold_units, 0)::numeric AS sold_units,
      COALESCE(s.cost_of_sales, 0)::numeric AS cost_of_sales,
      COALESCE(s.units_per_day, 0)::numeric AS units_per_day,
      COALESCE(s.equiv_per_day, 0)::numeric AS equiv_per_day,
      COALESCE(s.cost_per_day, 0)::numeric AS cost_per_day,
      i.child_count
    FROM inv i
    LEFT JOIN sales s
      ON s.group_id = i.group_id
      ${args.joinExtras ?? ""}
    WHERE TRUE
      ${args.outerWhereSql ?? ""}
    ORDER BY i.inventory_value DESC NULLS LAST, i.group_label ASC
    LIMIT ${args.limit}
  `;
};

const buildDimFilterClauses = (
  args: QueryArgs,
  params: unknown[],
): { dimSql: string } => {
  const dim = args.dimFilters ?? {
    lineas: [] as string[],
    sublineas: [] as string[],
    items: [] as string[],
    diMinDays: null as number | null,
  };
  const dimSql = dimensionPathSql(
    dim,
    {
      lineaId: DIM.lineaId,
      sublineaId: DIM.sublineaId,
      itemId: DIM.itemId,
    },
    params,
  );
  return { dimSql };
};

const composePathSql = (
  pathParts: string[],
  familySql: string,
  dimSql: string,
): string => {
  const base =
    pathParts.length > 0
      ? `AND ${pathParts.join("\n        AND ")}${familySql ? `\n        ${familySql}` : ""}`
      : familySql
        ? `\n        ${familySql}`
        : "";
  return `${base}${dimSql}`;
};

/** Que sabe la BD del consumo por kit; resuelto una vez por consulta. */
type EquivSupport = {
  /** Snapshot con `uds_equivalentes` (migracion 20260814 aplicada). */
  hasEquivColumn: boolean;
  /** CTE `equiv` para el camino en vivo; vacia si falta `rotacion_salidas_dia`. */
  equivCteSql: string;
};

/**
 * Cada camino toma el consumo por kit de donde le sale mas barato: el snapshot ya
 * lo trae agregado por item x sede, el camino en vivo tiene que agregarlo el mismo.
 * Si la BD no tiene ninguno de los dos, el DI queda identico al de hoy.
 */
const resolveEquivSupport = async (
  client: PoolClient,
  args: QueryArgs,
  mode: SourceMode,
  sedeFilter: string,
  sedePathSql: string,
): Promise<EquivSupport> => {
  if (mode === "periodo_std") {
    return {
      hasEquivColumn: await probePeriodoStdHasEquivColumn(
        client,
        args.periodoStdTable,
      ),
      equivCteSql: buildEquivCteSql({
        salidasTable: null,
        sedeFilter,
        sedePathSql,
      }),
    };
  }
  const salidasTable = await probeSalidasDiaTable(client, args.sourceTable);
  return {
    hasEquivColumn: false,
    equivCteSql: buildEquivCteSql({ salidasTable, sedeFilter, sedePathSql }),
  };
};

const buildDrillSql = (
  mode: SourceMode,
  level: AnalisisInventarioLevel,
  table: string,
  sedeFilter: string,
  pathSql: string,
  equiv: EquivSupport,
  havingSql = "",
  outerWhereSql = "",
) => {
  const group = levelGroup(level);
  const { hasEquivColumn, equivCteSql } = equiv;
  const sedeExtras = {
    invSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
    salesSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
    salesGroupExtras: `, empresa, sede_id`,
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
        hasEquivColumn,
        outerSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
        havingSql,
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
        hasEquivColumn,
        outerSelectExtras: `, MAX(descripcion) AS description`,
        havingSql,
        limit: 1500,
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
      hasEquivColumn,
      havingSql,
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
      equivCteSql,
      ...sedeExtras,
      outerWhereSql,
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
      equivCteSql,
      invSelectExtras: `, MAX(descripcion) AS description`,
      outerSelectExtras: `, i.description`,
      outerWhereSql,
      limit: 1500,
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
    equivCteSql,
    outerWhereSql,
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
  const diMinDays = args.dimFilters?.diMinDays ?? null;
  // DI > N se evalúa a nivel ítem (en todo el alcance o solo lo filtrado).
  const level = diMinDays != null ? "item" : nextDrillLevel(args.path);
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
  const { dimSql } = buildDimFilterClauses(args, params);
  const pathSql = composePathSql(pathParts, familySql, dimSql);

  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;
  const equiv = await resolveEquivSupport(
    client,
    args,
    mode,
    sedeFilter,
    sedePathFiltersSql(args.path, pathParts),
  );
  const sql = buildDrillSql(mode, level, table, sedeFilter, pathSql, equiv);

  const periodDays = calendarDaysInclusive(args.dateStart, args.dateEnd);
  const result = await withStatementTimeout(client, 30_000, () =>
    client.query(sql, params),
  );
  const metric = args.metric ?? "units";
  let rows = ((result.rows ?? []) as AggDbRow[])
    .map((row) => {
      const mapped = mapAgg(row, level, periodDays);
      return { ...mapped, drillStep: toDrillStep(mapped) };
    })
    .filter((row) =>
      passesDiMinFilter(row.diUnits, row.diValue, diMinDays, metric),
    )
    .sort((a, b) => {
      if (diMinDays == null) return 0;
      const av = metric === "value" ? a.diValue : a.diUnits;
      const bv = metric === "value" ? b.diValue : b.diUnits;
      return bv - av;
    });

  if (level === "item" && rows.length > 0) {
    const empresas = args.dimFilters?.empresas?.length
      ? args.dimFilters.empresas
      : [
          ...new Set(
            (args.sedePairs ?? [])
              .map((p) => p.empresa.toLowerCase())
              .filter(Boolean),
          ),
        ];
    try {
      const byItem = await lookupProveedorByItemIds(
        client,
        rows.map((row) => row.id),
        empresas.length > 0 ? empresas : null,
      );
      rows = rows.map((row) => {
        const prov = byItem.get(row.id);
        if (!prov) return row;
        return {
          ...row,
          proveedorId: prov.id,
          proveedorLabel: prov.label,
        };
      });
    } catch (error) {
      console.warn("[analisis-inventario] proveedor por ítem no disponible:", error);
    }
  }

  return { level, rows, sourceMode: mode };
}

export async function queryAnalisisInventarioHeatmap(
  client: PoolClient,
  args: QueryArgs & {
    path: AnalisisInventarioDrillStep[];
    columns: AnalisisInventarioSedeColumn[];
  },
): Promise<AnalisisInventarioHeatmapPayload & { sourceMode: SourceMode }> {
  const diMinDays = args.dimFilters?.diMinDays ?? null;
  // Con umbral DI: filas = ítems (busca en el alcance de filtros, no en el DI
  // agregado de categoría/línea, que casi nunca supera 100 d).
  const rowLevel =
    diMinDays != null ? "item" : nextHeatmapRowLevel(args.path);
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
  const { dimSql } = buildDimFilterClauses(args, params);
  const pathSql = composePathSql(pathParts, familySql, dimSql);
  const group = levelGroup(rowLevel);
  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;
  const limit = diMinDays != null ? 2500 : rowLevel === "item" ? 800 : 600;
  // El path del mapa nunca trae sede (las sedes son las columnas), asi que la CTE
  // de kits se acota solo con el alcance de sedes del usuario.
  const equiv = await resolveEquivSupport(client, args, mode, sedeFilter, "");

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
          hasEquivColumn: equiv.hasEquivColumn,
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
          equivCteSql: equiv.equivCteSql,
          invSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
          salesSelectExtras: `, ${DIM.empresa} AS empresa, ${DIM.sedeId} AS sede_id`,
          salesGroupExtras: `, empresa, sede_id`,
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
  const metric = args.metric ?? "units";
  const cells: AnalisisInventarioHeatmapCell[] = [];

  for (const row of dbRows) {
    const metrics = calculateDiFromRates({
      inventoryUnits: toNum(row.inventory_units),
      inventoryValue: toNum(row.inventory_value),
      unitsPerDay: toNum(row.units_per_day),
      equivUnitsPerDay: toNum(row.equiv_per_day),
      costPerDay: toNum(row.cost_per_day),
    });
    if (
      !passesDiMinFilter(metrics.diUnits, metrics.diValue, diMinDays, metric)
    ) {
      continue;
    }
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

  const rowMaxDi = new Map<string, number>();
  const rowInvValue = new Map<string, number>();
  for (const cell of cells) {
    const di = metric === "value" ? cell.diValue : cell.diUnits;
    rowMaxDi.set(cell.rowId, Math.max(rowMaxDi.get(cell.rowId) ?? 0, di));
    rowInvValue.set(
      cell.rowId,
      (rowInvValue.get(cell.rowId) ?? 0) + cell.inventoryValue,
    );
  }

  const orderedRowIds =
    diMinDays != null
      ? [...rowMaxDi.entries()]
          .sort(
            (a, b) =>
              b[1] - a[1] || a[0].localeCompare(b[0], "es", { numeric: true }),
          )
          .slice(0, 200)
          .map(([id]) => id)
      : rowLevel === "item"
        ? [...rowInvValue.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30)
            .map(([id]) => id)
        : [...rowMap.keys()].sort((a, b) =>
            a.localeCompare(b, "es", { numeric: true }),
          );
  const orderedSet = new Set(orderedRowIds);

  let rows = orderedRowIds
    .map((id) => rowMap.get(id))
    .filter((row): row is AnalisisInventarioHeatmapRow => Boolean(row));

  if (rowLevel === "item" && rows.length > 0) {
    const empresas = args.dimFilters?.empresas?.length
      ? args.dimFilters.empresas
      : [
          ...new Set(
            (args.sedePairs ?? [])
              .map((p) => p.empresa.toLowerCase())
              .filter(Boolean),
          ),
        ];
    try {
      const byItem = await lookupProveedorByItemIds(
        client,
        rows.map((row) => row.id),
        empresas.length > 0 ? empresas : null,
      );
      rows = rows.map((row) => {
        const prov = byItem.get(row.id);
        if (!prov) return row;
        return {
          ...row,
          proveedorId: prov.id,
          proveedorLabel: prov.label,
        };
      });
    } catch (error) {
      console.warn(
        "[analisis-inventario] proveedor heatmap por ítem no disponible:",
        error,
      );
    }
  }

  return {
    rowLevel,
    rows,
    columns: args.columns,
    cells: cells.filter((cell) => orderedSet.has(cell.rowId)),
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

/** Catálogo para MultiSelect: líneas, sublíneas (cascada) e ítems (búsqueda). */
export async function queryAnalisisInventarioFilterCatalog(
  client: PoolClient,
  args: QueryArgs & {
    itemQuery?: string;
  },
): Promise<AnalisisInventarioFilterCatalog> {
  const empty: AnalisisInventarioFilterCatalog = {
    lineas: [],
    sublineas: [],
    items: [],
  };
  const mode = await resolveSourceMode(client, args);
  if (mode === "matview") {
    const exists = await probeMatview(client, args.matview);
    if (!exists) return empty;
  }

  const table =
    mode === "periodo_std" ? args.periodoStdTable : args.matview;
  // Solo se pasa la fecha FINAL. El catalogo de filtros se arma sobre la foto de
  // un dia (`fecha = ...`), no sobre el rango, asi que `dateStart` no se usa.
  // Pasarlo igualmente rompia las tres consultas: si el SQL referencia $2 pero
  // nunca $1, Postgres no puede inferir el tipo de $1 y aborta con
  // 42P18 "could not determine data type of parameter $1".
  const params: unknown[] = mode === "periodo_std" ? [] : [args.dateEnd];
  const sedeFilter = buildSedePairSqlFilter(params, args.sedePairs);
  const familySql = lineFamilySqlFilter(
    args.lineFamily ?? "all",
    DIM.lineaId,
  );
  const dim = args.dimFilters ?? {
    lineas: [] as string[],
    sublineas: [] as string[],
    items: [] as string[],
    diMinDays: null as number | null,
  };

  const dateSql = mode === "periodo_std" ? "TRUE" : "fecha = $1::date";

  const lineasResult = await withStatementTimeout(client, 20_000, () =>
    client.query<{ value: string; label: string }>(
      `
      SELECT
        ${DIM.lineaId} AS value,
        MAX(${DIM.lineaLabel}) AS label
      FROM ${table}
      WHERE NULLIF(TRIM(item), '') IS NOT NULL
        AND ${dateSql}
        AND ${sedeFilter}
        ${familySql}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 120
      `,
      params,
    ),
  );

  const subParams = [...params];
  const subDimSql = dimensionPathSql(
    { lineas: dim.lineas, sublineas: [], items: [] },
    {
      lineaId: DIM.lineaId,
      sublineaId: DIM.sublineaId,
      itemId: DIM.itemId,
    },
    subParams,
  );
  const sublineasResult = await withStatementTimeout(client, 20_000, () =>
    client.query<{ value: string; label: string }>(
      `
      SELECT
        ${DIM.sublineaId} AS value,
        MAX(${DIM.sublineaLabel}) AS label
      FROM ${table}
      WHERE NULLIF(TRIM(item), '') IS NOT NULL
        AND ${dateSql}
        AND ${sedeFilter}
        ${familySql}
        ${subDimSql}
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 300
      `,
      subParams,
    ),
  );

  const itemQ = (args.itemQuery ?? "").trim();
  let items: AnalisisInventarioFilterCatalog["items"] = [];
  if (itemQ.length >= 2) {
    const itemParams = [...params];
    const itemDimSql = dimensionPathSql(
      {
        lineas: dim.lineas,
        sublineas: dim.sublineas,
        items: [],
      },
      {
        lineaId: DIM.lineaId,
        sublineaId: DIM.sublineaId,
        itemId: DIM.itemId,
      },
      itemParams,
    );
    itemParams.push(`%${itemQ.toLowerCase()}%`);
    const qIdx = itemParams.length;
    const itemsResult = await withStatementTimeout(client, 20_000, () =>
      client.query<{ value: string; label: string }>(
        `
        SELECT
          ${DIM.itemId} AS value,
          MAX(${DIM.itemLabel}) AS label
        FROM ${table}
        WHERE NULLIF(TRIM(item), '') IS NOT NULL
          AND ${dateSql}
          AND ${sedeFilter}
          ${familySql}
          ${itemDimSql}
          AND (
            LOWER(${DIM.itemId}) LIKE $${qIdx}
            OR LOWER(${DIM.itemLabel}) LIKE $${qIdx}
          )
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 80
        `,
        itemParams,
      ),
    );
    items = (itemsResult.rows ?? []).map((row) => ({
      value: String(row.value),
      label: `${row.value} · ${row.label}`,
    }));
  }

  return {
    lineas: (lineasResult.rows ?? []).map((row) => ({
      value: String(row.value),
      label: `${row.value} · ${row.label}`,
    })),
    sublineas: (sublineasResult.rows ?? []).map((row) => ({
      value: String(row.value),
      label: `${row.value} · ${row.label}`,
    })),
    items,
  };
}

export function resolvePeriodoStdTableName(
  sourceTable: RotacionSourceTable,
): string {
  return resolveRotacionPeriodoStdTable(sourceTable);
}
