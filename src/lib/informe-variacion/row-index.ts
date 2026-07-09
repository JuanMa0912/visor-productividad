import type { InformeCompactRow, InformeMetric } from "@/lib/informe-variacion/types";
import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import {
  readInformeRowPeriodTriple,
  type InformeMetricContext,
} from "@/lib/informe-variacion/informe-metric-values";

export type InformeRowIndex = {
  bySede: Map<number, number[]>;
  byEmpresa: Map<string, number[]>;
  bySedeCat: Map<string, number[]>;
  bySedeCatLin: Map<string, number[]>;
  bySedeCatLinSub: Map<string, number[]>;
  indicesByCat: Map<number, number[]>;
  indicesByCatLin: Map<string, number[]>;
  indicesByCatLinSub: Map<string, number[]>;
  allCats: number[];
  linsByCat: Map<number, number[]>;
  subsByCatLin: Map<string, number[]>;
  itemsByCatLinSub: Map<string, number[]>;
};

const pushIndex = (map: Map<number, number[]>, key: number, rowIndex: number) => {
  const bucket = map.get(key);
  if (bucket) bucket.push(rowIndex);
  else map.set(key, [rowIndex]);
};

const pushKeyIndex = (map: Map<string, number[]>, key: string, rowIndex: number) => {
  const bucket = map.get(key);
  if (bucket) bucket.push(rowIndex);
  else map.set(key, [rowIndex]);
};

export const buildInformeRowIndex = (
  rows: InformeCompactRow[],
  sedeEmpresas: string[],
): InformeRowIndex => {
  const bySede = new Map<number, number[]>();
  const byEmpresa = new Map<string, number[]>();
  const bySedeCat = new Map<string, number[]>();
  const bySedeCatLin = new Map<string, number[]>();
  const bySedeCatLinSub = new Map<string, number[]>();
  const indicesByCat = new Map<number, number[]>();
  const indicesByCatLin = new Map<string, number[]>();
  const indicesByCatLinSub = new Map<string, number[]>();
  const catSet = new Set<number>();
  const linsByCat = new Map<number, number[]>();
  const subsByCatLin = new Map<string, number[]>();
  const itemsByCatLinSub = new Map<string, number[]>();

  rows.forEach((row, rowIndex) => {
    const [sede, cat, lin, sub, item] = row;
    pushIndex(bySede, sede, rowIndex);

    const empresa = sedeEmpresas[sede];
    if (empresa) pushKeyIndex(byEmpresa, empresa, rowIndex);

    pushKeyIndex(bySedeCat, `${sede}|${cat}`, rowIndex);
    pushKeyIndex(bySedeCatLin, `${sede}|${cat}|${lin}`, rowIndex);
    pushKeyIndex(bySedeCatLinSub, `${sede}|${cat}|${lin}|${sub}`, rowIndex);

    pushIndex(indicesByCat, cat, rowIndex);
    pushKeyIndex(indicesByCatLin, `${cat}|${lin}`, rowIndex);
    pushKeyIndex(indicesByCatLinSub, `${cat}|${lin}|${sub}`, rowIndex);

    catSet.add(cat);
    pushIndex(linsByCat, cat, lin);
    pushKeyIndex(subsByCatLin, `${cat}|${lin}`, sub);
    pushKeyIndex(itemsByCatLinSub, `${cat}|${lin}|${sub}`, item);
  });

  const uniqueSorted = (map: Map<number, number[]>) =>
    [...map.entries()].map(([key, values]) => [key, [...new Set(values)]] as const);

  const uniqueSortedKey = (map: Map<string, number[]>) =>
    [...map.entries()].map(([key, values]) => [key, [...new Set(values)]] as const);

  return {
    bySede,
    byEmpresa,
    bySedeCat,
    bySedeCatLin,
    bySedeCatLinSub,
    indicesByCat,
    indicesByCatLin,
    indicesByCatLinSub,
    allCats: [...catSet].sort((a, b) => a - b),
    linsByCat: new Map(uniqueSorted(linsByCat).map(([k, v]) => [k, v.sort((a, b) => a - b)])),
    subsByCatLin: new Map(
      uniqueSortedKey(subsByCatLin).map(([k, v]) => [k, v.sort((a, b) => a - b)]),
    ),
    itemsByCatLinSub: new Map(
      uniqueSortedKey(itemsByCatLinSub).map(([k, v]) => [k, v.sort((a, b) => a - b)]),
    ),
  };
};

export const aggregateIndicesBySede = (
  rows: InformeCompactRow[],
  indices: readonly number[],
  metric: InformeMetric,
  sedeCount: number,
  keyIndex: number,
  metricCtx: InformeMetricContext,
): Map<number, PeriodTriple[]> => {
  const map = new Map<number, PeriodTriple[]>();
  for (const rowIndex of indices) {
    const row = rows[rowIndex];
    if (!row) continue;
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

export const aggregateIndicesByKey = (
  rows: InformeCompactRow[],
  indices: readonly number[],
  metric: InformeMetric,
  keyIndex: number,
  metricCtx: InformeMetricContext,
): Map<number, PeriodTriple> => {
  const map = new Map<number, PeriodTriple>();
  for (const rowIndex of indices) {
    const row = rows[rowIndex];
    if (!row) continue;
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

export const sumRowIndices = (
  rows: InformeCompactRow[],
  indices: readonly number[],
  metric: InformeMetric,
  metricCtx: InformeMetricContext,
): PeriodTriple => {
  const totals: PeriodTriple = [0, 0, 0];
  for (const rowIndex of indices) {
    const row = rows[rowIndex];
    if (!row) continue;
    const triple = readInformeRowPeriodTriple(row, metric, metricCtx);
    totals[0] += triple[0];
    totals[1] += triple[1];
    totals[2] += triple[2];
  }
  return totals;
};

/** Filtra indices de un bucket del indice jerarquico. */
export const filterIndexedRowIndices = (
  indices: readonly number[] | undefined,
  allowed: ReadonlySet<number>,
): number[] => {
  if (!indices?.length) return [];
  const result: number[] = [];
  for (const index of indices) {
    if (allowed.has(index)) result.push(index);
  }
  return result;
};
