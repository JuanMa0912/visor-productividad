"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DiMultiSelect, type DiSelectOption } from "@/app/analisis-de-inventario/di-multi-select";
import {
  formatPrice,
  formatPriceWithoutSixZeros,
  formatRangeLabel,
  formatRotationOneDecimal,
  NO_SALES_DI_VALUE,
  type DateRange,
} from "@/app/rotacion/rotacion-preamble";
import { useRotacionViewConfig } from "@/app/rotacion/rotacion-view-config-provider";
import { cn } from "@/lib/shared/utils";
import type {
  RotacionCriticalBucket,
  RotacionCriticalDigestFamily,
  RotacionCriticalTaggedRow,
} from "@/lib/rotacion/critical-digest";
import { filterTaggedRowsForChart } from "@/lib/rotacion/chart-series";
import {
  buildRotacionGestionKpis,
  diffRotacionGestionKpis,
  previousCalendarMonthRange,
  type RotacionGestionKpis,
  type RotacionGestionMonthlySedeSeries,
} from "@/lib/rotacion/gestion-kpis";

type GestionMetric = "plata" | "unidades";

type Props = {
  tagged: RotacionCriticalTaggedRow[];
  dateRange: DateRange;
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

const emptyKpis = (): RotacionGestionKpis => ({
  itemCount: 0,
  inventoryValue: 0,
  inventoryUnits: 0,
  diasInventario: 0,
  daysConsulted: 0,
});

const emptyMonthly = (): RotacionGestionMonthlySedeSeries => ({
  months: [],
  monthLabels: [],
  series: [],
});

const formatDias = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return formatRotationOneDecimal(value);
};

const formatItems = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 0 });

