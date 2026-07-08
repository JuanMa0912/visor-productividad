"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type InformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { readInformeApiResponse } from "@/lib/informe-variacion/read-api-response";
import { InformeVariacionBoard } from "@/app/informe-variacion/informe-variacion-board";
import { cn } from "@/lib/shared/utils";

type InformeMeta = {
  maxDate: string | null;
};

const INFORME_SESSION_CACHE_PREFIX = "vp-informe-variacion:";
const INFORME_FETCH_TIMEOUT_MS = 120_000;

const buildRangeCacheKey = (
  year: number,
  month: number,
  rangeId: InformeDayRangeId,
) => `${year}-${month}:range=${rangeId}`;

const readSessionInforme = (key: string): InformeVariacionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${INFORME_SESSION_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as InformeVariacionPayload;
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
  const monthAbortRef = useRef<AbortController | null>(null);
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
    ) => {
      const key = buildRangeCacheKey(year, month, rangeId);
      memoryCacheRef.current.set(key, data);
      writeSessionInforme(key, data);
      markRangeReady(rangeId);
    },
    [markRangeReady],
  );

  const readCachedPayload = useCallback(
    (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
    ): InformeVariacionPayload | null => {
      const key = buildRangeCacheKey(year, month, rangeId);
      const memoryHit = memoryCacheRef.current.get(key);
      if (memoryHit) {
        markRangeReady(rangeId);
        return memoryHit;
      }
      const sessionHit = readSessionInforme(key);
      if (sessionHit) {
        memoryCacheRef.current.set(key, sessionHit);
        markRangeReady(rangeId);
        return sessionHit;
      }
      return null;
    },
    [markRangeReady],
  );

  const fetchRangePayload = useCallback(
    async (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
      signal: AbortSignal,
      options: { force?: boolean } = {},
    ): Promise<InformeVariacionPayload> => {
      const key = buildRangeCacheKey(year, month, rangeId);
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
          storePayload(year, month, rangeId, data);
          return data;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          inflightRef.current.delete(key);
        }
      })();

      inflightRef.current.set(key, request);
      return request;
    },
    [readCachedPayload, router, storePayload],
  );

  const loadMonthBundle = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!parsedMonth) {
        setError("Selecciona un mes valido.");
        return;
      }

      const ranges = availableDayRanges;
      if (ranges.length === 0) {
        setError("No hay rangos de dias disponibles para este mes.");
        setPayload(null);
        return;
      }

      const { year, month } = parsedMonth;
      const monthToken = `${year}-${month}`;
      activeMonthKeyRef.current = monthToken;

      monthAbortRef.current?.abort();
      const controller = new AbortController();
      monthAbortRef.current = controller;

      if (options.force) {
        for (const key of [...memoryCacheRef.current.keys()]) {
          if (key.startsWith(`${year}-${month}:range=`)) {
            memoryCacheRef.current.delete(key);
          }
        }
        for (const key of [...inflightRef.current.keys()]) {
          if (key.startsWith(`${year}-${month}:range=`)) {
            inflightRef.current.delete(key);
          }
        }
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
        .filter((id) => id !== primaryId);

      setPrefetchTotal(ranges.length);
      setPrefetchDone(0);
      setError(null);

      const cachedPrimary = options.force
        ? null
        : readCachedPayload(year, month, primaryId);
      if (cachedPrimary) {
        setPayload(cachedPrimary);
        setPrefetchDone(1);
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const primary =
          cachedPrimary ??
          (await fetchRangePayload(
            year,
            month,
            primaryId,
            controller.signal,
            options,
          ));
        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }

        // Solo pisa el board si el usuario sigue en este rango (o aun no eligio otro).
        if (
          dayRangeIdRef.current === primaryId ||
          dayRangeIdRef.current === "" ||
          !dayRangeIdRef.current
        ) {
          setPayload(primary);
        }
        setPrefetchDone(1);
        setLoading(false);

        if (others.length === 0) return;

        const results = await Promise.allSettled(
          others.map((rangeId) =>
            fetchRangePayload(year, month, rangeId, controller.signal, options),
          ),
        );
        if (
          controller.signal.aborted ||
          activeMonthKeyRef.current !== monthToken
        ) {
          return;
        }

        let extraOk = 0;
        for (const result of results) {
          if (result.status === "fulfilled") extraOk += 1;
        }
        setPrefetchDone(1 + extraOk);

        // Si el usuario cambio de rango mientras precargabamos, aplicar cache.
        const selected = dayRangeIdRef.current;
        if (selected) {
          const selectedPayload = readCachedPayload(year, month, selected);
          if (selectedPayload) setPayload(selectedPayload);
        }
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
        }
      }
    },
    [availableDayRanges, fetchRangePayload, parsedMonth, readCachedPayload],
  );

  // Carga / precarga al entrar o cambiar de mes.
  useEffect(() => {
    if (!ready || !canAccess || metaLoading || !monthKey) return;
    if (availableDayRanges.length === 0) {
      setPayload(null);
      setPrefetchDone(0);
      setPrefetchTotal(0);
      setReadyRanges(new Set());
      return;
    }
    void loadMonthBundle();
    return () => {
      monthAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bundle solo por mes
  }, [canAccess, metaLoading, monthKey, ready]);

  // Cambio de rango: desde cache (instantaneo) o fetch puntual si falto en precarga.
  useEffect(() => {
    if (!parsedMonth || !dayRangeId || metaLoading) return;
    const { year, month } = parsedMonth;
    if (`${year}-${month}` !== activeMonthKeyRef.current && activeMonthKeyRef.current) {
      // El bundle del mes nuevo aun no arranco; saldra en loadMonthBundle.
      const cached = readCachedPayload(year, month, dayRangeId);
      if (cached) setPayload(cached);
      return;
    }

    const cached = readCachedPayload(year, month, dayRangeId);
    if (cached) {
      setPayload(cached);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchRangePayload(year, month, dayRangeId, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : "Error desconocido cargando el informe.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dayRangeId, fetchRangePayload, metaLoading, parsedMonth, readCachedPayload]);

  const preloadReady =
    prefetchTotal > 0 && prefetchDone >= prefetchTotal && !loading;
  const showInitialLoader = metaLoading || (loading && !payload && !error);
  const showBoard = Boolean(payload) && !metaLoading;

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
              onChange={(event) => setMonthInput(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadMonthBundle({ force: true })}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
                {preloadReady
                  ? "Mes precargado · cambio de rango instantaneo"
                  : prefetchTotal > 0
                    ? `Precargando rangos ${Math.min(prefetchDone, prefetchTotal)}/${prefetchTotal}`
                    : "Solo aparecen periodos ya cerrados en el mes"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDayRanges.map((range) => {
                const cached = readyRanges.has(range.id);
                return (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => setDayRangeId(range.id)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                      dayRangeId === range.id
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50",
                      cached &&
                        dayRangeId !== range.id &&
                        "ring-1 ring-emerald-200",
                    )}
                    title={
                      cached
                        ? "Listo en cache local"
                        : "Se cargara al seleccionarlo o al terminar la precarga"
                    }
                  >
                    {range.label}
                  </button>
                );
              })}
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
          <InformeVariacionBoard payload={payload!} />
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
