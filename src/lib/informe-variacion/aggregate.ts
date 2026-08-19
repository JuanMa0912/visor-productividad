import type {
  InformeCompactRow,
  InformeGlobalFilters,
  InformeMetric,
  InformeSedeMeta,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import {
  readInformeRowPeriodTripleForLevel,
  informeMetricContextFromPayload,
  isInformeRowAsaderoPollosUndContribution,
  floorPeriodTripleCompletePollos,
  type InformeMetricContext,
} from "@/lib/informe-variacion/informe-metric-values";
import { buildInformeLineUomIndex } from "@/lib/informe-variacion/line-item-uom";
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

/**
 * Nivel para totales padre (empresa/sede/categoría/KPI/resumen):
 * usa rollup (keyIndex 1) — kilos/litros/pollos sin romper padre>=hijo.
 */
export const INFORME_UNIT_SUMMARY_KEY_INDEX = 1;

export const sumFilteredRows = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
): PeriodTriple => {
  const totals: PeriodTriple = [0, 0, 0];
  for (const row of rows) {
    if (!pass(row)) continue;
    const triple = readInformeRowPeriodTripleForLevel(
      row,
      metric,
      metricCtx,
      INFORME_UNIT_SUMMARY_KEY_INDEX,
    );
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

const toIdSet = (values: string[]): Set<number> | null => {
  if (values.length === 0) return null;
  return new Set(values.map((value) => Number(value)));
};

export const compileInformeRowFilter = (
  filters: InformeGlobalFilters,
  sedeEmpresas: string[],
  itemsLow: string[],
  itemProv?: number[],
): ((row: InformeCompactRow) => boolean) => {
  const emp = filters.emp.length > 0 ? new Set(filters.emp) : null;
  const sede = toIdSet(filters.sede);
  const cat = toIdSet(filters.cat);
  const lin = toIdSet(filters.lin);
  const sub = toIdSet(filters.sub);
  const item = toIdSet(filters.item);
  const prov = toIdSet(filters.prov);
  const query = filters.q;

  return (row) => {
    if (emp && !emp.has(sedeEmpresas[row[0]] ?? "")) return false;
    if (sede && !sede.has(row[0])) return false;
    if (cat && !cat.has(row[1])) return false;
    if (lin && !lin.has(row[2])) return false;
    if (sub && !sub.has(row[3])) return false;
    if (item && !item.has(row[4])) return false;
    if (prov && !prov.has(itemProv?.[row[4]] ?? 0)) return false;
    if (query && !itemsLow[row[4]]?.includes(query)) return false;
    return true;
  };
};

export const passInformeRowFilter = (
  row: InformeCompactRow,
  filters: InformeGlobalFilters,
  sedeEmpresas: string[],
  itemsLow: string[],
  itemProv?: number[],
): boolean =>
  compileInformeRowFilter(filters, sedeEmpresas, itemsLow, itemProv)(row);

export const aggregateBySede = (
  rows: InformeCompactRow[],
  metric: InformeMetric,
  sedeCount: number,
  pass: (row: InformeCompactRow) => boolean,
  metricCtx: InformeMetricContext,
  options?: { floorCompletePollosUnd?: boolean },
): PeriodTriple[] => {
  const floorPollos = metric === "u" && Boolean(options?.floorCompletePollosUnd);
  const perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
  const perSedePollos = floorPollos
    ? Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple)
    : null;

  for (const row of rows) {
    if (!pass(row)) continue;
    const bucket = perSede[row[0]]!;
    const triple = readInformeRowPeriodTripleForLevel(
      row,
      metric,
      metricCtx,
      INFORME_UNIT_SUMMARY_KEY_INDEX,
    );
    if (
      floorPollos &&
      perSedePollos &&
      isInformeRowAsaderoPollosUndContribution(row, metricCtx)
    ) {
      const chicken = perSedePollos[row[0]]!;
      chicken[0] += triple[0];
      chicken[1] += triple[1];
      chicken[2] += triple[2];
      continue;
    }
    bucket[0] += triple[0];
    bucket[1] += triple[1];
    bucket[2] += triple[2];
  }

  if (perSedePollos) {
    for (let index = 0; index < sedeCount; index += 1) {
      const floored = floorPeriodTripleCompletePollos(perSedePollos[index]!);
      const bucket = perSede[index]!;
      bucket[0] += floored[0];
      bucket[1] += floored[1];
      bucket[2] += floored[2];
    }
  }

  return perSede;
};

export const aggregateVentasBySede = (
  rows: InformeCompactRow[],
  sedeCount: number,
  pass: (row: InformeCompactRow) => boolean,
): PeriodTriple[] => {
  const perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
  for (const row of rows) {
    if (!pass(row)) continue;
    const bucket = perSede[row[0]]!;
    bucket[0] += row[8];
    bucket[1] += row[9];
    bucket[2] += row[10];
  }
  return perSede;
};

export const aggregateMarginBySede = (
  rows: InformeCompactRow[],
  sedeCount: number,
  pass: (row: InformeCompactRow) => boolean,
): PeriodTriple[] => {
  const perSede = Array.from({ length: sedeCount }, () => [0, 0, 0] as PeriodTriple);
  for (const row of rows) {
    if (!pass(row)) continue;
    const bucket = perSede[row[0]]!;
    bucket[0] += row[11] ?? 0;
    bucket[1] += row[12] ?? 0;
    bucket[2] += row[13] ?? 0;
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
    const triple = readInformeRowPeriodTripleForLevel(
      row,
      metric,
      metricCtx,
      keyIndex,
    );
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
    const triple = readInformeRowPeriodTripleForLevel(
      row,
      metric,
      metricCtx,
      keyIndex,
    );
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
    filters.emp.length ||
      filters.sede.length ||
      filters.cat.length ||
      filters.lin.length ||
      filters.sub.length ||
      filters.item.length ||
      filters.prov.length ||
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
  const withUms = {
    ...payload,
    ums: payload.ums ?? [],
  };
  const ordered = reorderInformeVariacionSedes(withUms);
  const sedeEmpresas = buildSedeEmpresaMap(ordered.sedes);
  const sedeYoy = buildSedeYoyFlags(ordered.sedes);
  const itemsLow = buildItemsLower(ordered.items);
  const rowIndex = buildInformeRowIndex(ordered.rows, sedeEmpresas);
  const uomIndex = buildInformeLineUomIndex(rowIndex, ordered);
  const metricCtx = informeMetricContextFromPayload(ordered, uomIndex);
  const empYoy = ordered.sedes.reduce<Record<string, boolean>>((acc, sede) => {
    acc[sede.e] = acc[sede.e] || sede.yoyOk;
    return acc;
  }, {});
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
