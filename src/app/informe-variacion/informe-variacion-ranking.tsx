"use client";

import { useMemo } from "react";
import {
  aggregateBySede,
  type prepareInformeData,
} from "@/lib/informe-variacion/aggregate";
import {
  computeVariationPct,
  formatInformePct,
  formatInformeValue,
  heatmapCellStyle,
} from "@/lib/informe-variacion/format";
import {
  INFORME_RANKING_DIMENSIONS,
  buildInformeEmpresaSummary,
  buildInformeRankingRows,
  type InformeRankingDimension,
  type InformeRankingSort,
} from "@/lib/informe-variacion/ranking";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import { cn } from "@/lib/shared/utils";
import { VariationChip } from "@/app/informe-variacion/informe-variacion-chips";

type Prepared = ReturnType<typeof prepareInformeData>;

type RankingProps = {
  payload: Prepared;
  metric: InformeMetric;
  onMetricChange: (metric: InformeMetric) => void;
  dimension: InformeRankingDimension;
  onDimensionChange: (dimension: InformeRankingDimension) => void;
  sort: InformeRankingSort;
  onSortChange: (sort: InformeRankingSort) => void;
  mode: "yoy" | "mom";
  onModeChange: (mode: "yoy" | "mom") => void;
  pass: (row: Prepared["rows"][number]) => boolean;
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
  <span className="inline-flex overflow-hidden rounded-lg border border-slate-200">
    {options.map((option) => (
      <button
        key={option.id}
        type="button"
        onClick={() => onChange(option.id)}
        className={cn(
          "px-3 py-1 text-xs font-semibold",
          value === option.id ? "bg-blue-600 text-white" : "bg-white text-slate-500",
        )}
      >
        {option.label}
      </button>
    ))}
  </span>
);

export function InformeRankingTable({
  payload,
  metric,
  onMetricChange,
  dimension,
  onDimensionChange,
  sort,
  onSortChange,
  mode,
  onModeChange,
  pass,
}: RankingProps) {
  const rows = useMemo(
    () =>
      buildInformeRankingRows({
        payload,
        metric,
        pass,
        dimension,
        sort,
        limit: 20,
      }),
    [dimension, metric, pass, payload, sort],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MiniToggle
          value={dimension}
          options={INFORME_RANKING_DIMENSIONS.map((item) => ({
            id: item.id,
            label: item.label,
          }))}
          onChange={(value) => onDimensionChange(value as InformeRankingDimension)}
        />
        <MiniToggle
          value={metric}
          options={[
            { id: "u", label: "Unidades" },
            { id: "v", label: "Valor $" },
          ]}
          onChange={(value) => onMetricChange(value as InformeMetric)}
        />
        <MiniToggle
          value={sort}
          options={[
            { id: "cur", label: "Actual" },
            { id: "yoy", label: "YoY" },
            { id: "mom", label: "Anterior" },
          ]}
          onChange={(value) => onSortChange(value as InformeRankingSort)}
        />
        <MiniToggle
          value={mode}
          options={[
            { id: "yoy", label: "Heatmap YoY" },
            { id: "mom", label: "Heatmap anterior" },
          ]}
          onChange={(value) => onModeChange(value as "yoy" | "mom")}
        />
      </div>
      <p className="text-xs text-slate-500">
        Top 20 por {INFORME_RANKING_DIMENSIONS.find((item) => item.id === dimension)?.label.toLowerCase()}{" "}
        × sede. Categoría es la categoría comercial del ítem. Proveedor sale del
        maestro de ficha (proveedor_item). Los filtros de categoría y proveedor de
        arriba aplican a este ranking y al resto de secciones.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left">#</th>
              <th className="sticky left-8 z-10 bg-white px-2 py-2 text-left">Nombre</th>
              <th className="px-2 py-2 text-right">Actual</th>
              <th className="px-2 py-2 text-right">YoY</th>
              <th className="px-2 py-2 text-right">Anterior</th>
              {payload.sedes.map((sede) => (
                <th key={sede.key} className="px-1 py-2 text-center font-semibold text-slate-600">
                  {sede.s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${dimension}-${row.key}`} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white px-2 py-1.5 text-xs text-slate-400">
                  {index + 1}
                </td>
                <td className="sticky left-8 max-w-[14rem] truncate bg-white px-2 py-1.5 font-medium text-slate-800">
                  {row.label}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatInformeValue(row.total[0], metric)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <VariationChip current={row.total[0]} previous={row.total[2]} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <VariationChip current={row.total[0]} previous={row.total[1]} />
                </td>
                {row.perSede.map((values, sedeIndex) => {
                  const previous = mode === "mom" ? values[1] : values[2];
                  const nd = mode === "yoy" && !payload.sedeYoy[sedeIndex];
                  const pct = nd ? null : computeVariationPct(values[0], previous);
                  const style = heatmapCellStyle(pct, nd);
                  return (
                    <td
                      key={sedeIndex}
                      className="px-1 py-1 text-center text-[11px] tabular-nums"
                      style={style}
                    >
                      <div className="font-semibold">
                        {formatInformeValue(values[0], metric)}
                      </div>
                      <div className="opacity-90">
                        {nd ? "N/D" : formatInformePct(pct)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5 + payload.sedes.length} className="px-3 py-6 text-center text-sm text-slate-500">
                  No hay filas para el ranking con los filtros actuales.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function InformeEmpresaSummaryCards({
  payload,
  metric,
  pass,
}: {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
}) {
  const perSede = useMemo(
    () =>
      aggregateBySede(
        payload.rows,
        metric,
        payload.sedes.length,
        pass,
        payload.metricCtx,
        { floorCompletePollosUnd: true },
      ),
    [metric, pass, payload.metricCtx, payload.rows, payload.sedes.length],
  );
  const rows = useMemo(
    () => buildInformeEmpresaSummary({ payload, perSede }),
    [payload, perSede],
  );

  if (rows.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => (
        <div
          key={row.label}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {row.label}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
            {formatInformeValue(row.total[0], metric)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">YoY</span>
            <VariationChip
              current={row.total[0]}
              previous={row.total[2]}
              yoyOk={row.yoyOk}
            />
            <span className="text-slate-500">Ant.</span>
            <VariationChip current={row.total[0]} previous={row.total[1]} />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
              {(row.share * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
