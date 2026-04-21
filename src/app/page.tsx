"use client";

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
  forwardRef,
  useImperativeHandle,
  useDeferredValue,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { animate, remove } from "animejs";
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
import { canAccessPortalSection } from "@/lib/portal-sections";
import {
  escapeCsvValue,
  formatPdfDate,
  sanitizeExportText,
} from "@/lib/export-utils";
import type { Row, Worksheet } from "exceljs";
import { LineCard } from "@/components/LineCard";
import { LineComparisonTable } from "@/components/LineComparisonTable";
import { TopBar } from "@/components/TopBar";
import { EmptyState } from "@/components/productividad/EmptyState";
import { LoadingSkeleton } from "@/components/productividad/LoadingSkeleton";
import { SearchAndSort } from "@/components/productividad/SearchAndSort";
import { ViewToggle } from "@/components/productividad/ViewToggle";
import {
  calcLineMargin,
  formatCOP,
  getSedeM2,
  hasLaborDataForLine,
} from "@/lib/calc";
import { formatDateLabel } from "@/lib/utils";
import {
  DEFAULT_LINES,
  DEFAULT_SEDES,
  SEDE_ORDER,
  SEDE_GROUPS,
  Sede,
} from "@/lib/constants";
import { normalizeKeyCompact } from "@/lib/normalize";
import { DailyProductivity, LineMetrics } from "@/types";

const HourlyAnalysis = dynamic(
  () => import("@/components/HourlyAnalysis").then((mod) => mod.HourlyAnalysis),
  {
    loading: () => (
      <div className="rounded-3xl border border-slate-200/70 bg-white p-6">
        <p className="text-sm text-slate-600">Cargando análisis por hora...</p>
      </div>
    ),
  },
);

// ============================================================================
// UTILIDADES DE FECHA
// ============================================================================

const parseDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const loadExcelJs = () => import("exceljs");

// ============================================================================
// TIPOS
// ============================================================================

type ApiResponse = {
  dailyData: DailyProductivity[];
  sedes: Array<{ id: string; name: string }>;
  error?: string;
};

type DateRange = {
  start: string;
  end: string;
};

type ViewExportHandle = {
  exportCsv: () => boolean;
  exportXlsx: () => Promise<boolean>;
};

type ExportPayload = {
  pdfLines: LineMetrics[];
  selectedScopeLabel: string;
  selectedScopeId: string;
  dateRange: DateRange;
  dateRangeLabel: string;
  lineFilterLabel: string;
  comparisonDateRange: DateRange;
  comparisonDateRangeLabel: string;
  lineComparisons: Array<{
    id: string;
    name: string;
    currentSales: number;
    currentHours: number;
    currentSalesPerHour: number;
    previousSales: number;
    previousHours: number;
    previousSalesPerHour: number;
    salesDelta: number;
    salesDeltaPct: number | null;
  }>;
  lineSedeDetails: Array<{
    lineId: string;
    lineName: string;
    sedeId: string;
    sedeName: string;
    currentSales: number;
    currentHours: number;
    currentSalesPerHour: number;
    previousSales: number;
    previousHours: number;
    previousSalesPerHour: number;
    salesDelta: number;
    salesDeltaPct: number | null;
  }>;
  lineDailyDetails: Array<{
    periodLabel: "actual" | "mes anterior";
    date: string;
    lineId: string;
    lineName: string;
    sales: number;
    hours: number;
    salesPerHour: number;
  }>;
  lineSedeDailyDetails: Array<{
    periodLabel: "actual" | "mes anterior";
    date: string;
    sedeId: string;
    sedeName: string;
    lineId: string;
    lineName: string;
    sales: number;
    hours: number;
    salesPerHour: number;
  }>;
};

const formatRangeLabel = (range: DateRange) => {
  if (!range.start || !range.end) return "";
  if (range.start === range.end) {
    return `${formatDateLabel(range.start, dateLabelOptions)}`;
  }
  return `${formatDateLabel(range.start, dateLabelOptions)} al ${formatDateLabel(range.end, dateLabelOptions)}`;
};

const shiftMonthPreservingDay = (dateKey: string, months: number) => {
  const source = parseDateKey(dateKey);
  const targetYear = source.getFullYear();
  const targetMonthIndex = source.getMonth() + months;
  const candidate = new Date(targetYear, targetMonthIndex, 1);
  const lastDay = new Date(
    candidate.getFullYear(),
    candidate.getMonth() + 1,
    0,
  ).getDate();
  candidate.setDate(Math.min(source.getDate(), lastDay));
  return toDateKey(candidate);
};

const getPreviousComparableRange = (range: DateRange): DateRange => {
  if (!range.start || !range.end) return range;
  return {
    start: shiftMonthPreservingDay(range.start, -1),
    end: shiftMonthPreservingDay(range.end, -1),
  };
};

// ============================================================================
// HOOKS PERSONALIZADOS
// ============================================================================

