"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, TrendingUp } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth } from "@/lib/auth/auth-context";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { readInformeApiResponse } from "@/lib/informe-variacion/read-api-response";
import { InformeVariacionBoard, BOARD_TABS, type InformeBoardTab } from "@/app/informe-variacion/informe-variacion-board";
import { prefetchWarmInformeRange } from "@/lib/informe-variacion/use-matrix-agg-cache";
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
import {
  alignPreviousYearRange,
  compactToIso,
  defaultInformeMonthToDateRanges,
  defaultInformeYtdRanges,
  isoToCompact,
  type InformeSelectedRanges,
} from "@/lib/informe-variacion/date-range";
import {
  defaultInformeDayRangeId,
  getInformeCortesDayRanges,
  payloadMatchesInformeSelection,
  type InformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import {
  defaultInformeYearMonth,
  parseYearMonthInput,
  yearMonthToInputValue,
} from "@/lib/informe-variacion/periods";
import { cn } from "@/lib/shared/utils";

type InformeMeta = {
  maxDate: string | null;
  minDate?: string | null;
};

const INFORME_SESSION_CACHE_BASE = "vp-informe-variacion:v7:";
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

const buildRangeCacheKey = (
  ranges: InformeSelectedRanges,
  scopeSuffix = "",
) =>
  `${ranges.currentFrom}:${ranges.currentTo}:${ranges.previousFrom}:${ranges.previousTo}${scopeSuffix}`;

const buildCutsCacheKey = (
  year: number,
  month: number,
  rangeId: string,
  scopeSuffix = "",
) => `cuts:${year}:${month}:${rangeId}${scopeSuffix}`;

const readSessionInforme = (
  storagePrefix: string,
  key: string,
): InformeVariacionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${storagePrefix}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InformeVariacionPayload;
    if (!parsed.rows?.length) {
      sessionStorage.removeItem(`${storagePrefix}${key}`);
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
    sessionStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(payload));
  } catch {
    // quota
  }
};

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

