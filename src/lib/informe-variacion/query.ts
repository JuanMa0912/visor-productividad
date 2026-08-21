import type { ClientBase } from "pg";
import {
  listMargenSedeCatalogOptions,
  type MargenSedeCatalogOption,
} from "@/lib/margenes/margen-sede-catalog";
import { sedeKey } from "@/lib/margenes/margen-final-query";
import {
  isRollTable,
  resolveInformeMargenDataSource,
  type MargenDataTable,
} from "@/lib/margenes/margen-data-source";
import {
  buildInformeCategoriaLabel,
  buildInformeItemLabel,
  buildInformeLineaLabel,
  buildInformeSublineaLabel,
  formatInformeSedeLabel,
  informeEmpresaLabel,
} from "@/lib/informe-variacion/labels";
import { computeInformePeriods } from "@/lib/informe-variacion/periods";
import {
  splitInformeRangeAgainstClosedCut,
  type InformeDayRangeSpec,
} from "@/lib/informe-variacion/day-ranges";
import {
  computeInformeRangePeriods,
  informeRangeCacheKey,
  mergeInformeRangePlans,
  splitInformeRangeForQuery,
  type InformeSelectedRanges,
} from "@/lib/informe-variacion/date-range";
import { informePayloadHasComparisonData } from "@/lib/informe-variacion/comparison";
import {
  filterInformeVariacionSedes,
  sortInformeSedeCatalog,
} from "@/lib/informe-variacion/sede-order";
import { filterInformePayloadForLineScope } from "@/lib/informe-variacion/informe-line-scope";
import { applyInformeDayRangeProjection } from "@/lib/informe-variacion/projection";
import { attachInformeProveedores } from "@/lib/informe-variacion/proveedores";
import { attachInformeMarcas } from "@/lib/informe-variacion/marcas";
import { resolveUserLineCategoryScope } from "@/lib/shared/line-category-scope";
import { getInformePayloadStd } from "@/lib/informe-variacion/payload-std-server";
import {
  addInformePayloadMetrics,
  sumInformePayloadCurrentValue,
} from "@/lib/informe-variacion/payload-merge";
import type { InformePeriods } from "@/lib/informe-variacion/types";
import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";

export type InformeDbAggRow = {
  empresa: string;
  id_co: string;
  id_tipo: string;
  id_linea1: string;
  nombre_linea1: string;
  id_linea2: string;
  nombre_linea2: string;
  id_item: string;
  item_descripcion: string;
  id_unidad: string;
  u_cur: string | number;
  u_mom: string | number;
  u_yoy: string | number;
  v_cur: string | number;
  v_mom: string | number;
  v_yoy: string | number;
  m_cur: string | number;
  m_mom: string | number;
  m_yoy: string | number;
};

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const aggRowKey = (row: InformeDbAggRow) =>
  [
    row.empresa,
    row.id_co,
    row.id_tipo,
    row.id_linea1,
    row.id_linea2,
    row.id_item,
  ].join("\u0001");

export const mergeInformeDbAggRows = (
  left: InformeDbAggRow[],
  right: InformeDbAggRow[],
): InformeDbAggRow[] => {
  const map = new Map<string, InformeDbAggRow>();
  const add = (row: InformeDbAggRow) => {
    const key = aggRowKey(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...row,
        u_cur: toNum(row.u_cur),
        u_mom: toNum(row.u_mom),
        u_yoy: toNum(row.u_yoy),
        v_cur: toNum(row.v_cur),
        v_mom: toNum(row.v_mom),
        v_yoy: toNum(row.v_yoy),
        m_cur: toNum(row.m_cur),
        m_mom: toNum(row.m_mom),
        m_yoy: toNum(row.m_yoy),
      });
      return;
    }
    prev.u_cur = toNum(prev.u_cur) + toNum(row.u_cur);
    prev.u_mom = toNum(prev.u_mom) + toNum(row.u_mom);
    prev.u_yoy = toNum(prev.u_yoy) + toNum(row.u_yoy);
    prev.v_cur = toNum(prev.v_cur) + toNum(row.v_cur);
    prev.v_mom = toNum(prev.v_mom) + toNum(row.v_mom);
    prev.v_yoy = toNum(prev.v_yoy) + toNum(row.v_yoy);
    prev.m_cur = toNum(prev.m_cur) + toNum(row.m_cur);
    prev.m_mom = toNum(prev.m_mom) + toNum(row.m_mom);
    prev.m_yoy = toNum(prev.m_yoy) + toNum(row.m_yoy);
  };
  left.forEach(add);
  right.forEach(add);
  return [...map.values()];
};

