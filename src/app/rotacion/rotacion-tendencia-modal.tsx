"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart } from "@mui/x-charts/LineChart";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatPrice,
  formatPriceWithoutSixZeros,
  getCookieValue,
} from "@/app/rotacion/rotacion-preamble";
import { useRotacionViewConfig } from "@/app/rotacion/rotacion-view-config-provider";
import { clampTendenciaDateRange, type RotacionTendenciaMetric } from "@/lib/rotacion/tendencia-scope";
import { cn } from "@/lib/shared/utils";

export type RotacionTendenciaModalProps = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  start: string;
  end: string;
  availableMin?: string;
  availableMax?: string;
  items: string[];
  scoped: boolean;
  scopeLabel: string;
  defaultMetric?: RotacionTendenciaMetric;
  onClose: () => void;
};

type TrendPoint = {
  day: string;
  sales: number;
  units: number;
  inventoryValue: number;
};

const METRIC_OPTIONS: Array<{
  id: RotacionTendenciaMetric;
  label: string;
}> = [
  { id: "ventas", label: "Ventas" },
  { id: "unidades", label: "Unidades" },
  { id: "inventario", label: "Valor inventario" },
];

const formatDayLabel = (day: string): string => {
  const parts = day.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const date = parts[2];
  if (!year || !month || !date) return day;
  return new Date(year, month - 1, date).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
  });
};

