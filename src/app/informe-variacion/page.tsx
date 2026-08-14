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
  buildSingleDayInformeRangeId,
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
  latestInformeSingleDay,
  parseSingleDayInformeRangeId,
  payloadMatchesInformeSelection,
  type InformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { readInformeApiResponse, readInformeBundleApiResponse, isInformeMonthBundleResponse } from "@/lib/informe-variacion/read-api-response";
import { InformeVariacionBoard } from "@/app/informe-variacion/informe-variacion-board";
import {
  isInformeRangeViewReady,
  prefetchWarmInformeRange,
} from "@/lib/informe-variacion/use-matrix-agg-cache";
import { resolveSessionLineCategoryScope } from "@/lib/shared/line-category-scope";
import {
  filterInformePayloadForLineScope,
  informeLineScopeCacheSuffix,
} from "@/lib/informe-variacion/informe-line-scope";
import {
  DINASTIA_EMPRESA_CODE,
  userHasDinastiaAccess,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";
import { cn } from "@/lib/shared/utils";

type InformeMeta = {
  maxDate: string | null;
};

/**
 * v3: namespace por usuario + invalidación global.
 * v1 compartía clave entre usuarios; v2 namespaced; v3 fuerza wipe al desplegar
 * tras el incidente de payloads solo-Asaderos en sessionStorage.
 */
const INFORME_SESSION_CACHE_BASE = "vp-informe-variacion:v4:";
const INFORME_FETCH_TIMEOUT_MS = 120_000;

const sessionStoragePrefixForUser = (
  userId: string | number | null | undefined,
) => `${INFORME_SESSION_CACHE_BASE}u=${userId ?? "anon"}:`;

const purgeLegacyInformeSessionCache = () => {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith("vp-informe-variacion:") &&
        !key.startsWith(INFORME_SESSION_CACHE_BASE)
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const buildMonthBundleCacheKey = (year: number, month: number, scopeSuffix = "") =>
  `${year}-${month}:bundle${scopeSuffix}`;

const buildRangeCacheKey = (
  year: number,
  month: number,
  rangeId: InformeDayRangeId,
  scopeSuffix = "",
) => `${year}-${month}:range=${rangeId}${scopeSuffix}`;

const readSessionInforme = (
  storagePrefix: string,
  key: string,
): InformeVariacionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    const storageKey = `${storagePrefix}${key}`;
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

const writeSessionInforme = (
  storagePrefix: string,
  key: string,
  payload: InformeVariacionPayload,
) => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      `${storagePrefix}${key}`,
      JSON.stringify(payload),
    );
  } catch {
    // quota o payload demasiado grande
  }
};

/** Evita congelar el UI al serializar payloads multi-MB del mes. */
const writeSessionInformeIdle = (
  storagePrefix: string,
  key: string,
  payload: InformeVariacionPayload,
) => {
  if (typeof window === "undefined") return;
  const run = () => writeSessionInforme(storagePrefix, key, payload);
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 8_000 });
    return;
  }
  window.setTimeout(run, 0);
};