const formatSignedMillions = (value: number) => {
  const abs = formatPriceWithoutSixZeros(Math.abs(value));
  if (value > 0) return abs;
  if (value < 0) return `+${abs}`;
  return abs;
};

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
  tagged,
  dateRange,
  families,
  buckets,
  sedeOptions,
  loading = false,
}: Props) {
  const { apiBasePath } = useRotacionViewConfig();
  const [selectedSedeKeys, setSelectedSedeKeys] = useState<string[]>([]);
  const [metric, setMetric] = useState<GestionMetric>("plata");
  const [beforeRange, setBeforeRange] = useState<DateRange>({
    start: "",
    end: "",
  });
  const [afterRange, setAfterRange] = useState<DateRange>(dateRange);
  const [afterLockedToBoard, setAfterLockedToBoard] = useState(true);
  const [beforeKpis, setBeforeKpis] = useState<RotacionGestionKpis | null>(null);
  const [afterRemoteKpis, setAfterRemoteKpis] =
    useState<RotacionGestionKpis | null>(null);
  const [monthly, setMonthly] = useState<RotacionGestionMonthlySedeSeries>(
    emptyMonthly(),
  );
  const [trendSource, setTrendSource] = useState<"roll" | "empty" | null>(null);
  const [beforeLoading, setBeforeLoading] = useState(false);
  const [afterLoading, setAfterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sedeScopes = useMemo(
    () =>
      selectedSedeKeys.length > 0
        ? selectedSedeKeys
        : sedeOptions.map((option) => option.value),
    [sedeOptions, selectedSedeKeys],
  );

  const labelBySede = useMemo(
    () => Object.fromEntries(sedeOptions.map((option) => [option.value, option.label])),
    [sedeOptions],
  );

  useEffect(() => {
    setSelectedSedeKeys((current) =>
      current.filter((key) => sedeOptions.some((option) => option.value === key)),
    );
  }, [sedeOptions]);

  useEffect(() => {
    if (!dateRange.start) return;
    setBeforeRange((current) => {
      if (current.start && current.end) return current;
      return previousCalendarMonthRange(dateRange.start);
    });
  }, [dateRange.start]);

  useEffect(() => {
    if (!afterLockedToBoard) return;
    setAfterRange(dateRange);
  }, [afterLockedToBoard, dateRange]);

  const taggedForKpis = useMemo(
    () =>
      filterTaggedRowsForChart(tagged, families, [], {
        sedeKeys: selectedSedeKeys,
        buckets,
      }),
    [buckets, families, selectedSedeKeys, tagged],
  );

  const afterLocal = useMemo(
    () => buildRotacionGestionKpis(taggedForKpis, dateRange),
    [dateRange, taggedForKpis],
  );

  const useLocalAfter =
    afterLockedToBoard ||
    (afterRange.start === dateRange.start && afterRange.end === dateRange.end);

  const afterKpis = useLocalAfter ? afterLocal : (afterRemoteKpis ?? emptyKpis());

  const fetchKpis = async (range: DateRange, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    params.set("start", range.start);
    params.set("end", range.end);
    families.forEach((family) => params.append("family", family));
    buckets.forEach((bucket) => params.append("buckets", bucket));
    sedeScopes.forEach((scope) => params.append("sedeScope", scope));
    const response = await fetch(`${apiBasePath}/gestion?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    const payload = (await response.json()) as {
      kpis?: RotacionGestionKpis;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible comparar el periodo.");
    }
    if (!payload.kpis) throw new Error("Respuesta de gestion vacia.");
    return payload.kpis;
  };

  useEffect(() => {
    if (!beforeRange.start || !beforeRange.end || sedeScopes.length === 0) {
      return;
    }
    const controller = new AbortController();
    setBeforeLoading(true);
    setError(null);
    void fetchKpis(beforeRange, controller.signal)
      .then((kpis) => {
        if (controller.signal.aborted) return;
        setBeforeKpis(kpis);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error en periodo anterior.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBeforeLoading(false);
      });
    return () => controller.abort();
    // fetchKpis is recreated each render; the explicit inputs are enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiBasePath,
    beforeRange.end,
    beforeRange.start,
    buckets,
    families,
    sedeScopes,
  ]);

  useEffect(() => {
    if (useLocalAfter) {
      setAfterRemoteKpis(null);
      return;
    }
    if (!afterRange.start || !afterRange.end || sedeScopes.length === 0) return;
    const controller = new AbortController();
    setAfterLoading(true);
    setError(null);
    void fetchKpis(afterRange, controller.signal)
      .then((kpis) => {
        if (controller.signal.aborted) return;
        setAfterRemoteKpis(kpis);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error en periodo actual.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAfterLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    afterRange.end,
    afterRange.start,
    apiBasePath,
    buckets,
    families,
    sedeScopes,
    useLocalAfter,
  ]);

  useEffect(() => {
    const allScopes = sedeOptions.map((option) => option.value);
    if (allScopes.length === 0) return;
    const params = new URLSearchParams({ mode: "trend" });
    families.forEach((family) => params.append("family", family));
    buckets.forEach((bucket) => params.append("buckets", bucket));
    allScopes.forEach((scope) => params.append("sedeScope", scope));
    const controller = new AbortController();
    void fetch(`${apiBasePath}/gestion?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          monthly?: RotacionGestionMonthlySedeSeries;
          source?: "roll" | "empty";
        };
        if (controller.signal.aborted || !response.ok) return;
        setMonthly(payload.monthly ?? emptyMonthly());
        setTrendSource(payload.source ?? null);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setMonthly(emptyMonthly());
        setTrendSource("empty");
      });
    return () => controller.abort();
  }, [apiBasePath, buckets, families, sedeOptions]);

  const diff =
    beforeKpis && afterKpis
      ? diffRotacionGestionKpis(beforeKpis, afterKpis)
      : null;

  const visibleSeries = useMemo(() => {
    const selected = new Set(sedeScopes);
    return monthly.series
      .filter((serie) => selected.has(serie.sedeKey))
      .map((serie) => ({
        ...serie,
        label: labelBySede[serie.sedeKey] ?? serie.label,
      }));
  }, [labelBySede, monthly.series, sedeScopes]);

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

  const busy = loading || beforeLoading || afterLoading;

  return (
    <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-slate-900">Resultado de gestion</CardTitle>
        <CardDescription>
          Totales mes a mes de inventario D+0+S (plata o unidades). Cada sede
          queda en su propia barra; no se mezclan. Las tarjetas Antes/Ahora si
          suman el alcance seleccionado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_auto_auto]">
          <DiMultiSelect
            label="Sedes (este grafico)"
            values={selectedSedeKeys}
            options={sedeOptions}
            emptyLabel="Todas"
            searchable
            searchPlaceholder="Buscar sede..."
            onChange={setSelectedSedeKeys}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Antes
            <span className="flex gap-2">
              <input
                type="date"
                value={beforeRange.start}
                onChange={(event) =>
                  setBeforeRange((current) => ({
                    ...current,
                    start: event.target.value,
                  }))
                }
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"
              />
              <input
                type="date"
                value={beforeRange.end}
                onChange={(event) =>
                  setBeforeRange((current) => ({
                    ...current,
                    end: event.target.value,
                  }))
                }
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Ahora
            <span className="flex gap-2">
              <input
                type="date"
                value={afterRange.start}
                onChange={(event) => {
                  setAfterLockedToBoard(false);
                  setAfterRange((current) => ({
                    ...current,
                    start: event.target.value,
                  }));
                }}
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"
              />
              <input
                type="date"
                value={afterRange.end}
                onChange={(event) => {
                  setAfterLockedToBoard(false);
                  setAfterRange((current) => ({
                    ...current,
                    end: event.target.value,
                  }));
                }}
                className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-xs text-slate-800"
              />
            </span>
          </label>
        </div>

        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : null}

        {diff ? (
          <div
            className={`rounded-2xl border px-4 py-3 ${
              diff.liberatedValue >= 0
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Capital liberado
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
              {formatSignedMillions(diff.liberatedValue)}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {formatRangeLabel(beforeRange)}:{" "}
              {formatPrice(diff.before.inventoryValue)} →{" "}
              {formatRangeLabel(afterRange)}:{" "}
              {formatPrice(diff.after.inventoryValue)}.
              {diff.liberatedValue >= 0
                ? " Eso es inventario que ya no esta parado."
                : " El inventario comprometido subio."}
            </p>
          </div>
        ) : (
          <p className="py-4 text-sm text-slate-500">
            {busy
              ? "Calculando el periodo anterior..."
              : "Elige dos rangos para ver la gestion."}
          </p>
        )}

        {diff ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "Dias de inventario",
                before: formatDias(diff.before.diasInventario),
                after: formatDias(diff.after.diasInventario),
              },
              {
                label: "Items",
                before: formatItems(diff.before.itemCount),
                after: formatItems(diff.after.itemCount),
              },
              {
                label: "Inventario $",
                before: formatPrice(diff.before.inventoryValue),
                after: formatPrice(diff.after.inventoryValue),
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {card.label}
                </p>
                <p className="mt-1 text-sm text-slate-500">{card.before}</p>
                <p className="text-lg font-black tabular-nums text-slate-900">
                  {card.after}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {monthly.months.length > 0 && chartValues.length > 0 ? (
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
                  data: monthly.monthLabels,
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
            {trendSource === "empty"
              ? "Aun no hay historial mensual. Hay que poblar el roll semanal en el servidor."
              : sedeScopes.length === 0
                ? "No hay sedes en el grafico."
                : "Cargando totales mes a mes..."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
