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
    sessionStorage.setItem(`${INFORME_SESSION_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch {
    // quota o payload demasiado grande
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
  const [useMockBases, setUseMockBases] = useState(false);
  const [payload, setPayload] = useState<InformeVariacionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payloadRef = useRef<InformeVariacionPayload | null>(null);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  const INFORME_FETCH_TIMEOUT_MS = 120_000;

  useEffect(() => {
    if (!ready || !canAccess) return;
    let cancelled = false;
    const loadMeta = async () => {
      setMetaLoading(true);
      try {
        const response = await fetch("/api/informe-variacion/meta", { cache: "no-store" });
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

  const cacheKey = useMemo(() => {
    const parsed = parseYearMonthInput(monthInput);
    if (!parsed || !dayRangeId) return "";
    return `${parsed.year}-${parsed.month}:range=${dayRangeId}:mock=${useMockBases ? 1 : 0}`;
  }, [dayRangeId, monthInput, useMockBases]);

  const loadInforme = useCallback(async () => {
    const parsed = parseYearMonthInput(monthInput);
    if (!parsed) {
      setError("Selecciona un mes valido.");
      return;
    }
    if (!dayRangeId) {
      setError("No hay rangos de dias disponibles para este mes.");
      return;
    }
    const requestKey = `${parsed.year}-${parsed.month}:range=${dayRangeId}:mock=${useMockBases ? 1 : 0}`;
    const cached = readSessionInforme(requestKey);
    if (cached && !payloadRef.current) {
      setPayload(cached);
    }
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), INFORME_FETCH_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({
        year: String(parsed.year),
        month: String(parsed.month),
        mock: useMockBases ? "1" : "0",
        range: dayRangeId,
      });
      const response = await fetch(`/api/informe-variacion?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        router.replace("/secciones");
        return;
      }
      const data = await readInformeApiResponse(response);
      if (!response.ok) {
        throw new Error(data.error ?? "No fue posible cargar el informe.");
      }
      setPayload(data);
      writeSessionInforme(requestKey, data);
    } catch (err) {
      if (!payloadRef.current) {
        setPayload(null);
      }
      if (err instanceof Error && err.name === "AbortError") {
        setError(
          "La consulta tardo demasiado. Prueba con Simular MoM/YoY activo o un mes con menos datos.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Error desconocido cargando el informe.",
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [dayRangeId, monthInput, router, useMockBases]);

  useEffect(() => {
    if (!cacheKey) return;
    setPayload(readSessionInforme(cacheKey));
  }, [cacheKey]);

  useEffect(() => {
    if (!ready || !canAccess || metaLoading || !cacheKey) return;
    void loadInforme();
  }, [cacheKey, canAccess, loadInforme, metaLoading, ready]);

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
          <label className="flex cursor-pointer items-center gap-2 self-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900">
            <input
              type="checkbox"
              checked={useMockBases}
              onChange={(event) => setUseMockBases(event.target.checked)}
              className="rounded border-amber-300"
            />
            Simular MoM / YoY (demo)
          </label>
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
            onClick={() => void loadInforme()}
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
                Solo aparecen periodos ya cerrados en el mes
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDayRanges.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  onClick={() => setDayRangeId(range.id)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                    dayRangeId === range.id
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50",
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        ) : parsedMonth ? (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Este mes aun no tiene rangos de dias disponibles. Elige un mes anterior o espera a que
            cierre el primer periodo (dia 7).
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
            {useMockBases ? (
              <p className="mt-1 text-xs text-slate-400">
                Modo demo: solo se consulta el mes seleccionado.
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
                  onClick={() => void loadInforme()}
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