const sumAggCurrentValue = (rows: InformeDbAggRow[]) =>
  rows.reduce((sum, row) => sum + toNum(row.v_cur), 0);

/**
 * Placeholders de sede/tipo/linea empiezan DESPUES de `leadingParams`
 * (fechas o arrays de meses/dias del comparativo).
 */
const buildSedeFilter = (
  table: MargenDataTable,
  allowedSedeKeys: string[] | null,
  params: Array<string | string[]>,
  leadingParams: number,
): string => {
  // null = sin filtro (admin / todas). [] = denegar (no confundir con "todas").
  if (allowedSedeKeys === null) return "";
  if (allowedSedeKeys.length === 0) return "AND FALSE";

  const pairs = allowedSedeKeys
    .map((key) => {
      const [empresa, idCo] = key.split("|");
      if (!empresa || !idCo) return null;
      return { empresa: empresa.toLowerCase(), idCo: idCo.padStart(3, "0") };
    })
    .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);

  if (pairs.length === 0) return "AND FALSE";

  params.push(
    pairs.map((pair) => pair.empresa),
    pairs.map((pair) => pair.idCo),
  );
  const empresaParam = leadingParams + params.length - 1;
  const coParam = leadingParams + params.length;

  if (isRollTable(table)) {
    return `AND (empresa_norm, id_co_norm) IN (
      SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa_norm, id_co_norm)
    )`;
  }

  return `AND (LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0'))
    IN (SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa, id_co))`;
};

const buildMargenTipoFilter = (
  table: MargenDataTable,
  forcedMargenTipos: string[] | null,
  params: Array<string | string[]>,
  leadingParams = 6,
): string => {
  if (!forcedMargenTipos?.length) return "";
  params.push(forcedMargenTipos);
  const tipoParam = leadingParams + params.length;
  if (isRollTable(table)) {
    return `AND id_tipo = ANY($${tipoParam}::text[])`;
  }
  return `AND TRIM(COALESCE(id_tipo::text, '')) = ANY($${tipoParam}::text[])`;
};

const buildMargenLineaFilter = (
  table: MargenDataTable,
  forcedMargenLineas: string[] | null,
  params: Array<string | string[]>,
  leadingParams = 6,
): string => {
  if (!forcedMargenLineas?.length) return "";
  params.push(forcedMargenLineas);
  const lineaParam = leadingParams + params.length;
  if (isRollTable(table)) {
    return `AND id_linea1 = ANY($${lineaParam}::text[])`;
  }
  return `AND TRIM(COALESCE(id_linea1::text, '')) = ANY($${lineaParam}::text[])`;
};

const buildMargenExcludedTipoFilter = (
  table: MargenDataTable,
  excludedMargenTipos: string[] | null,
  params: Array<string | string[]>,
  leadingParams = 6,
): string => {
  if (!excludedMargenTipos?.length) return "";
  params.push(excludedMargenTipos);
  const tipoParam = leadingParams + params.length;
  if (isRollTable(table)) {
    return `AND NOT (id_tipo = ANY($${tipoParam}::text[]))`;
  }
  return `AND NOT (TRIM(COALESCE(id_tipo::text, '')) = ANY($${tipoParam}::text[]))`;
};

export { buildMargenTipoFilter as buildInformeMargenTipoFilter };
export { buildMargenLineaFilter as buildInformeMargenLineaFilter };
export { buildMargenExcludedTipoFilter as buildInformeMargenExcludedTipoFilter };

