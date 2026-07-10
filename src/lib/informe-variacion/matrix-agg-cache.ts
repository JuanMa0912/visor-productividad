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
  byItem: Map<string, Map<number, PeriodTriple[]>>;
  topItems: Map<string, number[]>;
};

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

/** Precalcula agregaciones por sede para expandir la matriz sin recomputar al abrir niveles. */
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
  const byItem = new Map<string, Map<number, PeriodTriple[]>>();
  const topItems = new Map<string, number[]>();

  for (const [catLinSub, indices] of rowIndex.indicesByCatLinSub) {
    const filtered = filterIndexedRowIndices(indices, filteredSet);
    if (filtered.length === 0) continue;
    const itemAgg = aggregateIndicesBySede(
      rows,
      filtered,
      metric,
      sedeCount,
      4,
      metricCtx,
    );
    byItem.set(catLinSub, itemAgg);
    topItems.set(catLinSub, topItemKeys(itemAgg));

    const subAgg = aggregateIndicesBySede(
      rows,
      filtered,
      metric,
      sedeCount,
      3,
      metricCtx,
    );
    bySub.set(catLinSub, subAgg);
  }

  return { byCat, byLin, bySub, byItem, topItems };
};

export type DualMatrixAggCache = Record<InformeMetric, MatrixAggCache>;

/** Precalcula agregaciones para unidades y valor; alternar metrica no recomputa. */
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
