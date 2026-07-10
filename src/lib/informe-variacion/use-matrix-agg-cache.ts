"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { filterRowIndices, type PeriodTriple } from "@/lib/informe-variacion/aggregate";
import {
  buildMatrixAggCache,
  buildSublineItemAgg,
  otherInformeMetric,
  type MatrixAggCache,
  type PartialDualMatrixAggCache,
  type SublineItemAgg,
} from "@/lib/informe-variacion/matrix-agg-cache";
import { readInformeRowPeriodTriple } from "@/lib/informe-variacion/informe-metric-values";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";

type Prepared = ReturnType<typeof prepareInformeData>;

const EMPTY_ITEM_AGG: SublineItemAgg = { byItem: new Map(), topItems: [] };

const scheduleIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn, { timeout: 150 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

export const useMatrixAggCache = (
  payload: Prepared,
  pass: (row: Prepared["rows"][number]) => boolean,
  metric: InformeMetric,
) => {
  const filteredIndices = useMemo(
    () => filterRowIndices(payload.rows, pass),
    [payload.rows, pass],
  );

  const filteredSet = useMemo(() => new Set(filteredIndices), [filteredIndices]);

  const [dualCache, setDualCache] = useState<PartialDualMatrixAggCache>({
    u: null,
    v: null,
  });
  const itemCacheRef = useRef(new Map<string, SublineItemAgg>());
  const [itemCacheTick, setItemCacheTick] = useState(0);

  const buildArgs = useMemo(
    () => ({
      rows: payload.rows,
      rowIndex: payload.rowIndex,
      filteredSet,
      filteredIndices,
      sedeCount: payload.sedes.length,
      metricCtx: payload.metricCtx,
    }),
    [
      filteredIndices,
      filteredSet,
      payload.metricCtx,
      payload.rowIndex,
      payload.rows,
      payload.sedes.length,
    ],
  );

  useEffect(() => {
    itemCacheRef.current.clear();
    setItemCacheTick(0);
  }, [buildArgs]);

  useEffect(() => {
    setDualCache({ u: null, v: null });
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;

    const buildOne = (activeMetric: InformeMetric): MatrixAggCache =>
      buildMatrixAggCache(
        buildArgs.rows,
        buildArgs.rowIndex,
        buildArgs.filteredSet,
        buildArgs.filteredIndices,
        activeMetric,
        buildArgs.sedeCount,
        buildArgs.metricCtx,
      );

    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const first = buildOne(metric);
      setDualCache((current) => ({ ...current, [metric]: first }));

      cancelIdle = scheduleIdle(() => {
        if (cancelled) return;
        const other = otherInformeMetric(metric);
        const second = buildOne(other);
        setDualCache((current) =>
          current[other] ? current : { ...current, [other]: second },
        );
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cancelIdle?.();
    };
  }, [buildArgs, metric]);

  const cacheReady = dualCache[metric] !== null;
  const aggCache = dualCache[metric];

  const ensureSublineItems = useCallback(
    (catLinSub: string, activeMetric: InformeMetric): SublineItemAgg => {
      const key = `${activeMetric}|${catLinSub}`;
      const cached = itemCacheRef.current.get(key);
      if (cached) return cached;

      const indices = (buildArgs.rowIndex.indicesByCatLinSub.get(catLinSub) ?? []).filter(
        (index) => buildArgs.filteredSet.has(index),
      );
      const next = buildSublineItemAgg(
        buildArgs.rows,
        indices,
        activeMetric,
        buildArgs.sedeCount,
        buildArgs.metricCtx,
      );
      itemCacheRef.current.set(key, next);
      startTransition(() => setItemCacheTick((tick) => tick + 1));
      return next;
    },
    [buildArgs],
  );

  const totPerByMetric = useMemo(() => {
    const build = (activeMetric: InformeMetric) => {
      const buckets = Array.from(
        { length: payload.sedes.length },
        () => [0, 0, 0] as PeriodTriple,
      );
      for (const rowIndex of filteredIndices) {
        const row = payload.rows[rowIndex]!;
        const triple = readInformeRowPeriodTriple(row, activeMetric, payload.metricCtx);
        const bucket = buckets[row[0]];
        bucket[0] += triple[0];
        bucket[1] += triple[1];
        bucket[2] += triple[2];
      }
      return buckets;
    };
    return { u: build("u"), v: build("v") } satisfies Record<InformeMetric, PeriodTriple[]>;
  }, [filteredIndices, payload.metricCtx, payload.rows, payload.sedes.length]);

  const totPer = totPerByMetric[metric];

  return {
    aggCache,
    cacheReady,
    ensureSublineItems,
    itemCacheTick,
    totPer,
    filteredIndices,
    filteredSet,
  };
};

export { EMPTY_ITEM_AGG };
