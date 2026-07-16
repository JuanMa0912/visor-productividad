"use client";

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, TrendingUp } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth } from "@/lib/auth/auth-context";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";
import {
  defaultInformeYearMonth,
  parseYearMonthInput,
  yearMonthToInputValue,
} from "@/lib/informe-variacion/periods";
import {
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
  payloadMatchesInformeSelection,
  type InformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { readInformeApiResponse, readInformeBundleApiResponse, isInformeMonthBundleResponse } from "@/lib/informe-variacion/read-api-response";
import { InformeVariacionBoard } from "@/app/informe-variacion/informe-variacion-board";
import { ensurePrepareInformeData } from "@/lib/informe-variacion/use-prepared-informe-data";
import { prefetchWarmInformeRange } from "@/lib/informe-variacion/use-matrix-agg-cache";
import { resolveSessionLineCategoryScope } from "@/lib/shared/line-category-scope";
import {
  filterInformePayloadForLineScope,
  informeLineScopeCacheSuffix,
} from "@/lib/informe-variacion/informe-line-scope";
import { cn } from "@/lib/shared/utils";

type InformeMeta = {
  maxDate: string | null;
};

const INFORME_SESSION_CACHE_PREFIX = "vp-informe-variacion:";
const INFORME_FETCH_TIMEOUT_MS = 120_000;

const buildMonthBundleCacheKey = (year: number, month: number, scopeSuffix = "") =>
  `${year}-${month}:bundle${scopeSuffix}`;

const buildRangeCacheKey = (
  year: number,
  month: number,
  rangeId: InformeDayRangeId,
  scopeSuffix = "",
) => `${year}-${month}:range=${rangeId}${scopeSuffix}`;

const readSessionInforme = (key: string): InformeVariacionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    const storageKey = `${INFORME_SESSION_CACHE_PREFIX}${key}`;
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InformeVariacionPayload;
    if (!parsed.rows?.length) {
      sessionStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeSessionInforme = (key: string, payload: InformeVariacionPayload) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      `${INFORME_SESSION_CACHE_PREFIX}${key}`,
      JSON.stringify(payload),
    );
  } catch {
    // quota o payload demasiado grande
  }
};

const clearSessionInformeMonth = (year: number, month: number) => {
  if (typeof window === "undefined") return;
  const prefix = `${INFORME_SESSION_CACHE_PREFIX}${year}-${month}:range=`;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) keysToRemove.push(key);
    }
    for (const key of keysToRemove) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