export function RotacionTendenciaModal({
  empresa,
  sedeId,
  sedeName,
  start,
  end,
  availableMin,
  availableMax,
  items,
  scoped,
  scopeLabel,
  defaultMetric = "ventas",
  onClose,
}: RotacionTendenciaModalProps) {
  const { apiBasePath } = useRotacionViewConfig();
  const bounds = useMemo(
    () =>
      clampTendenciaDateRange({
        start,
        end,
        availableMin,
        availableMax,
      }),
    [availableMax, availableMin, end, start],
  );
  const [draftStart, setDraftStart] = useState(bounds.start);
  const [draftEnd, setDraftEnd] = useState(bounds.end);
  const [appliedStart, setAppliedStart] = useState(bounds.start);
  const [appliedEnd, setAppliedEnd] = useState(bounds.end);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [metric, setMetric] = useState<RotacionTendenciaMetric>(defaultMetric);

  const itemsKey = scoped ? items.join("\n") : "";
  useEffect(() => {
    const controller = new AbortController();
    const csrf = getCookieValue("vp_csrf");
    const itemIds = itemsKey ? itemsKey.split("\n") : [];
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    void (async () => {
      try {
        const response = await fetch(`${apiBasePath}/tendencia`, {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(csrf ? { "x-csrf-token": csrf } : {}),
          },
          body: JSON.stringify({
            empresa,
            sedeId,
            start: appliedStart,
            end: appliedEnd,
            items: itemIds,
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          points?: TrendPoint[];
          start?: string;
          end?: string;
        };
        if (!response.ok) {
          throw new Error(data.error ?? "No fue posible cargar la tendencia.");
        }
        if (controller.signal.aborted) return;
        setPoints(Array.isArray(data.points) ? data.points : []);
        if (data.start) setAppliedStart(data.start);
        if (data.end) setAppliedEnd(data.end);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "No fue posible cargar la tendencia.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [apiBasePath, appliedEnd, appliedStart, empresa, itemsKey, sedeId]);

  const labels = useMemo(
    () => points.map((point) => formatDayLabel(point.day)),
    [points],
  );
  const values = useMemo(
    () =>
      points.map((point) => {
        if (metric === "unidades") return point.units;
        if (metric === "inventario") return point.inventoryValue;
        return point.sales;
      }),
    [metric, points],
  );
  const total = useMemo(
    () => values.reduce((sum, value) => sum + value, 0),
    [values],
  );
  const closing = values.at(-1) ?? 0;
  const metricLabel =
    METRIC_OPTIONS.find((option) => option.id === metric)?.label ?? "Ventas";
  const formatMetricValue = (value: number) =>
    metric === "unidades"
      ? value.toLocaleString("es-CO", { maximumFractionDigits: 1 })
      : formatPrice(value);
  const formatAxisValue = (value: number) =>
    metric === "unidades"
      ? value.toLocaleString("es-CO", { maximumFractionDigits: 0 })
      : formatPriceWithoutSixZeros(value);
  const summaryText =
    metric === "ventas"
      ? total > 0
        ? ` Total ${formatMetricValue(total)}`
        : null
      : closing !== 0
        ? ` Al cierre ${formatMetricValue(closing)}`
        : null;

  const applyDraftRange = () => {
    const next = clampTendenciaDateRange({
      start: draftStart,
      end: draftEnd,
      availableMin: bounds.min,
      availableMax: bounds.max,
    });
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setAppliedStart(next.start);
    setAppliedEnd(next.end);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotacion-tendencia-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
        <h2
          id="rotacion-tendencia-title"
          className="pr-10 text-lg font-bold text-slate-900"
        >
          Tendencia
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {sedeName} · {scopeLabel}
          {scoped
            ? ` · ${items.length.toLocaleString("es-CO")} ítems`
            : " · toda la sede"}
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Desde
            <input
              type="date"
              value={draftStart}
              min={bounds.min}
              max={bounds.max}
              onChange={(event) => setDraftStart(event.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Hasta
            <input
              type="date"
              value={draftEnd}
              min={bounds.min}
              max={bounds.max}
              onChange={(event) => setDraftEnd(event.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-800"
            />
          </label>
          <Button
            type="button"
            className="h-9 bg-amber-600 text-white hover:bg-amber-700"
            onClick={applyDraftRange}
          >
            Aplicar fechas
          </Button>
          <span
            className="inline-flex overflow-hidden rounded-lg border border-slate-200"
            role="group"
            aria-label="Métrica de tendencia"
          >
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setMetric(option.id)}
                aria-pressed={metric === option.id}
                className={cn(
                  "h-9 px-3 text-xs font-semibold transition",
                  metric === option.id
                    ? "bg-amber-600 text-white"
                    : "bg-white text-slate-600 hover:bg-amber-50",
                )}
              >
                {option.label}
              </button>
            ))}
          </span>
          <p className="text-xs text-slate-500">
            Desde el 1 de junio.
            {summaryText}
          </p>
        </div>

        <div className="mt-4 min-h-[320px]">
          {loading ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-slate-500">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="mt-2 text-sm">Cargando tendencia…</p>
            </div>
          ) : error ? (
            <p className="py-16 text-center text-sm text-rose-700">{error}</p>
          ) : points.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">
              No hay datos diarios para este recorte.
            </p>
          ) : (
            <LineChart
              height={340}
              margin={{ left: 8, right: 16, top: 16, bottom: 8 }}
              xAxis={[
                {
                  data: labels,
                  scaleType: "point",
                  tickLabelStyle: {
                    fontSize: 11,
                    angle: labels.length > 20 ? -45 : 0,
                    textAnchor: labels.length > 20 ? "end" : "middle",
                  },
                  height: labels.length > 20 ? 64 : 32,
                },
              ]}
              yAxis={[
                {
                  valueFormatter: (value: number | null) =>
                    value == null ? "" : formatAxisValue(value),
                },
              ]}
              series={[
                {
                  data: values,
                  label: metricLabel,
                  color:
                    metric === "inventario"
                      ? "#7c3aed"
                      : metric === "unidades"
                        ? "#2563eb"
                        : "#d97706",
                  area: true,
                  showMark: values.length <= 21,
                  valueFormatter: (value: number | null) =>
                    value == null ? "—" : formatMetricValue(value),
                },
              ]}
              grid={{ horizontal: true }}
            />
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
