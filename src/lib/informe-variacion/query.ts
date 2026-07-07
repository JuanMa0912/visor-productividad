import type { PoolClient } from "pg";
import {
  listMargenSedeCatalogOptions,
  type MargenSedeCatalogOption,
} from "@/lib/margenes/margen-sede-catalog";
import { sedeKey } from "@/lib/margenes/margen-final-query";
import {
  isRollTable,
  resolveMargenDataSource,
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
import {
  applyInformeMockComparisonBases,
  informePayloadHasComparisonData,
} from "@/lib/informe-variacion/mock-bases";
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
};

type InformePeriodSliceRow = {
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
  u_val: string | number;
  v_val: string | number;
};

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const rowMergeKey = (row: InformePeriodSliceRow) =>
  [
    row.empresa,
    row.id_co,
    row.id_tipo,
    row.id_linea1,
    row.id_linea2,
    row.id_item,
    row.id_unidad ?? "",
  ].join("\u0001");

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
  const empresaParam = params.length - 1;
  const coParam = params.length;

  if (isRollTable(table)) {
    return `AND (empresa_norm, id_co_norm) IN (
      SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa_norm, id_co_norm)
    )`;
  }

  return `AND (LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0'))
    IN (SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa, id_co))`;
};

/** Una pasada por mes: aprovecha indice fecha+sede en roll/raw. */
const buildInformeSinglePeriodSql = (
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
        SUM(COALESCE(cantidad, 0)) AS u_val,
        SUM(COALESCE(ventas_netas, 0)) AS v_val
      FROM ${table}
      WHERE fecha_dcto >= $1 AND fecha_dcto <= $2
        ${sedeFilterSql}
      GROUP BY
        empresa_norm,
        id_co_norm,
        id_tipo,
        id_linea1,
        id_linea2,
        id_item
      HAVING
        SUM(COALESCE(cantidad, 0)) <> 0
        OR SUM(COALESCE(ventas_netas, 0)) <> 0
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
      SUM(COALESCE(cantidad, 0)) AS u_val,
      SUM(COALESCE(vlrtot_bru, 0)) AS v_val
    FROM ${table}
    WHERE fecha_dcto >= $1 AND fecha_dcto <= $2
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
      SUM(COALESCE(cantidad, 0)) <> 0
      OR SUM(COALESCE(vlrtot_bru, 0)) <> 0
  `;
};

const queryInformePeriodSlice = async (
  client: PoolClient,
  table: MargenDataTable,
  from: string,
  to: string,
  sedeFilterSql: string,
  baseParams: string[],
): Promise<InformePeriodSliceRow[]> => {
  const params = [from, to, ...baseParams];
  const sql = buildInformeSinglePeriodSql(table, sedeFilterSql);
  const result = await client.query<InformePeriodSliceRow>(sql, params);
  return result.rows ?? [];
};

const mergeInformePeriodSlices = (
  current: InformePeriodSliceRow[],
  mom: InformePeriodSliceRow[],
  yoy: InformePeriodSliceRow[],
): InformeDbAggRow[] => {
  const map = new Map<string, InformeDbAggRow>();

  const ensure = (row: InformePeriodSliceRow): InformeDbAggRow => {
    const key = rowMergeKey(row);
    const existing = map.get(key);
    if (existing) return existing;
    const created: InformeDbAggRow = {
      empresa: row.empresa,
      id_co: row.id_co,
      id_tipo: row.id_tipo,
      id_linea1: row.id_linea1,
      nombre_linea1: row.nombre_linea1,
      id_linea2: row.id_linea2,
      nombre_linea2: row.nombre_linea2,
      id_item: row.id_item,
      item_descripcion: row.item_descripcion,
      id_unidad: row.id_unidad,
      u_cur: 0,
      u_mom: 0,
      u_yoy: 0,
      v_cur: 0,
      v_mom: 0,
      v_yoy: 0,
    };
    map.set(key, created);
    return created;
  };

  for (const row of current) {
    const acc = ensure(row);
    acc.u_cur = toNum(row.u_val);
    acc.v_cur = toNum(row.v_val);
  }
  for (const row of mom) {
    const acc = ensure(row);
    acc.u_mom = toNum(row.u_val);
    acc.v_mom = toNum(row.v_val);
  }
  for (const row of yoy) {
    const acc = ensure(row);
    acc.u_yoy = toNum(row.u_val);
    acc.v_yoy = toNum(row.v_val);
  }

  return [...map.values()].filter(
    (row) =>
      toNum(row.u_cur) !== 0 ||
      toNum(row.u_mom) !== 0 ||
      toNum(row.u_yoy) !== 0 ||
      toNum(row.v_cur) !== 0 ||
      toNum(row.v_mom) !== 0 ||
      toNum(row.v_yoy) !== 0,
  );
};

export type QueryInformeVariacionOptions = {
  currentPeriodOnly?: boolean;
};

export const queryInformeVariacionRows = async (
  client: PoolClient,
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
  options: QueryInformeVariacionOptions = {},
): Promise<InformeDbAggRow[]> => {
  const table = await resolveMargenDataSource(client);
  const sedeParams: Array<string | string[]> = [];
  const sedeFilterSql = buildSedeFilter(table, allowedSedeKeys, sedeParams);

  if (options.currentPeriodOnly) {
    const current = await queryInformePeriodSlice(
      client,
      table,
      periods.current.from,
      periods.current.to,
      sedeFilterSql,
      sedeParams,
    );
    return mergeInformePeriodSlices(current, [], []);
  }

  const [current, mom, yoy] = await Promise.all([
    queryInformePeriodSlice(
      client,
      table,
      periods.current.from,
      periods.current.to,
      sedeFilterSql,
      sedeParams,
    ),
    queryInformePeriodSlice(
      client,
      table,
      periods.mom.from,
      periods.mom.to,
      sedeFilterSql,
      sedeParams,
    ),
    queryInformePeriodSlice(
      client,
      table,
      periods.yoy.from,
      periods.yoy.to,
      sedeFilterSql,
      sedeParams,
    ),
  ]);

  return mergeInformePeriodSlices(current, mom, yoy);
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
  if (!allowedSedeKeys) return catalog;
  const allowed = new Set(allowedSedeKeys);
  return catalog.filter((option) => allowed.has(option.value));
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
  mockBases?: boolean;
  dayRange?: InformeDayRangeSpec | null;
};

export const loadInformeVariacionPayload = async (
  client: PoolClient,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  options: LoadInformeVariacionOptions = {},
): Promise<InformeVariacionPayload> => {
  const periods = computeInformePeriods(year, month, options.dayRange);

  if (options.mockBases === true) {
    const dbRows = await queryInformeVariacionRows(client, periods, allowedSedeKeys, {
      currentPeriodOnly: true,
    });
    if (dbRows.length === 0) {
      throw new Error("informe-sin-filas-mes-actual");
    }
    let payload = buildInformeVariacionPayload(dbRows, periods, allowedSedeKeys);
    if (!payload.meta.comparisonAvailable) {
      payload = applyInformeMockComparisonBases(payload);
    }
    return attachDayRangeMeta(payload, options.dayRange);
  }

  const dbRows = await queryInformeVariacionRows(client, periods, allowedSedeKeys);
  const payload = buildInformeVariacionPayload(dbRows, periods, allowedSedeKeys);
  return attachDayRangeMeta(payload, options.dayRange);
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
