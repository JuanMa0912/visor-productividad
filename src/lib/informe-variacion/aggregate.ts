import type {
  InformeCompactRow,
  InformeGlobalFilters,
  InformeMetric,
  InformeSedeMeta,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import {
  readInformeRowPeriodTriple,
  informeMetricContextFromPayload,
  type InformeMetricContext,
} from "@/lib/informe-variacion/informe-metric-values";
import { reorderInformeVariacionSedes } from "@/lib/informe-variacion/sede-order";
import {
  buildInformeRowIndex,
  type InformeRowIndex,
  aggregateIndicesByKey,
  aggregateIndicesBySede,
  filterIndexedRowIndices,
  sumRowIndices,
} from "@/lib/informe-variacion/row-index";

export type { InformeRowIndex };
export {
  aggregateIndicesByKey,
  aggregateIndicesBySede,
  filterIndexedRowIndices,
  sumRowIndices,
};

export type PeriodTriple = [number, number, number];

export const sumFilteredRows = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
): PeriodTriple => {
  const totals: PeriodTriple = [0, 0, 0];
  for (const row of rows) {
    if (!pass(row)) continue;
    const triple = readInformeRowPeriodTriple(row, metric, metricCtx);
    totals[0] += triple[0];
    totals[1] += triple[1];
    totals[2] += triple[2];
  }
  return totals;
};

export const buildSedeEmpresaMap = (sedes: InformeSedeMeta[]) =>
  sedes.map((sede) => sede.e);

export const buildSedeYoyFlags = (sedes: InformeSedeMeta[]) =>
  sedes.map((sede) => sede.yoyOk);

export const passInformeRowFilter = (
  row: InformeCompactRow,
  filters: InformeGlobalFilters,
  sedeEmpresas: string[],
  itemsLow: string[],
): boolean => {
  if (filters.emp && sedeEmpresas[row[0]] !== filters.emp) return false;
  if (filters.sede !== "" && row[0] !== Number(filters.sede)) return false;
  if (filters.cat !== "" && row[1] !== Number(filters.cat)) return false;
  if (filters.lin !== "" && row[2] !== Number(filters.lin)) return false;
  if (filters.sub !== "" && row[3] !== Number(filters.sub)) return false;
  if (filters.item !== "" && row[4] !== Number(filters.item)) return false;
  if (filters.q && !itemsLow[row[4]]?.includes(filters.q)) return false;
  return true;
};

export const aggregateBySede = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  sedeCount: number,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
): PeriodTriple[] => {
  const perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
  for (const row of rows) {
    if (!pass(row)) continue;
    const bucket = perSede[row[0]];
    const triple = readInformeRowPeriodTriple(row, metric, metricCtx);
    bucket[0] += triple[0];
    bucket[1] += triple[1];
    bucket[2] += triple[2];
  }
  return perSede;
};

export const levelAggregateBySede = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  sedeCount: number,
  keyIndex: number,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
): Map<number, PeriodTriple[]> => {
  const map = new Map<number, PeriodTriple[]>();
  for (const row of rows) {
    if (!pass(row)) continue;
    const key = row[keyIndex];
    let perSede = map.get(key);
    if (!perSede) {
      perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
      map.set(key, perSede);
    }
    const bucket = perSede[row[0]];
    const triple = readInformeRowPeriodTriple(row, metric, metricCtx);
    bucket[0] += triple[0];
    bucket[1] += triple[1];
    bucket[2] += triple[2];
  }
  return map;
};

export const aggregateByKey = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  keyIndex: number,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
): Map<number, PeriodTriple> => {
  const map = new Map<number, PeriodTriple>();
  for (const row of rows) {
    if (!pass(row)) continue;
    const key = row[keyIndex];
    const current = map.get(key) ?? [0, 0, 0];
    const triple = readInformeRowPeriodTriple(row, metric, metricCtx);
    current[0] += triple[0];
    current[1] += triple[1];
    current[2] += triple[2];
    map.set(key, current);
  }
  return map;
};

export const buildItemsLower = (items: string[]) =>
  items.map((item) => item.toLowerCase());

export const hasActiveInformeFilters = (filters: InformeGlobalFilters) =>
  Boolean(
    filters.emp ||
      filters.sede ||
      filters.cat ||
      filters.lin ||
      filters.sub ||
      filters.item ||
      filters.q,
  );

export const filterRowIndices = (
  rows: InformeCompactRow[],
  pass: (row: InformeCompactRow) => boolean,
): number[] => {
  const indices: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (pass(rows[index]!)) indices.push(index);
  }
  return indices;
};

export const prepareInformeData = (payload: InformeVariacionPayload) => {
  const ordered = reorderInformeVariacionSedes(payload);
  const sedeEmpresas = buildSedeEmpresaMap(ordered.sedes);
  const sedeYoy = buildSedeYoyFlags(ordered.sedes);
  const itemsLow = buildItemsLower(ordered.items);
  const metricCtx = informeMetricContextFromPayload(ordered);
  const empYoy = ordered.sedes.reduce<Record<string, boolean>>((acc, sede) => {
    acc[sede.e] = acc[sede.e] || sede.yoyOk;
    return acc;
  }, {});
  const rowIndex = buildInformeRowIndex(ordered.rows, sedeEmpresas);

  return {
    ...ordered,
    sedeEmpresas,
    sedeYoy,
    itemsLow,
    empYoy,
    rowIndex,
    metricCtx,
  };
};
