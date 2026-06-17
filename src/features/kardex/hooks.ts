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
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: T;
    error: string | null;
  }>({ key: "", data: initial, error: null });

  const query = useMemo(() => buildQueryString(filters), [filters]);
  const key = `${endpoint}?${query}`;
  const loading = snapshot.key !== key;
  const data = snapshot.data;
  const error = snapshot.key === key ? snapshot.error : null;

  useEffect(() => {
    const controller = new AbortController();

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
        if (!controller.signal.aborted) {
          setSnapshot({ key, data: payload, error: null });
        }
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!controller.signal.aborted) {
          setSnapshot((prev) => ({
            key,
            data: prev.key === key ? prev.data : initial,
            error:
              err instanceof Error ? err.message : "Error consultando kardex.",
          }));
        }
      });

    return () => controller.abort();
  }, [initial, key]);

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