const buildRangeFilters = (
  table: MargenDataTable,
  allowedSedeKeys: string[] | null,
  forcedMargenTipos: string[] | null,
  forcedMargenLineas: string[] | null,
  excludedMargenTipos: string[] | null,
  leadingParams: number,
) => {
  const extraParams: Array<string | string[]> = [];
  const sedeFilterSql = buildSedeFilter(
    table,
    allowedSedeKeys,
    extraParams,
    leadingParams,
  );
  const tipoFilterSql = buildMargenTipoFilter(
    table,
    forcedMargenTipos,
    extraParams,
    leadingParams,
  );
  const lineaFilterSql = buildMargenLineaFilter(
    table,
    forcedMargenLineas,
    extraParams,
    leadingParams,
  );
  const excludedTipoFilterSql = buildMargenExcludedTipoFilter(
    table,
    excludedMargenTipos,
    extraParams,
    leadingParams,
  );
  return {
    extraParams,
    filterSql: `${sedeFilterSql}${tipoFilterSql}${lineaFilterSql}${excludedTipoFilterSql}`,
  };
};

/**
 * Comparativo de 2 periodos sobre dias (Dinastia / fallback sin mes_roll).
 * $1-$2 actual, $3-$4 anterior. El slot YoY se copia del anterior.
 */
const buildInformeTwoPeriodSql = (
  table: MargenDataTable,
  sedeFilterSql: string,
) => {
  if (isRollTable(table)) {
    const qty = "COALESCE(cantidad, 0)";
    const ventasCol = "COALESCE(ventas_netas, 0)";
    const margenCol = "COALESCE(margen_pesos, 0)";
    return `
      SELECT
        empresa_norm AS empresa,
        id_co_norm AS id_co,
        id_tipo,
        id_linea1,
        MAX(nombre_linea1) AS nombre_linea1,
        id_linea2,
        MAX(nombre_linea2) AS nombre_linea2,
        id_item,
        MAX(item_descripcion) AS item_descripcion,
        '' AS id_unidad,
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${qty} ELSE 0 END) AS u_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${qty} ELSE 0 END) AS u_mom,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${qty} ELSE 0 END) AS u_yoy,
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${ventasCol} ELSE 0 END) AS v_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${ventasCol} ELSE 0 END) AS v_mom,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${ventasCol} ELSE 0 END) AS v_yoy,
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${margenCol} ELSE 0 END) AS m_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${margenCol} ELSE 0 END) AS m_mom,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${margenCol} ELSE 0 END) AS m_yoy
      FROM ${table}
      WHERE (
          (fecha_dcto >= $1 AND fecha_dcto <= $2)
          OR (fecha_dcto >= $3 AND fecha_dcto <= $4)
        )
        ${sedeFilterSql}
      GROUP BY
        empresa_norm,
        id_co_norm,
        id_tipo,
        id_linea1,
        id_linea2,
        id_item
      HAVING
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${qty} ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${qty} ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${ventasCol} ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${ventasCol} ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN ${margenCol} ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN ${margenCol} ELSE 0 END) <> 0
    `;
  }

  return `
    SELECT
      LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
      LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0') AS id_co,
      TRIM(COALESCE(id_tipo::text, '')) AS id_tipo,
      TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
      TRIM(COALESCE(MAX(nombre_linea1), '')) AS nombre_linea1,
      TRIM(COALESCE(id_linea2::text, '')) AS id_linea2,
      TRIM(COALESCE(MAX(nombre_linea2), '')) AS nombre_linea2,
      TRIM(COALESCE(id_item::text, '')) AS id_item,
      TRIM(COALESCE(MAX(item_descripcion), '')) AS item_descripcion,
      TRIM(COALESCE(MAX(id_unidad::text), '')) AS id_unidad,
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_cur,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_mom,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_yoy,
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_cur,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_mom,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_yoy,
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_cur,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_mom,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_yoy
    FROM ${table}
    WHERE (
        (fecha_dcto >= $1 AND fecha_dcto <= $2)
        OR (fecha_dcto >= $3 AND fecha_dcto <= $4)
      )
      ${sedeFilterSql}
    GROUP BY
      LOWER(TRIM(COALESCE(empresa, ''))),
      LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0'),
      TRIM(COALESCE(id_tipo::text, '')),
      TRIM(COALESCE(id_linea1::text, '')),
      TRIM(COALESCE(id_linea2::text, '')),
      TRIM(COALESCE(id_item::text, '')),
      TRIM(COALESCE(id_unidad::text, ''))
    HAVING
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) <> 0
  `;
};

