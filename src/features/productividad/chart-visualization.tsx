"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { LineChart } from "@mui/x-charts/LineChart";
import {
  ChartsTooltipContainer,
  ChartsTooltipPaper,
  ChartsTooltipTable,
  ChartsTooltipRow,
  ChartsTooltipCell,
  useAxesTooltip,
} from "@mui/x-charts/ChartsTooltip";
import type { ChartsTooltipProps } from "@mui/x-charts/ChartsTooltip";
import { ChartsLabelMark } from "@mui/x-charts/ChartsLabel";
import type { XAxis, YAxis } from "@mui/x-charts/models";
import type { LineSeries } from "@mui/x-charts/LineChart";
import type { MarkPlotProps, LinePlotProps } from "@mui/x-charts/LineChart";
import { hasLaborDataForLine } from "@/lib/shared/calc";
import {
  escapeCsvValue,
  sanitizeExportText,
} from "@/lib/shared/export-utils";
import type { Sede } from "@/lib/shared/constants";
import type { DailyProductivity, LineMetrics } from "@/types";
import type { DateRange, ViewExportHandle } from "./types";
import { clampChartDateRange, parseDateKey } from "./date-utils";
import { sortSedesByOrder } from "./sede-utils";

const loadExcelJs = () => import("exceljs");

const HighlightContext = createContext<{
  clicked: string | null;
  hovered: string | null;
}>({ clicked: null, hovered: null });

const SortedAxisTooltipContent = () => {
  const { clicked: clickedSid, hovered: hoveredSid } =
    useContext(HighlightContext);
  const tooltipData = useAxesTooltip();

  if (tooltipData === null) return null;

  return (
    <ChartsTooltipPaper>
      {tooltipData.map(
        ({ axisId, axisFormattedValue, seriesItems, mainAxis }) => {
          const sorted = [...seriesItems].sort((a, b) => {
            const aVal = typeof a.value === "number" ? a.value : 0;
            const bVal = typeof b.value === "number" ? b.value : 0;
            return bVal - aVal;
          });

          return (
            <ChartsTooltipTable key={axisId}>
              {!mainAxis.hideTooltip && (
                <caption
                  style={{
                    textAlign: "start",
                    padding: "4px 8px",
                    fontWeight: 600,
                    fontSize: "0.75rem",
                  }}
                >
                  {axisFormattedValue}
                </caption>
              )}
              <tbody>
                {sorted.map(
                  ({
                    seriesId,
                    color,
                    formattedValue,
                    formattedLabel,
                    markType,
                  }) => {
                    if (formattedValue == null) return null;
                    const sid = String(seriesId);
                    const isClicked = clickedSid === sid;
                    const isFadedByClick =
                      clickedSid != null && !isClicked;
                    const isHovered = hoveredSid === sid;
                    return (
                      <ChartsTooltipRow
                        key={seriesId}
                        style={{
                          opacity: isFadedByClick ? 0.35 : 1,
                          fontWeight: isClicked ? 700 : 400,
                          transition: "opacity 0.2s",
                        }}
                      >
                        <ChartsTooltipCell component="th">
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <ChartsLabelMark type={markType} color={color} />
                            <span
                              style={{
                                textDecoration: isHovered
                                  ? "underline"
                                  : "none",
                                textUnderlineOffset: 2,
                              }}
                            >
                              {formattedLabel || null}
                            </span>
                          </div>
                        </ChartsTooltipCell>
                        <ChartsTooltipCell component="td">
                          <span
                            style={{
                              textDecoration: isHovered
                                ? "underline"
                                : "none",
                              textUnderlineOffset: 2,
                            }}
                          >
                            {formattedValue}
                          </span>
                        </ChartsTooltipCell>
                      </ChartsTooltipRow>
                    );
                  },
                )}
              </tbody>
            </ChartsTooltipTable>
          );
        },
      )}
    </ChartsTooltipPaper>
  );
};

const CustomChartTooltip = (props: ChartsTooltipProps) => (
  <ChartsTooltipContainer {...props}>
    <SortedAxisTooltipContent />
  </ChartsTooltipContainer>
);

