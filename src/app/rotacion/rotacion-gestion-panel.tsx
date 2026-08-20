"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DiMultiSelect, type DiSelectOption } from "@/app/analisis-de-inventario/di-multi-select";
import { useRotacionViewConfig } from "@/app/rotacion/rotacion-view-config-provider";
import { cn } from "@/lib/shared/utils";
import type {
  RotacionCriticalBucket,
  RotacionCriticalDigestFamily,
} from "@/lib/rotacion/critical-digest";
import {
  sliceGestionMonthlySedeSeries,
  type RotacionGestionMonthlySedeSeries,
} from "@/lib/rotacion/gestion-kpis";

type GestionMetric = "plata" | "unidades";

type Props = {
  families: RotacionCriticalDigestFamily[];
  buckets: readonly RotacionCriticalBucket[];
  sedeOptions: DiSelectOption[];
  loading?: boolean;
};

const GESTION_SEDE_BAR_COLORS = [
  "#2563eb",
  "#16a34a",
  "#7c3aed",
  "#dc2626",
  "#0ea5e9",
  "#eab308",
  "#ea580c",
  "#db2777",
  "#0f766e",
  "#4f46e5",
  "#65a30d",
  "#78716c",
];

const emptyMonthly = (): RotacionGestionMonthlySedeSeries => ({
  months: [],
  monthLabels: [],
  series: [],
});

const MiniToggle = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) => (
  <span className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-200">
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        onClick={() => onChange(option.id)}
        className={cn(
          "px-3 py-1.5 text-xs font-semibold",
          value === option.id
            ? "bg-amber-600 text-white"
            : "bg-white text-slate-600 hover:bg-amber-50",
        )}
      >
        {option.label}
      </button>
    ))}
  </span>
);

const colorForSede = (sedeKey: string, sedeOptions: DiSelectOption[]) => {
  const index = sedeOptions.findIndex((option) => option.value === sedeKey);
  return GESTION_SEDE_BAR_COLORS[
    (index >= 0 ? index : 0) % GESTION_SEDE_BAR_COLORS.length
  ];
};

