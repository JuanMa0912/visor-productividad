import type {
  InformeCompactRow,
  InformeGlobalFilters,
  InformeMetric,
  InformeSedeMeta,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import { metricOffset } from "@/lib/informe-variacion/format";
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
): PeriodTriple => {
  const offset = metricOffset(metric);
  const totals: PeriodTriple = [0, 0, 0];
  for (const row of rows) {
    if (!pass(row)) continue;
    totals[0] += row[offset];
    totals[1] += row[offset + 1];
    totals[2] += row[offset + 2];
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
): PeriodTriple[] => {
  const offset = metricOffset(metric);
  const perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
  for (const row of rows) {
    if (!pass(row)) continue;
    const bucket = perSede[row[0]];
    bucket[0] += row[offset];
    bucket[1] += row[offset + 1];
    bucket[2] += row[offset + 2];
  }
  return perSede;
};

export const levelAggregateBySede = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  sedeCount: number,
  keyIndex: number,
  pass: (row: InformeCompactRow) => boolean,
): Map<number, PeriodTriple[]> => {
  const offset = metricOffset(metric);
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
    bucket[0] += row[offset];
    bucket[1] += row[offset + 1];
    bucket[2] += row[offset + 2];
  }
  return map;
};

export const aggregateByKey = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  keyIndex: number,
  pass: (row: InformeCompactRow) => boolean,
): Map<number, PeriodTriple> => {
  const offset = metricOffset(metric);
  const map = new Map<number, PeriodTriple>();
  for (const row of rows) {
    if (!pass(row)) continue;
    const key = row[keyIndex];
    const current = map.get(key) ?? [0, 0, 0];
    current[0] += row[offset];
    current[1] += row[offset + 1];
    current[2] += row[offset + 2];
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
  const sedeEmpresas = buildSedeEmpresaMap(payload.sedes);
  const sedeYoy = buildSedeYoyFlags(payload.sedes);
  const itemsLow = buildItemsLower(payload.items);
  const empYoy = payload.sedes.reduce<Record<string, boolean>>((acc, sede) => {
    acc[sede.e] = acc[sede.e] || sede.yoyOk;
    return acc;
  }, {});
  const rowIndex = buildInformeRowIndex(payload.rows, sedeEmpresas);

  return {
    ...payload,
    sedeEmpresas,
    sedeYoy,
    itemsLow,
    empYoy,
    rowIndex,
  };
};
