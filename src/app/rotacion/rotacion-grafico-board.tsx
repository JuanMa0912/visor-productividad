"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/shared/utils";
import type {
  AbcdConfig,
  DateRange,
  RotationRow,
} from "@/app/rotacion/rotacion-preamble";
import {
  formatPrice,
  formatPriceWithoutSixZeros,
  LINEA_N1_FAMILY_LABELS,
} from "@/app/rotacion/rotacion-preamble";
import { DiMultiSelect } from "@/app/analisis-de-inventario/di-multi-select";
import {
  tagRotacionCriticalRows,
  type RotacionCriticalDigestFamily,
} from "@/lib/rotacion/critical-digest";
import {
  buildRotacionChartItemOptions,
  buildRotacionChartStacks,
  filterTaggedRowsForChart,
  nextChartGroupBy,
  ROTACION_CHART_BUCKETS,
  ROTACION_CHART_SLICE_PRESETS,
  sumRotacionChartStacks,
  type RotacionChartFocus,
  type RotacionChartGroupBy,
  type RotacionChartMetric,
  type RotacionChartSlicePresetId,
} from "@/lib/rotacion/chart-series";

const GROUP_OPTIONS: Array<{ id: RotacionChartGroupBy; label: string }> = [
  { id: "sede", label: "Sedes" },
  { id: "linea", label: "Lineas" },
  { id: "sublinea", label: "Sublineas" },
  { id: "item", label: "Items" },
];

const METRIC_OPTIONS: Array<{ id: RotacionChartMetric; label: string }> = [
  { id: "items", label: "Cantidad" },
  { id: "inventario", label: "Inventario $" },
  { id: "unidades", label: "Unidades" },
];

const FAMILY_OPTIONS: Array<{
  id: RotacionCriticalDigestFamily | "ambas";
  label: string;
}> = [
  { id: "manufactura", label: LINEA_N1_FAMILY_LABELS.manufactura },
  { id: "perecederos", label: LINEA_N1_FAMILY_LABELS.perecederos },
  { id: "ambas", label: "Ambas" },
];

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

const formatMetric = (value: number, metric: RotacionChartMetric) => {
  if (metric === "inventario") return formatPrice(value);
  return value.toLocaleString("es-CO", { maximumFractionDigits: 0 });
};

const axisFormatter = (value: number | null, metric: RotacionChartMetric) => {
  if (value == null) return "";
  if (metric === "inventario") return formatPriceWithoutSixZeros(value);
  return value.toLocaleString("es-CO", { maximumFractionDigits: 0 });
};

type Props = {
  rows: RotationRow[];
  dateRange: DateRange;
  abcdConfig: AbcdConfig;
  loading?: boolean;
};

