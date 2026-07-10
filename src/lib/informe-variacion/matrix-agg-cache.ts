import {
  aggregateIndicesBySede,
  filterIndexedRowIndices,
} from "@/lib/informe-variacion/aggregate";
import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import type { InformeMetricContext } from "@/lib/informe-variacion/informe-metric-values";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import type { InformeRowIndex } from "@/lib/informe-variacion/row-index";

export type MatrixAggCache = {
  byCat: Map<number, PeriodTriple[]>;
  byLin: Map<string, Map<number, PeriodTriple[]>>;
  bySub: Map<string, Map<number, PeriodTriple[]>>;
};

export type SublineItemAgg = {
  byItem: Map<number, PeriodTriple[]>;
  topItems: number[];
};

export type PartialDualMatrixAggCache = {
  u: MatrixAggCache | null;
  v: MatrixAggCache | null;
};

export type DualMatrixAggCache = Record<InformeMetric, MatrixAggCache>;

const topItemKeys = (
  agg: Map<number, PeriodTriple[]>,
  limit = 30,
): number[] =>
  [...agg.keys()]
    .sort((a, b) => {
      const sa = (agg.get(a) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
      const sb = (agg.get(b) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
      return sb - sa;
    })
    .slice(0, limit);

/** Cat/lin/sub sin items; suficiente para abrir la matriz sin bloquear el hilo principal. */
export const buildMatrixAggCache = (
  rows: InformeCompactRow[],
  rowIndex: InformeRowIndex,
  filteredSet: ReadonlySet<number>,
  filteredIndices: readonly number[],
  metric: InformeMetric,
  sedeCount: number,
  metricCtx: InformeMetricContext,
): MatrixAggCache => {
  const byCat = aggregateIndicesBySede(
    rows,
    filteredIndices,
    metric,
    sedeCount,
    1,
    metricCtx,
  );

  const byLin = new Map<string, Map<number, PeriodTriple[]>>();
  for (const [catLin, indices] of rowIndex.indicesByCatLin) {
    const filtered = filterIndexedRowIndices(indices, filteredSet);
    if (filtered.length === 0) continue;
    byLin.set(
      catLin,
      aggregateIndicesBySede(rows, filtered, metric, sedeCount, 2, metricCtx),
    );
  }

  const bySub = new Map<string, Map<number, PeriodTriple[]>>();
  for (const [catLinSub, indices] of rowIndex.indicesByCatLinSub) {
    const filtered = filterIndexedRowIndices(indices, filteredSet);
    if (filtered.length === 0) continue;
    bySub.set(
      catLinSub,
      aggregateIndicesBySede(rows, filtered, metric, sedeCount, 3, metricCtx),
    );
  }

  return { byCat, byLin, bySub };
};

/** Agrega items de una sublinea bajo demanda al expandir. */
export const buildSublineItemAgg = (
  rows: InformeCompactRow[],
  indices: readonly number[],
  metric: InformeMetric,
  sedeCount: number,
  metricCtx: InformeMetricContext,
): SublineItemAgg => {
  if (indices.length === 0) {
    return { byItem: new Map(), topItems: [] };
  }
  const byItem = aggregateIndicesBySede(rows, indices, metric, sedeCount, 4, metricCtx);
  return { byItem, topItems: topItemKeys(byItem) };
};

export const buildDualMatrixAggCache = (
  rows: InformeCompactRow[],
  rowIndex: InformeRowIndex,
  filteredSet: ReadonlySet<number>,
  filteredIndices: readonly number[],
  sedeCount: number,
  metricCtx: InformeMetricContext,
): DualMatrixAggCache => ({
  u: buildMatrixAggCache(rows, rowIndex, filteredSet, filteredIndices, "u", sedeCount, metricCtx),
  v: buildMatrixAggCache(rows, rowIndex, filteredSet, filteredIndices, "v", sedeCount, metricCtx),
});

export const otherInformeMetric = (metric: InformeMetric): InformeMetric =>
  metric === "u" ? "v" : "u";
