import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SEDES, type Sede } from "@/lib/shared/constants";
import type { DailyProductivity } from "@/types";
import type { ApiResponse } from "./types";
import { resolveProductivityDefaultRange } from "@/lib/productivity/date-window";

const mergeByDateSede = (
  primary: DailyProductivity[],
  extra: DailyProductivity[],
): DailyProductivity[] => {
  if (extra.length === 0) return primary;
  const map = new Map<string, DailyProductivity>();
  for (const row of primary) {
    map.set(`${row.date}|${row.sede}`, row);
  }
  for (const row of extra) {
    map.set(`${row.date}|${row.sede}`, row);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

export const useProductivityData = () => {
  const [dailyDataSet, setDailyDataSet] = useState<DailyProductivity[]>([]);
  const [availableSedes, setAvailableSedes] = useState<Sede[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasFullHistory, setHasFullHistory] = useState(false);
  const fullHistoryInflight = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readyForWarmRef = useRef(false);

  const ensureFullHistory = useCallback(async () => {
    if (hasFullHistory) return;
    if (fullHistoryInflight.current) {
      await fullHistoryInflight.current;
      return;
    }

    const controller = abortRef.current;
    const run = (async () => {
      try {
        const fullResponse = await fetch("/api/productivity", {
          signal: controller?.signal,
          credentials: "include",
          cache: "no-store",
        });
        if (!fullResponse.ok) return;
        const fullPayload = (await fullResponse.json()) as ApiResponse;
        const fullDaily = fullPayload.dailyData ?? [];
        if (fullDaily.length === 0) return;
        setDailyDataSet((prev) => mergeByDateSede(prev, fullDaily));
        if (fullPayload.sedes && fullPayload.sedes.length > 0) {
          setAvailableSedes(fullPayload.sedes);
        }
        setHasFullHistory(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.warn("[productivity] Carga completa diferida falló", err);
      } finally {
        fullHistoryInflight.current = null;
      }
    })();

    fullHistoryInflight.current = run;
    await run;
  }, [hasFullHistory]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    abortRef.current = controller;
    readyForWarmRef.current = false;

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const range = resolveProductivityDefaultRange();
        const params = new URLSearchParams({
          from: range.start,
          to: range.end,
        });
        const response = await fetch(`/api/productivity?${params}`, {
          signal: controller.signal,
          credentials: "include",
          cache: "no-store",
        });

        const payload = (await response.json()) as ApiResponse;
        if (!isMounted) return;

        if (response.status === 401) {
          setError("No autorizado.");
          setDailyDataSet([]);
          setAvailableSedes([]);
          return;
        }

        const resolvedDailyData = payload.dailyData ?? [];
        const resolvedSedes =
          payload.sedes && payload.sedes.length > 0
            ? payload.sedes
            : DEFAULT_SEDES;

        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar la información");
        }

        setDailyDataSet(resolvedDailyData);
        setAvailableSedes(resolvedSedes);
        if (payload.error) {
          setError(payload.error);
        }
        readyForWarmRef.current = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Error desconocido");
          setDailyDataSet([]);
          setAvailableSedes([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    // Warmup ocioso del histórico completo (no pelea con la 1ª pintura).
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const warm = () => {
      if (!isMounted || !readyForWarmRef.current) return;
      void ensureFullHistory();
    };
    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout?: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(warm, { timeout: 8_000 });
    } else {
      timeoutId = setTimeout(warm, 4_000);
    }

    return () => {
      isMounted = false;
      controller.abort();
      if (idleId !== null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [ensureFullHistory]);

  return {
    dailyDataSet,
    availableSedes,
    isLoading,
    error,
    hasFullHistory,
    ensureFullHistory,
  };
};