export function RotacionGestionPanel({
  families,
  buckets,
  sedeOptions,
  loading = false,
}: Props) {
  const { apiBasePath } = useRotacionViewConfig();
  const [selectedSedeKeys, setSelectedSedeKeys] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [metric, setMetric] = useState<GestionMetric>("plata");
  const [monthly, setMonthly] = useState<RotacionGestionMonthlySedeSeries>(
    emptyMonthly(),
  );
  const [trendSource, setTrendSource] = useState<"roll" | "empty" | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validSedeKeys = useMemo(
    () =>
      selectedSedeKeys.filter((key) =>
        sedeOptions.some((option) => option.value === key),
      ),
    [sedeOptions, selectedSedeKeys],
  );

  const sedeScopes = useMemo(
    () =>
      validSedeKeys.length > 0
        ? validSedeKeys
        : sedeOptions.map((option) => option.value),
    [sedeOptions, validSedeKeys],
  );

  const labelBySede = useMemo(
    () => Object.fromEntries(sedeOptions.map((option) => [option.value, option.label])),
    [sedeOptions],
  );

  const monthOptions = useMemo(
    () =>
      monthly.months.map((month, index) => ({
        value: month,
        label: monthly.monthLabels[index] ?? month,
      })),
    [monthly.monthLabels, monthly.months],
  );

  const validMonths = useMemo(
    () => selectedMonths.filter((month) => monthly.months.includes(month)),
    [monthly.months, selectedMonths],
  );

  useEffect(() => {
    const allScopes = sedeOptions.map((option) => option.value);
    if (allScopes.length === 0) return;
    const params = new URLSearchParams({ mode: "trend" });
    families.forEach((family) => params.append("family", family));
    buckets.forEach((bucket) => params.append("buckets", bucket));
    allScopes.forEach((scope) => params.append("sedeScope", scope));
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setTrendLoading(true);
      setError(null);
    });
    void fetch(`${apiBasePath}/gestion?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const text = await response.text();
        let payload: {
          monthly?: RotacionGestionMonthlySedeSeries;
          source?: "roll" | "empty";
          error?: string;
        };
        try {
          payload = JSON.parse(text) as typeof payload;
        } catch {
          throw new Error(
            text.trim().slice(0, 80) || "No fue posible leer el historial mensual.",
          );
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "No fue posible cargar el grafico.");
        }
        if (controller.signal.aborted) return;
        setMonthly(payload.monthly ?? emptyMonthly());
        setTrendSource(payload.source ?? null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMonthly(emptyMonthly());
        setTrendSource("empty");
        setError(
          err instanceof Error ? err.message : "No fue posible cargar el grafico.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrendLoading(false);
      });
    return () => controller.abort();
  }, [apiBasePath, buckets, families, sedeOptions]);

  const sliced = useMemo(
    () => sliceGestionMonthlySedeSeries(monthly, validMonths),
    [monthly, validMonths],
  );

  const visibleSeries = useMemo(() => {
    const selected = new Set(sedeScopes);
    return sliced.series
      .filter((serie) => selected.has(serie.sedeKey))
      .map((serie) => ({
        ...serie,
        label: labelBySede[serie.sedeKey] ?? serie.label,
      }));
  }, [labelBySede, sedeScopes, sliced.series]);

  const chartValues = useMemo(
    () =>
      visibleSeries.map((serie) => ({
        ...serie,
        data:
          metric === "plata"
            ? serie.inventoryValue.map((value) => value / 1_000_000)
            : serie.inventoryUnits,
      })),
    [metric, visibleSeries],
  );

  const formatBarValue = (value: number | null) => {
    if (value == null || value === 0) return "";
    if (metric === "plata") {
      return `$ ${value.toLocaleString("es-CO", { maximumFractionDigits: 0 })} M`;
    }
    return value.toLocaleString("es-CO", { maximumFractionDigits: 0 });
  };

  const showChart = sliced.months.length > 0 && chartValues.length > 0;

  return (
    <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-slate-900">Resultado de gestion</CardTitle>
        <CardDescription>
          Totales mes a mes de inventario D+0+S (plata o unidades). Elige sedes
          y meses; cada sede queda en su propia barra, no se mezclan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_minmax(12rem,0.8fr)_auto]">
          <DiMultiSelect
            label="Sedes"
            values={validSedeKeys}
            options={sedeOptions}
            emptyLabel="Todas"
            searchable
            searchPlaceholder="Buscar sede..."
            onChange={setSelectedSedeKeys}
          />
          <DiMultiSelect
            label="Meses"
            values={validMonths}
            options={monthOptions}
            emptyLabel="Todos"
            searchable
            searchPlaceholder="Buscar mes..."
            onChange={setSelectedMonths}
            disabled={monthOptions.length === 0}
          />
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Ver
            <MiniToggle
              value={metric}
              options={[
                { id: "plata", label: "Plata" },
                { id: "unidades", label: "Unidades" },
              ]}
              onChange={(value) => setMetric(value as GestionMetric)}
            />
          </label>
        </div>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        {showChart ? (
          <div className="rounded-xl border border-slate-200 p-2">
            <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {metric === "plata"
                ? "Inventario comprometido por mes ($ millones)"
                : "Unidades comprometidas por mes"}
            </p>
            <p className="px-2 text-[11px] text-slate-500">
              Foto del ultimo corte semanal de cada mes. Varias sedes = barras
              agrupadas, no un total mezclado.
            </p>
            <BarChart
              height={360}
              margin={{ left: 8, right: 16, top: 28, bottom: 8 }}
              xAxis={[
                {
                  data: sliced.monthLabels,
                  scaleType: "band",
                  tickLabelStyle: {
                    fontSize: 11,
                    angle: -45,
                    textAnchor: "end",
                  },
                  height: 72,
                },
              ]}
              yAxis={[
                {
                  valueFormatter: (value: number | null) =>
                    value == null
                      ? ""
                      : value.toLocaleString("es-CO", {
                          maximumFractionDigits: 0,
                        }),
                },
              ]}
              series={chartValues.map((serie) => ({
                data: serie.data,
                label: serie.label,
                color: colorForSede(serie.sedeKey, sedeOptions),
                valueFormatter: (value: number | null) =>
                  value == null || value === 0 ? "—" : formatBarValue(value),
              }))}
              barLabel={
                chartValues.length > 4
                  ? undefined
                  : (item) =>
                      item.value == null || item.value === 0
                        ? null
                        : formatBarValue(Number(item.value))
              }
              grid={{ horizontal: true }}
            />
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            {loading || trendLoading
              ? "Cargando totales mes a mes..."
              : error
                ? "No hay grafico para mostrar."
                : trendSource === "empty"
                  ? "Aun no hay historial mensual. Hay que poblar el roll semanal en el servidor."
                  : validMonths.length > 0 && monthly.months.length > 0
                    ? "No hay datos en los meses seleccionados."
                    : sedeScopes.length === 0
                      ? "No hay sedes en el grafico."
                      : "Cargando totales mes a mes..."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