const useProductivityData = () => {
  const [dailyDataSet, setDailyDataSet] = useState<DailyProductivity[]>([]);
  const [availableSedes, setAvailableSedes] = useState<Sede[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/productivity", {
          signal: controller.signal,
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

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  return { dailyDataSet, availableSedes, isLoading, error };
};

const useAnimations = (
  isLoading: boolean,
  filteredLinesCount: number,
  viewMode: "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2",
) => {
  useEffect(() => {
    if (
      isLoading ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const hasLineItems = filteredLinesCount > 0;

    remove?.("[data-animate]");

    const hasTargets = (selector: string) =>
      document.querySelectorAll(selector).length > 0;

    const runAnimations = () => {
      if (hasTargets("[data-animate='top-bar']")) {
        animate("[data-animate='top-bar']", {
          translateY: [-16, 0],
          opacity: [0, 1],
          delay: (_el: unknown, index: number) => index * 90,
          duration: 650,
          easing: "easeOutCubic",
        });
      }

      if (hasLineItems && hasTargets("[data-animate='line-card']")) {
        animate("[data-animate='line-card']", {
          translateY: [18, 0],
          opacity: [0, 1],
          duration: 550,
          easing: "easeOutCubic",
        });
      }

      if (viewMode === "comparison") {
        if (hasTargets("[data-animate='comparison-card']")) {
          animate("[data-animate='comparison-card']", {
            translateY: [-8, 0],
            opacity: [0, 1],
            duration: 550,
            easing: "easeOutCubic",
          });
        }

        if (hasLineItems && hasTargets("[data-animate='comparison-row']")) {
          animate("[data-animate='comparison-row']", {
            translateX: [-12, 0],
            opacity: [0, 1],
            delay: (_el: unknown, index: number) => index * 40,
            duration: 450,
            easing: "easeOutCubic",
          });
        }
      }

      if (viewMode === "chart") {
        if (hasTargets("[data-animate='chart-card']")) {
          animate("[data-animate='chart-card']", {
            translateY: [-8, 0],
            opacity: [0, 1],
            duration: 550,
            easing: "easeOutCubic",
          });
        }
      }

      if (viewMode === "hourly") {
        if (hasTargets("[data-animate='hourly-card']")) {
          animate("[data-animate='hourly-card']", {
            translateY: [-8, 0],
            opacity: [0, 1],
            duration: 550,
            easing: "easeOutCubic",
          });
        }
      }
    };

    const animationFrame = window.requestAnimationFrame(runAnimations);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isLoading, filteredLinesCount, viewMode]);
};

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

const normalizeSedeKey = normalizeKeyCompact;

const SEDE_ORDER_MAP = new Map(
  SEDE_ORDER.map((name, index) => [normalizeSedeKey(name), index]),
);

const sortSedesByOrder = (sedes: Sede[]) => {
  return [...sedes].sort((a, b) => {
    const aKey = normalizeSedeKey(a.id || a.name);
    const bKey = normalizeSedeKey(b.id || b.name);
    const aOrder = SEDE_ORDER_MAP.get(aKey) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = SEDE_ORDER_MAP.get(bKey) ?? Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name, "es");
  });
};

const getHeatColor = (ratioPercent: number) => {
  if (ratioPercent >= 110) return "#16a34a";
  if (ratioPercent >= 100) return "#facc15";
  if (ratioPercent >= 90) return "#f97316";
  return "#dc2626";
};

const buildCompanyOptions = (): Sede[] =>
  SEDE_GROUPS.filter((group) => group.id !== "all").map((group) => ({
    id: group.id,
    name: group.name,
  }));

const resolveSelectedSedeIds = (
  selectedSede: string,
  selectedCompanies: string[],
  availableSedes: Sede[],
): string[] => {
  const availableByKey = new Map(
    availableSedes.map((sede) => [normalizeSedeKey(sede.id), sede.id]),
  );

  if (selectedCompanies.length > 0) {
    const resolved = new Set<string>();
    selectedCompanies.forEach((companyId) => {
      const group = SEDE_GROUPS.find(
        (candidate) => candidate.id === companyId,
      );
      if (!group) return;
      group.sedes.forEach((sedeId) => {
        const resolvedId = availableByKey.get(normalizeSedeKey(sedeId));
        if (resolvedId) resolved.add(resolvedId);
      });
    });
    return Array.from(resolved);
  }

  if (selectedSede) {
    const resolved = availableByKey.get(normalizeSedeKey(selectedSede));
    return resolved ? [resolved] : [];
  }

  return availableSedes.map((sede) => sede.id);
};
const aggregateLines = (dailyData: DailyProductivity[]): LineMetrics[] => {
  const lineMap = new Map<
    string,
    { id: string; name: string; sales: number; hours: number; cost: number }
  >();

  dailyData.forEach((day) => {
    day.lines.forEach((line) => {
      const hasLaborData = hasLaborDataForLine(line.id);
      const hours = hasLaborData ? line.hours : 0;
      const hourlyRate = hasLaborData ? line.hourlyRate : 0;
      const cost = hours * hourlyRate;
      const existing = lineMap.get(line.id);

      if (existing) {
        existing.sales += line.sales;
        existing.hours += hours;
        existing.cost += cost;
      } else {
        lineMap.set(line.id, {
          id: line.id,
          name: line.name,
          sales: line.sales,
          hours,
          cost,
        });
      }
    });
  });

  DEFAULT_LINES.forEach((line) => {
    if (!lineMap.has(line.id)) {
      lineMap.set(line.id, {
        id: line.id,
        name: line.name,
        sales: 0,
        hours: 0,
        cost: 0,
      });
    }
  });

  return Array.from(lineMap.values()).map((line) => ({
    id: line.id,
    name: line.name,
    sales: line.sales,
    hours: line.hours,
    hourlyRate: line.hours ? line.cost / line.hours : 0,
  }));
};

const filterLinesByStatus = (
  lines: LineMetrics[],
  filterType: string,
): LineMetrics[] => {
  if (filterType === "all") {
    return lines;
  }
  return lines;
};

// ============================================================================
// CHART TOOLTIP CUSTOM - Sorted descending + highlight support
// ============================================================================

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

const clampChartDateRange = (range: DateRange): DateRange => {
  if (!range.start || !range.end) return range;
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  if (start.getTime() <= end.getTime()) return range;
  return { start: range.end, end: range.end };
};

/** Max series drawn at once by default; exports still include full selection. */
const CHART_DISPLAY_TOP_N = 8;

// ============================================================================

type ChartVisualizationProps = {
  dailyDataSet: DailyProductivity[];
  selectedSedeIds: string[];
  availableDates: string[];
  dateRange: DateRange;
  lines: LineMetrics[];
  sedes: Sede[];
};

const ChartVisualization = forwardRef<ViewExportHandle, ChartVisualizationProps>(({
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

  // Date options filtered within global range
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

  const chartDisplaySeriesDefinitions = useMemo(() => {
    if (
      seriesDefinitions.length <= CHART_DISPLAY_TOP_N ||
      showAllChartSeries
    ) {
      return seriesDefinitions;
    }
    return rankedSeriesDefinitions.slice(0, CHART_DISPLAY_TOP_N);
  }, [
    rankedSeriesDefinitions,
    seriesDefinitions,
    showAllChartSeries,
  ]);

  useEffect(() => {
    if (seriesDefinitions.length <= CHART_DISPLAY_TOP_N) {
      setShowAllChartSeries(false);
    }
  }, [seriesDefinitions.length]);

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

  // Click overrides hover; when nothing clicked, hover highlighting works
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

      {/* Date range filter */}
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
          {seriesDefinitions.length > CHART_DISPLAY_TOP_N && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
              <p className="text-xs leading-relaxed text-slate-700">
                {showAllChartSeries ? (
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
                {showAllChartSeries
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
type LineTrendsProps = {
  dailyDataSet: DailyProductivity[];
  selectedSedeIds: string[];
  availableDates: string[];
  lines: LineMetrics[];
  sedes: Sede[];
  dateRange: DateRange;
};

const LineTrends = forwardRef<ViewExportHandle, LineTrendsProps>(({
  dailyDataSet,
  selectedSedeIds,
  availableDates,
  lines,
  sedes,
  dateRange,
}, ref) => {
  const [selectedLine, setSelectedLine] = useState<string>("");
  const [viewType, setViewType] = useState<"temporal" | "por-sede">("temporal");
  const [comparisonSedeSelection, setComparisonSedeSelection] = useState<{
    scopeKey: string;
    ids: string[];
  }>({ scopeKey: "", ids: [] });
  const [trendSedeState, setTrendSedeState] = useState<string>("");
  const [heatBaseline, setHeatBaseline] = useState<"sede" | "todas">("sede");
  const [comparisonBaseline, setComparisonBaseline] = useState<
    "seleccionadas" | "todas" | "propia"
  >("seleccionadas");
  const [comparisonSort, setComparisonSort] = useState<
    "none" | "m2_desc" | "m2_asc"
  >("none");
  const [trendDateFilterMode, setTrendDateFilterMode] = useState<
    "mes_corrido" | "mes_anterior" | "rango"
  >("mes_corrido");
  const [customTrendRangeState, setCustomTrendRangeState] = useState<DateRange>({
    start: dateRange.start,
    end: dateRange.end,
  });
  const [comparisonSizeFilter, setComparisonSizeFilter] = useState<
    | "all"
    | "gte_1000"
    | "gte_2000"
    | "gte_3000"
    | "between_1000_2000"
    | "between_2000_3000"
  >("all");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [showFloatingFilters, setShowFloatingFilters] = useState(false);
  const availableDateBounds = useMemo(() => {
    if (availableDates.length === 0) return { min: "", max: "" };
    const sortedDates = [...availableDates].sort();
    return {
      min: sortedDates[0] ?? "",
      max: sortedDates[sortedDates.length - 1] ?? "",
    };
  }, [availableDates]);
  const visibleSedes = useMemo(() => {
    const hidden = new Set(
      [
        "adm",
        "cedi-cavasa",
        "cedicavasa",
        "panificadora",
        "planta desposte mixto",
        "planta desprese pollo",
      ].map(normalizeSedeKey),
    );
    return sedes.filter((sede) => {
      const idKey = normalizeSedeKey(sede.id);
      const nameKey = normalizeSedeKey(sede.name);
      return !hidden.has(idKey) && !hidden.has(nameKey);
    });
  }, [sedes]);
  const visibleSedeScopeKey = useMemo(
    () => visibleSedes.map((sede) => sede.id).join("|"),
    [visibleSedes],
  );
  const visibleSedeIdSet = useMemo(
    () => new Set(visibleSedes.map((sede) => sede.id)),
    [visibleSedes],
  );
  const trendSede = useMemo(() => {
    if (trendSedeState && visibleSedeIdSet.has(trendSedeState)) {
      return trendSedeState;
    }
    return visibleSedes[0]?.id ?? "";
  }, [trendSedeState, visibleSedeIdSet, visibleSedes]);
  const customTrendRange = useMemo(() => {
    if (!availableDateBounds.min || !availableDateBounds.max) {
      return customTrendRangeState;
    }

    let start =
      customTrendRangeState.start || dateRange.start || availableDateBounds.min;
    let end =
      customTrendRangeState.end || dateRange.end || availableDateBounds.max;

    if (start < availableDateBounds.min) start = availableDateBounds.min;
    if (start > availableDateBounds.max) start = availableDateBounds.max;
    if (end < availableDateBounds.min) end = availableDateBounds.min;
    if (end > availableDateBounds.max) end = availableDateBounds.max;
    if (start > end) {
      const swapped = start;
      start = end;
      end = swapped;
    }

    return { start, end };
  }, [
    availableDateBounds.max,
    availableDateBounds.min,
    customTrendRangeState,
    dateRange.end,
    dateRange.start,
  ]);

  const todayDateKey = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return toDateKey(today);
  }, []);

  const trendEffectiveDateRange = useMemo<DateRange>(() => {
    if (!availableDateBounds.min || !availableDateBounds.max) {
      return { start: "", end: "" };
    }

    if (trendDateFilterMode === "mes_corrido") {
      const today = parseDateKey(todayDateKey);
      return {
        start: toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: todayDateKey,
      };
    }

    if (trendDateFilterMode === "mes_anterior") {
      const today = parseDateKey(todayDateKey);
      const previousMonthStart = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      );
      const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        start: toDateKey(previousMonthStart),
        end: toDateKey(previousMonthEnd),
      };
    }

    const fallbackStart = dateRange.start || availableDateBounds.min;
    const fallbackEnd = dateRange.end || availableDateBounds.max;
    const start = customTrendRange.start || fallbackStart;
    const end = customTrendRange.end || fallbackEnd;
    return start <= end ? { start, end } : { start: end, end: start };
  }, [
    availableDateBounds.max,
    availableDateBounds.min,
    customTrendRange.end,
    customTrendRange.start,
    dateRange.end,
    dateRange.start,
    todayDateKey,
    trendDateFilterMode,
  ]);

  const trendDateRangeLabel = useMemo(
    () => formatRangeLabel(trendEffectiveDateRange),
    [trendEffectiveDateRange],
  );

  const handleCustomTrendStartChange = useCallback((value: string) => {
    setCustomTrendRangeState((prev) => {
      const nextEnd =
        !prev.end || value <= prev.end ? prev.end || value : value;
      return { start: value, end: nextEnd };
    });
  }, []);

  const handleCustomTrendEndChange = useCallback((value: string) => {
    setCustomTrendRangeState((prev) => {
      const nextStart =
        !prev.start || value >= prev.start ? prev.start || value : value;
      return { start: nextStart, end: value };
    });
  }, []);

  const toggleComparisonSede = useCallback((sedeId: string) => {
    setComparisonSedeSelection((prev) => {
      const currentIds =
        prev.scopeKey === visibleSedeScopeKey ? prev.ids : [];
      return {
        scopeKey: visibleSedeScopeKey,
        ids: currentIds.includes(sedeId)
          ? currentIds.filter((id) => id !== sedeId)
          : [...currentIds, sedeId],
      };
    });
  }, [visibleSedeScopeKey]);

  // Temporal view: use single local sede, fall back to global selection
  const effectiveTrendSedeIds = useMemo(
    () => (trendSede ? [trendSede] : selectedSedeIds),
    [trendSede, selectedSedeIds],
  );

  const selectedSedeIdSet = useMemo(
    () => new Set(effectiveTrendSedeIds),
    [effectiveTrendSedeIds],
  );
  const baselineSedeIds = useMemo(
    () =>
      heatBaseline === "todas"
        ? visibleSedes.map((s) => s.id)
        : effectiveTrendSedeIds,
    [heatBaseline, visibleSedes, effectiveTrendSedeIds],
  );
  const baselineSedeIdSet = useMemo(
    () => new Set(baselineSedeIds),
    [baselineSedeIds],
  );
  const sedeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    sedes.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [sedes]);
  const getSedeM2Value = useCallback(
    (sede: Sede) => getSedeM2(sede.name) ?? getSedeM2(sede.id),
    [],
  );
  const filteredVisibleSedes = useMemo(() => {
    if (comparisonSizeFilter === "all") return visibleSedes;
    return visibleSedes.filter((sede) => {
      const m2 = getSedeM2Value(sede);
      if (m2 == null) return false;
      switch (comparisonSizeFilter) {
        case "gte_1000":
          return m2 >= 1000;
        case "gte_2000":
          return m2 >= 2000;
        case "gte_3000":
          return m2 >= 3000;
        case "between_1000_2000":
          return m2 >= 1000 && m2 < 2000;
        case "between_2000_3000":
          return m2 >= 2000 && m2 < 3000;
        default:
          return true;
      }
    });
  }, [comparisonSizeFilter, getSedeM2Value, visibleSedes]);
  const filteredVisibleSedeIdSet = useMemo(
    () => new Set(filteredVisibleSedes.map((sede) => sede.id)),
    [filteredVisibleSedes],
  );
  const comparisonSedeIds = useMemo(() => {
    if (comparisonSedeSelection.scopeKey !== visibleSedeScopeKey) {
      return [];
    }
    return comparisonSedeSelection.ids.filter((id) =>
      filteredVisibleSedeIdSet.has(id),
    );
  }, [
    comparisonSedeSelection.ids,
    comparisonSedeSelection.scopeKey,
    filteredVisibleSedeIdSet,
    visibleSedeScopeKey,
  ]);

  const toggleAllComparisonSedes = useCallback(() => {
    setComparisonSedeSelection((prev) => {
      const currentIds =
        prev.scopeKey === visibleSedeScopeKey
          ? prev.ids.filter((id) => filteredVisibleSedeIdSet.has(id))
          : [];
      return {
        scopeKey: visibleSedeScopeKey,
        ids:
          currentIds.length === filteredVisibleSedes.length
            ? []
            : filteredVisibleSedes.map((s) => s.id),
      };
    });
  }, [filteredVisibleSedeIdSet, filteredVisibleSedes, visibleSedeScopeKey]);
  const orderedVisibleSedes = useMemo(() => {
    if (comparisonSort === "none") return filteredVisibleSedes;
    const sorted = [...filteredVisibleSedes].sort((a, b) => {
      const aM2 = getSedeM2Value(a);
      const bM2 = getSedeM2Value(b);
      const aUnknown = aM2 == null;
      const bUnknown = bM2 == null;
      if (aUnknown && bUnknown) {
        return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      }
      if (aUnknown) return 1;
      if (bUnknown) return -1;
      return comparisonSort === "m2_desc" ? bM2 - aM2 : aM2 - bM2;
    });
    return sorted;
  }, [comparisonSort, getSedeM2Value, filteredVisibleSedes]);
  const orderedComparisonSedeIds = useMemo(() => {
    if (comparisonSort === "none") return comparisonSedeIds;
    const m2ById = new Map<string, number | null>();
    orderedVisibleSedes.forEach((s) => m2ById.set(s.id, getSedeM2Value(s)));
    return [...comparisonSedeIds].sort((a, b) => {
      const aM2 = m2ById.get(a) ?? getSedeM2(sedeNameMap.get(a) ?? a);
      const bM2 = m2ById.get(b) ?? getSedeM2(sedeNameMap.get(b) ?? b);
      const aUnknown = aM2 == null;
      const bUnknown = bM2 == null;
      if (aUnknown && bUnknown) {
        const aName = sedeNameMap.get(a) ?? a;
        const bName = sedeNameMap.get(b) ?? b;
        return aName.localeCompare(bName, "es", { sensitivity: "base" });
      }
      if (aUnknown) return 1;
      if (bUnknown) return -1;
      return comparisonSort === "m2_desc" ? bM2 - aM2 : aM2 - bM2;
    });
  }, [
    comparisonSort,
    comparisonSedeIds,
    getSedeM2Value,
    orderedVisibleSedes,
    sedeNameMap,
  ]);
  const temporalDates = useMemo(() => {
    if (!trendEffectiveDateRange.start || !trendEffectiveDateRange.end) {
      return [];
    }
    return availableDates.filter(
      (date) =>
        date >= trendEffectiveDateRange.start &&
        date <= trendEffectiveDateRange.end,
    );
  }, [
    availableDates,
    trendEffectiveDateRange.end,
    trendEffectiveDateRange.start,
  ]);

  const trendData = useMemo(() => {
    if (!selectedLine) return [];

    const dataByDate = temporalDates.map((date) => {
      const dayData = dailyDataSet.filter(
        (item) => selectedSedeIdSet.has(item.sede) && item.date === date,
      );

      if (dayData.length === 0) {
        return { date, value: 0, sales: 0, hours: 0 };
      }

      const totals = dayData.reduce(
        (acc, item) => {
          const lineData = item.lines.find((line) => line.id === selectedLine);
          if (!lineData) {
            return acc;
          }

          const hasLaborData = hasLaborDataForLine(lineData.id);
          const hours = hasLaborData ? lineData.hours : 0;

          return {
            sales: acc.sales + lineData.sales,
            hours: acc.hours + hours,
          };
        },
        { sales: 0, hours: 0 },
      );

      return { date, value: totals.sales, sales: totals.sales, hours: totals.hours };
    });

    return dataByDate;
  }, [
    selectedLine,
    dailyDataSet,
    selectedSedeIdSet,
    temporalDates,
  ]);

  const maxSalesPerHour = useMemo(() => {
    if (trendData.length === 0) return 1;
    return Math.max(
      ...trendData.map((d) => (d.hours > 0 ? d.sales / 1_000_000 / d.hours : 0)),
      1,
    );
  }, [trendData]);

  const avgValue = useMemo(() => {
    if (trendData.length === 0) return 0;
    const sum = trendData.reduce((acc, d) => acc + d.value, 0);
    return sum / trendData.length;
  }, [trendData]);

  const totalPeriodStats = useMemo(() => {
    if (!selectedLine || temporalDates.length === 0) {
      return { salesPerDay: 0, hoursPerDay: 0 };
    }
    const sedeIdSet = new Set(visibleSedes.map((s) => s.id));
    let sales = 0;
    let hours = 0;

    dailyDataSet.forEach((item) => {
      if (!sedeIdSet.has(item.sede)) return;
      if (
        item.date < trendEffectiveDateRange.start ||
        item.date > trendEffectiveDateRange.end
      )
        return;
      const lineData = item.lines.find((l) => l.id === selectedLine);
      if (!lineData) return;
      const hasLaborData = hasLaborDataForLine(lineData.id);
      sales += lineData.sales;
      hours += hasLaborData ? lineData.hours : 0;
    });

    const days = temporalDates.length || 1;
    return {
      salesPerDay: sales / days,
      hoursPerDay: hours / days,
    };
  }, [
    dailyDataSet,
    selectedLine,
    temporalDates.length,
    trendEffectiveDateRange.end,
    trendEffectiveDateRange.start,
    visibleSedes,
  ]);

  // Average sales/hour over the selected trends range.
  const avgSalesPerHour = useMemo(() => {
    if (!selectedLine || temporalDates.length === 0) return 0;
    const totals = temporalDates.reduce(
      (acc, date) => {
        const dayData = dailyDataSet.filter(
          (item) => baselineSedeIdSet.has(item.sede) && item.date === date,
        );
        for (const item of dayData) {
          const lineData = item.lines.find((l) => l.id === selectedLine);
          if (!lineData) continue;
          const hasLaborData = hasLaborDataForLine(lineData.id);
          acc.sales += lineData.sales;
          acc.hours += hasLaborData ? lineData.hours : 0;
        }
        return acc;
      },
      { sales: 0, hours: 0 },
    );
    return totals.hours > 0 ? totals.sales / 1_000_000 / totals.hours : 0;
  }, [selectedLine, temporalDates, dailyDataSet, baselineSedeIdSet]);

  // Daily average sales/hour for the selected range (used for "promedio total")
  const dailyAvgSalesPerHour = useMemo(() => {
    if (!selectedLine || temporalDates.length === 0) return new Map<string, number>();
    const map = new Map<string, number>();
    temporalDates.forEach((date) => {
      let sales = 0;
      let hours = 0;
      const dayData = dailyDataSet.filter(
        (item) => baselineSedeIdSet.has(item.sede) && item.date === date,
      );
      for (const item of dayData) {
        const lineData = item.lines.find((l) => l.id === selectedLine);
        if (!lineData) continue;
        const hasLaborData = hasLaborDataForLine(lineData.id);
        sales += lineData.sales;
        hours += hasLaborData ? lineData.hours : 0;
      }
      map.set(date, hours > 0 ? sales / 1_000_000 / hours : 0);
    });
    return map;
  }, [selectedLine, temporalDates, dailyDataSet, baselineSedeIdSet]);

  const comparisonBaselineIds = useMemo(
    () =>
      comparisonBaseline === "todas"
        ? filteredVisibleSedes.map((s) => s.id)
        : comparisonSedeIds,
    [comparisonBaseline, filteredVisibleSedes, comparisonSedeIds],
  );

  useEffect(() => {
    if (viewType !== "por-sede") return;

    const updateFloating = () => {
      if (!filtersRef.current || !cardRef.current) return;
      const filtersRect = filtersRef.current.getBoundingClientRect();
      const cardRect = cardRef.current.getBoundingClientRect();
      const cardVisible = cardRect.bottom > 120 && cardRect.top < window.innerHeight;
      const shouldFloat = filtersRect.bottom < 12;
      setShowFloatingFilters(cardVisible && shouldFloat);
    };

    updateFloating();
    window.addEventListener("scroll", updateFloating, { passive: true });
    window.addEventListener("resize", updateFloating);
    return () => {
      window.removeEventListener("scroll", updateFloating);
      window.removeEventListener("resize", updateFloating);
    };
  }, [viewType]);
  const floatingFiltersVisible = viewType === "por-sede" && showFloatingFilters;

  const dailyComparisonBaseline = useMemo(() => {
    if (comparisonBaseline === "propia") return new Map<string, number>();
    if (!selectedLine || temporalDates.length === 0) return new Map<string, number>();
    const map = new Map<string, number>();
    const rangeDates = temporalDates;

    rangeDates.forEach((date) => {
      let sales = 0;
      let hours = 0;
      const dayData = dailyDataSet.filter(
        (item) => comparisonBaselineIds.includes(item.sede) && item.date === date,
      );
      for (const item of dayData) {
        const lineData = item.lines.find((l) => l.id === selectedLine);
        if (!lineData) continue;
        const hasLaborData = hasLaborDataForLine(lineData.id);
        sales += lineData.sales;
        hours += hasLaborData ? lineData.hours : 0;
      }
      map.set(date, hours > 0 ? sales / 1_000_000 / hours : 0);
    });

    return map;
  }, [
    comparisonBaseline,
    selectedLine,
    dailyDataSet,
    comparisonBaselineIds,
    temporalDates,
  ]);

  const ownSedeBaseline = useMemo(() => {
    const map = new Map<string, number>();
    const rangeDates = temporalDates;
    if (!selectedLine || comparisonSedeIds.length === 0 || rangeDates.length === 0) {
      return map;
    }

    comparisonSedeIds.forEach((sedeId) => {
      let sales = 0;
      let hours = 0;

      rangeDates.forEach((date) => {
        const dayData = dailyDataSet.filter(
          (item) => item.sede === sedeId && item.date === date,
        );
        dayData.forEach((item) => {
          const lineData = item.lines.find((l) => l.id === selectedLine);
          if (!lineData) return;
          const hasLaborData = hasLaborDataForLine(lineData.id);
          sales += lineData.sales;
          hours += hasLaborData ? lineData.hours : 0;
        });
      });

      map.set(sedeId, hours > 0 ? sales / 1_000_000 / hours : 0);
    });

    return map;
  }, [comparisonSedeIds, dailyDataSet, selectedLine, temporalDates]);

  const comparisonRangeDates = useMemo(
    () => temporalDates,
    [temporalDates],
  );

  const computeComparisonStats = useCallback(
    (sedeIds: string[]) => {
      if (!selectedLine || sedeIds.length === 0) {
        return { sales: 0, hours: 0, days: 0, salesPerHour: 0, salesPerDay: 0, hoursPerDay: 0 };
      }

      const sedeSet = new Set(sedeIds);
      let sales = 0;
      let hours = 0;

      dailyDataSet.forEach((item) => {
        if (!sedeSet.has(item.sede)) return;
        if (
          item.date < trendEffectiveDateRange.start ||
          item.date > trendEffectiveDateRange.end
        )
          return;
        const lineData = item.lines.find((l) => l.id === selectedLine);
        if (!lineData) return;
        const hasLaborData = hasLaborDataForLine(lineData.id);
        sales += lineData.sales;
        hours += hasLaborData ? lineData.hours : 0;
      });

      const days = comparisonRangeDates.length;
      const salesPerHour = hours > 0 ? sales / 1_000_000 / hours : 0;
      const salesPerDay = days > 0 ? sales / days : 0;
      const hoursPerDay = days > 0 ? hours / days : 0;

      return { sales, hours, days, salesPerHour, salesPerDay, hoursPerDay };
    },
    [
      comparisonRangeDates.length,
      dailyDataSet,
      selectedLine,
      trendEffectiveDateRange.end,
      trendEffectiveDateRange.start,
    ],
  );

  const selectedComparisonStats = useMemo(
    () => computeComparisonStats(comparisonSedeIds),
    [comparisonSedeIds, computeComparisonStats],
  );

  const totalComparisonStats = useMemo(() => {
    if (!selectedLine) {
      return { sales: 0, hours: 0, days: 0, salesPerHour: 0, salesPerDay: 0, hoursPerDay: 0 };
    }

    let sales = 0;
    let hours = 0;

    dailyDataSet.forEach((item) => {
      if (
        item.date < trendEffectiveDateRange.start ||
        item.date > trendEffectiveDateRange.end
      )
        return;
      const lineData = item.lines.find((l) => l.id === selectedLine);
      if (!lineData) return;
      const hasLaborData = hasLaborDataForLine(lineData.id);
      sales += lineData.sales;
      hours += hasLaborData ? lineData.hours : 0;
    });

    const days = comparisonRangeDates.length;
    const salesPerHour = hours > 0 ? sales / 1_000_000 / hours : 0;
    const salesPerDay = days > 0 ? sales / days : 0;
    const hoursPerDay = days > 0 ? hours / days : 0;

    return { sales, hours, days, salesPerHour, salesPerDay, hoursPerDay };
  }, [
    comparisonRangeDates.length,
    dailyDataSet,
    selectedLine,
    trendEffectiveDateRange.end,
    trendEffectiveDateRange.start,
  ]);

  const sedeComparisonData = useMemo(() => {
    if (!selectedLine || comparisonSedeIds.length === 0) return [];

    const rangeDates = comparisonRangeDates;

    return rangeDates.map((date) => {
      const sedesForDay = orderedComparisonSedeIds.map((sedeId) => {
        const dayData = dailyDataSet.filter(
          (item) => item.sede === sedeId && item.date === date,
        );

        const totals = dayData.reduce(
          (acc, item) => {
            const lineData = item.lines.find((l) => l.id === selectedLine);
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

        return {
          sedeId,
          sedeName: sedeNameMap.get(sedeId) || sedeId,
          value: totals.sales,
          sales: totals.sales,
          hours: totals.hours,
        };
      });

      return { date, sedes: sedesForDay };
    });
  }, [
    selectedLine,
    comparisonSedeIds,
    orderedComparisonSedeIds,
    dailyDataSet,
    comparisonRangeDates,
    sedeNameMap,
  ]);

  const handleExportTrendsCsv = useCallback(() => {
    if (!selectedLine) return false;
    if (viewType === "temporal") {
      if (trendData.length === 0) return false;
      const rows = [
        ["Fecha", "Ventas", "Horas", "Vta/Hr"],
        ...trendData.map((point) => [
          point.date,
          Math.round(point.sales),
          point.hours.toFixed(2),
          point.hours > 0 ? (point.sales / 1_000_000 / point.hours).toFixed(3) : "0.000",
        ]),
      ];
      const csv = rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tendencias-temporal-${selectedLine}-${trendEffectiveDateRange.start || "sin-fecha"}-${trendEffectiveDateRange.end || "sin-fecha"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return true;
    }

    if (sedeComparisonData.length === 0 || comparisonSedeIds.length === 0) {
      return false;
    }

    const rows = [
      ["Fecha", "Sede", "Ventas", "Horas", "Vta/Hr"],
      ...sedeComparisonData.flatMap((day) =>
        day.sedes.map((sede) => [
          day.date,
          sede.sedeName,
          Math.round(sede.sales),
          sede.hours.toFixed(2),
          sede.hours > 0 ? (sede.sales / 1_000_000 / sede.hours).toFixed(3) : "0.000",
        ]),
      ),
    ];
    const csv = rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tendencias-sedes-${selectedLine}-${trendEffectiveDateRange.start || "sin-fecha"}-${trendEffectiveDateRange.end || "sin-fecha"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }, [
    comparisonSedeIds.length,
    sedeComparisonData,
    selectedLine,
    trendData,
    trendEffectiveDateRange.end,
    trendEffectiveDateRange.start,
    viewType,
  ]);

  const handleExportTrendsXlsx = useCallback(async () => {
    if (!selectedLine) return false;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(
      viewType === "temporal" ? "Tendencias temporal" : "Tendencias sedes",
    );

    if (viewType === "temporal") {
      if (trendData.length === 0) return false;
      sheet.columns = [
        { key: "date", width: 14 },
        { key: "sales", width: 16 },
        { key: "hours", width: 12 },
        { key: "productivity", width: 12 },
      ];
      sheet.addRow(["Fecha", "Ventas", "Horas", "Vta/Hr"]);
      trendData.forEach((point) => {
        sheet.addRow([
          sanitizeExportText(point.date),
          Math.round(point.sales),
          Number(point.hours.toFixed(2)),
          point.hours > 0 ? Number((point.sales / 1_000_000 / point.hours).toFixed(3)) : 0,
        ]);
      });
    } else {
      if (sedeComparisonData.length === 0 || comparisonSedeIds.length === 0) {
        return false;
      }
      sheet.columns = [
        { key: "date", width: 14 },
        { key: "sede", width: 22 },
        { key: "sales", width: 16 },
        { key: "hours", width: 12 },
        { key: "productivity", width: 12 },
      ];
      sheet.addRow(["Fecha", "Sede", "Ventas", "Horas", "Vta/Hr"]);
      sedeComparisonData.forEach((day) => {
        day.sedes.forEach((sede) => {
          sheet.addRow([
            sanitizeExportText(day.date),
            sanitizeExportText(sede.sedeName),
            Math.round(sede.sales),
            Number(sede.hours.toFixed(2)),
            sede.hours > 0 ? Number((sede.sales / 1_000_000 / sede.hours).toFixed(3)) : 0,
          ]);
        });
      });
    }

    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `tendencias-${viewType}-${selectedLine}-${trendEffectiveDateRange.start || "sin-fecha"}-${trendEffectiveDateRange.end || "sin-fecha"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }, [
    comparisonSedeIds.length,
    sedeComparisonData,
    selectedLine,
    trendData,
    trendEffectiveDateRange.end,
    trendEffectiveDateRange.start,
    viewType,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      exportCsv: handleExportTrendsCsv,
      exportXlsx: handleExportTrendsXlsx,
    }),
    [handleExportTrendsCsv, handleExportTrendsXlsx],
  );

  if (lines.length === 0 || availableDates.length === 0) return null;

  const renderComparisonFilters = (compact = false) => (
    <div
      className={`rounded-2xl border border-slate-200/70 bg-white/95 ${
        compact ? "px-4 py-3" : "p-4"
      } shadow-[0_18px_40px_-35px_rgba(15,23,42,0.5)] backdrop-blur`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700">
          Sedes a comparar
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            Orden
            <select
              value={comparisonSort}
              onChange={(e) =>
                setComparisonSort(e.target.value as typeof comparisonSort)
              }
              className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            >
              <option value="none">Por defecto</option>
              <option value="m2_desc">M2: mayor a menor</option>
              <option value="m2_asc">M2: menor a mayor</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            Tamano m2
            <select
              value={comparisonSizeFilter}
              onChange={(e) =>
                setComparisonSizeFilter(
                  e.target.value as typeof comparisonSizeFilter,
                )
              }
              className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            >
              <option value="all">Todas</option>
              <option value="gte_1000">Mayor o igual a 1000 m2</option>
              <option value="gte_2000">Mayor o igual a 2000 m2</option>
              <option value="gte_3000">Mayor o igual a 3000 m2</option>
              <option value="between_1000_2000">Entre 1000 y 2000 m2</option>
              <option value="between_2000_3000">Entre 2000 y 3000 m2</option>
            </select>
          </label>
        </div>
      </div>
      <div>
        <span className="mb-3 block text-xs font-semibold text-slate-700">
          Mapa de calor
        </span>
        <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setComparisonBaseline("seleccionadas")}
            className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              comparisonBaseline === "seleccionadas"
                ? "bg-white text-mercamio-700 shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Promedio seleccionadas
          </button>
          <button
            type="button"
            onClick={() => setComparisonBaseline("todas")}
            className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              comparisonBaseline === "todas"
                ? "bg-white text-mercamio-700 shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Promedio total
          </button>
          <button
            type="button"
            onClick={() => setComparisonBaseline("propia")}
            className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              comparisonBaseline === "propia"
                ? "bg-white text-mercamio-700 shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Promedio por sede
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-700">
          Seleccion de sedes
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {orderedVisibleSedes.map((sede) => {
          const isSelected = comparisonSedeIds.includes(sede.id);
          return (
            <button
              key={sede.id}
              type="button"
              onClick={() => toggleComparisonSede(sede.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                isSelected
                  ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-300 shadow-sm"
                  : "border-slate-200/70 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {sede.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleAllComparisonSedes}
          className="rounded-full border border-mercamio-200/70 bg-white px-3 py-1.5 text-xs font-semibold text-mercamio-700 transition-all hover:border-mercamio-300 hover:text-mercamio-800"
        >
          {comparisonSedeIds.length === filteredVisibleSedes.length
            ? "Deseleccionar todas"
            : "Seleccionar todas"}
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={cardRef}
      className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]"
    >
      {floatingFiltersVisible && (
        <div className="fixed left-1/2 top-0 z-30 w-[calc(100vw-1rem)] max-w-none -translate-x-1/2">
          {renderComparisonFilters(true)}
        </div>
      )}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-700">
          Analisis de tendencias
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">
          {viewType === "temporal"
            ? "Evolucion temporal por linea"
            : "Comparativo por sede"}
        </h3>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-full border border-slate-200/70 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setViewType("temporal")}
          className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-all ${
            viewType === "temporal"
              ? "bg-white text-mercamio-700 shadow-sm"
              : "text-slate-700 hover:text-slate-800"
          }`}
        >
          Evolucion temporal
        </button>
        <button
          type="button"
          onClick={() => setViewType("por-sede")}
          className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-all ${
            viewType === "por-sede"
              ? "bg-white text-mercamio-700 shadow-sm"
              : "text-slate-700 hover:text-slate-800"
          }`}
        >
          Comparativo por sede
        </button>
      </div>

      <div className="mb-6">
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">Linea</span>
          <select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            className="mt-1 w-full rounded-full border border-slate-200/70 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
          >
            <option value="">Selecciona una linea</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name} ({line.id})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-6 space-y-3 rounded-2xl border border-slate-200/70 bg-slate-50 p-4">
        <span className="text-xs font-semibold text-slate-700">
          Filtro de fechas (tendencias)
        </span>
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200/70 bg-white p-1">
          <button
            type="button"
            onClick={() => setTrendDateFilterMode("mes_corrido")}
            className={`rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              trendDateFilterMode === "mes_corrido"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Mes corrido
          </button>
          <button
            type="button"
            onClick={() => setTrendDateFilterMode("mes_anterior")}
            className={`rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              trendDateFilterMode === "mes_anterior"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Mes anterior
          </button>
          <button
            type="button"
            onClick={() => setTrendDateFilterMode("rango")}
            className={`rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
              trendDateFilterMode === "rango"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-700 hover:text-slate-800"
            }`}
          >
            Rango
          </button>
        </div>
        {trendDateFilterMode === "rango" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
                Desde
              </span>
              <input
                type="date"
                value={customTrendRange.start}
                onChange={(e) => handleCustomTrendStartChange(e.target.value)}
                min={availableDateBounds.min}
                max={availableDateBounds.max}
                className="rounded-lg border border-slate-200/70 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 shadow-sm transition-all hover:border-mercamio-200 focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
                Hasta
              </span>
              <input
                type="date"
                value={customTrendRange.end}
                onChange={(e) => handleCustomTrendEndChange(e.target.value)}
                min={availableDateBounds.min}
                max={availableDateBounds.max}
                className="rounded-lg border border-slate-200/70 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 shadow-sm transition-all hover:border-mercamio-200 focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
              />
            </label>
          </div>
        )}
        <p className="text-xs text-slate-600">
          Rango aplicado: {trendDateRangeLabel || "Sin rango definido"}
        </p>
      </div>

      {viewType === "temporal" && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Sede</span>
            <select
              value={trendSede}
              onChange={(e) => setTrendSedeState(e.target.value)}
              className="mt-1 w-full rounded-full border border-slate-200/70 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            >
              {visibleSedes.map((sede) => (
                <option key={sede.id} value={sede.id}>
                  {sede.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-700">
              Mapa de calor
            </span>
            <div className="mt-1 flex items-center gap-2 rounded-full border border-slate-200/70 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setHeatBaseline("sede")}
                className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
                  heatBaseline === "sede"
                    ? "bg-white text-mercamio-700 shadow-sm"
                    : "text-slate-700 hover:text-slate-800"
                }`}
              >
                Sede actual
              </button>
              <button
                type="button"
                onClick={() => setHeatBaseline("todas")}
                className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] transition-all ${
                  heatBaseline === "todas"
                    ? "bg-white text-mercamio-700 shadow-sm"
                    : "text-slate-700 hover:text-slate-800"
                }`}
              >
                Promedio total
              </button>
            </div>
          </div>
        </div>
      )}

      {viewType === "por-sede" && (
        <div className="mb-6">
          <div ref={filtersRef}>{renderComparisonFilters()}</div>
          <div className="mt-4" />
        </div>
      )}

      {viewType === "temporal" ? (
        <>
          {selectedLine && trendData.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-700">Promedio del periodo</p>
                  <p className="text-2xl font-semibold text-slate-900">
                    {formatCOP(avgValue)}
                  </p>
                  <p className="text-lg font-semibold text-slate-800">
                    {(
                      trendData.reduce((a, d) => a + d.hours, 0) /
                      (trendData.length || 1)
                    ).toFixed(1)}
                    h
                  </p>
                  <p className="text-xs text-slate-500">Horas promedio/dia</p>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-2 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                    Prom. total (todas las sedes)
                  </p>
                  <div className="mt-1 flex flex-wrap gap-3 text-sm font-semibold text-slate-900">
                    <span>Ventas {formatCOP(totalPeriodStats.salesPerDay)}</span>
                    <span>Horas {totalPeriodStats.hoursPerDay.toFixed(1)}h</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {trendData.map((point) => {
                  const salesPerHour =
                    point.hours > 0 ? point.sales / 1_000_000 / point.hours : 0;
                  const percentage =
                    maxSalesPerHour > 0 ? (salesPerHour / maxSalesPerHour) * 100 : 0;
                  const dailyBaseline =
                    heatBaseline === "todas"
                      ? (dailyAvgSalesPerHour.get(point.date) ?? 0)
                      : avgSalesPerHour;
                  const heatRatio =
                    dailyBaseline > 0
                      ? (salesPerHour / dailyBaseline) * 100
                      : 0;
                  const heatColor = getHeatColor(heatRatio);

                  return (
                    <div key={point.date} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-700">
                          {formatDateLabel(point.date, dateLabelOptions)}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-slate-900">
                            Vta/Hr: {salesPerHour.toFixed(3)}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-700">
                            {formatCOP(point.value)}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {point.hours.toFixed(1)}h
                          </span>
                        </div>
                      </div>
                      <div className="relative h-6 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: heatColor,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!selectedLine && (
            <p className="py-8 text-center text-sm text-slate-700">
              Selecciona una linea para ver su tendencia temporal
            </p>
          )}

          {selectedLine && trendData.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-700">
              No hay datos disponibles para esta linea
            </p>
          )}
        </>
      ) : (
        <>
          {selectedLine && sedeComparisonData.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-700">Comparativo diario</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {sedeComparisonData.length}{" "}
                    {sedeComparisonData.length === 1 ? "dia" : "dias"},{" "}
                    {comparisonSedeIds.length}{" "}
                    {comparisonSedeIds.length === 1 ? "sede" : "sedes"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                  <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-2 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                      Prom. seleccionadas
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm font-semibold text-slate-900">
                      <span>
                        Vta/Hr{" "}
                        {comparisonSedeIds.length > 0
                          ? selectedComparisonStats.salesPerHour.toFixed(3)
                          : "—"}
                      </span>
                      <span>
                        Ventas{" "}
                        {comparisonSedeIds.length > 0
                          ? formatCOP(selectedComparisonStats.salesPerDay)
                          : "—"}
                      </span>
                      <span>
                        Horas{" "}
                        {comparisonSedeIds.length > 0
                          ? `${selectedComparisonStats.hoursPerDay.toFixed(1)}h`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-2 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                      Prom. total
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-sm font-semibold text-slate-900">
                      <span>Vta/Hr {totalComparisonStats.salesPerHour.toFixed(3)}</span>
                      <span>Ventas {formatCOP(totalComparisonStats.salesPerDay)}</span>
                      <span>Horas {totalComparisonStats.hoursPerDay.toFixed(1)}h</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {sedeComparisonData.map((day) => (
                  <div key={day.date}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                      {formatDateLabel(day.date, dateLabelOptions)}
                    </p>
                    <div className="space-y-1">
                      {(() => {
                        const sedeSalesPerHour = day.sedes
                          .map((sede) =>
                            sede.hours > 0
                              ? sede.sales / 1_000_000 / sede.hours
                              : 0,
                          )
                          .filter((value) => value > 0);
                        const dayMaxSalesPerHour =
                          sedeSalesPerHour.length > 0
                            ? Math.max(...sedeSalesPerHour)
                            : 0;
                        const dayAvgSalesPerHour =
                          dailyComparisonBaseline.get(day.date) ?? 0;

                        return day.sedes.map((sede) => {
                          const salesPerHour =
                            sede.hours > 0
                              ? sede.sales / 1_000_000 / sede.hours
                              : 0;
                          const percentage =
                            dayMaxSalesPerHour > 0
                              ? (salesPerHour / dayMaxSalesPerHour) * 100
                              : 0;
                          const heatRatio =
                            dayAvgSalesPerHour > 0
                              ? (salesPerHour / dayAvgSalesPerHour) * 100
                              : 0;
                          const ownBaseline = ownSedeBaseline.get(sede.sedeId) ?? 0;
                          const resolvedHeatRatio =
                            comparisonBaseline === "propia"
                              ? ownBaseline > 0
                                ? (salesPerHour / ownBaseline) * 100
                                : 0
                              : heatRatio;
                          const heatColor = getHeatColor(resolvedHeatRatio);

                          return (
                            <div
                              key={sede.sedeId}
                              className="flex items-center gap-3"
                            >
                              <span className="w-32 truncate text-sm font-semibold text-slate-900">
                                {sede.sedeName}
                              </span>
                              <div className="relative h-7 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="absolute inset-y-0 left-0 flex items-center gap-3 truncate rounded-full px-3 text-[12px] font-semibold text-slate-900"
                                  style={{
                                    width: `${percentage}%`,
                                    backgroundColor: heatColor,
                                  }}
                                >
                                  <span className="ml-auto shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[12px] font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200/60">
                                    Vta/Hr: {salesPerHour.toFixed(3)} |{" "}
                                    {formatCOP(sede.value)} |{" "}
                                    {sede.hours.toFixed(1)}h
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!selectedLine && (
            <p className="py-8 text-center text-sm text-slate-700">
              Selecciona una linea para comparar entre sedes
            </p>
          )}

          {selectedLine && sedeComparisonData.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-700">
              {comparisonSedeIds.length === 0
                ? "Selecciona al menos una sede para ver la comparacion."
                : "No hay datos disponibles para esta linea en las sedes seleccionadas."}
            </p>
          )}
        </>
      )}
    </div>
  );
});

LineTrends.displayName = "LineTrends";

const formatM2Value = (value: number | null) => {
  if (value == null) return "--";
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

type M2MetricsSectionProps = {
  dailyDataSet: DailyProductivity[];
  sedes: Sede[];
  selectedSedeIds: string[];
  dateRange: DateRange;
};

const M2MetricsSection = forwardRef<ViewExportHandle, M2MetricsSectionProps>(({
  dailyDataSet,
  sedes,
  selectedSedeIds,
  dateRange,
}, ref) => {
  const selectedSedeIdSet = useMemo(
    () => new Set(selectedSedeIds),
    [selectedSedeIds],
  );
  const filteredSedes = useMemo(() => {
    if (selectedSedeIds.length === 0) return sedes;
    return sedes.filter((sede) => selectedSedeIdSet.has(sede.id));
  }, [selectedSedeIds.length, sedes, selectedSedeIdSet]);
  const metrics = useMemo(() => {
    const bySede = new Map<
      string,
      { sales: number; hours: number; margin: number }
    >();

    dailyDataSet.forEach((item) => {
      if (dateRange.start && item.date < dateRange.start) return;
      if (dateRange.end && item.date > dateRange.end) return;
      if (selectedSedeIds.length > 0 && !selectedSedeIdSet.has(item.sede)) return;

      const entry = bySede.get(item.sede) ?? { sales: 0, hours: 0, margin: 0 };
      item.lines.forEach((line) => {
        const hasLabor = hasLaborDataForLine(line.id);
        const hours = hasLabor ? line.hours : 0;
        entry.sales += line.sales;
        entry.hours += hours;
        entry.margin += calcLineMargin(line);
      });
      bySede.set(item.sede, entry);
    });

    return filteredSedes.map((sede) => {
      const totals = bySede.get(sede.id) ?? { sales: 0, hours: 0, margin: 0 };
      const m2 = getSedeM2(sede.name) ?? getSedeM2(sede.id);
      const salesPerM2 = m2 ? totals.sales / m2 : null;
      const hoursPerM2 = m2 ? totals.hours / m2 : null;
      const marginPerM2 = m2 ? totals.margin / m2 : null;

      return {
        sedeId: sede.id,
        sedeName: sede.name,
        m2,
        salesPerM2,
        hoursPerM2,
        marginPerM2,
      };
    });
  }, [
    dailyDataSet,
    dateRange.end,
    dateRange.start,
    filteredSedes,
    selectedSedeIdSet,
    selectedSedeIds.length,
  ]);

  const handleExportM2Csv = useCallback(() => {
    if (metrics.length === 0) return false;
    const rows = [
      ["Sede", "m2", "Ventas/m2", "Horas/m2", "Margen/m2"],
      ...metrics.map((item) => [
        item.sedeName,
        item.m2 ?? "",
        item.salesPerM2 ?? "",
        item.hoursPerM2 ?? "",
        item.marginPerM2 ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `indicadores-m2-${dateRange.start || "sin-fecha"}-${dateRange.end || "sin-fecha"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }, [dateRange.end, dateRange.start, metrics]);

  const handleExportM2Xlsx = useCallback(async () => {
    if (metrics.length === 0) return false;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Indicadores m2");
    sheet.columns = [
      { key: "sede", width: 22 },
      { key: "m2", width: 10 },
      { key: "sales", width: 16 },
      { key: "hours", width: 12 },
      { key: "margin", width: 16 },
    ];
    sheet.addRow(["Sede", "m2", "Ventas/m2", "Horas/m2", "Margen/m2"]);
    metrics.forEach((item) => {
      sheet.addRow([
        sanitizeExportText(item.sedeName),
        item.m2 ?? null,
        item.salesPerM2 ?? null,
        item.hoursPerM2 ?? null,
        item.marginPerM2 ?? null,
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
    link.download = `indicadores-m2-${dateRange.start || "sin-fecha"}-${dateRange.end || "sin-fecha"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }, [dateRange.end, dateRange.start, metrics]);

  useImperativeHandle(
    ref,
    () => ({
      exportCsv: handleExportM2Csv,
      exportXlsx: handleExportM2Xlsx,
    }),
    [handleExportM2Csv, handleExportM2Xlsx],
  );

  if (metrics.length === 0) return null;

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-700">
          Indicadores por m2
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">
          Ventas, horas y margen por m2
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-slate-700">
          <thead className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Sede</th>
              <th className="px-3 py-2 text-right font-semibold">m2</th>
              <th className="px-3 py-2 text-right font-semibold">Ventas/m2</th>
              <th className="px-3 py-2 text-right font-semibold">Horas/m2</th>
              <th className="px-3 py-2 text-right font-semibold">Margen/m2</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((item) => (
              <tr key={item.sedeId} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold text-slate-900">
                  {item.sedeName}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatM2Value(item.m2)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {item.salesPerM2 == null ? "--" : formatCOP(item.salesPerM2)}
                </td>
                <td className="px-3 py-2 text-right">
                  {item.hoursPerM2 == null ? "--" : item.hoursPerM2.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {item.marginPerM2 == null ? "--" : formatCOP(item.marginPerM2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

M2MetricsSection.displayName = "M2MetricsSection";
// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Home() {
  // Estado para controlar hidratación
  const [mounted, setMounted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [pendingSedeKey, setPendingSedeKey] = useState<string | null>(null);
  const [allowedLineIds, setAllowedLineIds] = useState<string[]>([]);
  const [appliedUserDefault, setAppliedUserDefault] = useState(false);
  const router = useRouter();

  // Estado con persistencia - siempre inicia con valores por defecto
  const [selectedSede, setSelectedSede] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = toDateKey(new Date());
    return { start: today, end: today };
  });
  const [lineFilter, setLineFilter] = useState("all");
  const [viewMode, setViewMode] = useState<
    "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2"
  >("cards");

  const prefsKey = useMemo(
    () => `vp_prefs_${username ?? "default"}`,
    [username],
  );

  const resolveUsernameSedeKey = useCallback((value?: string | null) => {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized.startsWith("sede_")) return null;
    const raw = normalized.replace(/^sede_/, "").replace(/_/g, " ");
    return normalizeSedeKey(raw);
  }, []);

  const resolveAllowedLineIds = useCallback((value?: string[] | null) => {
    if (!Array.isArray(value) || value.length === 0) return [];
    const fallbackIds = new Set(DEFAULT_LINES.map((line) => line.id));
    return Array.from(
      new Set(
        value
          .map((line) => (typeof line === "string" ? line.trim().toLowerCase() : ""))
          .filter((line) => fallbackIds.has(line)),
      ),
    );
  }, []);

  // Cargar preferencias desde localStorage después de montar
  useEffect(() => {
    setMounted(true);
    document.documentElement.classList.remove("dark");
  }, []);

  // Cargar preferencias por usuario cuando auth esté listo
  useEffect(() => {
    if (!mounted || !authLoaded) return;

    const rawPrefs = localStorage.getItem(prefsKey);
    if (rawPrefs) {
      try {
        const parsed = JSON.parse(rawPrefs) as {
          selectedSede?: string;
          selectedCompanies?: string[];
          dateRange?: DateRange;
          lineFilter?: string;
          viewMode?: "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2";
        };
        if (Array.isArray(parsed.selectedCompanies)) {
          setSelectedCompanies(parsed.selectedCompanies.slice(0, 2));
        }
        if (typeof parsed.selectedSede === "string") {
          setSelectedSede(parsed.selectedSede);
        }
        if (typeof parsed.lineFilter === "string") {
          setLineFilter(parsed.lineFilter);
        }
        if (parsed.viewMode) {
          setViewMode(parsed.viewMode);
        }
        if (
          parsed.dateRange &&
          typeof parsed.dateRange.start === "string" &&
          typeof parsed.dateRange.end === "string" &&
          parsed.dateRange.start &&
          parsed.dateRange.end
        ) {
          setDateRange({
            start: parsed.dateRange.start,
            end: parsed.dateRange.end,
          });
        }
        setPrefsReady(true);
        return;
      } catch {
        // fallback a preferencias antiguas
      }
    }

    const savedCompanies = localStorage.getItem("selectedCompanies");
    const savedCompany = localStorage.getItem("selectedCompany");
    const savedSede = localStorage.getItem("selectedSede");
    if (savedCompanies) {
      try {
        const parsed = JSON.parse(savedCompanies) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedCompanies(parsed.slice(0, 2));
          setSelectedSede("");
        }
      } catch {
        // Mantener valores por defecto si hay error
      }
    } else if (savedCompany) {
      setSelectedCompanies([savedCompany]);
      setSelectedSede("");
    } else if (savedSede) {
      setSelectedSede(savedSede);
      setSelectedCompanies([]);
    }

    const savedLineFilter = localStorage.getItem("lineFilter");
    if (savedLineFilter) setLineFilter(savedLineFilter);

    const savedViewMode = localStorage.getItem("viewMode");
    if (savedViewMode) {
      setViewMode(
        savedViewMode as
          | "cards"
          | "comparison"
          | "chart"
          | "trends"
          | "hourly"
          | "m2",
      );
    }

    setPrefsReady(true);
  }, [authLoaded, mounted, prefsKey]);

  // Guardar preferencias por usuario
  useEffect(() => {
    if (!mounted || !prefsReady) return;
    const payload = {
      selectedSede,
      selectedCompanies,
      dateRange,
      lineFilter,
      viewMode,
    };
    localStorage.setItem(prefsKey, JSON.stringify(payload));
  }, [
    dateRange,
    lineFilter,
    mounted,
    prefsKey,
    prefsReady,
    selectedCompanies,
    selectedSede,
    viewMode,
  ]);

  // Estados adicionales para búsqueda y ordenamiento
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"sales" | "hours" | "name">("sales");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Cargar datos
  const { dailyDataSet: rawDailyDataSet, availableSedes, isLoading, error } =
    useProductivityData();
  const dailyDataSet = useMemo(() => {
    if (isAdmin || allowedLineIds.length === 0) return rawDailyDataSet;
    const allowedSet = new Set(allowedLineIds);
    return rawDailyDataSet
      .map((item) => ({
        ...item,
        lines: item.lines.filter((line) => allowedSet.has(line.id.toLowerCase())),
      }))
      .filter((item) => item.lines.length > 0);
  }, [allowedLineIds, isAdmin, rawDailyDataSet]);
  const orderedSedes = useMemo(() => {
    const hidden = new Set(
      [
        "adm",
        "cedicavasa",
        "panificadora",
        "planta desposte mixto",
        "planta desprese pollo",
      ].map(normalizeSedeKey),
    );
    const filtered = availableSedes.filter((sede) => {
      const idKey = normalizeSedeKey(sede.id);
      const nameKey = normalizeSedeKey(sede.name);
      return !hidden.has(idKey) && !hidden.has(nameKey);
    });
    return sortSedesByOrder(filtered);
  }, [availableSedes]);

  const companyOptions = useMemo(() => buildCompanyOptions(), []);
  const selectedSedeIds = useMemo(
    () => resolveSelectedSedeIds(selectedSede, selectedCompanies, orderedSedes),
    [selectedSede, selectedCompanies, orderedSedes],
  );
  /** Si la resolución devuelve [] (sede inválida, etc.), mismo criterio que export: todas las sedes visibles. */
  const scopedSedeIds = useMemo(() => {
    if (selectedSedeIds.length > 0) return selectedSedeIds;
    return orderedSedes.map((sede) => sede.id);
  }, [orderedSedes, selectedSedeIds]);
  const selectedSedeIdSet = useMemo(
    () => new Set(scopedSedeIds),
    [scopedSedeIds],
  );
  const availableSedesKey = useMemo(
    () => orderedSedes.map((sede) => sede.id).join("|"),
    [orderedSedes],
  );

  // Fechas disponibles
  const availableDates = useMemo(() => {
    return Array.from(
      new Set(
        dailyDataSet
          .filter((item) => selectedSedeIdSet.has(item.sede))
          .map((item) => item.date),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [dailyDataSet, selectedSedeIdSet]);

  const allAvailableDates = useMemo(() => {
    return Array.from(new Set(dailyDataSet.map((item) => item.date))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [dailyDataSet]);
  const exportMinDate = allAvailableDates[0] ?? "";
  const exportMaxDate =
    allAvailableDates[allAvailableDates.length - 1] ?? "";

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportSedeIds, setExportSedeIds] = useState<string[]>([]);
  const [exportDateRange, setExportDateRange] = useState<DateRange>({
    start: "",
    end: "",
  });
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const chartExportRef = useRef<ViewExportHandle | null>(null);
  const trendsExportRef = useRef<ViewExportHandle | null>(null);
  const hourlyExportRef = useRef<ViewExportHandle | null>(null);
  const m2ExportRef = useRef<ViewExportHandle | null>(null);

  // Sincronizar sede seleccionada
  useEffect(() => {
    if (orderedSedes.length === 0) return;

    if (selectedCompanies.length > 0) return;

    if (
      selectedSede &&
      !orderedSedes.some((sede) => sede.id === selectedSede)
    ) {
      setSelectedSede(orderedSedes[0].id);
    }
  }, [availableSedesKey, selectedSede, selectedCompanies, orderedSedes]);

  // Si el usuario es sede_*, seleccionar su sede por defecto
  useEffect(() => {
    if (!prefsReady || appliedUserDefault) return;
    if (!pendingSedeKey) {
      setAppliedUserDefault(true);
      return;
    }
    const match = orderedSedes.find((sede) => {
      const idKey = normalizeSedeKey(sede.id);
      const nameKey = normalizeSedeKey(sede.name);
      return idKey === pendingSedeKey || nameKey === pendingSedeKey;
    });
    if (match) {
      setSelectedCompanies([]);
      setSelectedSede(match.id);
      setAppliedUserDefault(true);
    }
  }, [appliedUserDefault, orderedSedes, pendingSedeKey, prefsReady]);

  // Datos derivados
  const selectedSedeName = (() => {
    if (selectedCompanies.length > 0) {
      const names = selectedCompanies
        .map(
          (companyId) =>
            SEDE_GROUPS.find((group) => group.id === companyId)?.name,
        )
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) return names.join(" + ");
    }
    return (
      orderedSedes.find((sede) => sede.id === selectedSede)?.name ??
      "Todas las sedes"
    );
  })();

  const dateRangeLabel = useMemo(
    () => formatRangeLabel(dateRange),
    [dateRange],
  );

  const rangeDailyData = useMemo(() => {
    return dailyDataSet.filter(
      (item) =>
        selectedSedeIdSet.has(item.sede) &&
        item.date >= dateRange.start &&
        item.date <= dateRange.end,
    );
  }, [dailyDataSet, dateRange, selectedSedeIdSet]);

  const lines = useMemo(() => aggregateLines(rangeDailyData), [rangeDailyData]);
  const hasRangeData = rangeDailyData.length > 0;
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredLines = useMemo(() => {
    let result = filterLinesByStatus(lines, lineFilter);

    // Aplicar búsqueda
    if (deferredSearchQuery.trim()) {
      const query = deferredSearchQuery.toLowerCase();
      result = result.filter(
        (line) =>
          line.name.toLowerCase().includes(query) ||
          line.id.toLowerCase().includes(query),
      );
    }

    // Aplicar ordenamiento
    result.sort((a, b) => {
      let compareValue = 0;

      switch (sortBy) {
        case "sales":
          compareValue = a.sales - b.sales;
          break;
        case "hours":
          compareValue = a.hours - b.hours;
          break;
        case "name":
          compareValue = a.name.localeCompare(b.name);
          break;
      }

      return sortOrder === "asc" ? compareValue : -compareValue;
    });

    return result;
  }, [deferredSearchQuery, lineFilter, lines, sortBy, sortOrder]);
  const lineFilterLabels: Record<string, string> = {
    all: "Todas las líneas",
    critical: "Líneas críticas (alerta)",
    improving: "Líneas en mejora (atención)",
  };

  const lineFilterLabel = lineFilterLabels[lineFilter] ?? "Todas las líneas";

  const buildExportPayload = useCallback(
    (options?: { sedeIds?: string[]; dateRange?: DateRange }): ExportPayload => {
      const resolvedDateRange: DateRange = {
        start: options?.dateRange?.start || exportMinDate || dateRange.start,
        end: options?.dateRange?.end || exportMaxDate || dateRange.end,
      };

      const hasSedeOverride = options?.sedeIds !== undefined;
      const resolvedSedeIds = hasSedeOverride
        ? options!.sedeIds!.length > 0
          ? options!.sedeIds!
          : orderedSedes.map((sede) => sede.id)
        : selectedSedeIds.length > 0
          ? selectedSedeIds
          : orderedSedes.map((sede) => sede.id);

      const resolvedSedeIdSet = new Set(resolvedSedeIds);
      const rangeData = dailyDataSet.filter(
        (item) =>
          resolvedSedeIdSet.has(item.sede) &&
          item.date >= resolvedDateRange.start &&
          item.date <= resolvedDateRange.end,
      );
      const comparisonDateRange = getPreviousComparableRange(resolvedDateRange);
      const previousRangeData = dailyDataSet.filter(
        (item) =>
          resolvedSedeIdSet.has(item.sede) &&
          item.date >= comparisonDateRange.start &&
          item.date <= comparisonDateRange.end,
      );

      const exportLines = aggregateLines(rangeData);
      const previousLines = aggregateLines(previousRangeData);
      const previousLineMap = new Map(previousLines.map((line) => [line.id, line]));
      let exportFilteredLines = filterLinesByStatus(exportLines, lineFilter);

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        exportFilteredLines = exportFilteredLines.filter(
          (line) =>
            line.name.toLowerCase().includes(query) ||
            line.id.toLowerCase().includes(query),
        );
      }

      exportFilteredLines.sort((a, b) => {
        let compareValue = 0;
        switch (sortBy) {
          case "sales":
            compareValue = a.sales - b.sales;
            break;
          case "hours":
            compareValue = a.hours - b.hours;
            break;
          case "name":
            compareValue = a.name.localeCompare(b.name);
            break;
        }
        return sortOrder === "asc" ? compareValue : -compareValue;
      });

      const exportPdfLines = [...exportFilteredLines].sort(
        (a, b) => b.sales - a.sales,
      );
      const lineComparisons = exportPdfLines.map((line) => {
        const previous = previousLineMap.get(line.id);
        const currentHours = hasLaborDataForLine(line.id) ? line.hours : 0;
        const previousHours =
          previous && hasLaborDataForLine(line.id) ? previous.hours : 0;
        const currentSalesPerHour =
          currentHours > 0 ? line.sales / 1_000_000 / currentHours : 0;
        const previousSalesPerHour =
          previousHours > 0 && previous
            ? previous.sales / 1_000_000 / previousHours
            : 0;
        const salesDelta = line.sales - (previous?.sales ?? 0);
        return {
          id: line.id,
          name: line.name,
          currentSales: line.sales,
          currentHours,
          currentSalesPerHour,
          previousSales: previous?.sales ?? 0,
          previousHours,
          previousSalesPerHour,
          salesDelta,
          salesDeltaPct:
            previous && previous.sales !== 0
              ? (salesDelta / previous.sales) * 100
              : null,
        };
      });

      const lineSedeDetails = exportPdfLines.flatMap((line) => {
        const currentBySede = new Map<
          string,
          { sales: number; hours: number; sedeName: string }
        >();
        const previousBySede = new Map<
          string,
          { sales: number; hours: number; sedeName: string }
        >();

        rangeData.forEach((item) => {
          const currentLine = item.lines.find((candidate) => candidate.id === line.id);
          if (!currentLine) return;
          const existing = currentBySede.get(item.sede) ?? {
            sales: 0,
            hours: 0,
            sedeName:
              orderedSedes.find((sede) => sede.id === item.sede)?.name ?? item.sede,
          };
          currentBySede.set(item.sede, {
            ...existing,
            sales: existing.sales + currentLine.sales,
            hours:
              existing.hours +
              (hasLaborDataForLine(line.id) ? currentLine.hours : 0),
          });
        });

        previousRangeData.forEach((item) => {
          const previousLine = item.lines.find((candidate) => candidate.id === line.id);
          if (!previousLine) return;
          const existing = previousBySede.get(item.sede) ?? {
            sales: 0,
            hours: 0,
            sedeName:
              orderedSedes.find((sede) => sede.id === item.sede)?.name ?? item.sede,
          };
          previousBySede.set(item.sede, {
            ...existing,
            sales: existing.sales + previousLine.sales,
            hours:
              existing.hours +
              (hasLaborDataForLine(line.id) ? previousLine.hours : 0),
          });
        });

        return resolvedSedeIds.map((sedeId) => {
          const current = currentBySede.get(sedeId) ?? {
            sales: 0,
            hours: 0,
            sedeName:
              orderedSedes.find((sede) => sede.id === sedeId)?.name ?? sedeId,
          };
          const previous = previousBySede.get(sedeId) ?? {
            sales: 0,
            hours: 0,
            sedeName: current.sedeName,
          };
          const currentSalesPerHour =
            current.hours > 0 ? current.sales / 1_000_000 / current.hours : 0;
          const previousSalesPerHour =
            previous.hours > 0 ? previous.sales / 1_000_000 / previous.hours : 0;
          const salesDelta = current.sales - previous.sales;

          return {
            lineId: line.id,
            lineName: line.name,
            sedeId,
            sedeName: current.sedeName,
            currentSales: current.sales,
            currentHours: current.hours,
            currentSalesPerHour,
            previousSales: previous.sales,
            previousHours: previous.hours,
            previousSalesPerHour,
            salesDelta,
            salesDeltaPct:
              previous.sales !== 0 ? (salesDelta / previous.sales) * 100 : null,
          };
        });
      });

      const buildLineDailyDetails = (
        sourceData: DailyProductivity[],
        periodLabel: "actual" | "mes anterior",
      ) => {
        const details = sourceData.flatMap((item) =>
          item.lines.map((line) => {
            const hours = hasLaborDataForLine(line.id) ? line.hours : 0;
            return {
              periodLabel,
              date: item.date,
              lineId: line.id,
              lineName: line.name,
              sales: line.sales,
              hours,
              salesPerHour: hours > 0 ? line.sales / 1_000_000 / hours : 0,
            };
          }),
        );

        return details
          .filter((detail) =>
            exportPdfLines.some((line) => line.id === detail.lineId),
          )
          .sort((a, b) => {
            if (a.periodLabel !== b.periodLabel) {
              return a.periodLabel.localeCompare(b.periodLabel);
            }
            if (a.date !== b.date) {
              return a.date.localeCompare(b.date);
            }
            return b.sales - a.sales;
          });
      };

      const lineDailyDetails = [
        ...buildLineDailyDetails(rangeData, "actual"),
        ...buildLineDailyDetails(previousRangeData, "mes anterior"),
      ];

      const buildLineSedeDailyDetails = (
        sourceData: DailyProductivity[],
        periodLabel: "actual" | "mes anterior",
      ) =>
        sourceData
          .flatMap((item) =>
            item.lines.map((line) => {
              const hours = hasLaborDataForLine(line.id) ? line.hours : 0;
              return {
                periodLabel,
                date: item.date,
                sedeId: item.sede,
                sedeName:
                  orderedSedes.find((sede) => sede.id === item.sede)?.name ??
                  item.sede,
                lineId: line.id,
                lineName: line.name,
                sales: line.sales,
                hours,
                salesPerHour: hours > 0 ? line.sales / 1_000_000 / hours : 0,
              };
            }),
          )
          .filter((detail) => exportPdfLines.some((line) => line.id === detail.lineId))
          .sort((a, b) => {
            if (a.periodLabel !== b.periodLabel) {
              return a.periodLabel.localeCompare(b.periodLabel);
            }
            if (a.date !== b.date) {
              return a.date.localeCompare(b.date);
            }
            const sedeCompare = a.sedeName.localeCompare(b.sedeName, "es", {
              sensitivity: "base",
            });
            if (sedeCompare !== 0) return sedeCompare;
            return b.sales - a.sales;
          });

      const lineSedeDailyDetails = [
        ...buildLineSedeDailyDetails(rangeData, "actual"),
        ...buildLineSedeDailyDetails(previousRangeData, "mes anterior"),
      ];

      const selectedScopeLabel =
        resolvedSedeIds.length === 0
          ? "Todas las sedes"
          : resolvedSedeIds
              .map(
                (sedeId) =>
                  orderedSedes.find((sede) => sede.id === sedeId)?.name,
              )
              .filter((name): name is string => Boolean(name))
              .join(" + ") || "Todas las sedes";

      const selectedScopeId =
        resolvedSedeIds.length > 0 ? resolvedSedeIds.join("-") : "todas";

      return {
        pdfLines: exportPdfLines,
        selectedScopeLabel,
        selectedScopeId,
        dateRange: resolvedDateRange,
        dateRangeLabel: formatRangeLabel(resolvedDateRange),
        lineFilterLabel,
        comparisonDateRange,
        comparisonDateRangeLabel: formatRangeLabel(comparisonDateRange),
        lineComparisons,
        lineSedeDetails,
        lineDailyDetails,
        lineSedeDailyDetails,
      };
    },
    [
      dailyDataSet,
      dateRange.end,
      dateRange.start,
      exportMaxDate,
      exportMinDate,
      lineFilter,
      lineFilterLabel,
      orderedSedes,
      searchQuery,
      selectedSedeIds,
      sortBy,
      sortOrder,
    ],
  );

  // Handlers
  const handleStartDateChange = useCallback((value: string) => {
    setDateRange((prev) => ({
      start: value,
      end: value > prev.end ? value : prev.end,
    }));
  }, []);

  const handleSedeChange = useCallback((value: string) => {
    setSelectedSede(value);
    if (value) {
      setSelectedCompanies([]);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as {
          user?: {
            role?: string;
            username?: string;
            allowedLines?: string[] | null;
            allowedDashboards?: string[] | null;
          };
        };
        if (!isMounted) return;
        const isUserAdmin = payload.user?.role === "admin";
        if (
          !isUserAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
        ) {
          router.replace("/secciones");
          return;
        }
        setIsAdmin(isUserAdmin);
        setUsername(payload.user?.username ?? null);
        setPendingSedeKey(resolveUsernameSedeKey(payload.user?.username));
        setAllowedLineIds(resolveAllowedLineIds(payload.user?.allowedLines));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      } finally {
        if (isMounted) setAuthLoaded(true);
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [resolveAllowedLineIds, resolveUsernameSedeKey, router]);

  const handleCompaniesChange = useCallback((value: string[]) => {
    const next = value.slice(0, 2);
    setSelectedCompanies(next);
    if (next.length > 0) {
      setSelectedSede("");
    }
  }, []);

  const handleEndDateChange = useCallback((value: string) => {
    setDateRange((prev) => ({
      start: value < prev.start ? value : prev.start,
      end: value,
    }));
  }, []);

  const openExportModal = useCallback(() => {
    setExportError(null);
    setExportSedeIds(selectedSedeIds);
    setExportDateRange({
      start: dateRange.start || exportMinDate,
      end: dateRange.end || exportMaxDate,
    });
    setExportModalOpen((prev) => !prev);
  }, [dateRange.end, dateRange.start, exportMaxDate, exportMinDate, selectedSedeIds]);

  const handleExportStartChange = useCallback((value: string) => {
    setExportDateRange((prev) => ({
      start: value,
      end: value > prev.end ? value : prev.end,
    }));
  }, []);

  const handleExportEndChange = useCallback((value: string) => {
    setExportDateRange((prev) => ({
      start: value < prev.start ? value : prev.start,
      end: value,
    }));
  }, []);

  const toggleExportSede = useCallback((sedeId: string) => {
    setExportSedeIds((prev) =>
      prev.includes(sedeId)
        ? prev.filter((id) => id !== sedeId)
        : [...prev, sedeId],
    );
  }, []);

  const handleViewChange = useCallback(
    (value: "cards" | "comparison" | "chart" | "trends" | "hourly" | "m2") => {
      setViewMode(value);
    },
    [],
  );

  const handleSortOrderToggle = useCallback(() => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  }, []);

  const handleDownloadCsv = useCallback((payload?: ExportPayload) => {
    const {
      pdfLines: exportLines,
      selectedScopeLabel: exportScopeLabel,
      selectedScopeId: exportScopeId,
      dateRange: exportDateRange,
      dateRangeLabel: exportDateRangeLabel,
      lineFilterLabel: exportLineFilterLabel,
    } = payload ?? buildExportPayload();
    const pdfLines = exportLines;
    const selectedScopeLabel = exportScopeLabel;
    const selectedScopeId = exportScopeId;
    const dateRange = exportDateRange;
    const dateRangeLabel = exportDateRangeLabel;
    const lineFilterLabel = exportLineFilterLabel;

    const formatNumber = (value: number) => {
      return new Intl.NumberFormat("es-CO", {
        maximumFractionDigits: 0,
      }).format(value);
    };

    // Calcular totales
    const totalSales = exportLines.reduce((acc, line) => acc + line.sales, 0);
    const totalHours = exportLines.reduce((acc, line) => {
      const hasLaborData = hasLaborDataForLine(line.id);
      return acc + (hasLaborData ? line.hours : 0);
    }, 0);

    const csvLines = [
      "REPORTE DE PRODUCTIVIDAD POR LINEA",
      "",
      "BLOQUE: INFORMACION",
      "Sede,Valor",
      `Sede,${escapeCsvValue(sanitizeExportText(selectedScopeLabel))}`,
      `Rango,${escapeCsvValue(sanitizeExportText(dateRangeLabel || "Sin rango definido"))}`,
      `Filtro,${escapeCsvValue(sanitizeExportText(lineFilterLabel))}`,
      `Generado,${escapeCsvValue(sanitizeExportText(formatPdfDate()))}`,
      "",
      "BLOQUE: DETALLE POR LINEA",
      "",
      "#,Línea,Código,Ventas ($),Horas",
      ...pdfLines.map((line, index) => {
        const hasLaborData = hasLaborDataForLine(line.id);
        const hours = hasLaborData ? line.hours : 0;
        return [
          index + 1,
          escapeCsvValue(sanitizeExportText(line.name)),
          escapeCsvValue(sanitizeExportText(line.id)),
          formatNumber(Math.round(line.sales)),
          hours.toFixed(2),
        ].join(",");
      }),
      "",
      "BLOQUE: TOTALES",
      "Etiqueta,Valor",
      `,TOTAL,,${formatNumber(Math.round(totalSales))},${totalHours.toFixed(2)}`,
      "",
      "",
      "FIN REPORTE",
    ];

    const csvContent = csvLines.join("\n");
    const blob = new Blob(["\ufeff" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeSede = selectedScopeId.replace(/\s+/g, "-");
    const fileName = `reporte-productividad-${safeSede}-${dateRange.start || "sin-fecha"}-${
      dateRange.end || "sin-fecha"
    }.csv`;
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [buildExportPayload]);

  const handleDownloadXlsx = useCallback(async (payload?: ExportPayload) => {
    const ExcelJS = await loadExcelJs();
    const {
      pdfLines: exportLines,
      selectedScopeLabel: exportScopeLabel,
      selectedScopeId: exportScopeId,
      dateRange: exportDateRange,
      dateRangeLabel: exportDateRangeLabel,
      lineFilterLabel: exportLineFilterLabel,
      comparisonDateRangeLabel: exportComparisonDateRangeLabel,
      lineComparisons,
      lineSedeDetails,
      lineDailyDetails,
      lineSedeDailyDetails,
    } = payload ?? buildExportPayload();
    const pdfLines = exportLines;
    const selectedScopeLabel = exportScopeLabel;
    const selectedScopeId = exportScopeId;
    const dateRange = exportDateRange;
    const dateRangeLabel = exportDateRangeLabel;
    const lineFilterLabel = exportLineFilterLabel;
    const comparisonDateRangeLabel = exportComparisonDateRangeLabel;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Visor de Productividad";
    workbook.created = new Date();

    const allLinesSheet = workbook.addWorksheet("Todas las lineas", {
      views: [{ showGridLines: false }],
    });
    const summarySheet = workbook.addWorksheet("Resumen ejecutivo", {
      views: [{ showGridLines: false }],
    });
    const rankingSheet = workbook.addWorksheet("Ranking lineas", {
      views: [{ showGridLines: false }],
    });
    const comparisonSheet = workbook.addWorksheet("Comparativo lineas", {
      views: [{ showGridLines: false }],
    });
    const detailSheet = workbook.addWorksheet("Sedes por linea", {
      views: [{ showGridLines: false }],
    });
    const dailyLineSheet = workbook.addWorksheet("Diario lineas", {
      views: [{ showGridLines: false }],
    });
    const dailySedeLineSheet = workbook.addWorksheet("Diario sede-linea", {
      views: [{ showGridLines: false }],
    });
    const linesWithSedesSheet = workbook.addWorksheet("Lineas y sedes", {
      views: [{ showGridLines: false }],
    });

    const primaryColor = "1F4E79";
    const lightBg = "D6DCE4";
    const accentBg = "EAF2F8";
    const borderColor = "C9D3DD";
    const lineFillColor = "EAF2F8";
    const sedeFillColor = "F8FAFC";
    const previousMonthFillColor = "FEF3C7";
    const previousMonthLineFillColor = "FDE68A";
    const previousMonthSedeFillColor = "FDEFD8";
    const previousMonthFontColor = "92400E";

    const applyHeaderStyle = (row: Row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { argb: "FFFFFF" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: primaryColor },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: primaryColor } },
          left: { style: "thin", color: { argb: primaryColor } },
          bottom: { style: "thin", color: { argb: primaryColor } },
          right: { style: "thin", color: { argb: primaryColor } },
        };
      });
      row.height = 20;
    };

    const applyBodyBorder = (sheet: Worksheet) => {
      sheet.eachRow((row, rowNumber) => {
        const headerRowCount = sheet.name === "Todas las lineas" ? 2 : 1;
        if (rowNumber <= headerRowCount) return;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: borderColor } },
            left: { style: "thin", color: { argb: borderColor } },
            bottom: { style: "thin", color: { argb: borderColor } },
            right: { style: "thin", color: { argb: borderColor } },
          };
          cell.alignment = { vertical: "middle" };
        });
      });
    };

    const applyLineSummaryStyle = (row: Row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { argb: primaryColor },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: lineFillColor },
        };
      });
    };

    const applySedeDetailStyle = (row: Row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: 10,
          color: { argb: "334155" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: sedeFillColor },
        };
      });
    };

    const applyPreviousMonthAccent = (
      row: Row,
      fillColor = previousMonthFillColor,
    ) => {
      [4, 6, 8].forEach((columnNumber) => {
        const cell = row.getCell(columnNumber);
        const currentFont = cell.font ?? {};
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fillColor },
        };
        cell.font = {
          name:
            typeof currentFont.name === "string" ? currentFont.name : "Calibri",
          size: typeof currentFont.size === "number" ? currentFont.size : 11,
          bold: currentFont.bold ?? false,
          color: { argb: previousMonthFontColor },
        };
      });
    };

    summarySheet.columns = [
      { key: "metric", width: 28 },
      { key: "current", width: 18 },
      { key: "previous", width: 18 },
      { key: "delta", width: 18 },
      { key: "deltaPct", width: 14 },
    ];

    summarySheet.mergeCells("A1:E1");
    const titleCell = summarySheet.getCell("A1");
    titleCell.value = "REPORTE DE PRODUCTIVIDAD POR LÍNEA";
    titleCell.font = {
      name: "Calibri",
      size: 18,
      bold: true,
      color: { argb: primaryColor },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    summarySheet.getRow(1).height = 30;

    const infoStartRow = 3;
    const infoData = [
      ["Sede:", selectedScopeLabel],
      ["Rango actual:", dateRangeLabel || "Sin rango definido"],
      ["Rango comparativo:", comparisonDateRangeLabel || "Sin rango definido"],
      ["Filtro:", lineFilterLabel],
      ["Generado:", formatPdfDate()],
    ];

    summarySheet.mergeCells(`A${infoStartRow}:E${infoStartRow}`);
    const infoHeaderCell = summarySheet.getCell(`A${infoStartRow}`);
    infoHeaderCell.value = "Información del Reporte";
    infoHeaderCell.font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: primaryColor },
    };
    infoHeaderCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: lightBg },
    };

    infoData.forEach((item, index) => {
      const rowNum = infoStartRow + 1 + index;
      summarySheet.getCell(`A${rowNum}`).value = item[0];
      summarySheet.getCell(`A${rowNum}`).font = {
        name: "Calibri",
        size: 11,
        bold: true,
      };
      summarySheet.getCell(`B${rowNum}`).value = item[1];
      summarySheet.getCell(`B${rowNum}`).font = { name: "Calibri", size: 11 };
    });

    const currentSalesTotal = lineComparisons.reduce(
      (acc, line) => acc + line.currentSales,
      0,
    );
    const previousSalesTotal = lineComparisons.reduce(
      (acc, line) => acc + line.previousSales,
      0,
    );
    const currentHoursTotal = lineComparisons.reduce(
      (acc, line) => acc + line.currentHours,
      0,
    );
    const previousHoursTotal = lineComparisons.reduce(
      (acc, line) => acc + line.previousHours,
      0,
    );
    const currentSalesPerHour =
      currentHoursTotal > 0 ? currentSalesTotal / 1_000_000 / currentHoursTotal : 0;
    const previousSalesPerHour =
      previousHoursTotal > 0
        ? previousSalesTotal / 1_000_000 / previousHoursTotal
        : 0;
    const totalSalesDelta = currentSalesTotal - previousSalesTotal;
    const totalHoursDelta = currentHoursTotal - previousHoursTotal;
    const totalSalesDeltaPct =
      previousSalesTotal !== 0 ? totalSalesDelta / previousSalesTotal : null;

    const sortedByCurrentSales = [...lineComparisons].sort(
      (a, b) => b.currentSales - a.currentSales,
    );
    const topLines = sortedByCurrentSales.slice(0, 5);
    const linesWithWorstDelta = [...lineComparisons]
      .sort((a, b) => a.salesDelta - b.salesDelta)
      .slice(0, 5);

    const summaryHeaderRow = infoStartRow + infoData.length + 2;
    const summaryHeaders = [
      "Métrica",
      "Periodo actual",
      "Mes anterior",
      "Variación",
      "Variación %",
    ];
    const summaryHeader = summarySheet.getRow(summaryHeaderRow);
    summaryHeaders.forEach((header, index) => {
      const cell = summaryHeader.getCell(index + 1);
      cell.value = header;
    });
    applyHeaderStyle(summaryHeader);

    const summaryRows = [
      [
        "Ventas totales",
        currentSalesTotal,
        previousSalesTotal,
        currentSalesTotal - previousSalesTotal,
        previousSalesTotal !== 0
          ? (currentSalesTotal - previousSalesTotal) / previousSalesTotal
          : null,
      ],
      [
        "Horas trabajadas",
        currentHoursTotal,
        previousHoursTotal,
        currentHoursTotal - previousHoursTotal,
        previousHoursTotal !== 0
          ? (currentHoursTotal - previousHoursTotal) / previousHoursTotal
          : null,
      ],
      [
        "Vta/Hr consolidada",
        currentSalesPerHour,
        previousSalesPerHour,
        currentSalesPerHour - previousSalesPerHour,
        previousSalesPerHour !== 0
          ? (currentSalesPerHour - previousSalesPerHour) / previousSalesPerHour
          : null,
      ],
      [
        "Líneas incluidas",
        pdfLines.length,
        pdfLines.length,
        0,
        null,
      ],
    ];

    summaryRows.forEach((rowData, index) => {
      const row = summarySheet.getRow(summaryHeaderRow + 1 + index);
      rowData.forEach((value, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.value = value;
        if (colIndex === 4 && typeof value === "number") {
          cell.numFmt = "0.00%";
        }
      });
      const metric = row.getCell(1).value;
      if (metric === "Ventas totales") {
        row.getCell(2).numFmt = '"$"#,##0';
        row.getCell(3).numFmt = '"$"#,##0';
        row.getCell(4).numFmt = '"$"#,##0';
      } else if (metric === "Horas trabajadas") {
        row.getCell(2).numFmt = '#,##0.00';
        row.getCell(3).numFmt = '#,##0.00';
        row.getCell(4).numFmt = '#,##0.00';
      } else if (metric === "Vta/Hr consolidada") {
        row.getCell(2).numFmt = '#,##0.000';
        row.getCell(3).numFmt = '#,##0.000';
        row.getCell(4).numFmt = '#,##0.000';
      } else {
        row.getCell(2).numFmt = '#,##0';
        row.getCell(3).numFmt = '#,##0';
        row.getCell(4).numFmt = '#,##0';
      }
    });

    const highlightsStartRow = summaryHeaderRow + summaryRows.length + 3;
    summarySheet.mergeCells(`A${highlightsStartRow}:E${highlightsStartRow}`);
    const highlightsHeader = summarySheet.getCell(`A${highlightsStartRow}`);
    highlightsHeader.value = "Hallazgos principales";
    highlightsHeader.font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: primaryColor },
    };
    highlightsHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: accentBg },
    };

    const insights = [
      [
        "Línea líder por ventas",
        topLines[0]?.name ?? "Sin datos",
        topLines[0]?.currentSales ?? 0,
        topLines[0]?.salesDelta ?? 0,
        topLines[0]?.salesDeltaPct !== null && topLines[0]
          ? topLines[0].salesDeltaPct / 100
          : null,
      ],
      [
        "Mayor caída en ventas",
        linesWithWorstDelta[0]?.name ?? "Sin datos",
        linesWithWorstDelta[0]?.currentSales ?? 0,
        linesWithWorstDelta[0]?.salesDelta ?? 0,
        linesWithWorstDelta[0]?.salesDeltaPct !== null && linesWithWorstDelta[0]
          ? linesWithWorstDelta[0].salesDeltaPct / 100
          : null,
      ],
      [
        "Ventas consolidadas",
        currentSalesTotal,
        previousSalesTotal,
        totalSalesDelta,
        totalSalesDeltaPct,
      ],
      [
        "Horas consolidadas",
        currentHoursTotal,
        previousHoursTotal,
        totalHoursDelta,
        previousHoursTotal !== 0 ? totalHoursDelta / previousHoursTotal : null,
      ],
    ];

    insights.forEach((rowData, index) => {
      const row = summarySheet.getRow(highlightsStartRow + 1 + index);
      rowData.forEach((value, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.value = value;
        if (colIndex === 4 && typeof value === "number") {
          cell.numFmt = "0.00%";
        }
      });
      const metric = row.getCell(1).value;
      if (
        metric === "Ventas consolidadas" ||
        metric === "Línea líder por ventas" ||
        metric === "Mayor caída en ventas"
      ) {
        row.getCell(3).numFmt = '"$"#,##0';
        row.getCell(4).numFmt = '"$"#,##0';
      } else if (metric === "Horas consolidadas") {
        row.getCell(2).numFmt = '#,##0.00';
        row.getCell(3).numFmt = '#,##0.00';
        row.getCell(4).numFmt = '#,##0.00';
      }
    });

    const sheetColumns = [
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "ventasActual", width: 18 },
      { key: "ventasAnterior", width: 18 },
      { key: "vtaHrActual", width: 14 },
      { key: "vtaHrAnterior", width: 16 },
      { key: "horasActual", width: 14 },
      { key: "horasAnterior", width: 16 },
    ];
    allLinesSheet.columns = sheetColumns;
    linesWithSedesSheet.columns = sheetColumns;

    const allLinesHeaderValues = [
      "Línea",
      "Código",
      "Act.",
      "Mes ant.",
      "Act.",
      "Mes ant.",
      "Act.",
      "Mes ant.",
    ];

    const headerValues = [
      "Línea",
      "Código",
      "Ventas actual",
      "Ventas mes anterior",
      "Vta/Hr actual",
      "Vta/Hr mes anterior",
      "Horas actual",
      "Horas mes anterior",
    ];

    allLinesSheet.mergeCells("C1:D1");
    allLinesSheet.mergeCells("E1:F1");
    allLinesSheet.mergeCells("G1:H1");
    allLinesSheet.getCell("A1").value = "";
    allLinesSheet.getCell("B1").value = "";
    allLinesSheet.getCell("C1").value = "Ventas";
    allLinesSheet.getCell("E1").value = "Vta/Hr";
    allLinesSheet.getCell("G1").value = "Horas";
    const allLinesGroupHeader = allLinesSheet.getRow(1);
    const allLinesSubHeader = allLinesSheet.addRow(allLinesHeaderValues);
    applyHeaderStyle(allLinesGroupHeader);
    applyHeaderStyle(allLinesSubHeader);
    applyPreviousMonthAccent(allLinesSubHeader, "DCC8A0");
    const linesWithSedesHeader = linesWithSedesSheet.addRow(headerValues);
    applyHeaderStyle(linesWithSedesHeader);

    sortedByCurrentSales.forEach((line) => {
      const lineRow = allLinesSheet.addRow([
        sanitizeExportText(line.name),
        sanitizeExportText(line.id),
        line.currentSales,
        line.previousSales,
        line.currentSalesPerHour,
        line.previousSalesPerHour,
        line.currentHours,
        line.previousHours,
      ]);
      applyLineSummaryStyle(lineRow);
      applyPreviousMonthAccent(lineRow, previousMonthLineFillColor);

      lineSedeDetails
        .filter((detail) => detail.lineId === line.id)
        .sort((a, b) => b.currentSales - a.currentSales)
        .forEach((detail) => {
          const sedeRow = allLinesSheet.addRow([
            `   ${sanitizeExportText(detail.sedeName)}`,
            sanitizeExportText(detail.sedeId),
            detail.currentSales,
            detail.previousSales,
            detail.currentSalesPerHour,
            detail.previousSalesPerHour,
            detail.currentHours,
            detail.previousHours,
          ]);
          sedeRow.outlineLevel = 1;
          applySedeDetailStyle(sedeRow);
          applyPreviousMonthAccent(sedeRow, previousMonthSedeFillColor);
        });
    });

    rankingSheet.columns = [
      { key: "ranking", width: 10 },
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "ventasActual", width: 18 },
      { key: "participacionVentas", width: 16 },
      { key: "horasActual", width: 16 },
      { key: "participacionHoras", width: 16 },
      { key: "vtaHrActual", width: 14 },
      { key: "ventasAnterior", width: 18 },
      { key: "variacionVentas", width: 18 },
      { key: "variacionPct", width: 14 },
    ];
    const rankingHeader = rankingSheet.addRow([
      "Rank",
      "Línea",
      "Código",
      "Ventas actual",
      "% part. ventas",
      "Horas actual",
      "% part. horas",
      "Vta/Hr actual",
      "Ventas mes anterior",
      "Variación ventas",
      "Variación %",
    ]);
    applyHeaderStyle(rankingHeader);
    sortedByCurrentSales.forEach((line, index) => {
      const row = rankingSheet.addRow([
        index + 1,
        sanitizeExportText(line.name),
        sanitizeExportText(line.id),
        line.currentSales,
        currentSalesTotal > 0 ? line.currentSales / currentSalesTotal : null,
        line.currentHours,
        currentHoursTotal > 0 ? line.currentHours / currentHoursTotal : null,
        line.currentSalesPerHour,
        line.previousSales,
        line.salesDelta,
        line.salesDeltaPct !== null ? line.salesDeltaPct / 100 : null,
      ]);
      row.getCell(5).numFmt = "0.00%";
      row.getCell(7).numFmt = "0.00%";
      row.getCell(11).numFmt = "0.00%";
    });

    comparisonSheet.columns = [
      { key: "ranking", width: 10 },
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "ventasActual", width: 16 },
      { key: "horasActual", width: 14 },
      { key: "vtaHrActual", width: 14 },
      { key: "ventasAnterior", width: 18 },
      { key: "horasAnterior", width: 16 },
      { key: "vtaHrAnterior", width: 16 },
    ];
    const comparisonHeader = comparisonSheet.addRow([
      "Rank",
      "Línea",
      "Código",
      "Ventas actual",
      "Horas actual",
      "Vta/Hr actual",
      "Ventas mes anterior",
      "Horas mes anterior",
      "Vta/Hr mes anterior",
    ]);
    applyHeaderStyle(comparisonHeader);
    sortedByCurrentSales.forEach((line, index) => {
      comparisonSheet.addRow([
        index + 1,
        sanitizeExportText(line.name),
        sanitizeExportText(line.id),
        line.currentSales,
        line.currentHours,
        line.currentSalesPerHour,
        line.previousSales,
        line.previousHours,
        line.previousSalesPerHour,
      ]);
    });

    detailSheet.columns = [
      { key: "rankingLinea", width: 12 },
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "rankingSede", width: 12 },
      { key: "sede", width: 22 },
      { key: "ventasActual", width: 16 },
      { key: "participacionLinea", width: 16 },
      { key: "horasActual", width: 14 },
      { key: "vtaHrActual", width: 14 },
      { key: "ventasAnterior", width: 18 },
      { key: "horasAnterior", width: 16 },
      { key: "vtaHrAnterior", width: 16 },
    ];
    const detailHeader = detailSheet.addRow([
      "Rank línea",
      "Línea",
      "Código",
      "Rank sede",
      "Sede",
      "Ventas actual",
      "% part. línea",
      "Horas actual",
      "Vta/Hr actual",
      "Ventas mes anterior",
      "Horas mes anterior",
      "Vta/Hr mes anterior",
    ]);
    applyHeaderStyle(detailHeader);

    const lineRankMap = new Map(
      sortedByCurrentSales.map((line, index) => [line.id, index + 1]),
    );
    const currentSalesByLineMap = new Map(
      sortedByCurrentSales.map((line) => [line.id, line.currentSales]),
    );
    const sedeRankByLineMap = new Map<string, Map<string, number>>();
    sortedByCurrentSales.forEach((line) => {
      const rankedSedes = lineSedeDetails
        .filter((detail) => detail.lineId === line.id)
        .sort((a, b) => b.currentSales - a.currentSales);
      sedeRankByLineMap.set(
        line.id,
        new Map(rankedSedes.map((detail, index) => [detail.sedeId, index + 1])),
      );
    });

    lineSedeDetails
      .sort((a, b) => {
        const lineRankDiff =
          (lineRankMap.get(a.lineId) ?? Number.MAX_SAFE_INTEGER) -
          (lineRankMap.get(b.lineId) ?? Number.MAX_SAFE_INTEGER);
        if (lineRankDiff !== 0) return lineRankDiff;
        return b.currentSales - a.currentSales;
      })
      .forEach((detail) => {
        const lineSales = currentSalesByLineMap.get(detail.lineId) ?? 0;
        const row = detailSheet.addRow([
          lineRankMap.get(detail.lineId) ?? null,
          sanitizeExportText(detail.lineName),
          sanitizeExportText(detail.lineId),
          sedeRankByLineMap.get(detail.lineId)?.get(detail.sedeId) ?? null,
          sanitizeExportText(detail.sedeName),
          detail.currentSales,
          lineSales > 0 ? detail.currentSales / lineSales : null,
          detail.currentHours,
          detail.currentSalesPerHour,
          detail.previousSales,
          detail.previousHours,
          detail.previousSalesPerHour,
        ]);
        row.getCell(7).numFmt = "0.00%";
      });

    dailyLineSheet.columns = [
      { key: "periodo", width: 14 },
      { key: "fecha", width: 14 },
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "ventas", width: 16 },
      { key: "horas", width: 14 },
      { key: "vtaHr", width: 14 },
    ];
    const dailyLineHeader = dailyLineSheet.addRow([
      "Periodo",
      "Fecha",
      "Línea",
      "Código",
      "Ventas",
      "Horas",
      "Vta/Hr",
    ]);
    applyHeaderStyle(dailyLineHeader);
    lineDailyDetails.forEach((detail) => {
      dailyLineSheet.addRow([
        sanitizeExportText(detail.periodLabel),
        sanitizeExportText(detail.date),
        sanitizeExportText(detail.lineName),
        sanitizeExportText(detail.lineId),
        detail.sales,
        detail.hours,
        detail.salesPerHour,
      ]);
    });

    dailySedeLineSheet.columns = [
      { key: "periodo", width: 14 },
      { key: "fecha", width: 14 },
      { key: "sede", width: 22 },
      { key: "sedeId", width: 18 },
      { key: "linea", width: 24 },
      { key: "codigo", width: 18 },
      { key: "ventas", width: 16 },
      { key: "horas", width: 14 },
      { key: "vtaHr", width: 14 },
    ];
    const dailySedeLineHeader = dailySedeLineSheet.addRow([
      "Periodo",
      "Fecha",
      "Sede",
      "Id sede",
      "Línea",
      "Código",
      "Ventas",
      "Horas",
      "Vta/Hr",
    ]);
    applyHeaderStyle(dailySedeLineHeader);
    lineSedeDailyDetails.forEach((detail) => {
      dailySedeLineSheet.addRow([
        sanitizeExportText(detail.periodLabel),
        sanitizeExportText(detail.date),
        sanitizeExportText(detail.sedeName),
        sanitizeExportText(detail.sedeId),
        sanitizeExportText(detail.lineName),
        sanitizeExportText(detail.lineId),
        detail.sales,
        detail.hours,
        detail.salesPerHour,
      ]);
    });

    [
      summarySheet,
      allLinesSheet,
      rankingSheet,
      comparisonSheet,
      detailSheet,
      dailyLineSheet,
      dailySedeLineSheet,
      linesWithSedesSheet,
    ].forEach((sheet) => {
      applyBodyBorder(sheet);
      sheet.eachRow((row, rowNumber) => {
        if (sheet.name === "Todas las lineas" && rowNumber <= 2) return;
        if (rowNumber === 1 && sheet !== summarySheet) return;
        row.eachCell((cell) => {
          if (typeof cell.value === "number") {
            if (cell.numFmt) return;
            cell.numFmt = "#,##0.000";
          }
        });
      });
    });

    allLinesSheet.getColumn(3).numFmt = '"$"#,##0';
    allLinesSheet.getColumn(4).numFmt = '"$"#,##0';
    allLinesSheet.getColumn(5).numFmt = '#,##0.000';
    allLinesSheet.getColumn(6).numFmt = '#,##0.000';
    allLinesSheet.getColumn(7).numFmt = '#,##0.00';
    allLinesSheet.getColumn(8).numFmt = '#,##0.00';
    comparisonSheet.getColumn(4).numFmt = '"$"#,##0';
    comparisonSheet.getColumn(5).numFmt = '#,##0.00';
    comparisonSheet.getColumn(6).numFmt = '#,##0.000';
    comparisonSheet.getColumn(7).numFmt = '"$"#,##0';
    comparisonSheet.getColumn(8).numFmt = '#,##0.00';
    comparisonSheet.getColumn(9).numFmt = '#,##0.000';
    rankingSheet.getColumn(4).numFmt = '"$"#,##0';
    rankingSheet.getColumn(5).numFmt = "0.00%";
    rankingSheet.getColumn(6).numFmt = '#,##0.00';
    rankingSheet.getColumn(7).numFmt = "0.00%";
    rankingSheet.getColumn(8).numFmt = '#,##0.000';
    rankingSheet.getColumn(9).numFmt = '"$"#,##0';
    rankingSheet.getColumn(10).numFmt = '"$"#,##0';
    rankingSheet.getColumn(11).numFmt = "0.00%";
    detailSheet.getColumn(6).numFmt = '"$"#,##0';
    detailSheet.getColumn(7).numFmt = "0.00%";
    detailSheet.getColumn(8).numFmt = '#,##0.00';
    detailSheet.getColumn(9).numFmt = '#,##0.000';
    detailSheet.getColumn(10).numFmt = '"$"#,##0';
    detailSheet.getColumn(11).numFmt = '#,##0.00';
    detailSheet.getColumn(12).numFmt = '#,##0.000';
    dailyLineSheet.getColumn(5).numFmt = '"$"#,##0';
    dailyLineSheet.getColumn(6).numFmt = '#,##0.00';
    dailyLineSheet.getColumn(7).numFmt = '#,##0.000';
    dailySedeLineSheet.getColumn(7).numFmt = '"$"#,##0';
    dailySedeLineSheet.getColumn(8).numFmt = '#,##0.00';
    dailySedeLineSheet.getColumn(9).numFmt = '#,##0.000';
    linesWithSedesSheet.getColumn(3).numFmt = '"$"#,##0';
    linesWithSedesSheet.getColumn(4).numFmt = '"$"#,##0';
    linesWithSedesSheet.getColumn(5).numFmt = '"$"#,##0';
    linesWithSedesSheet.getColumn(6).numFmt = "0.00%";
    linesWithSedesSheet.getColumn(7).numFmt = '#,##0.000';
    linesWithSedesSheet.getColumn(8).numFmt = '#,##0.00';
    allLinesSheet.views = [{ state: "frozen", ySplit: 2 }];
    rankingSheet.views = [{ state: "frozen", ySplit: 1 }];
    comparisonSheet.views = [{ state: "frozen", ySplit: 1 }];
    detailSheet.views = [{ state: "frozen", ySplit: 1 }];
    dailyLineSheet.views = [{ state: "frozen", ySplit: 1 }];
    dailySedeLineSheet.views = [{ state: "frozen", ySplit: 1 }];
    linesWithSedesSheet.views = [{ state: "frozen", ySplit: 1 }];
    allLinesSheet.autoFilter = "A2:H2";
    rankingSheet.autoFilter = "A1:K1";
    comparisonSheet.autoFilter = "A1:I1";
    detailSheet.autoFilter = "A1:L1";
    dailyLineSheet.autoFilter = "A1:G1";
    dailySedeLineSheet.autoFilter = "A1:I1";
    linesWithSedesSheet.autoFilter = "A1:H1";

    [
      summarySheet,
      rankingSheet,
      comparisonSheet,
      detailSheet,
      dailyLineSheet,
      dailySedeLineSheet,
      linesWithSedesSheet,
    ].forEach((sheet) => {
      workbook.removeWorksheet(sheet.id);
    });

    const safeSede = selectedScopeId.replace(/\s+/g, "-");
    const fileName = "reporte-productividad.xlsx";

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [buildExportPayload]);

  const handleDownloadPdf = useCallback(async (payload?: ExportPayload) => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const {
      pdfLines: exportLines,
      selectedScopeLabel: exportScopeLabel,
      selectedScopeId: exportScopeId,
      dateRange: exportDateRange,
      dateRangeLabel: exportDateRangeLabel,
      lineFilterLabel: exportLineFilterLabel,
      comparisonDateRangeLabel: exportComparisonDateRangeLabel,
      lineComparisons,
      lineSedeDetails,
    } = payload ?? buildExportPayload();
    const pdfLines = exportLines;
    const selectedScopeLabel = exportScopeLabel;
    const selectedScopeId = exportScopeId;
    const dateRange = exportDateRange;
    const dateRangeLabel = exportDateRangeLabel;
    const lineFilterLabel = exportLineFilterLabel;
    const comparisonDateRangeLabel = exportComparisonDateRangeLabel;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const primaryColor: [number, number, number] = [31, 78, 121];
    const accentColor: [number, number, number] = [46, 117, 182];

    const formatNumber = (value: number) =>
      new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(
        value,
      );
    const formatHoursAsClock = (value: number) => {
      const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
      const totalMinutes = Math.round(safeValue * 60);
      const hoursPart = Math.floor(totalMinutes / 60);
      const minutesPart = totalMinutes % 60;
      return `${String(hoursPart).padStart(2, "0")}:${String(minutesPart).padStart(2, "0")}`;
    };
    const getLastAutoTableFinalY = () =>
      (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
      0;
    const renderFooter = () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      const totalPages = doc.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setFillColor(...accentColor);
        doc.rect(0, pageHeight - 10, pageWidth, 10, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont("helvetica", "italic");
        doc.text(
          `Generado automáticamente por Visor de Productividad | Página ${pageNumber} de ${totalPages}`,
          pageWidth / 2,
          pageHeight - 4,
          {
            align: "center",
          },
        );
      }
    };

    // === TÍTULO ===
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE PRODUCTIVIDAD POR LÍNEA", pageWidth / 2, 13, {
      align: "center",
    });

    // === INFORMACIÓN DEL REPORTE ===
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(214, 220, 228);
    doc.rect(15, 25, pageWidth - 30, 8, "F");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...primaryColor);
    doc.text("Información del Reporte", 20, 30.5);

    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    const infoY = 40;
    const infoData = [
      ["Sede:", selectedScopeLabel],
      ["Rango actual:", dateRangeLabel || "Sin rango definido"],
      ["Rango comparativo:", comparisonDateRangeLabel || "Sin rango definido"],
      ["Filtro:", lineFilterLabel],
      ["Generado:", formatPdfDate()],
    ];

    infoData.forEach((item, index) => {
      const y = infoY + index * 6;
      doc.setFont("helvetica", "bold");
      doc.text(item[0], 20, y);
      doc.setFont("helvetica", "normal");
      doc.text(item[1], 45, y);
    });

    // === TABLA DE DATOS ===
    const tableStartY = infoY + infoData.length * 6 + 8;

    // Calcular totales
    const totalSales = pdfLines.reduce((acc, line) => acc + line.sales, 0);
    const totalHours = pdfLines.reduce((acc, line) => {
      const hasLaborData = hasLaborDataForLine(line.id);
      return acc + (hasLaborData ? line.hours : 0);
    }, 0);

    // Preparar filas de datos
    const tableBody = pdfLines.map((line, index) => {
      const hasLaborData = hasLaborDataForLine(line.id);
      const hours = hasLaborData ? line.hours : 0;

      return [
        (index + 1).toString(),
        line.name,
        line.id,
        `$ ${formatNumber(Math.round(line.sales))}`,
        formatHoursAsClock(hours),
      ];
    });

    // Fila de totales
    const totalsRow = [
      "",
      "TOTAL",
      "",
      `$ ${formatNumber(Math.round(totalSales))}`,
      formatHoursAsClock(totalHours),
    ];

    autoTable(doc, {
      startY: tableStartY,
      head: [["#", "Línea", "Código", "Ventas", "Horas trabajadas"]],
      body: tableBody,
      foot: [totalsRow],
      theme: "grid",
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 9,
        textColor: [50, 50, 50],
      },
      footStyles: {
        fillColor: [189, 215, 238],
        textColor: primaryColor,
        fontStyle: "bold",
        fontSize: 10,
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 15 },
        1: { halign: "left", cellWidth: 80 },
        2: { halign: "left", cellWidth: 50 },
        3: { halign: "right", cellWidth: 50 },
        4: { halign: "right", cellWidth: 30 },
      },
      margin: { left: 15, right: 15 },
      styles: {
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
      },
    });

    // === DETALLE INTERNO POR SEDE ===
    const pageHeight = doc.internal.pageSize.getHeight();
    let currentY = getLastAutoTableFinalY() + 10;

    const groupedLineDetails = lineComparisons.map((line, index) => ({
      rank: index + 1,
      line,
      details: lineSedeDetails
        .filter((detail) => detail.lineId === line.id)
        .sort((a, b) => b.currentSales - a.currentSales),
    }));

    if (groupedLineDetails.length > 0) {
      if (currentY > pageHeight - 30) {
        doc.addPage();
        currentY = 20;
      }

      doc.setFillColor(214, 220, 228);
      doc.rect(15, currentY, pageWidth - 30, 8, "F");
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...primaryColor);
      doc.text("Detalle interno por sede", 20, currentY + 5.5);
      currentY += 12;

      groupedLineDetails.forEach(({ rank, line, details }) => {
        if (currentY > pageHeight - 45) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFillColor(234, 242, 248);
        doc.rect(15, currentY, pageWidth - 30, 7, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...primaryColor);
        doc.text(
          `${rank}. ${sanitizeExportText(line.name)} (${sanitizeExportText(line.id)})`,
          20,
          currentY + 4.7,
        );
        currentY += 9;

        const detailRows =
          details.length > 0
            ? details.map((detail, detailIndex) => [
                String(detailIndex + 1),
                sanitizeExportText(detail.sedeName),
                `$ ${formatNumber(Math.round(detail.currentSales))}`,
                `$ ${formatNumber(Math.round(detail.previousSales))}`,
                detail.currentSalesPerHour.toFixed(3),
                detail.previousSalesPerHour.toFixed(3),
                formatHoursAsClock(detail.currentHours),
                formatHoursAsClock(detail.previousHours),
              ])
            : [[
                "",
                "Sin datos de sede para esta línea",
                "-",
                "-",
                "-",
                "-",
                "-",
                "-",
              ]];

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              { content: "#", rowSpan: 2 },
              { content: "Sede", rowSpan: 2 },
              { content: "Ventas", colSpan: 2 },
              { content: "Vta/Hr", colSpan: 2 },
              { content: "Horas", colSpan: 2 },
            ],
            [
              "Actual",
              "Mes anterior",
              "Actual",
              "Mes anterior",
              "Actual",
              "Mes anterior",
            ],
          ],
          body: detailRows,
          theme: "grid",
          headStyles: {
            fillColor: accentColor,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            halign: "center",
            fontSize: 8,
            valign: "middle",
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [50, 50, 50],
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { halign: "center", cellWidth: 10 },
            1: { halign: "left", cellWidth: 42 },
            2: { halign: "right", cellWidth: 23 },
            3: { halign: "right", cellWidth: 23 },
            4: { halign: "right", cellWidth: 18 },
            5: { halign: "right", cellWidth: 18 },
            6: { halign: "right", cellWidth: 20 },
            7: { halign: "right", cellWidth: 20 },
          },
          margin: { left: 15, right: 15 },
          styles: {
            lineColor: [210, 218, 226],
            lineWidth: 0.1,
            cellPadding: 1.5,
          },
        });

        currentY = getLastAutoTableFinalY() + 6;
      });
    }

    renderFooter();

    // Descargar
    const safeSede = selectedScopeId.replace(/\s+/g, "-");
    const fileName = `reporte-productividad-${safeSede}-${dateRange.start || "sin-fecha"}-${
      dateRange.end || "sin-fecha"
    }.pdf`;
    doc.save(fileName);
  }, [buildExportPayload]);

  const handleExport = useCallback(
    async (format: "pdf" | "csv" | "xlsx") => {
      if (isExporting) return;
      setIsExporting(true);
      try {
        if (viewMode === "cards" || viewMode === "comparison") {
          const payload = buildExportPayload({
            sedeIds: exportSedeIds,
            dateRange: exportDateRange,
          });

          if (payload.pdfLines.length === 0) {
            setExportError("No hay datos para el rango y sedes seleccionadas.");
            return;
          }

          setExportError(null);
          if (format === "pdf") {
            handleDownloadPdf(payload);
          } else if (format === "csv") {
            handleDownloadCsv(payload);
          } else {
            await handleDownloadXlsx(payload);
          }

          setExportModalOpen(false);
          return;
        }

        if (format === "pdf") {
          setExportError("El PDF solo está disponible en la vista de líneas.");
          return;
        }

        let exported = false;
        if (viewMode === "chart") {
          exported =
            format === "csv"
              ? chartExportRef.current?.exportCsv() ?? false
              : (await chartExportRef.current?.exportXlsx?.()) ?? false;
        } else if (viewMode === "trends") {
          exported =
            format === "csv"
              ? trendsExportRef.current?.exportCsv() ?? false
              : (await trendsExportRef.current?.exportXlsx?.()) ?? false;
        } else if (viewMode === "hourly") {
          exported =
            format === "csv"
              ? hourlyExportRef.current?.exportCsv() ?? false
              : (await hourlyExportRef.current?.exportXlsx?.()) ?? false;
        } else if (viewMode === "m2") {
          exported =
            format === "csv"
              ? m2ExportRef.current?.exportCsv() ?? false
              : (await m2ExportRef.current?.exportXlsx?.()) ?? false;
        }

        if (!exported) {
          setExportError("No hay datos para exportar en esta vista.");
          return;
        }

        setExportError(null);
        setExportModalOpen(false);
      } finally {
        setIsExporting(false);
      }
    },
    [
      buildExportPayload,
      exportDateRange,
      exportSedeIds,
      handleDownloadCsv,
      handleDownloadPdf,
      handleDownloadXlsx,
      viewMode,
      chartExportRef,
      trendsExportRef,
      hourlyExportRef,
      m2ExportRef,
      isExporting,
    ],
  );

  // Atajos de teclado
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Ignorar si está escribiendo en un input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        // Solo permitir Escape para limpiar búsqueda
        if (
          event.key === "Escape" &&
          event.target instanceof HTMLInputElement
        ) {
          setSearchQuery("");
          event.target.blur();
        }
        return;
      }

      // Ctrl/Cmd + E: Abrir menú de exportación
      if ((event.ctrlKey || event.metaKey) && event.key === "e") {
        event.preventDefault();
        // Trigger del botón de exportar (se implementará con ref si es necesario)
      }

      // Ctrl/Cmd + F: Enfocar búsqueda
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        const searchInput = document.querySelector(
          'input[placeholder*="Buscar"]',
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }

      // T: Toggle vista (tarjetas/comparativo/gráfico/tendencias)
      if (event.key === "t") {
        setViewMode((prev) => {
          if (prev === "cards") return "comparison";
          if (prev === "comparison") return "chart";
          if (prev === "chart") return "trends";
          if (prev === "trends") return "hourly";
          return "cards";
        });
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, []);

  // Animaciones
  useAnimations(isLoading, filteredLines.length, viewMode);

  // Render
  return (
    <div className="min-h-screen bg-background px-3 pb-8 pt-4 text-foreground sm:px-4 sm:pb-12 sm:pt-6 md:px-8 md:pb-16 md:pt-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-6 md:gap-10">
        {isAdmin && (
          <div className="flex justify-end">
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-2 rounded-full border border-slate-900/90 bg-slate-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white shadow-[0_14px_30px_-16px_rgba(15,23,42,0.6)] transition-all hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Administrar usuarios
            </Link>
          </div>
        )}
        <TopBar
          title="Productividad por Línea"
          selectedSede={selectedSede}
          sedes={orderedSedes}
          selectedCompanies={selectedCompanies}
          companies={companyOptions}
          startDate={dateRange.start}
          endDate={dateRange.end}
          onSedeChange={handleSedeChange}
          onCompaniesChange={handleCompaniesChange}
          onStartDateChange={handleStartDateChange}
          onEndDateChange={handleEndDateChange}
          onExportClick={openExportModal}
          isExportDisabled={dailyDataSet.length === 0}
          backHref="/productividad"
          backLabel="Volver a Productividad"
        />

        {exportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Exportar reporte
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                    Selecciona sedes y fechas
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Elige el rango y las sedes para generar el archivo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="rounded-full border border-slate-200/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Sedes
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setExportSedeIds(orderedSedes.map((sede) => sede.id))}
                      className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Seleccionar todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportSedeIds([])}
                      className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Quitar todas
                    </button>
                  </div>

                  <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-2xl border border-slate-200/70 p-3">
                    {orderedSedes.map((sede) => {
                      const checked = exportSedeIds.includes(sede.id);
                      return (
                        <label
                          key={sede.id}
                          className="flex items-center justify-between rounded-xl px-2 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <span>{sede.name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExportSede(sede.id)}
                            className="h-4 w-4 rounded border-slate-300 text-mercamio-600 focus:ring-mercamio-200"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Fechas
                  </p>
                  <div className="mt-3 grid gap-3">
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Desde
                      <input
                        type="date"
                        value={exportDateRange.start}
                        min={exportMinDate}
                        max={exportMaxDate}
                        onChange={(e) => handleExportStartChange(e.target.value)}
                        className="rounded-lg border border-slate-200/70 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700">
                      Hasta
                      <input
                        type="date"
                        value={exportDateRange.end}
                        min={exportMinDate}
                        max={exportMaxDate}
                        onChange={(e) => handleExportEndChange(e.target.value)}
                        className="rounded-lg border border-slate-200/70 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Rango disponible: {exportMinDate || "--"} a {exportMaxDate || "--"}
                  </p>
                </div>
              </div>

              {exportError && (
                <p className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
                  {exportError}
                </p>
              )}

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  disabled={isExporting}
                  className="rounded-full border border-slate-200/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("pdf")}
                  disabled={isExporting}
                  className="rounded-full border border-mercamio-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-mercamio-700 transition-all hover:border-mercamio-300 hover:bg-mercamio-50"
                >
                  {isExporting ? "Generando..." : "PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  disabled={isExporting}
                  className="rounded-full border border-mercamio-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-mercamio-700 transition-all hover:border-mercamio-300 hover:bg-mercamio-50"
                >
                  {isExporting ? "Generando..." : "CSV"}
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("xlsx")}
                  disabled={isExporting}
                  className="rounded-full border border-slate-900 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-100"
                >
                  {isExporting ? "Generando..." : "XLSX"}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-900">{error}</p>
          </div>
        )}

        {isLoading ? (
          <LoadingSkeleton />
        ) : lines.length === 0 ? (
          <EmptyState
            title={`No hay datos para ${selectedSedeName} ${dateRangeLabel}.`}
            description="Prueba otra fecha o sede para ver actividad."
          />
        ) : (
          <div className="space-y-6">
            <ViewToggle viewMode={viewMode} onChange={handleViewChange} />
            {(viewMode === "cards" || viewMode === "comparison") && (
              <SearchAndSort
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortBy={sortBy}
                onSortByChange={setSortBy}
                sortOrder={sortOrder}
                onSortOrderToggle={handleSortOrderToggle}
              />
            )}

            {viewMode === "comparison" ? (
              filteredLines.length > 0 ? (
                <LineComparisonTable
                  lines={filteredLines}
                  dailyDataSet={dailyDataSet}
                  sedes={orderedSedes}
                  dateRange={dateRange}
                  defaultSedeIds={scopedSedeIds}
                  hasData={hasRangeData}
                />
              ) : (
                <EmptyState
                  title="No hay líneas para comparar con este filtro."
                  description="Ajusta el filtro para ver el comparativo de líneas."
                />
              )
            ) : viewMode === "chart" ? (
              <div data-animate="chart-card">
                <ChartVisualization
                  ref={chartExportRef}
                  dailyDataSet={dailyDataSet}
                  selectedSedeIds={scopedSedeIds}
                  availableDates={availableDates}
                  dateRange={dateRange}
                  lines={lines}
                  sedes={orderedSedes}
                />
              </div>
            ) : viewMode === "trends" ? (
              <LineTrends
                ref={trendsExportRef}
                dailyDataSet={dailyDataSet}
                selectedSedeIds={scopedSedeIds}
                availableDates={availableDates}
                lines={lines}
                sedes={orderedSedes}
                dateRange={dateRange}
              />
            ) : viewMode === "hourly" ? (
              <HourlyAnalysis
                availableDates={availableDates}
                availableSedes={orderedSedes}
                defaultDate={dateRange.end}
                defaultSede={selectedSede || undefined}
                allowedLineIds={!isAdmin ? allowedLineIds : undefined}
                sections={["map"]}
                dashboardContext="productividad"
                exportRef={hourlyExportRef}
              />
            ) : viewMode === "m2" ? (
              <M2MetricsSection
                ref={m2ExportRef}
                dailyDataSet={dailyDataSet}
                sedes={orderedSedes}
                selectedSedeIds={selectedSedeIds}
                dateRange={dateRange}
              />
            ) : (
              <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredLines.map((line) => (
                  <LineCard key={line.id} line={line} hasData={hasRangeData} />
                ))}
              </section>
            )}

            {viewMode === "cards" && filteredLines.length === 0 && (
              <EmptyState
                title="No hay líneas para este segmento."
                description="Prueba otro filtro o revisa un rango distinto."
                actionLabel="Ver todas las líneas"
                onAction={() => setLineFilter("all")}
              />
            )}

          </div>
        )}
      </div>
    </div>
  );
}
