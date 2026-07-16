import type { PoolClient } from "pg";
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
import type { InformeDayRangeSpec } from "@/lib/informe-variacion/day-ranges";
import { informePayloadHasComparisonData } from "@/lib/informe-variacion/comparison";
import { sortInformeSedeCatalog } from "@/lib/informe-variacion/sede-order";
import { filterInformePayloadForLineScope } from "@/lib/informe-variacion/informe-line-scope";
import { resolveUserLineCategoryScope } from "@/lib/shared/line-category-scope";
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

/**
 * Filtro de sedes. Los 6 primeros placeholders son fechas
 * ($1..$6 = cur/mom/yoy from-to); los de sede empiezan en $7.
 */
const buildSedeFilter = (
  table: MargenDataTable,
  allowedSedeKeys: string[] | null,
  params: Array<string | string[]>,
): string => {
  if (!allowedSedeKeys || allowedSedeKeys.length === 0) return "";

  const pairs = allowedSedeKeys
    .map((key) => {
      const [empresa, idCo] = key.split("|");
      if (!empresa || !idCo) return null;
      return { empresa: empresa.toLowerCase(), idCo: idCo.padStart(3, "0") };
    })
    .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);

  if (pairs.length === 0) return "";

  params.push(
    pairs.map((pair) => pair.empresa),
    pairs.map((pair) => pair.idCo),
  );
  // $1..$6 fechas; sedeParams van despues → $7 / $8
  const empresaParam = 6 + params.length - 1;
  const coParam = 6 + params.length;

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
): string => {
  if (!forcedMargenTipos?.length) return "";
  params.push(forcedMargenTipos);
  const tipoParam = 6 + params.length;
  if (isRollTable(table)) {
    return `AND id_tipo = ANY($${tipoParam}::text[])`;
  }
  return `AND TRIM(COALESCE(id_tipo::text, '')) = ANY($${tipoParam}::text[])`;
};

const buildMargenLineaFilter = (
  table: MargenDataTable,
  forcedMargenLineas: string[] | null,
  params: Array<string | string[]>,
): string => {
  if (!forcedMargenLineas?.length) return "";
  params.push(forcedMargenLineas);
  const lineaParam = 6 + params.length;
  if (isRollTable(table)) {
    return `AND id_linea1 = ANY($${lineaParam}::text[])`;
  }
  return `AND TRIM(COALESCE(id_linea1::text, '')) = ANY($${lineaParam}::text[])`;
};

const buildMargenExcludedTipoFilter = (
  table: MargenDataTable,
  excludedMargenTipos: string[] | null,
  params: Array<string | string[]>,
): string => {
  if (!excludedMargenTipos?.length) return "";
  params.push(excludedMargenTipos);
  const tipoParam = 6 + params.length;
  if (isRollTable(table)) {
    return `AND NOT (id_tipo = ANY($${tipoParam}::text[]))`;
  }
  return `AND NOT (TRIM(COALESCE(id_tipo::text, '')) = ANY($${tipoParam}::text[]))`;
};

export { buildMargenTipoFilter as buildInformeMargenTipoFilter };
export { buildMargenLineaFilter as buildInformeMargenLineaFilter };
export { buildMargenExcludedTipoFilter as buildInformeMargenExcludedTipoFilter };

/**
 * Una sola pasada: MoM + YoY + actual en CASE, filtrando solo las 3 ventanas.
 * Evita 3 round-trips serializados en el mismo client de `pg`.
 */
