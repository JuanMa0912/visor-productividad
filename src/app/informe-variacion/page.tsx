"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, TrendingUp } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessRotacionBoard } from "@/lib/shared/special-role-features";
import {
  defaultInformeYearMonth,
  parseYearMonthInput,
  yearMonthToInputValue,
} from "@/lib/informe-variacion/periods";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { readInformeApiResponse } from "@/lib/informe-variacion/read-api-response";
import { InformeVariacionBoard } from "@/app/informe-variacion/informe-variacion-board";

type MargenMeta = {
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
  const { isAdmin, hasSection, hasSubsection } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);

  const canAccess = useMemo(() => {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (!hasSection("producto")) return false;
    return (
      hasSubsection("rotacion") ||
      hasSubsection("margenes") ||
      canAccessRotacionBoard(user.specialRoles, isAdmin, user.allowedSubdashboards)
    );
  }, [hasSection, hasSubsection, isAdmin, user]);

  useEffect(() => {
    if (ready && !canAccess) {
      router.replace("/secciones");
    }
  }, [canAccess, ready, router]);

  const [metaLoading, setMetaLoading] = useState(true);
  const [monthInput, setMonthInput] = useState("");
  const [useMockBases, setUseMockBases] = useState(true);
  const [payload, setPayload] = useState<InformeVariacionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const INFORME_FETCH_TIMEOUT_MS = 120_000;

  useEffect(() => {
    if (!ready || !canAccess) return;
    let cancelled = false;
    const loadMeta = async () => {
      setMetaLoading(true);
      try {
        const response = await fetch("/api/margenes/meta", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await response.json()) as MargenMeta;
        if (cancelled) return;
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

  const cacheKey = useMemo(() => {
    const parsed = parseYearMonthInput(monthInput);
    if (!parsed) return "";
    return `${parsed.year}-${parsed.month}:mock=${useMockBases ? 1 : 0}`;
  }, [monthInput, useMockBases]);

  const loadInforme = useCallback(async () => {
    const parsed = parseYearMonthInput(monthInput);
    if (!parsed) {
      setError("Selecciona un mes valido.");
      return;
    }
    const requestKey = `${parsed.year}-${parsed.month}:mock=${useMockBases ? 1 : 0}`;
    const cached = readSessionInforme(requestKey);
    if (cached && !payload) {
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
      if (!payload) {
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
  }, [monthInput, payload, router, useMockBases]);

  useEffect(() => {
    if (!cacheKey) return;
    const cached = readSessionInforme(cacheKey);
    if (cached) setPayload(cached);
  }, [cacheKey]);

  useEffect(() => {
    if (!ready || !canAccess || metaLoading || !monthInput) return;
    void loadInforme();
  }, [canAccess, loadInforme, metaLoading, monthInput, ready, useMockBases]);

  const showInitialLoader = metaLoading || (loading && !payload && !error);
  const showBoard = Boolean(payload) && !metaLoading;
  const isRefreshing = loading && Boolean(payload);

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
        <div className="mb-5 flex flex-wrap items-end justify-end gap-3">
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
          <div className={isRefreshing ? "opacity-70 transition-opacity" : undefined}>
            <InformeVariacionBoard payload={payload!} />
          </div>
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