/** Max series drawn at once by default; exports still include full selection. */
const CHART_DISPLAY_TOP_N = 8;

export type ChartVisualizationProps = {
  dailyDataSet: DailyProductivity[];
  selectedSedeIds: string[];
  availableDates: string[];
  dateRange: DateRange;
  lines: LineMetrics[];
  sedes: Sede[];
};

export const ChartVisualization = forwardRef<ViewExportHandle, ChartVisualizationProps>(({
  dailyDataSet,
  selectedSedeIds,
  availableDates,
  dateRange,
  lines,
  sedes,
}, ref) => {
  const [selectedSeriesState, setSelectedSeriesState] = useState<string[]>([]);
  const [selectedChartSedesState, setSelectedChartSedesState] = useState<string[]>([]);
  const [chartRangeDraft, setChartRangeDraft] = useState(() => {
    const initialRange = clampChartDateRange(dateRange);
    return {
      sourceStart: dateRange.start,
      sourceEnd: dateRange.end,
      start: initialRange.start,
      end: initialRange.end,
    };
  });
  const [clickedSeriesId, setClickedSeriesId] = useState<string | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{
    seriesId: string | number;
    dataIndex?: number;
  } | null>(null);
  const [showAllChartSeries, setShowAllChartSeries] = useState(false);
  const [lineLegendSearch, setLineLegendSearch] = useState("");
  const [sedeLegendSearch, setSedeLegendSearch] = useState("");

  const sedeOptions = useMemo(() => sortSedesByOrder(sedes ?? []), [sedes]);
  const sedeOptionIds = useMemo(
    () => new Set(sedeOptions.map((sede) => sede.id)),
    [sedeOptions],
  );
  const selectedChartSedes = useMemo(
    () =>
      selectedChartSedesState.filter((sedeId) => sedeOptionIds.has(sedeId)),
    [selectedChartSedesState, sedeOptionIds],
  );
  const defaultChartRange = useMemo(
    () => clampChartDateRange(dateRange),
    [dateRange],
  );
  const chartRangeMatchesSource =
    chartRangeDraft.sourceStart === dateRange.start &&
    chartRangeDraft.sourceEnd === dateRange.end;
  const chartStartDate = chartRangeMatchesSource
    ? chartRangeDraft.start
    : defaultChartRange.start;
  const chartEndDate = chartRangeMatchesSource
    ? chartRangeDraft.end
    : defaultChartRange.end;

  const chartDates = useMemo<string[]>(() => {
    if (!chartStartDate || !chartEndDate) {
      return availableDates;
    }
    return availableDates.filter(
      (date) => date >= chartStartDate && date <= chartEndDate,
    );
  }, [availableDates, chartStartDate, chartEndDate]);

  const globalRangeDates = useMemo(
    () =>
      availableDates.filter(
        (d) => d >= dateRange.start && d <= dateRange.end,
      ),
    [availableDates, dateRange.start, dateRange.end],
  );

  const chartRangeBounds = useMemo(() => {
    if (globalRangeDates.length === 0) return { min: "", max: "" };
    const sorted = [...globalRangeDates].sort();
    return { min: sorted[0], max: sorted[sorted.length - 1] };
  }, [globalRangeDates]);

  const lineOptions = useMemo(
    () =>
      lines.map((line) => ({
        id: line.id,
        name: line.name,
      })),
    [lines],
  );
  const lineLegendQuery = lineLegendSearch.trim().toLowerCase();
  const filteredLineOptions = useMemo(() => {
    if (!lineLegendQuery) return lineOptions;
    return lineOptions.filter((line) =>
      line.name.toLowerCase().includes(lineLegendQuery),
    );
  }, [lineLegendQuery, lineOptions]);
  const sedeLegendQuery = sedeLegendSearch.trim().toLowerCase();
  const filteredSedeOptions = useMemo(() => {
    if (!sedeLegendQuery) return sedeOptions;
    return sedeOptions.filter((sede) =>
      sede.name.toLowerCase().includes(sedeLegendQuery),
    );
  }, [sedeLegendQuery, sedeOptions]);
  const lineOptionIds = useMemo(
    () => new Set(lineOptions.map((line) => line.id)),
    [lineOptions],
  );
  const selectedSeries = useMemo(
    () => selectedSeriesState.filter((lineId) => lineOptionIds.has(lineId)),
    [lineOptionIds, selectedSeriesState],
  );

  const effectiveSedes = useMemo(
    () =>
      selectedChartSedes.length > 0 ? selectedChartSedes : selectedSedeIds,
    [selectedChartSedes, selectedSedeIds],
  );
  const selectedSedeIdSet = useMemo(
    () => new Set(effectiveSedes),
    [effectiveSedes],
  );

  const sedeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    sedes.forEach((sede) => map.set(sede.id, sede.name));
    return map;
  }, [sedes]);

  const handleChartStartChange = useCallback(
    (value: string) => {
      const nextEnd = value > chartEndDate ? value : chartEndDate;
      setChartRangeDraft({
        sourceStart: dateRange.start,
        sourceEnd: dateRange.end,
        start: value,
        end: nextEnd,
      });
    },
    [chartEndDate, dateRange.end, dateRange.start],
  );

  const handleChartEndChange = useCallback(
    (value: string) => {
      const nextStart = value < chartStartDate ? value : chartStartDate;
      setChartRangeDraft({
        sourceStart: dateRange.start,
        sourceEnd: dateRange.end,
        start: nextStart,
        end: value,
      });
    },
    [chartStartDate, dateRange.end, dateRange.start],
  );

  const seriesDefinitions = useMemo(() => {
    if (selectedSeries.length === 0 || effectiveSedes.length === 0) {
      return [] as Array<{
        id: string;
        lineId: string;
        sedeId: string;
        label: string;
      }>;
    }
    return selectedSeries.flatMap((lineId) =>
      effectiveSedes.map((sedeId) => ({
        id: `${sedeId}::${lineId}`,
        lineId,
        sedeId,
        label: `${sedeNameMap.get(sedeId) ?? sedeId} ${
          lineOptions.find((line) => line.id === lineId)?.name ?? lineId
        }`,
      })),
    );
  }, [effectiveSedes, lineOptions, selectedSeries, sedeNameMap]);

  const seriesMap = useMemo(() => {
    const map = new Map<string, number[]>();
    const dailyByDate = new Map<string, DailyProductivity[]>();

    chartDates.forEach((date) => {
      const dayData = dailyDataSet.filter(
        (item) => selectedSedeIdSet.has(item.sede) && item.date === date,
      );
      dailyByDate.set(date, dayData);
    });

    seriesDefinitions.forEach(({ id, lineId, sedeId }) => {
      const data = chartDates.map((date) => {
        const dayData = (dailyByDate.get(date) ?? []).filter(
          (item) => item.sede === sedeId,
        );
        const totals = dayData.reduce(
          (acc, item) => {
            const lineData = item.lines.find((line) => line.id === lineId);
            if (!lineData) return acc;

            const hasLaborData = hasLaborDataForLine(lineData.id);
            const hours = hasLaborData ? lineData.hours : 0;

            return {
              sales: acc.sales + lineData.sales,
              hours: acc.hours + hours,
            };
          },
          { sales: 0, hours: 0 },
        );

        return totals.hours > 0 ? totals.sales / 1_000_000 / totals.hours : 0;
      });

      map.set(id, data);
    });

    return map;
  }, [chartDates, dailyDataSet, selectedSedeIdSet, seriesDefinitions]);

  const seriesMeanVtaHr = useMemo(() => {
    const m = new Map<string, number>();
    seriesDefinitions.forEach((def) => {
      const arr = seriesMap.get(def.id);
      if (!arr?.length) {
        m.set(def.id, 0);
        return;
      }
      let sum = 0;
      let n = 0;
      for (const v of arr) {
        if (typeof v === "number" && Number.isFinite(v)) {
          sum += v;
          n += 1;
        }
      }
      m.set(def.id, n > 0 ? sum / n : 0);
    });
    return m;
  }, [seriesDefinitions, seriesMap]);

  const rankedSeriesDefinitions = useMemo(
    () =>
      [...seriesDefinitions].sort((a, b) => {
        const mb = seriesMeanVtaHr.get(b.id) ?? 0;
        const ma = seriesMeanVtaHr.get(a.id) ?? 0;
        return mb - ma;
      }),
    [seriesDefinitions, seriesMeanVtaHr],
  );

  const canShowAllChartSeries =
    seriesDefinitions.length > CHART_DISPLAY_TOP_N;
  const effectiveShowAllChartSeries =
    canShowAllChartSeries && showAllChartSeries;

  const chartDisplaySeriesDefinitions = useMemo(() => {
    if (!canShowAllChartSeries || effectiveShowAllChartSeries) {
      return seriesDefinitions;
    }
    return rankedSeriesDefinitions.slice(0, CHART_DISPLAY_TOP_N);
  }, [
    canShowAllChartSeries,
    effectiveShowAllChartSeries,
    rankedSeriesDefinitions,
    seriesDefinitions,
  ]);

  const activeClickedSeriesId = useMemo(() => {
    if (clickedSeriesId === null) return null;
    if (!seriesDefinitions.some((series) => series.id === clickedSeriesId)) {
      return null;
    }
    const visible = new Set(
      chartDisplaySeriesDefinitions.map((series) => series.id),
    );
    return visible.has(clickedSeriesId) ? clickedSeriesId : null;
  }, [chartDisplaySeriesDefinitions, clickedSeriesId, seriesDefinitions]);

  const hoveredSeriesId = hoveredItem ? String(hoveredItem.seriesId) : null;

  const effectiveHighlight = useMemo(
    () =>
      activeClickedSeriesId != null
        ? { seriesId: activeClickedSeriesId }
        : hoveredItem,
    [activeClickedSeriesId, hoveredItem],
  );

  const highlightCtx = useMemo(
    () => ({ clicked: activeClickedSeriesId, hovered: hoveredSeriesId }),
    [activeClickedSeriesId, hoveredSeriesId],
  );

  const chartDataset = useMemo(() => {
    return chartDates.map((date, index) => {
      const row: Record<string, number | string | null> = { date };
      chartDisplaySeriesDefinitions.forEach((series) => {
        const data = seriesMap.get(series.id);
        row[series.id] = data ? data[index] : null;
      });
      return row;
    });
  }, [chartDates, chartDisplaySeriesDefinitions, seriesMap]);
  const chartAxisLabel = useMemo(() => {
    if (chartDates.length === 0) return "";
    const first = parseDateKey(chartDates[0]);
    const last = parseDateKey(chartDates[chartDates.length - 1]);
    const fmtMonth = new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
    });
    const firstLabel = fmtMonth.format(first);
    const lastLabel = fmtMonth.format(last);
    return firstLabel === lastLabel
      ? firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1)
      : `${firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1)} – ${lastLabel}`;
  }, [chartDates]);

  const handleExportChartCsv = useCallback(() => {
    if (chartDates.length === 0 || seriesDefinitions.length === 0) return false;
    const header = ["Fecha", ...seriesDefinitions.map((s) => s.label)];
    const rows = chartDates.map((date, index) => [
      date,
      ...seriesDefinitions.map((series) => {
        const value = seriesMap.get(series.id)?.[index];
        return value == null ? "" : value.toFixed(3);
      }),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsvValue).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `grafico-productividad-${chartStartDate || "sin-fecha"}-${chartEndDate || "sin-fecha"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }, [chartDates, chartEndDate, chartStartDate, seriesDefinitions, seriesMap]);

  const handleExportChartXlsx = useCallback(async () => {
    if (chartDates.length === 0 || seriesDefinitions.length === 0) return false;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Grafico productividad");
    sheet.columns = [
      { key: "date", width: 14 },
      ...seriesDefinitions.map(() => ({ key: "series", width: 18 })),
    ];
    sheet.addRow([
      "Fecha",
      ...seriesDefinitions.map((s) => sanitizeExportText(s.label)),
    ]);
    chartDates.forEach((date, index) => {
      sheet.addRow([
        sanitizeExportText(date),
        ...seriesDefinitions.map((series) => {
          const value = seriesMap.get(series.id)?.[index];
          return value == null ? null : Number(value.toFixed(3));
        }),
      ]);
    });
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `grafico-productividad-${chartStartDate || "sin-fecha"}-${chartEndDate || "sin-fecha"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }, [chartDates, chartEndDate, chartStartDate, seriesDefinitions, seriesMap]);

  useImperativeHandle(
    ref,
    () => ({
      exportCsv: handleExportChartCsv,
      exportXlsx: handleExportChartXlsx,
    }),
    [handleExportChartCsv, handleExportChartXlsx],
  );

  const xAxis = useMemo<XAxis<"point", string>[]>(
    () => [
      {
        dataKey: "date",
        scaleType: "point",
        label: chartAxisLabel,
        valueFormatter: (value: string) => value.slice(8),
      },
    ],
    [chartAxisLabel],
  );

  const yAxis = useMemo<YAxis<"linear", number>[]>(
    () => [{ label: "Vta/Hr" }],
    [],
  );

  const chartSeries = useMemo<LineSeries[]>(
    () =>
      chartDisplaySeriesDefinitions.map((series) => ({
        type: "line",
        dataKey: series.id,
        label: series.label,
        showMark: true,
        curve: "linear",
        valueFormatter: (value: number | null) => `${(value ?? 0).toFixed(3)}`,
        highlightScope: { highlight: "series" as const, fade: "global" as const },
      })),
    [chartDisplaySeriesDefinitions],
  );

  const handleToggleSeries = (lineId: string) => {
    setSelectedSeriesState((prev) =>
      prev.includes(lineId)
        ? prev.filter((id) => id !== lineId)
        : [...prev, lineId],
    );
  };

  const handleToggleSede = (sedeId: string) => {
    setSelectedChartSedesState((prev) =>
      prev.includes(sedeId)
        ? prev.filter((id) => id !== sedeId)
        : [...prev, sedeId],
    );
  };

  const handleMarkClick = useCallback<
    NonNullable<MarkPlotProps["onItemClick"]>
  >((event, identifier) => {
    event.stopPropagation();
    const sid = String(identifier.seriesId);
    setClickedSeriesId((prev) => (prev === sid ? null : sid));
  }, []);

  const handleLineClick = useCallback<
    NonNullable<LinePlotProps["onItemClick"]>
  >((event, identifier) => {
    event.stopPropagation();
    const sid = String(identifier.seriesId);
    setClickedSeriesId((prev) => (prev === sid ? null : sid));
  }, []);

  if (lines.length === 0) return null;

  return (
    <div className="relative overflow-visible rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-700">
          Grafico de productividad
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">
          Vta/Hr por dia
        </h3>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            Series a graficar
          </span>
          <button
            type="button"
            className="text-xs font-semibold text-mercamio-700 transition-colors hover:text-mercamio-800"
            onClick={() =>
              setSelectedSeriesState(
                selectedSeries.length === lineOptions.length
                  ? []
                  : lineOptions.map((line) => line.id),
              )
            }
          >
            {selectedSeries.length === lineOptions.length
              ? "Deseleccionar todas"
              : "Seleccionar todas"}
          </button>
        </div>
        <input
          type="search"
          value={lineLegendSearch}
          onChange={(e) => setLineLegendSearch(e.target.value)}
          placeholder="Buscar línea..."
          aria-label="Buscar en series"
          className="mb-2 w-full max-w-md rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
        />
        <div className="flex flex-wrap gap-2">
          {filteredLineOptions.length === 0 ? (
            <p className="text-xs text-slate-500">Sin coincidencias.</p>
          ) : (
            filteredLineOptions.map((line) => {
              const isSelected = selectedSeries.includes(line.id);
              return (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => handleToggleSeries(line.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? "border-mercamio-300 bg-mercamio-50 text-mercamio-700"
                      : "border-slate-200/70 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                  }`}
                >
                  {line.name}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            Sedes a comparar
          </span>
          <button
            type="button"
            className="text-xs font-semibold text-mercamio-700 transition-colors hover:text-mercamio-800"
            onClick={() =>
              setSelectedChartSedesState(
                selectedChartSedes.length === sedeOptions.length
                  ? []
                  : sedeOptions.map((sede) => sede.id),
              )
            }
          >
            {selectedChartSedes.length === sedeOptions.length
              ? "Deseleccionar todas"
              : "Seleccionar todas"}
          </button>
        </div>
        <input
          type="search"
          value={sedeLegendSearch}
          onChange={(e) => setSedeLegendSearch(e.target.value)}
          placeholder="Buscar sede..."
          aria-label="Buscar en sedes del grafico"
          className="mb-2 w-full max-w-md rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
        />
        <div className="flex flex-wrap gap-2">
          {filteredSedeOptions.length === 0 ? (
            <p className="text-xs text-slate-500">Sin coincidencias.</p>
          ) : (
            filteredSedeOptions.map((sede) => {
              const isSelected = selectedChartSedes.includes(sede.id);
              return (
                <button
                  key={sede.id}
                  type="button"
                  onClick={() => handleToggleSede(sede.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-300 shadow-sm"
                      : "border-slate-200/70 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                  }`}
                >
                  {sede.name}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-2">
          <span className="text-xs font-semibold text-slate-700">Rango de fechas</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
              Desde
            </span>
            <input
              type="date"
              value={chartStartDate}
              onChange={(e) => handleChartStartChange(e.target.value)}
              min={chartRangeBounds.min}
              max={chartRangeBounds.max}
              className="rounded-lg border border-slate-200/70 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 shadow-sm transition-all hover:border-mercamio-200 focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            />
          </label>
          <span className="mt-5 text-sm text-slate-400">&mdash;</span>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
              Hasta
            </span>
            <input
              type="date"
              value={chartEndDate}
              onChange={(e) => handleChartEndChange(e.target.value)}
              min={chartRangeBounds.min}
              max={chartRangeBounds.max}
              className="rounded-lg border border-slate-200/70 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 shadow-sm transition-all hover:border-mercamio-200 focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            />
          </label>
        </div>
      </div>

      {selectedSeries.length === 0 ||
      effectiveSedes.length === 0 ||
      chartDates.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-600">
          Selecciona al menos una serie para ver el grafico.
        </p>
      ) : (
        <HighlightContext.Provider value={highlightCtx}>
          {canShowAllChartSeries && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
              <p className="text-xs leading-relaxed text-slate-700">
                {effectiveShowAllChartSeries ? (
                  <>
                    Mostrando las{" "}
                    <span className="font-semibold text-slate-900">
                      {seriesDefinitions.length}
                    </span>{" "}
                    series en el grafico. Puede verse muy denso con muchas lineas.
                  </>
                ) : (
                  <>
                    En el grafico: las{" "}
                    <span className="font-semibold text-slate-900">
                      {CHART_DISPLAY_TOP_N}
                    </span>{" "}
                    con mayor Vta/Hr promedio en este rango (
                    {seriesDefinitions.length} combinaciones sede/línea
                    seleccionadas). CSV y Excel siguen incluyendo todas.
                  </>
                )}
              </p>
              <button
                type="button"
                className="shrink-0 rounded-full border border-mercamio-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-mercamio-700 shadow-sm transition-colors hover:border-mercamio-300 hover:bg-mercamio-50"
                onClick={() => setShowAllChartSeries((open) => !open)}
              >
                {effectiveShowAllChartSeries
                  ? `Solo top ${CHART_DISPLAY_TOP_N}`
                  : "Ver todas en el grafico"}
              </button>
            </div>
          )}
          <div
            className="h-85"
            onClick={() => setClickedSeriesId(null)}
          >
            <LineChart
              height={340}
              dataset={chartDataset}
              xAxis={xAxis}
              yAxis={yAxis}
              series={chartSeries}
              grid={{ horizontal: true, vertical: false }}
              slots={{ tooltip: CustomChartTooltip }}
              highlightedItem={effectiveHighlight}
              onHighlightChange={(item) => setHoveredItem(item)}
              onMarkClick={handleMarkClick}
              onLineClick={handleLineClick}
            />
          </div>
        </HighlightContext.Provider>
      )}
    </div>
  );
});

ChartVisualization.displayName = "ChartVisualization";