export function RotacionGraficoBoard({
  rows,
  dateRange,
  abcdConfig,
  loading = false,
}: Props) {
  const [groupBy, setGroupBy] = useState<RotacionChartGroupBy>("sede");
  const [metric, setMetric] = useState<RotacionChartMetric>("items");
  const [familyMode, setFamilyMode] = useState<
    RotacionCriticalDigestFamily | "ambas"
  >("manufactura");
  const [focusTrail, setFocusTrail] = useState<RotacionChartFocus[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [slicePreset, setSlicePreset] =
    useState<RotacionChartSlicePresetId>("todos");

  const families = useMemo<RotacionCriticalDigestFamily[]>(
    () => (familyMode === "ambas" ? ["manufactura", "perecederos"] : [familyMode]),
    [familyMode],
  );

  const sliceBuckets = useMemo(
    () =>
      ROTACION_CHART_SLICE_PRESETS.find((preset) => preset.id === slicePreset)
        ?.buckets ?? (["demandaD", "cero", "restock"] as const),
    [slicePreset],
  );

  const tagged = useMemo(
    () => tagRotacionCriticalRows(rows, dateRange, abcdConfig, families),
    [abcdConfig, dateRange, families, rows],
  );

  const scopedBeforeItems = useMemo(
    () => filterTaggedRowsForChart(tagged, families, focusTrail),
    [families, focusTrail, tagged],
  );

  const itemOptions = useMemo(
    () => buildRotacionChartItemOptions(scopedBeforeItems),
    [scopedBeforeItems],
  );

  const scoped = useMemo(
    () =>
      filterTaggedRowsForChart(tagged, families, focusTrail, {
        itemKeys: selectedItems,
        buckets: sliceBuckets,
      }),
    [families, focusTrail, selectedItems, sliceBuckets, tagged],
  );

  const visibleBuckets = useMemo(
    () =>
      ROTACION_CHART_BUCKETS.filter((bucket) =>
        sliceBuckets.includes(bucket.id),
      ),
    [sliceBuckets],
  );

  const stacks = useMemo(
    () =>
      buildRotacionChartStacks(
        scoped,
        groupBy,
        metric,
        groupBy === "sede" || selectedItems.length > 0 ? 0 : 18,
      ),
    [groupBy, metric, scoped, selectedItems.length],
  );

  const totals = useMemo(() => sumRotacionChartStacks(stacks), [stacks]);
  const nextGroup = nextChartGroupBy(groupBy);

  const resetDefault = () => {
    setGroupBy("sede");
    setMetric("items");
    setFamilyMode("manufactura");
    setFocusTrail([]);
    setSelectedItems([]);
    setSlicePreset("todos");
  };

  const drillInto = (row: (typeof stacks)[number]) => {
    if (row.key === "__otros__") return;
    const next = nextChartGroupBy(groupBy);
    if (!next) return;
    setFocusTrail((current) => [
      ...current,
      { groupBy, key: row.key, label: row.label },
    ]);
    setGroupBy(next);
    setSelectedItems([]);
  };

  const jumpToTrail = (index: number) => {
    const nextTrail = focusTrail.slice(0, index);
    setFocusTrail(nextTrail);
    if (nextTrail.length === 0) {
      setGroupBy("sede");
      return;
    }
    const last = nextTrail[nextTrail.length - 1]!;
    setGroupBy(nextChartGroupBy(last.groupBy) ?? "sede");
  };

  return (
    <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-slate-900">
              Grafico D + 0 + S
            </CardTitle>
            <CardDescription>
              Misma lectura del correo diario: criticos de manufactura por sede.
              Elige cortes (D, cero, restock; uno, dos o todos), busca y marca
              items, o agrupa por sede / linea / sublinea / item. Empresa y sede
              de arriba siguen filtrando este grafico.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetDefault}
            className="h-8 gap-1.5 rounded-lg text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Como el correo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Familia
            <MiniToggle
              value={familyMode}
              options={FAMILY_OPTIONS}
              onChange={(value) =>
                setFamilyMode(value as RotacionCriticalDigestFamily | "ambas")
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Agrupar
            <MiniToggle
              value={groupBy}
              options={GROUP_OPTIONS}
              onChange={(value) => {
                setGroupBy(value as RotacionChartGroupBy);
                setFocusTrail([]);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Ver
            <MiniToggle
              value={metric}
              options={METRIC_OPTIONS}
              onChange={(value) => setMetric(value as RotacionChartMetric)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Cortes
            <MiniToggle
              value={slicePreset}
              options={ROTACION_CHART_SLICE_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
              }))}
              onChange={(value) =>
                setSlicePreset(value as RotacionChartSlicePresetId)
              }
            />
          </label>
          <div className="min-w-[16rem] flex-1">
            <DiMultiSelect
              label="Items"
              values={selectedItems}
              options={itemOptions}
              emptyLabel="Todos"
              searchable
              searchPlaceholder="Buscar codigo o nombre..."
              onChange={(items) => {
                setSelectedItems(items);
                if (items.length > 0) setGroupBy("item");
              }}
            />
          </div>
        </div>

        {focusTrail.length > 0 ? (
          <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            <button
              type="button"
              className="font-semibold text-amber-800 hover:underline"
              onClick={() => jumpToTrail(0)}
            >
              Todas
            </button>
            {focusTrail.map((focus, index) => (
              <span key={`${focus.groupBy}-${focus.key}`} className="inline-flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <button
                  type="button"
                  className="font-semibold text-amber-800 hover:underline"
                  onClick={() => jumpToTrail(index + 1)}
                >
                  {focus.label}
                </button>
              </span>
            ))}
          </nav>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Criticos", value: totals.total, hint: visibleBuckets.map((b) => b.label).join(" + ") },
            ...visibleBuckets.map((bucket) => ({
              label: bucket.label,
              value: totals[bucket.id],
              hint: bucket.id === "demandaD"
                ? "Baja rotacion"
                : bucket.id === "cero"
                  ? "Sin salida"
                  : "Nuevos / restock",
            })),
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {card.label}
              </p>
              <p className="mt-1 text-lg font-black tabular-nums text-slate-900">
                {formatMetric(card.value, metric)}
              </p>
              <p className="text-[11px] text-slate-500">{card.hint}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Cargando sedes para el grafico...
          </p>
        ) : stacks.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No hay criticos D+0+S con los filtros actuales.
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
            <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2">
              <p className="px-2 pt-1 text-[11px] text-slate-500">
                {nextGroup
                  ? `Clic en una barra para ver ${GROUP_OPTIONS.find((option) => option.id === nextGroup)?.label.toLowerCase()}.`
                  : "Ultimo nivel: items."}
              </p>
              <BarChart
                layout="horizontal"
                height={Math.max(320, stacks.length * 34)}
                margin={{ left: 8, right: 16, top: 12, bottom: 8 }}
                yAxis={[
                  {
                    data: stacks.map((row) => row.label),
                    scaleType: "band",
                    width: groupBy === "item" ? 168 : 110,
                  },
                ]}
                xAxis={[
                  {
                    valueFormatter: (value: number | null) =>
                      axisFormatter(value, metric),
                  },
                ]}
                series={visibleBuckets.map((bucket) => ({
                  data: stacks.map((row) => row[bucket.id]),
                  label: bucket.label,
                  color: bucket.color,
                  stack: "criticos",
                  valueFormatter: (value: number | null) =>
                    value == null ? "—" : formatMetric(value, metric),
                }))}
                grid={{ vertical: true }}
                onItemClick={(_event, item) => {
                  const row = stacks[item.dataIndex];
                  if (row) drillInto(row);
                }}
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="text-sm font-bold text-slate-900">
                Mix {visibleBuckets.map((bucket) => bucket.label).join(" + ")}
              </h3>
              <p className="mb-2 text-[11px] text-slate-500">
                Participacion del alcance actual.
              </p>
              <PieChart
                height={260}
                series={[
                  {
                    innerRadius: 48,
                    outerRadius: 92,
                    paddingAngle: 2,
                    data: visibleBuckets.map((bucket) => ({
                      id: bucket.id,
                      value: totals[bucket.id],
                      label: bucket.label,
                      color: bucket.color,
                    })).filter((slice) => slice.value > 0),
                    valueFormatter: (item) => formatMetric(Number(item.value), metric),
                  },
                ]}
              />
            </div>
          </div>
        )}

        {stacks.length > 0 && !loading ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left">
                    {GROUP_OPTIONS.find((option) => option.id === groupBy)?.label}
                  </th>
                  {visibleBuckets.map((bucket) => (
                    <th key={bucket.id} className="px-3 py-2 text-right">
                      {bucket.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {stacks.map((row) => (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      {nextGroup && row.key !== "__otros__" ? (
                        <button
                          type="button"
                          className="text-left font-medium text-amber-800 hover:underline"
                          onClick={() => drillInto(row)}
                        >
                          {row.label}
                        </button>
                      ) : (
                        <span className="font-medium text-slate-800">{row.label}</span>
                      )}
                    </td>
                    {visibleBuckets.map((bucket) => (
                      <td
                        key={bucket.id}
                        className="px-3 py-1.5 text-right tabular-nums text-slate-700"
                      >
                        {formatMetric(row[bucket.id], metric)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                      {formatMetric(row.total, metric)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