const buildInformeThreePeriodSql = (
  table: MargenDataTable,
  sedeFilterSql: string,
) => {
  if (isRollTable(table)) {
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
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_mom,
        SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_yoy,
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(ventas_netas, 0) ELSE 0 END) AS v_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(ventas_netas, 0) ELSE 0 END) AS v_mom,
        SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(ventas_netas, 0) ELSE 0 END) AS v_yoy,
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(margen_pesos, 0) ELSE 0 END) AS m_cur,
        SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(margen_pesos, 0) ELSE 0 END) AS m_mom,
        SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(margen_pesos, 0) ELSE 0 END) AS m_yoy
      FROM ${table}
      WHERE (
          (fecha_dcto >= $1 AND fecha_dcto <= $2)
          OR (fecha_dcto >= $3 AND fecha_dcto <= $4)
          OR (fecha_dcto >= $5 AND fecha_dcto <= $6)
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
        SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(ventas_netas, 0) ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(ventas_netas, 0) ELSE 0 END) <> 0
        OR SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(ventas_netas, 0) ELSE 0 END) <> 0
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
      SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_yoy,
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_cur,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_mom,
      SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) AS v_yoy,
      SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_cur,
      SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_mom,
      SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0) ELSE 0 END) AS m_yoy
    FROM ${table}
    WHERE (
        (fecha_dcto >= $1 AND fecha_dcto <= $2)
        OR (fecha_dcto >= $3 AND fecha_dcto <= $4)
        OR (fecha_dcto >= $5 AND fecha_dcto <= $6)
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
      OR SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $1 AND fecha_dcto <= $2 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $3 AND fecha_dcto <= $4 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto >= $5 AND fecha_dcto <= $6 THEN COALESCE(vlrtot_bru, 0) ELSE 0 END) <> 0
  `;
};

export const queryInformeVariacionRows = async (
  client: PoolClient,
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
  forcedMargenTipos: string[] | null = null,
  forcedMargenLineas: string[] | null = null,
  excludedMargenTipos: string[] | null = null,
): Promise<InformeDbAggRow[]> => {
  const table = await resolveInformeMargenDataSource(client);
  const extraParams: Array<string | string[]> = [];
  const sedeFilterSql = buildSedeFilter(table, allowedSedeKeys, extraParams);
  const tipoFilterSql = buildMargenTipoFilter(table, forcedMargenTipos, extraParams);
  const lineaFilterSql = buildMargenLineaFilter(
    table,
    forcedMargenLineas,
    extraParams,
  );
  const excludedTipoFilterSql = buildMargenExcludedTipoFilter(
    table,
    excludedMargenTipos,
    extraParams,
  );
  const sql = buildInformeThreePeriodSql(
    table,
    `${sedeFilterSql}${tipoFilterSql}${lineaFilterSql}${excludedTipoFilterSql}`,
  );
  const params = [
    periods.current.from,
    periods.current.to,
    periods.mom.from,
    periods.mom.to,
    periods.yoy.from,
    periods.yoy.to,
    ...extraParams,
  ];
  const result = await client.query<InformeDbAggRow>(sql, params);
  return (result.rows ?? []).filter(
    (row) =>
      toNum(row.u_cur) !== 0 ||
      toNum(row.u_mom) !== 0 ||
      toNum(row.u_yoy) !== 0 ||
      toNum(row.v_cur) !== 0 ||
      toNum(row.v_mom) !== 0 ||
      toNum(row.v_yoy) !== 0,
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

const buildSedeCatalog = (
  allowedSedeKeys: string[] | null,
): MargenSedeCatalogOption[] => {
  const catalog = listMargenSedeCatalogOptions();
  const filtered =
    !allowedSedeKeys || allowedSedeKeys.length === 0
      ? catalog
      : catalog.filter((option) => allowedSedeKeys.includes(option.value));
  return sortInformeSedeCatalog(filtered);
};

export const buildInformeVariacionPayload = (
  dbRows: InformeDbAggRow[],
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
): InformeVariacionPayload => {
  const catalog = buildSedeCatalog(allowedSedeKeys);
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

    yoyTotals[sedeIdx] += vYoy;

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
};

export const loadInformeVariacionPayload = async (
  client: PoolClient,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  options: LoadInformeVariacionOptions = {},
): Promise<InformeVariacionPayload> => {
  const periods = computeInformePeriods(year, month, options.dayRange);
  const dbRows = await queryInformeVariacionRows(
    client,
    periods,
    allowedSedeKeys,
    options.forcedMargenTipos ?? null,
    options.forcedMargenLineas ?? null,
    options.excludedMargenTipos ?? null,
  );
  const payload = buildInformeVariacionPayload(dbRows, periods, allowedSedeKeys);
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
  return attachDayRangeMeta(filtered, options.dayRange);
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
      },
    },
  };
};