const clearSessionInformeMonth = (
  storagePrefix: string,
  year: number,
  month: number,
) => {
  if (typeof window === "undefined") return;
  const prefix = `${storagePrefix}${year}-${month}:`;
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
  const dinastiaOnly = useMemo(
    () =>
      Boolean(
        user &&
          userIsDinastiaOnly({
            role: user.role,
            allowedEmpresas: user.allowedEmpresas,
          }),
      ),
    [user],
  );
  const canSelectDinastia = useMemo(
    () =>
      Boolean(
        user &&
          userHasDinastiaAccess({
            role: user.role,
            allowedEmpresas: user.allowedEmpresas,
          }),
      ),
    [user],
  );
  const [dataTenant, setDataTenant] = useState<"default" | "dinastia">("default");
  useEffect(() => {
    if (dinastiaOnly) setDataTenant("dinastia");
  }, [dinastiaOnly]);

  const tenantEmpresaParam =
    dataTenant === "dinastia" ? DINASTIA_EMPRESA_CODE : null;
  const scopeCacheSuffix = useMemo(
    () =>
      `${informeLineScopeCacheSuffix(lineCategoryScope)}:ds=${dataTenant}`,
    [lineCategoryScope, dataTenant],
  );
  const sessionStoragePrefix = useMemo(
    () => sessionStoragePrefixForUser(user?.id),
    [user?.id],
  );

  useEffect(() => {
    if (ready && !canAccess) {
      router.replace("/secciones");
    }
  }, [canAccess, ready, router]);

  useEffect(() => {
    purgeLegacyInformeSessionCache();
  }, []);

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
  /** Prepare + matriz + KPI listos: solo entonces el chip permite swap barato. */
  const [viewReadyRanges, setViewReadyRanges] = useState<Set<InformeDayRangeId>>(
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
    memoryCacheRef.current.clear();
    inflightRef.current.clear();
    bundleInflightRef.current.clear();
  }, [user?.id, dataTenant]);

  useEffect(() => {
    if (!ready || !canAccess) return;
    let cancelled = false;
    const loadMeta = async () => {
      setMetaLoading(true);
      try {
        const metaUrl = tenantEmpresaParam
          ? `/api/informe-variacion/meta?empresa=${encodeURIComponent(tenantEmpresaParam)}`
          : "/api/informe-variacion/meta";
        const response = await fetch(metaUrl, {
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
  }, [canAccess, ready, router, tenantEmpresaParam]);

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

  /** Ultimo dia del mes con datos cargados; null si el mes aun no empieza. */
  const maxSingleDay = useMemo(() => {
    if (!parsedMonth) return null;
    return latestInformeSingleDay(
      parsedMonth.year,
      parsedMonth.month,
      new Date(),
      maxDate,
    );
  }, [maxDate, parsedMonth]);

  /** Dia activo cuando el rango seleccionado es un dia suelto (`d-05`). */
  const activeSingleDay = useMemo(
    () => parseSingleDayInformeRangeId(dayRangeId || null),
    [dayRangeId],
  );

  useEffect(() => {
    if (availableDayRanges.length === 0) {
      setDayRangeId("");
      return;
    }
    setDayRangeId((current) => {
      if (current && availableDayRanges.some((range) => range.id === current)) {
        return current;
      }
      // Los dias sueltos NO estan en availableDayRanges (no se precargan, ver
      // buildInformeSingleDayRange). Sin esta rama, este efecto los borraria al
      // instante y el modo dia seria inusable: hay que conservarlos mientras el
      // dia siga existiendo y tenga datos en el mes elegido.
      const day = parseSingleDayInformeRangeId(current || null);
      if (day !== null && maxSingleDay !== null && day <= maxSingleDay) {
        return current;
      }
      return defaultInformeDayRangeId(availableDayRanges) ?? "";
    });
  }, [availableDayRanges, maxSingleDay]);

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

  const markViewReady = useCallback((rangeId: InformeDayRangeId) => {
    setViewReadyRanges((current) => {
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
      options: { warm?: boolean; persistSession?: "sync" | "idle" | "none" } = {},
    ): InformeVariacionPayload | null => {
      // No persistir vacios (p.ej. durante TRUNCATE del refresh diario).
      const scoped = filterInformePayloadForLineScope(data, lineCategoryScope);
      if (!scoped.rows?.length) return null;
      const key = buildRangeCacheKey(year, month, rangeId, scopeCacheSuffix);
      memoryCacheRef.current.set(key, scoped);
      const persist = options.persistSession ?? "idle";
      if (persist === "sync") {
        writeSessionInforme(sessionStoragePrefix, key, scoped);
      } else if (persist === "idle") {
        writeSessionInformeIdle(sessionStoragePrefix, key, scoped);
      }
      markRangeReady(rangeId);
      if (options.warm !== false) {
        prefetchWarmInformeRange(scoped, {
          metrics: ["v"],
          onDone: () => markViewReady(rangeId),
        });
      }
      return scoped;
    },
    [lineCategoryScope, markRangeReady, markViewReady, scopeCacheSuffix, sessionStoragePrefix],
  );

  const storeMonthBundle = useCallback(
    (
      year: number,
      month: number,
      payloads: Record<string, InformeVariacionPayload>,
    ) => {
      const primaryId = dayRangeIdRef.current;
      const stored: Array<{
        rangeId: string;
        payload: InformeVariacionPayload;
        isPrimary: boolean;
      }> = [];
      for (const [rangeId, data] of Object.entries(payloads)) {
        const isPrimary = rangeId === primaryId;
        const scoped = storePayload(
          year,
          month,
          rangeId as InformeDayRangeId,
          data,
          {
            // Calentar en cola (uno a uno). No sync-warm en el store.
            warm: false,
            persistSession: isPrimary ? "idle" : "none",
          },
        );
        if (scoped) {
          stored.push({ rangeId, payload: scoped, isPrimary });
        }
      }
      // Primero el visible; luego el resto para que el cambio de chip sea hit.
      stored.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      for (const entry of stored) {
        prefetchWarmInformeRange(entry.payload, {
          metrics: ["v"],
          priority: entry.isPrimary,
          onDone: () => markViewReady(entry.rangeId as InformeDayRangeId),
        });
      }
    },
    [markViewReady, storePayload],
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
        prefetchWarmInformeRange(memoryHit, {
          metrics: ["v"],
          onDone: () => markViewReady(rangeId),
        });
        return memoryHit;
      }
      const sessionHit = readSessionInforme(sessionStoragePrefix, key);
      if (sessionHit) {
        const scoped = filterInformePayloadForLineScope(
          sessionHit,
          lineCategoryScope,
        );
        memoryCacheRef.current.set(key, scoped);
        markRangeReady(rangeId);
        prefetchWarmInformeRange(scoped, {
          metrics: ["v"],
          onDone: () => markViewReady(rangeId),
        });
        return scoped;
      }
      return null;
    },
    [
      lineCategoryScope,
      markRangeReady,
      markViewReady,
      scopeCacheSuffix,
      sessionStoragePrefix,
    ],
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
        if (!signal.aborted) {
          const inflight = inflightRef.current.get(key);
          if (inflight) return inflight;
        }
      }
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // No convertir a `const`: el `finally` de abajo lee `request`, y en la ruta de
      // abort el throw es SINCRONO (antes del primer await), asi que ese `finally`
      // corre mientras el IIFE aun no retorna. Con `const` eso seria un ReferenceError
      // por TDZ que taparia el AbortError; con `let` simplemente lee `undefined`.
      let request!: Promise<InformeVariacionPayload>;
      // eslint-disable-next-line prefer-const
      request = (async () => {
        const timeoutController = new AbortController();
        const onAbort = () => timeoutController.abort();
        signal.addEventListener("abort", onAbort);
        const timeoutId = window.setTimeout(
          () => timeoutController.abort(),
          INFORME_FETCH_TIMEOUT_MS,
        );
        try {
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const params = new URLSearchParams({
            year: String(year),
            month: String(month),
            range: rangeId,
          });
          if (options.force) params.set("force", "1");
          if (tenantEmpresaParam) params.set("empresa", tenantEmpresaParam);
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            {
              cache: "no-store",
              signal: timeoutController.signal,
            },
          );
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
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
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const scoped = storePayload(year, month, rangeId, data);
          if (!scoped) {
            throw new Error("Sin datos en el alcance permitido para este informe.");
          }
          return scoped;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          if (inflightRef.current.get(key) === request) {
            inflightRef.current.delete(key);
          }
        }
      })();

      inflightRef.current.set(key, request);
      return request;
    },
    [readCachedPayload, router, storePayload, scopeCacheSuffix, tenantEmpresaParam],
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
        const ranges = getAvailableInformeDayRanges(year, month, new Date(), maxDate);
        const allCached =
          ranges.length > 0 &&
          ranges.every((range) =>
            Boolean(readCachedPayload(year, month, range.id)),
          );
        if (allCached) return "ok";

        if (!signal.aborted) {
          const inflight = bundleInflightRef.current.get(bundleKey);
          if (inflight) return inflight;
        }
      }
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Mismo caso que arriba: `const` romperia por TDZ en la ruta de abort sincrona.
      let request!: Promise<"ok" | "fallback">;
      // eslint-disable-next-line prefer-const
      request = (async (): Promise<"ok" | "fallback"> => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          INFORME_FETCH_TIMEOUT_MS,
        );
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort);

        try {
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const params = new URLSearchParams({
            year: String(year),
            month: String(month),
            bundle: "month",
          });
          if (options.force) params.set("force", "1");
          if (tenantEmpresaParam) params.set("empresa", tenantEmpresaParam);
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
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
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          storeMonthBundle(year, month, data.payloads);
          return "ok" as const;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          if (bundleInflightRef.current.get(bundleKey) === request) {
            bundleInflightRef.current.delete(bundleKey);
          }
        }
      })();

      bundleInflightRef.current.set(bundleKey, request);
      return request;
    },
    [maxDate, readCachedPayload, router, storeMonthBundle, scopeCacheSuffix, tenantEmpresaParam],
  );

  /** Clic: swap sync si la vista ya esta caliente; si no, calienta sin congelar el UI. */
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
        if (isInformeRangeViewReady(cached, "v")) {
          setRangeSwitchPending(false);
          markViewReady(rangeId);
          startTransition(() => setPayload(cached));
          return;
        }
        // No llamar prepare/matriz en el click (congela 10–30s). Cola idle.
        setRangeSwitchPending(true);
        prefetchWarmInformeRange(cached, {
          metrics: ["v"],
          priority: true,
          onDone: () => {
            if (dayRangeIdRef.current !== rangeId) return;
            markViewReady(rangeId);
            startTransition(() => setPayload(cached));
            setRangeSwitchPending(false);
          },
        });
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
          prefetchWarmInformeRange(data, {
            metrics: ["v"],
            priority: true,
            onDone: () => {
              if (dayRangeIdRef.current !== rangeId) return;
              markViewReady(rangeId);
              startTransition(() => setPayload(data));
              setRangeSwitchPending(false);
            },
          });
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
    [fetchRangePayload, markViewReady, parsedMonth, readCachedPayload],
  );

  /** Selecciona un dia suelto, acotado a [1, ultimo dia con datos]. */
  const selectSingleDay = useCallback(
    (day: number) => {
      if (!maxSingleDay) return;
      const clamped = Math.min(Math.max(Math.trunc(day), 1), maxSingleDay);
      selectDayRange(buildSingleDayInformeRangeId(clamped));
    },
    [maxSingleDay, selectDayRange],
  );

  /**
   * Al ver un dia suelto se compara contra el MISMO NUMERO de dia del mes anterior
   * y del año pasado. Eso cruza dias de semana distintos y en retail un domingo no
   * se parece a un miercoles, asi que buena parte de la variacion puede ser efecto
   * calendario. Se avisa cuando ocurre en vez de dejar que el % se lea como real.
   */
  const weekdayComparisonWarning = useMemo(() => {
    if (!payload || activeSingleDay === null) return null;
    const NAMES = [
      "domingo",
      "lunes",
      "martes",
      "miercoles",
      "jueves",
      "viernes",
      "sabado",
    ];
    const weekdayOf = (compact: string) =>
      new Date(
        Number(compact.slice(0, 4)),
        Number(compact.slice(4, 6)) - 1,
        Number(compact.slice(6, 8)),
      ).getDay();
    const cur = weekdayOf(payload.periods.current.from);
    const mom = weekdayOf(payload.periods.mom.from);
    const yoy = weekdayOf(payload.periods.yoy.from);
    if (cur === mom && cur === yoy) return null;
    return `Se compara el mismo numero de dia: este es ${NAMES[cur]}, el del mes anterior cae en ${NAMES[mom]} y el del año pasado en ${NAMES[yoy]}. Parte de la variacion puede ser efecto calendario, no venta.`;
  }, [activeSingleDay, payload]);

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
        clearSessionInformeMonth(sessionStoragePrefix, year, month);
        setReadyRanges(new Set());
        setViewReadyRanges(new Set());
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
              readSessionInforme(
                sessionStoragePrefix,
                buildRangeCacheKey(year, month, range.id, scopeCacheSuffix),
              )
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
    [availableDayRanges, fetchMonthBundle, fetchRangePayload, parsedMonth, readCachedPayload, scopeCacheSuffix, sessionStoragePrefix],
  );

  // Carga / precarga al entrar o cambiar de mes.
  useEffect(() => {
    if (!ready || !canAccess || metaLoading || !monthKey) return;
    setReadyRanges(new Set());
    setViewReadyRanges(new Set());
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
    prefetchTotal > 0 &&
    viewReadyRanges.size >= prefetchTotal &&
    !loading;
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
          {canSelectDinastia && !dinastiaOnly ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Fuente de datos
              <select
                value={dataTenant}
                disabled={periodControlsDisabled}
                onChange={(event) => {
                  if (periodControlsDisabled) return;
                  const next =
                    event.target.value === "dinastia" ? "dinastia" : "default";
                  setDataTenant(next);
                  setPayload(null);
                  setReadyRanges(new Set());
                  setViewReadyRanges(new Set());
                  setError(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="default">Mercamio / Comercializadora / Merkmios</option>
                <option value="dinastia">Dinastía</option>
              </select>
            </label>
          ) : null}
          {dinastiaOnly ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Fuente: Dinastía
            </span>
          ) : null}
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
                      ? `Preparando vistas ${Math.min(viewReadyRanges.size, prefetchTotal)}/${prefetchTotal} · chip habilitado al quedar listo`
                      : "Cortes cerrados + acumulado hasta el último día con datos"}
                {rangeSwitchPending ? " · sincronizando…" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDayRanges
                .filter((range) => readyRanges.has(range.id))
                .map((range) => {
                  const viewReady = viewReadyRanges.has(range.id);
                  const selected = dayRangeId === range.id;
                  const canClick = selected || viewReady;
                  return (
                  <button
                    key={range.id}
                    type="button"
                    disabled={!canClick || periodControlsDisabled}
                    onClick={() => {
                      if (!canClick) return;
                      selectDayRange(range.id);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                      selected
                        ? range.projection
                          ? "border-amber-600 bg-amber-600 text-white shadow-sm"
                          : "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : !viewReady
                          ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
                          : range.projection
                            ? "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50",
                    )}
                    title={
                      range.projection
                        ? `Proyección a día ${range.projection.targetToDay} con datos hasta el ${range.projection.actualToDay}`
                        : viewReady
                          ? "Vista precargada · cambio instantaneo"
                          : "Preparando vista en segundo plano…"
                    }
                  >
                    {range.label}
                    {!viewReady && !selected ? (
                      <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin opacity-70" />
                    ) : null}
                  </button>
                  );
                })}
              {!preloadReady &&
              (readyRanges.size < prefetchTotal ||
                viewReadyRanges.size < prefetchTotal) ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-3 py-1.5 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Preparando mas rangos…
                </span>
              ) : null}
            </div>
            {payload?.meta.dayRange?.projection ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                Proyección a{" "}
                <span className="font-semibold">
                  día {payload.meta.dayRange.projection.targetToDay}
                </span>{" "}
                con corte real hasta el{" "}
                <span className="font-semibold">
                  día {payload.meta.dayRange.projection.actualToDay}
                </span>{" "}
                (último cargado). Fórmula: (venta 1→
                {payload.meta.dayRange.projection.actualToDay} /{" "}
                {payload.meta.dayRange.projection.actualToDay}) ×{" "}
                {payload.meta.dayRange.projection.targetToDay}. MoM/YoY usan el
                tramo cerrado comparable.
              </p>
            ) : null}

            {maxSingleDay ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={periodControlsDisabled}
                    onClick={() =>
                      selectSingleDay(activeSingleDay ?? maxSingleDay)
                    }
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                      activeSingleDay
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50",
                    )}
                    title="Ver la venta de un solo dia"
                  >
                    Dia
                  </button>

                  <button
                    type="button"
                    aria-label="Dia anterior"
                    disabled={
                      periodControlsDisabled ||
                      (activeSingleDay ?? maxSingleDay) <= 1
                    }
                    onClick={() =>
                      selectSingleDay((activeSingleDay ?? maxSingleDay) - 1)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹
                  </button>

                  <input
                    type="date"
                    aria-label="Elegir dia"
                    disabled={periodControlsDisabled}
                    value={
                      parsedMonth
                        ? `${parsedMonth.year}-${String(parsedMonth.month).padStart(2, "0")}-${String(activeSingleDay ?? maxSingleDay).padStart(2, "0")}`
                        : ""
                    }
                    min={
                      parsedMonth
                        ? `${parsedMonth.year}-${String(parsedMonth.month).padStart(2, "0")}-01`
                        : undefined
                    }
                    max={
                      parsedMonth
                        ? `${parsedMonth.year}-${String(parsedMonth.month).padStart(2, "0")}-${String(maxSingleDay).padStart(2, "0")}`
                        : undefined
                    }
                    onChange={(event) => {
                      const day = Number(event.target.value.slice(8, 10));
                      if (Number.isInteger(day)) selectSingleDay(day);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 disabled:opacity-50"
                  />

                  <button
                    type="button"
                    aria-label="Dia siguiente"
                    disabled={
                      periodControlsDisabled ||
                      (activeSingleDay ?? maxSingleDay) >= maxSingleDay
                    }
                    onClick={() =>
                      selectSingleDay((activeSingleDay ?? maxSingleDay) + 1)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ›
                  </button>

                  <span className="text-xs text-slate-400">
                    {activeSingleDay
                      ? "Venta de un solo dia"
                      : `Ultimo dia cargado: ${maxSingleDay}`}
                  </span>
                </div>

                {activeSingleDay && weekdayComparisonWarning ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    {weekdayComparisonWarning}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : parsedMonth ? (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Este mes aun no tiene dias cargados en la fuente de datos. Elige un mes
            anterior o espera a que suba el primer dia del mes.
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
