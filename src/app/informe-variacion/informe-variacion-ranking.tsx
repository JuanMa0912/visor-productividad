"use client";

import { useMemo, type ReactNode } from "react";
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
  INFORME_RANKING_LIMITS,
  buildInformeEmpresaSummary,
  buildInformeRankingRows,
  type InformeRankingDimension,
  type InformeRankingSortCol,
  type InformeRankingTableSort,
} from "@/lib/informe-variacion/ranking";
import { stripInformeSedeDisplayName } from "@/lib/informe-variacion/labels";
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
  sort: InformeRankingTableSort;
  onSortChange: (sort: InformeRankingTableSort) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
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
  <span className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-200">
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

const SortableTh = ({
  children,
  align,
  active,
  dir,
  onClick,
  sticky = false,
  title,
}: {
  children: ReactNode;
  align: "left" | "right" | "center";
  active: boolean;
  dir: number;
  onClick: () => void;
  sticky?: boolean;
  title?: string;
}) => (
  <th
    className={cn(
      "cursor-pointer select-none px-2 py-2 font-semibold text-slate-600",
      align === "left" && "text-left",
      align === "right" && "text-right",
      align === "center" && "text-center",
      sticky && "sticky left-8 z-10 bg-white",
    )}
    title={title ?? "Clic para mayor/menor"}
    onClick={onClick}
  >
    {children}
    {active ? (dir > 0 ? " ▼" : " ▲") : ""}
  </th>
);

export function InformeRankingTable({
  payload,
  metric,
  onMetricChange,
  dimension,
  onDimensionChange,
  sort,
  onSortChange,
  limit,
  onLimitChange,
  mode: _mode,
  onModeChange: _onModeChange,
  pass,
}: RankingProps) {
  void _mode;
  void _onModeChange;
  const rows = useMemo(
    () =>
      buildInformeRankingRows({
        payload,
        metric,
        pass,
        dimension,
        sort,
        limit,
      }),
    [dimension, limit, metric, pass, payload, sort],
  );

  const toggleRankingSort = (col: InformeRankingSortCol) => {
    onSortChange({
      col,
      dir: sort.col === col ? sort.dir * -1 : 1,
    });
  };

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
          value={String(limit)}
          options={INFORME_RANKING_LIMITS.map((item) => ({
            id: String(item),
            label: `Top ${item}`,
          }))}
          onChange={(value) => onLimitChange(Number(value))}
        />
      </div>
      <p className="text-xs text-slate-500">
        Top {limit} por{" "}
        {INFORME_RANKING_DIMENSIONS.find((item) => item.id === dimension)?.label.toLowerCase()}{" "}
        × sede. Clic en una columna para mayor/menor. Las sedes van en el orden
        del portal, sin código al inicio. Categoría es el tipo comercial.
        Empresa (proveedor) sale del maestro. Los filtros de estructura de
        arriba aplican a este ranking.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left">#</th>
              <SortableTh
                sticky
                align="left"
                active={sort.col === "name"}
                dir={sort.dir}
                onClick={() => toggleRankingSort("name")}
              >
                Nombre
              </SortableTh>
              <SortableTh
                align="right"
                active={sort.col === "cur"}
                dir={sort.dir}
                onClick={() => toggleRankingSort("cur")}
              >
                Actual
              </SortableTh>
              <SortableTh
                align="right"
                active={sort.col === "var"}
                dir={sort.dir}
                onClick={() => toggleRankingSort("var")}
              >
                Var. %
              </SortableTh>
              <SortableTh
                align="right"
                active={sort.col === "prev"}
                dir={sort.dir}
                onClick={() => toggleRankingSort("prev")}
              >
                Anterior
              </SortableTh>
              {payload.sedes.map((sede, index) => (
                <SortableTh
                  key={sede.key}
                  align="center"
                  active={sort.col === index}
                  dir={sort.dir}
                  title={`${sede.e} — clic para mayor/menor`}
                  onClick={() => toggleRankingSort(index)}
                >
                  {stripInformeSedeDisplayName(sede.s)}
                </SortableTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${dimension}-${row.key}`} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white px-2 py-1.5 text-xs text-slate-400">
                  {index + 1}
                </td>
                <td className="sticky left-8 bg-white px-2 py-1.5 align-top font-medium text-slate-800">
                  <span className="block max-w-[14rem] whitespace-normal break-words">
                    {row.label}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatInformeValue(row.total[0], metric)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <VariationChip current={row.total[0]} previous={row.total[1]} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatInformeValue(row.total[1], metric)}
                </td>
                {row.perSede.map((values, sedeIndex) => {
                  const previous = values[1];
                  const pct = computeVariationPct(values[0], previous);
                  const style = heatmapCellStyle(pct, false);
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
                        {formatInformePct(pct)}
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
            <span className="text-slate-500">vs ant.</span>
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