const payloadMatchesRanges = (
  payload: InformeVariacionPayload,
  ranges: InformeSelectedRanges,
) =>
  payload.periods.current.from === ranges.currentFrom &&
  payload.periods.current.to === ranges.currentTo &&
  payload.periods.mom.from === ranges.previousFrom &&
  payload.periods.mom.to === ranges.previousTo;

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
    () =>
      user
        ? resolveSessionLineCategoryScope(user)
        : resolveSessionLineCategoryScope({ role: "user", allowedLines: null }),
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
  const [dataTenant, setDataTenant] = useState<"default" | "dinastia">(
    "default",
  );
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
    if (ready && !canAccess) router.replace("/secciones");
  }, [canAccess, ready, router]);

  useEffect(() => {
    purgeLegacyInformeSessionCache();
  }, []);

  const [metaLoading, setMetaLoading] = useState(true);
  const [maxDate, setMaxDate] = useState<string | null>(null);
  const [minDate, setMinDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<InformeSelectedRanges | null>(null);
  const [applied, setApplied] = useState<InformeSelectedRanges | null>(null);
  const [boardTab, setBoardTab] = useState<InformeBoardTab>("reporte");
  const [monthInput, setMonthInput] = useState("");
  const [dayRangeId, setDayRangeId] = useState<InformeDayRangeId | "">("");
  const [rankingDraft, setRankingDraft] = useState<InformeSelectedRanges | null>(
    null,
  );
  const [rankingApplied, setRankingApplied] =
    useState<InformeSelectedRanges | null>(null);
  const [payload, setPayload] = useState<InformeVariacionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memoryCacheRef = useRef<Map<string, InformeVariacionPayload>>(
    new Map(),
  );
  const inflightRef = useRef<Map<string, Promise<InformeVariacionPayload>>>(
    new Map(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const appliedKeyRef = useRef("");

  useEffect(() => {
    memoryCacheRef.current.clear();
    inflightRef.current.clear();
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
        const response = await fetch(metaUrl, { cache: "no-store" });
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
        const max = data.maxDate;
        setMaxDate(max);
        setMinDate(data.minDate ?? null);
        const ytd = defaultInformeYtdRanges(max);
        const monthToDate = defaultInformeMonthToDateRanges(max);
        const ym = defaultInformeYearMonth(max);
        setDraft(ytd);
        setApplied(ytd);
        setRankingDraft(monthToDate);
        setRankingApplied(monthToDate);
        setMonthInput(yearMonthToInputValue(ym.year, ym.month));
      } catch {
        if (!cancelled) {
          const ytd = defaultInformeYtdRanges(null);
          const monthToDate = defaultInformeMonthToDateRanges(null);
          const ym = defaultInformeYearMonth(null);
          setDraft(ytd);
          setApplied(ytd);
          setRankingDraft(monthToDate);
          setRankingApplied(monthToDate);
          setMonthInput(yearMonthToInputValue(ym.year, ym.month));
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

  const minIso = minDate ? compactToIso(minDate) : undefined;
  const maxIso = maxDate ? compactToIso(maxDate) : undefined;
  const parsedMonth = useMemo(
    () => parseYearMonthInput(monthInput),
    [monthInput],
  );
  const availableDayRanges = useMemo(() => {
    if (!parsedMonth) return [];
    return getInformeCortesDayRanges(
      parsedMonth.year,
      parsedMonth.month,
      new Date(),
      maxDate,
    );
  }, [maxDate, parsedMonth]);
  const effectiveDayRangeId =
    dayRangeId && availableDayRanges.some((range) => range.id === dayRangeId)
      ? dayRangeId
      : defaultInformeDayRangeId(availableDayRanges);

  const storePayload = useCallback(
    (ranges: InformeSelectedRanges, data: InformeVariacionPayload) => {
      const scoped = filterInformePayloadForLineScope(data, lineCategoryScope);
      if (!scoped.rows?.length) return null;
      const key = buildRangeCacheKey(ranges, scopeCacheSuffix);
      memoryCacheRef.current.set(key, scoped);
      writeSessionInformeIdle(sessionStoragePrefix, key, scoped);
      prefetchWarmInformeRange(scoped, { metrics: ["v"] });
      return scoped;
    },
    [lineCategoryScope, scopeCacheSuffix, sessionStoragePrefix],
  );

  const readCachedPayload = useCallback(
    (ranges: InformeSelectedRanges): InformeVariacionPayload | null => {
      const key = buildRangeCacheKey(ranges, scopeCacheSuffix);
      const memoryHit = memoryCacheRef.current.get(key);
      if (memoryHit) return memoryHit;
      const sessionHit = readSessionInforme(sessionStoragePrefix, key);
      if (!sessionHit) return null;
      const scoped = filterInformePayloadForLineScope(
        sessionHit,
        lineCategoryScope,
      );
      memoryCacheRef.current.set(key, scoped);
      return scoped;
    },
    [lineCategoryScope, scopeCacheSuffix, sessionStoragePrefix],
  );

  const fetchRanges = useCallback(
    async (
      ranges: InformeSelectedRanges,
      signal: AbortSignal,
      options: { force?: boolean } = {},
    ): Promise<InformeVariacionPayload> => {
      const key = buildRangeCacheKey(ranges, scopeCacheSuffix);
      if (!options.force) {
        const cached = readCachedPayload(ranges);
        if (cached) return cached;
        const inflight = inflightRef.current.get(key);
        if (inflight) return inflight;
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

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
            from: ranges.currentFrom,
            to: ranges.currentTo,
            compareFrom: ranges.previousFrom,
            compareTo: ranges.previousTo,
          });
          if (options.force) params.set("force", "1");
          if (tenantEmpresaParam) params.set("empresa", tenantEmpresaParam);
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            { cache: "no-store", signal: timeoutController.signal },
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
          const stored = storePayload(ranges, data);
          if (!stored) {
            throw new Error(
              "Sin datos en el alcance permitido para este informe.",
            );
          }
          return stored;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
        }
      })();

      inflightRef.current.set(key, request);
      try {
        return await request;
      } finally {
        if (inflightRef.current.get(key) === request) {
          inflightRef.current.delete(key);
        }
      }
    },
    [readCachedPayload, router, scopeCacheSuffix, storePayload, tenantEmpresaParam],
  );

  const fetchCuts = useCallback(
    async (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
      signal: AbortSignal,
      options: { force?: boolean } = {},
    ): Promise<InformeVariacionPayload> => {
      const key = buildCutsCacheKey(year, month, rangeId, scopeCacheSuffix);
      if (!options.force) {
        const memoryHit = memoryCacheRef.current.get(key);
        if (memoryHit) return memoryHit;
        const sessionHit = readSessionInforme(sessionStoragePrefix, key);
        if (sessionHit) {
          const scoped = filterInformePayloadForLineScope(
            sessionHit,
            lineCategoryScope,
          );
          memoryCacheRef.current.set(key, scoped);
          return scoped;
        }
        const inflight = inflightRef.current.get(key);
        if (inflight) return inflight;
      }
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

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
          if (options.force) params.set("force", "1");
          if (tenantEmpresaParam) params.set("empresa", tenantEmpresaParam);
          const response = await fetch(
            `/api/informe-variacion?${params.toString()}`,
            { cache: "no-store", signal: timeoutController.signal },
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
          const scoped = filterInformePayloadForLineScope(data, lineCategoryScope);
          if (!scoped.rows?.length) {
            throw new Error(
              "Sin datos en el alcance permitido para este informe.",
            );
          }
          memoryCacheRef.current.set(key, scoped);
          writeSessionInformeIdle(sessionStoragePrefix, key, scoped);
          prefetchWarmInformeRange(scoped, { metrics: ["v"] });
          return scoped;
        } finally {
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
        }
      })();

      inflightRef.current.set(key, request);
      try {
        return await request;
      } finally {
        if (inflightRef.current.get(key) === request) {
          inflightRef.current.delete(key);
        }
      }
    },
    [lineCategoryScope, router, scopeCacheSuffix, sessionStoragePrefix, tenantEmpresaParam],
  );

  const loadCuts = useCallback(
    async (
      year: number,
      month: number,
      rangeId: InformeDayRangeId,
      options: { force?: boolean } = {},
    ) => {
      const token = buildCutsCacheKey(year, month, rangeId, scopeCacheSuffix);
      appliedKeyRef.current = token;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      const cached = options.force
        ? null
        : memoryCacheRef.current.get(token) ??
          readSessionInforme(sessionStoragePrefix, token);
      if (cached) {
        const scoped = filterInformePayloadForLineScope(
          cached,
          lineCategoryScope,
        );
        setPayload(scoped);
        setLoading(false);
        prefetchWarmInformeRange(scoped, { metrics: ["v"] });
        if (!options.force) return;
      } else {
        setLoading(true);
      }
      try {
        const data = await fetchCuts(
          year,
          month,
          rangeId,
          controller.signal,
          options,
        );
        if (appliedKeyRef.current !== token || controller.signal.aborted) {
          return;
        }
        setPayload(data);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted || appliedKeyRef.current !== token) {
          return;
        }
        if (!cached) setPayload(null);
        setError(
          err instanceof Error
            ? err.name === "AbortError"
              ? "La consulta tardo demasiado. Prueba un corte mas corto."
              : err.message
            : "Error desconocido cargando el informe.",
        );
      } finally {
        if (!controller.signal.aborted && appliedKeyRef.current === token) {
          setLoading(false);
        }
      }
    },
    [fetchCuts, lineCategoryScope, scopeCacheSuffix, sessionStoragePrefix],
  );

  const loadSelection = useCallback(
    async (
      ranges: InformeSelectedRanges,
      options: { force?: boolean } = {},
    ) => {
      const token = buildRangeCacheKey(ranges, scopeCacheSuffix);
      appliedKeyRef.current = token;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      const cached = options.force ? null : readCachedPayload(ranges);
      if (cached) {
        setPayload(cached);
        setLoading(false);
        prefetchWarmInformeRange(cached, { metrics: ["v"] });
        if (!options.force) return;
      } else {
        setLoading(true);
      }
      try {
        const data = await fetchRanges(ranges, controller.signal, options);
        if (appliedKeyRef.current !== token || controller.signal.aborted) {
          return;
        }
        setPayload(data);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted || appliedKeyRef.current !== token) {
          return;
        }
        if (!cached) setPayload(null);
        setError(
          err instanceof Error
            ? err.name === "AbortError"
              ? "La consulta tardo demasiado. Prueba un rango mas corto."
              : err.message
            : "Error desconocido cargando el informe.",
        );
      } finally {
        if (!controller.signal.aborted && appliedKeyRef.current === token) {
          setLoading(false);
        }
      }
    },
    [fetchRanges, readCachedPayload, scopeCacheSuffix],
  );

  useEffect(() => {
    if (!ready || !canAccess || metaLoading) return;
    if (boardTab === "comparativo") {
      if (!applied) return;
      void loadSelection(applied);
      return () => abortRef.current?.abort();
    }
    if (boardTab === "ranking") {
      if (!rankingApplied) return;
      void loadSelection(rankingApplied);
      return () => abortRef.current?.abort();
    }
    if (!parsedMonth || !effectiveDayRangeId) return;
    void loadCuts(parsedMonth.year, parsedMonth.month, effectiveDayRangeId);
    return () => abortRef.current?.abort();
  }, [
    applied,
    boardTab,
    canAccess,
    effectiveDayRangeId,
    loadCuts,
    loadSelection,
    metaLoading,
    parsedMonth,
    rankingApplied,
    ready,
  ]);

  const applyDraft = (next: InformeSelectedRanges) => {
    setDraft(next);
    setApplied(next);
  };

  const updateDraftDate = (
    field: keyof InformeSelectedRanges,
    iso: string,
  ) => {
    const compact = isoToCompact(iso);
    if (!compact || !draft) return;
    setDraft({ ...draft, [field]: compact });
  };

  const periodControlsDisabled = metaLoading || loading;
  const showInitialLoader = metaLoading || (loading && !payload && !error);
  const payloadMatchesSelection = Boolean(
    payload &&
      (boardTab === "reporte" || boardTab === "cortes"
        ? parsedMonth &&
          effectiveDayRangeId &&
          payloadMatchesInformeSelection(
            payload,
            parsedMonth.year,
            parsedMonth.month,
            effectiveDayRangeId,
            availableDayRanges,
          )
        : boardTab === "ranking"
          ? rankingApplied && payloadMatchesRanges(payload, rankingApplied)
          : applied && payloadMatchesRanges(payload, applied)),
  );
  const showBoard = Boolean(payload) && !metaLoading;
  const boardDataPending =
    Boolean(payload) && !payloadMatchesSelection && loading;

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
              Informe de variacion
            </h1>
            <p className="text-sm text-slate-500">
              Compañía → Sede → Categoría → Línea → Sublínea → Ítem, con
              empresa (proveedor). Cortes Excel, comparativo libre y ranking.
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
                  const next =
                    event.target.value === "dinastia" ? "dinastia" : "default";
                  setDataTenant(next);
                  setPayload(null);
                  setError(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="default">
                  Mercamio / Comercializadora / Merkmios
                </option>
                <option value="dinastia">Dinastía</option>
              </select>
            </label>
          ) : null}
          {dinastiaOnly ? (
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Fuente: Dinastía
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (boardTab === "reporte" || boardTab === "cortes") {
                if (!parsedMonth || !effectiveDayRangeId) return;
                void loadCuts(
                  parsedMonth.year,
                  parsedMonth.month,
                  effectiveDayRangeId,
                  { force: true },
                );
                return;
              }
              const target =
                boardTab === "ranking" ? rankingApplied : applied;
              if (target) void loadSelection(target, { force: true });
            }}
            disabled={
              periodControlsDisabled ||
              (boardTab === "ranking"
                ? !rankingApplied
                : boardTab === "comparativo"
                  ? !applied
                  : !parsedMonth || !effectiveDayRangeId)
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Pestañas del informe"
          className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        >
          {BOARD_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={boardTab === tab.id}
              onClick={() => setBoardTab(tab.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                boardTab === tab.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          {boardTab === "reporte" || boardTab === "cortes" ? (
            <>
              <p className="mb-3 text-xs text-slate-500">
                Mes + cortes Excel (1 al 7, 1 al 14, …, 1 al fin). Si el mes
                sigue abierto, también sale el acumulado con datos, la
                proyección 1 a hoy (aunque falten días) y la del siguiente
                corte. Compara MoM y YoY.
              </p>
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Mes actual
                  <input
                    type="month"
                    value={monthInput}
                    disabled={metaLoading}
                    onChange={(event) => setMonthInput(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableDayRanges.map((range) => {
                  const selected = effectiveDayRangeId === range.id;
                  return (
                    <button
                      key={range.id}
                      type="button"
                      onClick={() => setDayRangeId(range.id)}
                      title={
                        range.projection
                          ? `Proyección a día ${range.projection.targetToDay} con datos hasta el ${range.projection.actualToDay}`
                          : range.label
                      }
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold",
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      {range.label}
                    </button>
                  );
                })}
                {availableDayRanges.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No hay cortes disponibles para este mes.
                  </p>
                ) : null}
              </div>
            </>
          ) : boardTab === "ranking" ? (
            <>
              <p className="mb-3 text-xs text-slate-500">
                Elige un periodo para el ranking. La variación usa el mismo
                tramo del año anterior.
              </p>
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Desde
                  <input
                    type="date"
                    value={
                      rankingDraft ? compactToIso(rankingDraft.currentFrom) : ""
                    }
                    min={minIso}
                    max={maxIso}
                    disabled={metaLoading}
                    onChange={(event) => {
                      const compact = isoToCompact(event.target.value);
                      if (!compact || !rankingDraft) return;
                      const aligned =
                        alignPreviousYearRange(compact, rankingDraft.currentTo) ??
                        rankingDraft;
                      setRankingDraft({
                        ...rankingDraft,
                        currentFrom: compact,
                        previousFrom: aligned.previousFrom,
                        previousTo: aligned.previousTo,
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                  Hasta
                  <input
                    type="date"
                    value={
                      rankingDraft ? compactToIso(rankingDraft.currentTo) : ""
                    }
                    min={minIso}
                    max={maxIso}
                    disabled={metaLoading}
                    onChange={(event) => {
                      const compact = isoToCompact(event.target.value);
                      if (!compact || !rankingDraft) return;
                      const aligned =
                        alignPreviousYearRange(
                          rankingDraft.currentFrom,
                          compact,
                        ) ?? rankingDraft;
                      setRankingDraft({
                        ...rankingDraft,
                        currentTo: compact,
                        previousFrom: aligned.previousFrom,
                        previousTo: aligned.previousTo,
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={!rankingDraft || metaLoading}
                  onClick={() => rankingDraft && setRankingApplied(rankingDraft)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Aplicar periodo
                </button>
              </div>
            </>
          ) : (
            <>
          <p className="mb-3 text-xs text-slate-500">
            Elige dos intervalos de fechas. Al comparar, las cifras salen de
            una: meses cerrados ya van preagregados.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="mb-1 w-full text-xs font-semibold uppercase tracking-wide text-slate-500">
                Periodo actual
              </legend>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Desde
                <input
                  type="date"
                  value={draft ? compactToIso(draft.currentFrom) : ""}
                  min={minIso}
                  max={maxIso}
                  disabled={metaLoading}
                  onChange={(event) =>
                    updateDraftDate("currentFrom", event.target.value)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Hasta
                <input
                  type="date"
                  value={draft ? compactToIso(draft.currentTo) : ""}
                  min={minIso}
                  max={maxIso}
                  disabled={metaLoading}
                  onChange={(event) =>
                    updateDraftDate("currentTo", event.target.value)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                />
              </label>
            </fieldset>

            <span className="hidden pb-3 text-sm font-semibold text-slate-400 sm:inline">
              vs
            </span>

            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="mb-1 w-full text-xs font-semibold uppercase tracking-wide text-slate-500">
                Periodo anterior
              </legend>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Desde
                <input
                  type="date"
                  value={draft ? compactToIso(draft.previousFrom) : ""}
                  min={minIso}
                  max={maxIso}
                  disabled={metaLoading}
                  onChange={(event) =>
                    updateDraftDate("previousFrom", event.target.value)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Hasta
                <input
                  type="date"
                  value={draft ? compactToIso(draft.previousTo) : ""}
                  min={minIso}
                  max={maxIso}
                  disabled={metaLoading}
                  onChange={(event) =>
                    updateDraftDate("previousTo", event.target.value)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100"
                />
              </label>
            </fieldset>

            <button
              type="button"
              disabled={!draft || metaLoading}
              onClick={() => {
                if (!draft) return;
                const aligned = alignPreviousYearRange(
                  draft.currentFrom,
                  draft.currentTo,
                );
                if (!aligned) return;
                setDraft({ ...draft, ...aligned });
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Mismo tramo año anterior
            </button>
            <button
              type="button"
              disabled={!maxDate || metaLoading}
              onClick={() => applyDraft(defaultInformeYtdRanges(maxDate))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Corrido del año
            </button>
            <button
              type="button"
              disabled={!draft || metaLoading}
              onClick={() => draft && applyDraft(draft)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Comparar
            </button>
          </div>
            </>
          )}
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {showInitialLoader ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            <p className="mt-3 text-sm text-slate-600">
              Cargando comparativo…
            </p>
          </div>
        ) : showBoard ? (
          <InformeVariacionBoard
            key={`${boardTab}:${payload?.periods.current.from ?? ""}:${payload?.periods.mom.from ?? ""}:${payload?.meta.dayRange?.id ?? ""}:${scopeCacheSuffix}`}
            payload={payload!}
            boardTab={boardTab}
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
                  onClick={() =>
                    applied && void loadSelection(applied, { force: true })
                  }
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
