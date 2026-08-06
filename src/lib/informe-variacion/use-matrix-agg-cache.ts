"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import { filterRowIndices, INFORME_UNIT_SUMMARY_KEY_INDEX, type PeriodTriple } from "@/lib/informe-variacion/aggregate";
import {
  buildMatrixAggCache,
  buildSublineItemAgg,
  getUnfilteredMatrixWarm,
  mergeUnfilteredMatrixWarm,
  otherInformeMetric,
  warmUnfilteredMatrixAgg,
  type MatrixAggCache,
  type PartialDualMatrixAggCache,
  type SublineItemAgg,
} from "@/lib/informe-variacion/matrix-agg-cache";
import { readInformeRowPeriodTripleForLevel } from "@/lib/informe-variacion/informe-metric-values";
import type {
  InformeCompactRow,
  InformeMetric,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import {
  ensurePrepareInformeData,
  isPrepareInformeDataCached,
} from "@/lib/informe-variacion/use-prepared-informe-data";

type Prepared = ReturnType<typeof prepareInformeData>;

type DualCacheState = {
  rows: InformeCompactRow[] | null;
  dual: PartialDualMatrixAggCache;
};

const EMPTY_ITEM_AGG: SublineItemAgg = { byItem: new Map(), topItems: [] };
const EMPTY_DUAL: PartialDualMatrixAggCache = { u: null, v: null };

/** Prefetch de la otra metrica: debe correr aunque el tab este ocupado. */
const OTHER_METRIC_IDLE_TIMEOUT_MS = 8_000;
const RANGE_WARM_IDLE_TIMEOUT_MS = 2_500;

const scheduleIdle = (
  fn: () => void,
  timeoutMs = OTHER_METRIC_IDLE_TIMEOUT_MS,
): (() => void) => {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

type WarmJob = {
  payload: InformeVariacionPayload;
  metrics: readonly InformeMetric[];
  onDone?: () => void;
};

const warmQueue: WarmJob[] = [];
let warmRunning = false;

const runWarmJob = (job: WarmJob): void => {
  const prepared = ensurePrepareInformeData(job.payload);
  const warm = getUnfilteredMatrixWarm(prepared.rows);
  if (!job.metrics.every((metric) => warm?.[metric])) {
    warmUnfilteredMatrixAgg(
      prepared.rows,
      prepared.rowIndex,
      prepared.sedes.length,
      prepared.metricCtx,
      job.metrics,
    );
  }
};

const pumpWarmQueue = (): void => {
  if (warmRunning) return;
  const job = warmQueue.shift();
  if (!job) return;
  warmRunning = true;
  scheduleIdle(() => {
    try {
      runWarmJob(job);
      job.onDone?.();
    } finally {
      warmRunning = false;
      // Ceder el hilo entre rangos para que el UI siga respondiendo.
      window.setTimeout(() => pumpWarmQueue(), 0);
    }
  }, RANGE_WARM_IDLE_TIMEOUT_MS);
};

/** Vista lista para swap sync: prepare + matriz de la metrica por defecto. */
export const isInformeRangeViewReady = (
  payload: InformeVariacionPayload,
  metric: InformeMetric = "v",
): boolean => {
  if (!isPrepareInformeDataCached(payload)) return false;
  const prepared = ensurePrepareInformeData(payload);
  return Boolean(getUnfilteredMatrixWarm(prepared.rows)?.[metric]);
};

/**
 * Encola prepare + matriz (uno a uno en idle). `priority` pone el job al frente
 * (p. ej. el rango que el usuario acaba de pedir).
 */
export const prefetchWarmInformeRange = (
  payload: InformeVariacionPayload,
  options: {
    metrics?: readonly InformeMetric[];
    priority?: boolean;
    onDone?: () => void;
  } = {},
): void => {
  if (typeof window === "undefined") return;
  const metrics = options.metrics ?? (["v"] as const);

  if (isInformeRangeViewReady(payload, metrics[0] ?? "v")) {
    options.onDone?.();
    return;
  }

  // Deduplicar por identidad de payload; conservar onDone mas reciente.
  for (let i = warmQueue.length - 1; i >= 0; i -= 1) {
    if (warmQueue[i]?.payload === payload) warmQueue.splice(i, 1);
  }
  const job: WarmJob = {
    payload,
    metrics,
    onDone: options.onDone,
  };
  if (options.priority) warmQueue.unshift(job);
  else warmQueue.push(job);
  pumpWarmQueue();
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

  const isUnfiltered = filteredIndices.length === payload.rows.length;
  const warmedDual = isUnfiltered
    ? getUnfilteredMatrixWarm(payload.rows)
    : undefined;

  const [cacheState, setCacheState] = useState<DualCacheState>({
    rows: null,
    dual: EMPTY_DUAL,
  });

  const dualCacheRef = useRef(cacheState.dual);
  const metricRef = useRef(metric);
  useEffect(() => {
    dualCacheRef.current = cacheState.dual;
  }, [cacheState.dual]);
  useEffect(() => {
    metricRef.current = metric;
  }, [metric]);

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
      isUnfiltered,
    }),
    [
      filteredIndices,
      filteredSet,
      isUnfiltered,
      payload.metricCtx,
      payload.rowIndex,
      payload.rows,
      payload.sedes.length,
    ],
  );

  const commitDual = useCallback(
    (rows: InformeCompactRow[], dual: PartialDualMatrixAggCache) => {
      setCacheState({ rows, dual });
    },
    [],
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

  // Rebuild async (setTimeout/idle) para no setState sync en el cuerpo del effect.
  useEffect(() => {
    let cancelled = false;
    let cancelSecondary: (() => void) | undefined;
    itemCacheRef.current = new Map();

    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const active = metricRef.current;

      if (buildArgs.isUnfiltered) {
        const warm = getUnfilteredMatrixWarm(buildArgs.rows);
        if (warm?.[active]) {
          commitDual(buildArgs.rows, warm);
          if (!warm[otherInformeMetric(active)]) {
            cancelSecondary = scheduleIdle(() => {
              if (cancelled) return;
              const other = otherInformeMetric(active);
              if (getUnfilteredMatrixWarm(buildArgs.rows)?.[other]) return;
              const second = buildOne(other);
              if (cancelled) return;
              const next = mergeUnfilteredMatrixWarm(buildArgs.rows, {
                [other]: second,
              } as PartialDualMatrixAggCache);
              commitDual(buildArgs.rows, next);
            });
          }
          return;
        }
      }

      const first = buildOne(active);
      if (cancelled) return;
      if (buildArgs.isUnfiltered) {
        const next = mergeUnfilteredMatrixWarm(buildArgs.rows, {
          [active]: first,
        } as PartialDualMatrixAggCache);
        commitDual(buildArgs.rows, next);
      } else {
        setCacheState({
          rows: buildArgs.rows,
          dual: { ...EMPTY_DUAL, [active]: first },
        });
      }

      cancelSecondary = scheduleIdle(() => {
        if (cancelled) return;
        const other = otherInformeMetric(active);
        if (buildArgs.isUnfiltered) {
          if (getUnfilteredMatrixWarm(buildArgs.rows)?.[other]) return;
        } else if (dualCacheRef.current[other]) {
          return;
        }
        const second = buildOne(other);
        if (cancelled) return;
        if (buildArgs.isUnfiltered) {
          const next = mergeUnfilteredMatrixWarm(buildArgs.rows, {
            [other]: second,
          } as PartialDualMatrixAggCache);
          commitDual(buildArgs.rows, next);
        } else {
          setCacheState((current) => {
            if (current.rows !== buildArgs.rows || current.dual[other]) {
              return current;
            }
            return {
              rows: buildArgs.rows,
              dual: { ...current.dual, [other]: second },
            };
          });
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cancelSecondary?.();
    };
  }, [buildArgs, buildOne, commitDual]);

  // Si el usuario cambia de metrica antes del prefetch, construye solo la faltante.
  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const warmHit = buildArgs.isUnfiltered
        ? getUnfilteredMatrixWarm(buildArgs.rows)?.[metric]
        : null;
      if (warmHit || dualCacheRef.current[metric]) return;

      const built = buildOne(metric);
      if (cancelled) return;
      if (buildArgs.isUnfiltered) {
        const next = mergeUnfilteredMatrixWarm(buildArgs.rows, {
          [metric]: built,
        } as PartialDualMatrixAggCache);
        commitDual(buildArgs.rows, next);
      } else {
        setCacheState((current) => {
          if (current.rows !== buildArgs.rows || current.dual[metric]) {
            return current;
          }
          return {
            rows: buildArgs.rows,
            dual: { ...current.dual, [metric]: built },
          };
        });
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [metric, buildOne, buildArgs, commitDual]);

  // Preferir warm por identidad de `rows` en el mismo render del cambio de corte.
  const stateIsForCurrentRows = cacheState.rows === payload.rows;
  const resolvedDual: PartialDualMatrixAggCache = isUnfiltered
    ? {
        u: warmedDual?.u ?? (stateIsForCurrentRows ? cacheState.dual.u : null),
        v: warmedDual?.v ?? (stateIsForCurrentRows ? cacheState.dual.v : null),
      }
    : stateIsForCurrentRows
      ? cacheState.dual
      : EMPTY_DUAL;

  const cacheReady = resolvedDual[metric] !== null;
  const aggCache = resolvedDual[metric];

  const ensureSublineItems = useCallback(
    (catLinSub: string, activeMetric: InformeMetric): SublineItemAgg => {
      const key = `${activeMetric}|${catLinSub}`;
      const cached = itemCacheRef.current.get(key);
      if (cached) return cached;

      const indices = (
        buildArgs.rowIndex.indicesByCatLinSub.get(catLinSub) ?? []
      ).filter((index) => buildArgs.filteredSet.has(index));
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
        const triple = readInformeRowPeriodTripleForLevel(
          row,
          activeMetric,
          payload.metricCtx,
          INFORME_UNIT_SUMMARY_KEY_INDEX,
        );
        const bucket = buckets[row[0]];
        bucket[0] += triple[0];
        bucket[1] += triple[1];
        bucket[2] += triple[2];
      }
      return buckets;
    };
    return { u: build("u"), v: build("v") } satisfies Record<
      InformeMetric,
      PeriodTriple[]
    >;
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