export default function InformeVariacionPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const ready = status === "authenticated" && Boolean(user);

  const canAccess = useMemo(() => {
    if (!user) return false;
    return canAccessInformeVariacion(
      user.role,
      user.allowedDashboards,
      user.allowedSubdashboards,
      user.specialRoles,
    );
  }, [user]);

  const lineCategoryScope = useMemo(
    () => (user ? resolveSessionLineCategoryScope(user) : resolveSessionLineCategoryScope({ role: "user", allowedLines: null })),
    [user],
  );
  const scopeCacheSuffix = useMemo(
    () => informeLineScopeCacheSuffix(lineCategoryScope),
    [lineCategoryScope],
  );

  useEffect(() => {
    if (ready && !canAccess) {
      router.replace("/secciones");
    }
  }, [canAccess, ready, router]);

  const [metaLoading, setMetaLoading] = useState(true);
  const [maxDate, setMaxDate] = useState<string | null>(null);
  const [monthInput, setMonthInput] = useState("");
  const [dayRangeId, setDayRangeId] = useState<InformeDayRangeId | "">("");
  const [payload, setPayload] = useState<InformeVariacionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [monthLoadLocked, setMonthLoadLocked] = useState(false);
  const [rangeSwitchPending, setRangeSwitchPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetchDone, setPrefetchDone] = useState(0);
  const [prefetchTotal, setPrefetchTotal] = useState(0);
  const [readyRanges, setReadyRanges] = useState<Set<InformeDayRangeId>>(
    () => new Set(),
  );

  const memoryCacheRef = useRef<Map<string, InformeVariacionPayload>>(new Map());
  const inflightRef = useRef<Map<string, Promise<InformeVariacionPayload>>>(
    new Map(),
  );
  const bundleInflightRef = useRef<Map<string, Promise<"ok" | "fallback">>>(
    new Map(),
  );
  const monthAbortRef = useRef<AbortController | null>(null);
  const rangeAbortRef = useRef<AbortController | null>(null);
  const activeMonthKeyRef = useRef("");
  const dayRangeIdRef = useRef<InformeDayRangeId | "">("");

  useEffect(() => {
    dayRangeIdRef.current = dayRangeId;
  }, [dayRangeId]);

  useEffect(() => {
    if (!ready || !canAccess) return;
    let cancelled = false;
    const loadMeta = async () => {
      setMetaLoading(true);
      try {
        const response = await fetch("/api/informe-variacion/meta", {
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }
        const data = (await response.json()) as InformeMeta;
        if (cancelled) return;
        setMaxDate(data.maxDate);
        const { year, month } = defaultInformeYearMonth(data.maxDate);
        setMonthInput(yearMonthToInputValue(year, month));
      } catch {
        if (!cancelled) {
          const now = defaultInformeYearMonth(null);
          setMonthInput(yearMonthToInputValue(now.year, now.month));
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    };
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [canAccess, ready, router]);

  const parsedMonth = useMemo(() => parseYearMonthInput(monthInput), [monthInput]);

  const availableDayRanges = useMemo(() => {
    if (!parsedMonth) return [];
    return getAvailableInformeDayRanges(
      parsedMonth.year,
      parsedMonth.month,
      new Date(),
      maxDate,
    );
  }, [maxDate, parsedMonth]);

  useEffect(() => {
    if (availableDayRanges.length === 0) {
      setDayRangeId("");
      return;
    }
    setDayRangeId((current) => {
      if (current && availableDayRanges.some((range) => range.id === current)) {
        return current;
      }
      return defaultInformeDayRangeId(availableDayRanges) ?? "";
    });
  }, [availableDayRanges]);

  const monthKey = useMemo(() => {
    if (!parsedMonth) return "";
    return `${parsedMonth.year}-${parsedMonth.month}`;
  }, [parsedMonth]);

  const markRangeReady = useCallback((rangeId: InformeDayRangeId) => {
    setReadyRanges((current) => {
      if (current.has(rangeId)) return current;
      const next = new Set(current);
      next.add(rangeId);
      return next;
    });
  }, []);

  const storePayload = useCallback(
    (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
      data: InformeVariacionPayload,
    ): InformeVariacionPayload | null => {
      // No persistir vacios (p.ej. durante TRUNCATE del refresh diario).
      const scoped = filterInformePayloadForLineScope(data, lineCategoryScope);
      if (!scoped.rows?.length) return null;
      const key = buildRangeCacheKey(year, month, rangeId, scopeCacheSuffix);
      memoryCacheRef.current.set(key, scoped);
      writeSessionInforme(key, scoped);
      markRangeReady(rangeId);
      prefetchWarmInformeRange(scoped);
      return scoped;
    },
    [lineCategoryScope, markRangeReady, scopeCacheSuffix],
  );

  const storeMonthBundle = useCallback(
    (
      year: number,
      month: number,
      payloads: Record<string, InformeVariacionPayload>,
    ) => {
      for (const [rangeId, data] of Object.entries(payloads)) {
        storePayload(year, month, rangeId as InformeDayRangeId, data);
      }
    },
    [storePayload],
  );

  const readCachedPayload = useCallback(
    (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
    ): InformeVariacionPayload | null => {
      const key = buildRangeCacheKey(year, month, rangeId, scopeCacheSuffix);
      const memoryHit = memoryCacheRef.current.get(key);
      if (memoryHit) {
        markRangeReady(rangeId);
        prefetchWarmInformeRange(memoryHit);
        return memoryHit;
      }
      const sessionHit = readSessionInforme(key);
      if (sessionHit) {
        const scoped = filterInformePayloadForLineScope(
          sessionHit,
          lineCategoryScope,
        );
        memoryCacheRef.current.set(key, scoped);
        markRangeReady(rangeId);
        prefetchWarmInformeRange(scoped);
        return scoped;
      }
      return null;
    },
    [lineCategoryScope, markRangeReady, scopeCacheSuffix],
  );

  const fetchRangePayload = useCallback(
    async (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
      signal: AbortSignal,
      options: { force?: boolean } = {},
    ): Promise<InformeVariacionPayload> => {
      const key = buildRangeCacheKey(year, month, rangeId, scopeCacheSuffix);
      if (!options.force) {
        const cached = readCachedPayload(year, month, rangeId);
        if (cached) return cached;
        const inflight = inflightRef.current.get(key);
        if (inflight) return inflight;
      }

      const request = (async () => {
        const timeoutController = new AbortController();
        const onAbort = () => timeoutController.abort();
        signal.addEventListener("abort", onAbort);
        const timeoutId = window.setTimeout(
          () => timeoutController.abort(),
          INFORME_FETCH_TIMEOUT_MS,
        );
        try {
          const params = new URLSearchParams({
            year: String(year),
            month: String(month),
            range: rangeId,
          });
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            {
              cache: "no-store",
              signal: timeoutController.signal,
            },
          );
          if (response.status === 401) {
            router.replace("/login");
            throw new Error("No autorizado.");
          }
          if (response.status === 403) {
            router.replace("/secciones");
            throw new Error("Sin permisos.");
          }
          const data = await readInformeApiResponse(response);
          if (!response.ok) {
            throw new Error(data.error ?? "No fue posible cargar el informe.");
          }
          const scoped = storePayload(year, month, rangeId, data);
          if (!scoped) {
            throw new Error("Sin datos en el alcance permitido para este informe.");
          }
          return scoped;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          inflightRef.current.delete(key);
        }
      })();

      inflightRef.current.set(key, request);
      return request;
    },
    [readCachedPayload, router, storePayload, scopeCacheSuffix],
  );

  const fetchMonthBundle = useCallback(
    async (
      year: number,
      month: number,
      signal: AbortSignal,
      options: { force?: boolean } = {},
    ): Promise<"ok" | "fallback"> => {
      const bundleKey = buildMonthBundleCacheKey(year, month, scopeCacheSuffix);
      if (!options.force) {
        const ranges = getAvailableInformeDayRanges(year, month);
        const allCached =
          ranges.length > 0 &&
          ranges.every((range) =>
            Boolean(readCachedPayload(year, month, range.id)),
          );
        if (allCached) return "ok";

        const inflight = bundleInflightRef.current.get(bundleKey);
        if (inflight) {
          await inflight;
          return "ok";
        }
      }

      const request = (async (): Promise<"ok" | "fallback"> => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          INFORME_FETCH_TIMEOUT_MS,
        );
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort);

        try {
          const params = new URLSearchParams({
            year: String(year),
            month: String(month),
            bundle: "month",
          });
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (response.status === 401) {
            router.replace("/login");
            throw new Error("Sesion expirada.");
          }
          if (response.status === 403) {
            router.replace("/secciones");
            throw new Error("Sin permisos.");
          }
          const data = await readInformeBundleApiResponse(response);
          if (!response.ok) {
            throw new Error(data.error ?? "No fue posible cargar el informe.");
          }
          if (!isInformeMonthBundleResponse(data)) {
            return "fallback" as const;
          }
          storeMonthBundle(year, month, data.payloads);
          return "ok" as const;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          bundleInflightRef.current.delete(bundleKey);
        }
      })();

      bundleInflightRef.current.set(bundleKey, request);
      return request;
    },
    [readCachedPayload, router, storeMonthBundle, scopeCacheSuffix],
  );

  /** Como rotacion: clic = cambia vista al instante desde cache; red solo de fondo. */
  const selectDayRange = useCallback(
    (rangeId: InformeDayRangeId) => {
      if (!parsedMonth) return;
      if (rangeId === dayRangeIdRef.current) return;

      const { year, month } = parsedMonth;
      dayRangeIdRef.current = rangeId;
      setDayRangeId(rangeId);
      setError(null);

      const cached = readCachedPayload(year, month, rangeId);
      if (cached) {
        setRangeSwitchPending(false);
        // Sync: prepare + matriz warm (si idle ya termino) → cambio sin spinner.
        ensurePrepareInformeData(cached);
        setPayload(cached);
        return;
      }

      // Sin cache: mantener vista actual y pedir el rango en background.
      setRangeSwitchPending(true);
      rangeAbortRef.current?.abort();
      const controller = new AbortController();
      rangeAbortRef.current = controller;
      void fetchRangePayload(year, month, rangeId, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          if (dayRangeIdRef.current !== rangeId) return;
          startTransition(() => {
            setPayload(data);
          });
          setRangeSwitchPending(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof Error && err.name === "AbortError") return;
          if (dayRangeIdRef.current !== rangeId) return;
          setRangeSwitchPending(false);
          setError(
            err instanceof Error
              ? err.message
              : "Error desconocido cargando el informe.",
          );
        });
    },
    [fetchRangePayload, parsedMonth, readCachedPayload],
  );

  const loadMonthBundle = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!parsedMonth) {
        setError("Selecciona un mes valido.");
        setMonthLoadLocked(false);
        return;
      }

      const ranges = availableDayRanges;
      if (ranges.length === 0) {
        setError("No hay rangos de dias disponibles para este mes.");
        setPayload(null);
        setMonthLoadLocked(false);
        return;
      }

      const { year, month } = parsedMonth;
      const monthToken = `${year}-${month}`;
      activeMonthKeyRef.current = monthToken;
      setMonthLoadLocked(true);

      monthAbortRef.current?.abort();
      rangeAbortRef.current?.abort();
      const controller = new AbortController();
      monthAbortRef.current = controller;

      if (options.force) {
        for (const key of [...memoryCacheRef.current.keys()]) {
          if (key.startsWith(`${year}-${month}:`)) {
            memoryCacheRef.current.delete(key);
          }
        }
        for (const key of [...inflightRef.current.keys()]) {
          if (key.startsWith(`${year}-${month}:range=`)) {
            inflightRef.current.delete(key);
          }
        }
        bundleInflightRef.current.delete(buildMonthBundleCacheKey(year, month, scopeCacheSuffix));
        clearSessionInformeMonth(year, month);
        setReadyRanges(new Set());
      }

      const primaryFromState = dayRangeIdRef.current;
      const primaryId =
        primaryFromState && ranges.some((range) => range.id === primaryFromState)
          ? primaryFromState
          : (defaultInformeDayRangeId(ranges) as InformeDayRangeId);
      const others = ranges
        .map((range) => range.id)
        .filter((id) => id !== primaryId)
        .sort((a, b) => {
          const ra = ranges.find((range) => range.id === a)!;
          const rb = ranges.find((range) => range.id === b)!;
          const ac = ra.fromDay === 1 ? 0 : 1;
          const bc = rb.fromDay === 1 ? 0 : 1;
          if (ac !== bc) return ac - bc;
          return (ra.toDay ?? 99) - (rb.toDay ?? 99);
        });

      setPrefetchTotal(ranges.length);
      setPrefetchDone(0);
      setError(null);
      setRangeSwitchPending(false);
      if (!options.force) {
        // Conserva chips del mismo mes si ya hay cache; al cambiar mes limpia.
        setReadyRanges((current) => {
          const kept = new Set<InformeDayRangeId>();
          for (const range of ranges) {
            if (
              current.has(range.id) ||
              memoryCacheRef.current.has(
                buildRangeCacheKey(year, month, range.id, scopeCacheSuffix),
              ) ||
              readSessionInforme(buildRangeCacheKey(year, month, range.id, scopeCacheSuffix))
            ) {
              kept.add(range.id);
            }
          }
          return kept;
        });
      }

      const selectedId =
        dayRangeIdRef.current &&
        ranges.some((range) => range.id === dayRangeIdRef.current)
          ? dayRangeIdRef.current
          : primaryId;
      const allCached =
        !options.force &&
        ranges.every((range) =>
          Boolean(readCachedPayload(year, month, range.id)),
        );
      if (allCached) {
        const selectedPayload = readCachedPayload(year, month, selectedId);
        if (selectedPayload) {
          setPayload(selectedPayload);
        }
        setPrefetchDone(ranges.length);
        setLoading(false);
        setRangeSwitchPending(false);
        setMonthLoadLocked(false);
        return;
      }

      const cachedSelected = options.force
        ? null
        : readCachedPayload(year, month, selectedId);
      if (cachedSelected) {
        setPayload(cachedSelected);
      } else {
        setLoading(true);
      }

      const updatePrefetchProgress = () => {
        const ready = ranges.filter((range) =>
          Boolean(readCachedPayload(year, month, range.id)),
        ).length;
        setPrefetchDone(ready);
      };

      const applySelectedPayload = () => {
        const current =
          dayRangeIdRef.current &&
          ranges.some((range) => range.id === dayRangeIdRef.current)
            ? dayRangeIdRef.current
            : selectedId;
        const data = readCachedPayload(year, month, current);
        if (data) {
          startTransition(() => setPayload(data));
          setRangeSwitchPending(false);
        }
      };

      try {
        updatePrefetchProgress();

        const primaryTask = cachedSelected
          ? Promise.resolve(cachedSelected)
          : fetchRangePayload(
              year,
              month,
              selectedId,
              controller.signal,
              options,
            );

        // Un solo rango: no pedir bundle (misma SQL agregada).
        if (ranges.length <= 1) {
          if (cachedSelected) {
            setLoading(false);
          } else {
            setLoading(true);
          }
          try {
            const data = await primaryTask;
            if (
              controller.signal.aborted ||
              activeMonthKeyRef.current !== monthToken
            ) {
              return;
            }
            if (!cachedSelected) {
              setPayload(data);
            }
          } catch (primaryErr) {
            if (
              primaryErr instanceof Error &&
              primaryErr.name === "AbortError"
            ) {
              return;
            }
            if (!readCachedPayload(year, month, selectedId)) {
              throw primaryErr;
            }
          }
          if (
            controller.signal.aborted ||
            activeMonthKeyRef.current !== monthToken
          ) {
            return;
          }
          applySelectedPayload();
          setPrefetchDone(ranges.length);
          setLoading(false);
          setRangeSwitchPending(false);
          return;
        }

        // Varios rangos: rango visible primero (pinta UI), luego bundle.
        // Antes corrían en paralelo y saturaban Cloud SQL (~5s + ~15s a la vez).
        if (!cachedSelected) {
          setLoading(true);
          try {
            const data = await primaryTask;
            if (
              controller.signal.aborted ||
              activeMonthKeyRef.current !== monthToken
            ) {
              return;
            }
            setPayload(data);
            setLoading(false);
            setMonthLoadLocked(false);
            updatePrefetchProgress();
          } catch (primaryErr) {
            if (
              primaryErr instanceof Error &&
              primaryErr.name === "AbortError"
            ) {
              return;
            }
            if (!readCachedPayload(year, month, selectedId)) {
              throw primaryErr;
            }
            setLoading(false);
            setMonthLoadLocked(false);
          }
        } else {
          setLoading(false);
          setMonthLoadLocked(false);
        }

        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }

        const bundleResult = await fetchMonthBundle(
          year,
          month,
          controller.signal,
          options,
        );
        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }

        if (bundleResult === "ok") {
          applySelectedPayload();
          setPrefetchDone(ranges.length);
          setLoading(false);
          setRangeSwitchPending(false);
          return;
        }

        // Sin item_dia_roll: precargar el resto de rangos en serie.
        applySelectedPayload();
        setLoading(false);
        updatePrefetchProgress();

        const missingOthers = others.filter(
          (rangeId) => !readCachedPayload(year, month, rangeId),
        );
        for (const rangeId of missingOthers) {
          if (
            controller.signal.aborted ||
            activeMonthKeyRef.current !== monthToken
          ) {
            return;
          }
          try {
            await fetchRangePayload(
              year,
              month,
              rangeId,
              controller.signal,
              options,
            );
            updatePrefetchProgress();
          } catch (prefetchErr) {
            if (
              controller.signal.aborted ||
              (prefetchErr instanceof Error && prefetchErr.name === "AbortError")
            ) {
              return;
            }
            console.warn(
              `[informe-variacion] fallo precargando rango ${rangeId}`,
              prefetchErr,
            );
          }
        }

        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }

        applySelectedPayload();
      } catch (err) {
        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }
        if (!readCachedPayload(year, month, primaryId)) {
          setPayload(null);
        }
        if (err instanceof Error && err.name === "AbortError") {
          setError(
            "La consulta tardo demasiado. Prueba un mes o rango con menos datos.",
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Error desconocido cargando el informe.",
          );
        }
      } finally {
        if (
          !controller.signal.aborted &&
          activeMonthKeyRef.current === monthToken
        ) {
          setLoading(false);
          setMonthLoadLocked(false);
        }
      }
    },
    [availableDayRanges, fetchMonthBundle, fetchRangePayload, parsedMonth, readCachedPayload, scopeCacheSuffix],
  );

  // Carga / precarga al entrar o cambiar de mes.
  useEffect(() => {
    if (!ready || !canAccess || metaLoading || !monthKey) return;
    setReadyRanges(new Set());
    setPrefetchDone(0);
    setPrefetchTotal(0);
    if (availableDayRanges.length === 0) {
      setPayload(null);
      return;
    }
    void loadMonthBundle();
    return () => {
      monthAbortRef.current?.abort();
      rangeAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bundle solo por mes
  }, [canAccess, metaLoading, monthKey, ready]);

  const preloadReady =
    prefetchTotal > 0 && prefetchDone >= prefetchTotal && !loading;
  const periodControlsDisabled = metaLoading || monthLoadLocked;
  const showInitialLoader = metaLoading || (loading && !payload && !error);
  const showBoard = Boolean(payload) && !metaLoading;
  const payloadMatchesSelection = useMemo(() => {
    if (!payload || !parsedMonth) return false;
    return payloadMatchesInformeSelection(
      payload,
      parsedMonth.year,
      parsedMonth.month,
      dayRangeId,
      availableDayRanges,
    );
  }, [availableDayRanges, dayRangeId, parsedMonth, payload]);
  const boardDataPending =
    rangeSwitchPending ||
    (Boolean(payload) &&
      !payloadMatchesSelection &&
      (monthLoadLocked || loading));

  if (!ready || !canAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-amber-50/40">
      <AppTopBar backHref="/productividad" backLabel="Volver a productividad" />
      <main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">
              Informe de variacion MoM · YoY
            </h1>
            <p className="text-sm text-slate-500">
              Empresa → Sede → Categoria → Linea → Sublinea → Item
            </p>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end justify-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Periodo actual
            <input
              type="month"
              value={monthInput}
              disabled={periodControlsDisabled}
              onChange={(event) => {
                if (periodControlsDisabled) return;
                setMonthInput(event.target.value);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              aria-busy={monthLoadLocked}
            />
          </label>
          <button
            type="button"
            onClick={() => void loadMonthBundle({ force: true })}
            disabled={periodControlsDisabled}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw
              className={`h-4 w-4 ${monthLoadLocked ? "animate-spin" : ""}`}
            />
            Actualizar
          </button>
        </div>

        {availableDayRanges.length > 0 ? (
          <div className="mb-5 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rango de dias
              </span>
              <span className="text-xs text-slate-400">
                {periodControlsDisabled
                  ? "Cargando periodo seleccionado…"
                  : preloadReady
                    ? "Todos los rangos listos · cambio instantaneo (vista precargada)"
                    : prefetchTotal > 0
                      ? `Cargando rangos ${Math.min(readyRanges.size, prefetchTotal)}/${prefetchTotal} · aparecen al quedar listos`
                      : "Solo aparecen periodos ya cerrados en el mes"}
                {rangeSwitchPending ? " · sincronizando…" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDayRanges
                .filter((range) => readyRanges.has(range.id))
                .map((range) => (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => selectDayRange(range.id)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                      dayRangeId === range.id
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50",
                    )}
                    title="Listo en memoria · cambio instantaneo"
                  >
                    {range.label}
                  </button>
                ))}
              {!preloadReady && readyRanges.size < prefetchTotal ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-3 py-1.5 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Preparando mas rangos…
                </span>
              ) : null}
            </div>
          </div>
        ) : parsedMonth ? (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Este mes aun no tiene rangos de dias disponibles. Elige un mes anterior o espera a
            que cierre el primer periodo (dia 7).
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {showInitialLoader ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="mt-3 text-sm text-slate-600">Construyendo informe...</p>
            {prefetchTotal > 1 ? (
              <p className="mt-1 text-xs text-slate-400">
                Luego se precargaran el resto de rangos del mes
              </p>
            ) : null}
          </div>
        ) : showBoard ? (
          <InformeVariacionBoard
            key={`${monthKey || "informe"}${scopeCacheSuffix}`}
            payload={payload!}
            dataPending={boardDataPending}
            categoryScopeLocked={Boolean(
              lineCategoryScope.forcedMargenTipos?.length,
            )}
            lineScopeLocked={Boolean(
              lineCategoryScope.forcedMargenLineas?.length,
            )}
          />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-6 py-10 text-center text-sm text-slate-600">
            No hay datos para el periodo seleccionado.
            {error ? null : (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void loadMonthBundle({ force: true })}
                  className="text-sm font-semibold text-blue-600"
                >
                  Reintentar
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
