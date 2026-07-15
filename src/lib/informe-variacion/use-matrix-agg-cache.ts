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

/** Prefetch de la otra metrica: debe correr aunque el tab este ocupado. */
const OTHER_METRIC_IDLE_TIMEOUT_MS = 8_000;

const scheduleIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn, { timeout: OTHER_METRIC_IDLE_TIMEOUT_MS });
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
  const dualCacheRef = useRef(dualCache);
  dualCacheRef.current = dualCache;

  const itemCacheRef = useRef(new Map<string, SublineItemAgg>());
  const [itemCacheTick, setItemCacheTick] = useState(0);

  const metricRef = useRef(metric);
  metricRef.current = metric;

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

  const buildOne = useCallback(
    (activeMetric: InformeMetric): MatrixAggCache =>
      buildMatrixAggCache(
        buildArgs.rows,
        buildArgs.rowIndex,
        buildArgs.filteredSet,
        buildArgs.filteredIndices,
        activeMetric,
        buildArgs.sedeCount,
        buildArgs.metricCtx,
      ),
    [buildArgs],
  );

  useEffect(() => {
    itemCacheRef.current.clear();
    setItemCacheTick(0);
  }, [buildArgs]);

  // Rebuild solo cuando cambian datos/filtros. NO al cambiar Unidades↔Valor:
  // antes se vaciaban ambas metricas y el hilo principal se bloqueaba ~10s.
  useEffect(() => {
    setDualCache({ u: null, v: null });
    let cancelled = false;
    let cancelSecondary: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const active = metricRef.current;
      const first = buildOne(active);
      if (cancelled) return;
      setDualCache((current) => ({ ...current, [active]: first }));

      cancelSecondary = scheduleIdle(() => {
        if (cancelled) return;
        const other = otherInformeMetric(active);
        if (dualCacheRef.current[other]) return;
        const second = buildOne(other);
        if (cancelled) return;
        setDualCache((current) =>
          current[other] ? current : { ...current, [other]: second },
        );
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cancelSecondary?.();
    };
  }, [buildArgs, buildOne]);

  // Si el usuario cambia de metrica antes del prefetch, construye solo la faltante.
  useEffect(() => {
    if (dualCacheRef.current[metric]) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled || dualCacheRef.current[metric]) return;
      const built = buildOne(metric);
      if (cancelled) return;
      setDualCache((current) =>
        current[metric] ? current : { ...current, [metric]: built },
      );
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [metric, buildOne]);

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