/**
 * YTD rapido: meses cerrados en margen_item_mes_roll + recortes diarios.
 * $1 cur_months, $2 prev_months, $3/$4 cur leftover from/to[], $5/$6 prev leftover.
 */
const buildInformeMonthRollSql = (filterSql: string) => `
  WITH leftover_cur AS (
    SELECT dfrom, dto
    FROM UNNEST($3::text[], $4::text[]) AS t(dfrom, dto)
    WHERE dfrom IS NOT NULL AND dfrom <> '' AND dto IS NOT NULL AND dto <> ''
  ),
  leftover_prev AS (
    SELECT dfrom, dto
    FROM UNNEST($5::text[], $6::text[]) AS t(dfrom, dto)
    WHERE dfrom IS NOT NULL AND dfrom <> '' AND dto IS NOT NULL AND dto <> ''
  ),
  src AS (
    SELECT
      empresa_norm,
      id_co_norm,
      id_tipo,
      id_linea1,
      nombre_linea1,
      id_linea2,
      nombre_linea2,
      id_item,
      item_descripcion,
      CASE WHEN anio_mes = ANY($1::text[]) THEN COALESCE(cantidad, 0) ELSE 0 END AS u_cur,
      CASE WHEN anio_mes = ANY($2::text[]) THEN COALESCE(cantidad, 0) ELSE 0 END AS u_mom,
      CASE WHEN anio_mes = ANY($1::text[]) THEN COALESCE(ventas_netas, 0) ELSE 0 END AS v_cur,
      CASE WHEN anio_mes = ANY($2::text[]) THEN COALESCE(ventas_netas, 0) ELSE 0 END AS v_mom,
      CASE WHEN anio_mes = ANY($1::text[]) THEN COALESCE(margen_pesos, 0) ELSE 0 END AS m_cur,
      CASE WHEN anio_mes = ANY($2::text[]) THEN COALESCE(margen_pesos, 0) ELSE 0 END AS m_mom
    FROM margen_item_mes_roll
    WHERE (
        (CARDINALITY($1::text[]) > 0 AND $1[1] <> '' AND anio_mes = ANY($1::text[]))
        OR (CARDINALITY($2::text[]) > 0 AND $2[1] <> '' AND anio_mes = ANY($2::text[]))
      )
      ${filterSql}
    UNION ALL
    SELECT
      empresa_norm,
      id_co_norm,
      id_tipo,
      id_linea1,
      nombre_linea1,
      id_linea2,
      nombre_linea2,
      id_item,
      item_descripcion,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_cur l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(cantidad, 0) ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_prev l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(cantidad, 0) ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_cur l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(ventas_netas, 0) ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_prev l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(ventas_netas, 0) ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_cur l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(margen_pesos, 0) ELSE 0 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM leftover_prev l
        WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
      ) THEN COALESCE(margen_pesos, 0) ELSE 0 END
    FROM margen_item_dia_roll
    WHERE (
        (
          EXISTS (SELECT 1 FROM leftover_cur LIMIT 1)
          AND fecha_dcto >= (SELECT MIN(dfrom) FROM leftover_cur)
          AND fecha_dcto <= (SELECT MAX(dto) FROM leftover_cur)
          AND EXISTS (
            SELECT 1 FROM leftover_cur l
            WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
          )
        )
        OR (
          EXISTS (SELECT 1 FROM leftover_prev LIMIT 1)
          AND fecha_dcto >= (SELECT MIN(dfrom) FROM leftover_prev)
          AND fecha_dcto <= (SELECT MAX(dto) FROM leftover_prev)
          AND EXISTS (
            SELECT 1 FROM leftover_prev l
            WHERE fecha_dcto >= l.dfrom AND fecha_dcto <= l.dto
          )
        )
      )
      ${filterSql}
  )
  SELECT
    empresa_norm AS empresa,
    id_co_norm AS id_co,
    id_tipo,
    id_linea1,
    MAX(nombre_linea1) AS nombre_linea1,
    id_linea2,
    MAX(nombre_linea2) AS nombre_linea2,
    id_item,
    MAX(item_descripcion) AS item_descripcion,
    '' AS id_unidad,
    SUM(u_cur) AS u_cur,
    SUM(u_mom) AS u_mom,
    SUM(u_mom) AS u_yoy,
    SUM(v_cur) AS v_cur,
    SUM(v_mom) AS v_mom,
    SUM(v_mom) AS v_yoy,
    SUM(m_cur) AS m_cur,
    SUM(m_mom) AS m_mom,
    SUM(m_mom) AS m_yoy
  FROM src
  GROUP BY
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item
  HAVING
    SUM(u_cur) <> 0 OR SUM(u_mom) <> 0
    OR SUM(v_cur) <> 0 OR SUM(v_mom) <> 0
    OR SUM(m_cur) <> 0 OR SUM(m_mom) <> 0
`;

