"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  KardexFilters,
  KardexLookups,
  KardexResumenCategoria,
  KardexResumenItem,
  KardexRow,
  KardexTotales,
} from "./types";

type QueryState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

const buildQueryString = (filters: KardexFilters) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  return params.toString();
};

const useKardexQuery = <T,>(
  endpoint: string,
  filters: KardexFilters,
  initial: T,
): QueryState<T> => {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => buildQueryString(filters), [filters]);
  const key = `${endpoint}?${query}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetch(key, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error ?? "Error consultando kardex.");
        }
        return (await res.json()) as T;
      })
      .then((payload) => {
        setData(payload);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error consultando kardex.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [key]);

  return { data, loading, error };
};

export const useKardexDetalle = (filters: KardexFilters) =>
  useKardexQuery<KardexRow[]>("/api/kardex/detalle", filters, []);

export const useKardexResumenItem = (filters: KardexFilters) =>
  useKardexQuery<KardexResumenItem[]>("/api/kardex/resumen-item", filters, []);

export const useKardexResumenCategoria = (filters: KardexFilters) =>
  useKardexQuery<KardexResumenCategoria[]>(
    "/api/kardex/resumen-categoria",
    filters,
    [],
  );

export const useKardexTotales = (filters: KardexFilters) =>
  useKardexQuery<KardexTotales>("/api/kardex/totales", filters, {
    ventas: 0,
    costo: 0,
    margen: 0,
    margenPct: 0,
  });

export const useKardexLookups = (filters: KardexFilters) =>
  useKardexQuery<KardexLookups>("/api/kardex/lookups", filters, {
    empresas: [],
    sedes: [],
    bodegas: [],
    categorias: [],
    lineas: [],
  });