let mesRollAvailable: boolean | null = null;

const mesRollIsReady = async (client: ClientBase): Promise<boolean> => {
  if (mesRollAvailable === false) return false;
  if (mesRollAvailable === true) {
    const populated = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM margen_item_mes_roll LIMIT 1) AS ok
    `);
    return Boolean(populated.rows[0]?.ok);
  }
  const exists = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'margen_item_mes_roll'
    ) AS ok
  `);
  if (!exists.rows[0]?.ok) {
    mesRollAvailable = false;
    return false;
  }
  mesRollAvailable = true;
  const populated = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM margen_item_mes_roll LIMIT 1) AS ok
  `);
  return Boolean(populated.rows[0]?.ok);
};

export const resetInformeMesRollCache = () => {
  mesRollAvailable = null;
};

const leftoverArray = (values: string[]) =>
  values.length > 0 ? values : [""];

export const queryInformeVariacionRows = async (
  client: ClientBase,
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
  forcedMargenTipos: string[] | null = null,
  forcedMargenLineas: string[] | null = null,
  excludedMargenTipos: string[] | null = null,
  options?: { kind?: "default" | "dinastia" },
): Promise<InformeDbAggRow[]> => {
  const table = await resolveInformeMargenDataSource(client, {
    kind: options?.kind,
  });

  const canUseMesRoll =
    options?.kind !== "dinastia" &&
    table === "margen_item_dia_roll" &&
    (await mesRollIsReady(client));

  if (canUseMesRoll) {
    const currentPlan = splitInformeRangeForQuery(
      periods.current.from,
      periods.current.to,
    );
    const previousPlan = splitInformeRangeForQuery(periods.mom.from, periods.mom.to);
    const merged = mergeInformeRangePlans(currentPlan, previousPlan);
    const curLeftoverFrom = leftoverArray(
      merged.leftovers.filter((span) => span.bucket === "cur").map((span) => span.from),
    );
    const curLeftoverTo = leftoverArray(
      merged.leftovers.filter((span) => span.bucket === "cur").map((span) => span.to),
    );
    const prevLeftoverFrom = leftoverArray(
      merged.leftovers.filter((span) => span.bucket === "prev").map((span) => span.from),
    );
    const prevLeftoverTo = leftoverArray(
      merged.leftovers.filter((span) => span.bucket === "prev").map((span) => span.to),
    );

    const leadingParams = 6;
    const { extraParams, filterSql } = buildRangeFilters(
      table,
      allowedSedeKeys,
      forcedMargenTipos,
      forcedMargenLineas,
      excludedMargenTipos,
      leadingParams,
    );
    const sql = buildInformeMonthRollSql(filterSql);
    const params = [
      merged.currentMonths,
      merged.previousMonths,
      curLeftoverFrom,
      curLeftoverTo,
      prevLeftoverFrom,
      prevLeftoverTo,
      ...extraParams,
    ];
    const result = await client.query<InformeDbAggRow>(sql, params);
    return (result.rows ?? []).filter(
      (row) =>
        toNum(row.u_cur) !== 0 ||
        toNum(row.u_mom) !== 0 ||
        toNum(row.v_cur) !== 0 ||
        toNum(row.v_mom) !== 0 ||
        toNum(row.m_cur) !== 0 ||
        toNum(row.m_mom) !== 0,
    );
  }

  const leadingParams = 4;
  const { extraParams, filterSql } = buildRangeFilters(
    table,
    allowedSedeKeys,
    forcedMargenTipos,
    forcedMargenLineas,
    excludedMargenTipos,
    leadingParams,
  );
  const sql = buildInformeTwoPeriodSql(table, filterSql);
  const params = [
    periods.current.from,
    periods.current.to,
    periods.mom.from,
    periods.mom.to,
    ...extraParams,
  ];
  const result = await client.query<InformeDbAggRow>(sql, params);
  return (result.rows ?? []).filter(
    (row) =>
      toNum(row.u_cur) !== 0 ||
      toNum(row.u_mom) !== 0 ||
      toNum(row.v_cur) !== 0 ||
      toNum(row.v_mom) !== 0 ||
      toNum(row.m_cur) !== 0 ||
      toNum(row.m_mom) !== 0,
  );
};

const indexLabel = (
  map: Map<string, number>,
  labels: string[],
  label: string,
): number => {
  const existing = map.get(label);
  if (existing !== undefined) return existing;
  const index = labels.length;
  labels.push(label);
  map.set(label, index);
  return index;
};

const catalogForKind = (
  kind: "default" | "dinastia" = "default",
): MargenSedeCatalogOption[] => {
  const catalog = listMargenSedeCatalogOptions();
  if (kind === "dinastia") {
    return catalog.filter((option) => option.empresa === "dinastia");
  }
  return catalog.filter((option) => option.empresa !== "dinastia");
};

const buildSedeCatalog = (
  allowedSedeKeys: string[] | null,
  kind: "default" | "dinastia" = "default",
): MargenSedeCatalogOption[] => {
  const catalog = catalogForKind(kind);
  // null = catálogo del tenant; [] = ninguna sede (no "todas").
  if (allowedSedeKeys === null) return sortInformeSedeCatalog(catalog);
  if (allowedSedeKeys.length === 0) return [];
  const allowed = new Set(allowedSedeKeys);
  return sortInformeSedeCatalog(
    catalog.filter((option) => allowed.has(option.value)),
  );
};

export const buildInformeVariacionPayload = (
  dbRows: InformeDbAggRow[],
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
  kind: "default" | "dinastia" = "default",
): InformeVariacionPayload => {
  const catalog = buildSedeCatalog(allowedSedeKeys, kind);
  const sedeIndex = new Map<string, number>();
  const sedes = catalog.map((option, index) => {
    sedeIndex.set(option.value, index);
    return {
      e: informeEmpresaLabel(option.empresa),
      s: formatInformeSedeLabel(option.empresa, option.idCo, option.label),
      yoyOk: false,
      key: option.value,
    };
  });

  const cats: string[] = [];
  const lins: string[] = [];
  const subs: string[] = [];
  const items: string[] = [];
  const itemIds: string[] = [];
  const ums: string[] = [];
  const catMap = new Map<string, number>();
  const linMap = new Map<string, number>();
  const subMap = new Map<string, number>();
  const itemMap = new Map<string, number>();

  const rows: InformeCompactRow[] = [];
  const yoyTotals = new Array(sedes.length).fill(0);

  for (const row of dbRows) {
    const key = sedeKey(row.empresa, row.id_co);
    const sedeIdx = sedeIndex.get(key);
    if (sedeIdx === undefined) continue;

    const catLabel = buildInformeCategoriaLabel(row.id_tipo);
    const linLabel = buildInformeLineaLabel(row.id_linea1, row.nombre_linea1);
    const subLabel = buildInformeSublineaLabel(row.id_linea2, row.nombre_linea2);
    const itemLabel = buildInformeItemLabel(row.id_item, row.item_descripcion);

    const catIdx = indexLabel(catMap, cats, catLabel);
    const linIdx = indexLabel(linMap, lins, linLabel);
    const subIdx = indexLabel(subMap, subs, subLabel);
    const itemIdx = indexLabel(itemMap, items, itemLabel);
    if (!itemIds[itemIdx]) itemIds[itemIdx] = (row.id_item ?? "").trim();
    if (!ums[itemIdx]) ums[itemIdx] = (row.id_unidad ?? "").trim();

    const uCur = toNum(row.u_cur);
    const uMom = toNum(row.u_mom);
    const uYoy = toNum(row.u_yoy);
    const vCur = toNum(row.v_cur);
    const vMom = toNum(row.v_mom);
    const vYoy = toNum(row.v_yoy);
    const mCur = toNum(row.m_cur);
    const mMom = toNum(row.m_mom);
    const mYoy = toNum(row.m_yoy);

    yoyTotals[sedeIdx] += vMom;

    rows.push([
      sedeIdx,
      catIdx,
      linIdx,
      subIdx,
      itemIdx,
      uCur,
      uMom,
      uYoy,
      vCur,
      vMom,
      vYoy,
      mCur,
      mMom,
      mYoy,
    ]);
  }

  sedes.forEach((sede, index) => {
    sede.yoyOk = yoyTotals[index] > 0;
  });

  return {
    periods,
    sedes,
    cats,
    lins,
    subs,
    items,
    itemIds,
    ums,
    rows,
    meta: {
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
      comparisonAvailable: informePayloadHasComparisonData(rows),
    },
  };
};

export type LoadInformeVariacionOptions = {
  dayRange?: InformeDayRangeSpec | null;
  forcedMargenTipos?: string[] | null;
  forcedMargenLineas?: string[] | null;
  excludedMargenTipos?: string[] | null;
  kind?: "default" | "dinastia";
  compare?: { year: number; month: number } | null;
  ranges?: InformeSelectedRanges | null;
};

const decorateInformePayload = async (
  client: ClientBase,
  payload: InformeVariacionPayload,
  options: LoadInformeVariacionOptions,
  year?: number,
  month?: number,
): Promise<InformeVariacionPayload> => {
  const lineScope = {
    ...resolveUserLineCategoryScope(null),
    forcedMargenTipos: options.forcedMargenTipos ?? null,
    forcedMargenLineas: options.forcedMargenLineas ?? null,
    excludedMargenTipos: options.excludedMargenTipos ?? null,
    locked: Boolean(
      options.forcedMargenTipos?.length ||
        options.forcedMargenLineas?.length ||
        options.excludedMargenTipos?.length,
    ),
  };
  const filtered = filterInformePayloadForLineScope(payload, lineScope);
  const [withProveedores, withMarcas] = await Promise.all([
    attachInformeProveedores(client, filtered),
    attachInformeMarcas(client, filtered),
  ]);
  const decorated = {
    ...withProveedores,
    marcas: withMarcas.marcas,
    itemMarca: withMarcas.itemMarca,
  };
  const withMeta = options.ranges
    ? {
        ...decorated,
        meta: {
          ...decorated.meta,
          rangeKey: informeRangeCacheKey(options.ranges),
        },
      }
    : attachDayRangeMeta(decorated, options.dayRange);
  if (!options.dayRange || year == null || month == null) return withMeta;
  return applyInformeDayRangeProjection(
    withMeta,
    year,
    month,
    options.dayRange,
  );
};

const finishInformePayload = async (
  client: ClientBase,
  dbRows: InformeDbAggRow[],
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
  options: LoadInformeVariacionOptions,
  year?: number,
  month?: number,
): Promise<InformeVariacionPayload> => {
  const payload = buildInformeVariacionPayload(
    dbRows,
    periods,
    allowedSedeKeys,
    options.kind ?? "default",
  );
  return decorateInformePayload(client, payload, options, year, month);
};

export const loadInformeVariacionRangePayload = async (
  client: ClientBase,
  ranges: InformeSelectedRanges,
  allowedSedeKeys: string[] | null,
  options: Omit<LoadInformeVariacionOptions, "ranges" | "dayRange" | "compare"> = {},
): Promise<InformeVariacionPayload> => {
  const periods = computeInformeRangePeriods(ranges);
  const dbRows = await queryInformeVariacionRows(
    client,
    periods,
    allowedSedeKeys,
    options.forcedMargenTipos ?? null,
    options.forcedMargenLineas ?? null,
    options.excludedMargenTipos ?? null,
    { kind: options.kind },
  );
  return finishInformePayload(client, dbRows, periods, allowedSedeKeys, {
    ...options,
    ranges,
  });
};

export const loadInformeVariacionPayload = async (
  client: ClientBase,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  options: LoadInformeVariacionOptions = {},
): Promise<InformeVariacionPayload> => {
  if (options.ranges) {
    return loadInformeVariacionRangePayload(
      client,
      options.ranges,
      allowedSedeKeys,
      options,
    );
  }

  const split =
    options.kind === "dinastia" || !options.dayRange
      ? { closed: null, leftover: null }
      : splitInformeRangeAgainstClosedCut(options.dayRange);

  if (split.closed && split.leftover) {
    const closedPeriods = computeInformePeriods(
      year,
      month,
      split.closed,
      options.compare,
    );
    const leftoverPeriods = computeInformePeriods(
      year,
      month,
      split.leftover,
      options.compare,
    );
    const fullPeriods = computeInformePeriods(
      year,
      month,
      options.dayRange,
      options.compare,
    );
    const queryKind = { kind: options.kind };
    const closedRows = await queryInformeVariacionRows(
      client,
      closedPeriods,
      allowedSedeKeys,
      options.forcedMargenTipos ?? null,
      options.forcedMargenLineas ?? null,
      options.excludedMargenTipos ?? null,
      queryKind,
    );
    const leftoverRows = await queryInformeVariacionRows(
      client,
      leftoverPeriods,
      allowedSedeKeys,
      options.forcedMargenTipos ?? null,
      options.forcedMargenLineas ?? null,
      options.excludedMargenTipos ?? null,
      queryKind,
    );
    const stdClosed = await getInformePayloadStd(
      client,
      year,
      month,
      split.closed.id,
    );
    const liveClosedValue = sumAggCurrentValue(closedRows);
    const stdClosedValue = stdClosed
      ? sumInformePayloadCurrentValue(stdClosed)
      : 0;

    if (stdClosed && stdClosedValue > liveClosedValue * 1.15) {
      const scopedStd =
        allowedSedeKeys == null
          ? stdClosed
          : filterInformeVariacionSedes(stdClosed, (sede) =>
              allowedSedeKeys.includes(sede.key),
            );
      const leftoverPayload = buildInformeVariacionPayload(
        leftoverRows,
        leftoverPeriods,
        allowedSedeKeys,
        options.kind ?? "default",
      );
      const merged = addInformePayloadMetrics(
        { ...scopedStd, periods: fullPeriods },
        leftoverPayload,
      );
      return decorateInformePayload(client, merged, options, year, month);
    }

    return finishInformePayload(
      client,
      mergeInformeDbAggRows(closedRows, leftoverRows),
      fullPeriods,
      allowedSedeKeys,
      options,
      year,
      month,
    );
  }

  const periods = computeInformePeriods(
    year,
    month,
    options.dayRange,
    options.compare,
  );
  const dbRows = await queryInformeVariacionRows(
    client,
    periods,
    allowedSedeKeys,
    options.forcedMargenTipos ?? null,
    options.forcedMargenLineas ?? null,
    options.excludedMargenTipos ?? null,
    { kind: options.kind },
  );
  return finishInformePayload(
    client,
    dbRows,
    periods,
    allowedSedeKeys,
    options,
    year,
    month,
  );
};

const attachDayRangeMeta = (
  payload: InformeVariacionPayload,
  dayRange?: InformeDayRangeSpec | null,
): InformeVariacionPayload => {
  if (!dayRange) return payload;
  return {
    ...payload,
    meta: {
      ...payload.meta,
      dayRange: {
        id: dayRange.id,
        label: dayRange.label,
        fromDay: dayRange.fromDay,
        toDay: dayRange.toDay,
        ...(dayRange.projection
          ? {
              projection: {
                actualToDay: dayRange.projection.actualToDay,
                targetToDay: dayRange.projection.targetToDay,
                factor: dayRange.projection.factor,
              },
            }
          : {}),
      },
    },
  };
};
