"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatCOP,
  getSedeM2,
  hasLaborDataForLine,
} from "@/lib/shared/calc";
import {
  escapeCsvValue,
  sanitizeExportText,
} from "@/lib/shared/export-utils";
import { formatDateLabel } from "@/lib/shared/utils";
import type { Sede } from "@/lib/shared/constants";
import type { DailyProductivity, LineMetrics } from "@/types";
import type { DateRange, ViewExportHandle } from "./types";
import {
  dateLabelOptions,
  formatRangeLabel,
  parseDateKey,
  toDateKey,
} from "./date-utils";
import { getHeatColor } from "./formatters";
import { normalizeSedeKey } from "./sede-utils";

const loadExcelJs = () => import("exceljs");

export type LineTrendsProps = {
  dailyDataSet: DailyProductivity[];
  selectedSedeIds: string[];
  availableDates: string[];
  lines: LineMetrics[];
  sedes: Sede[];
  dateRange: DateRange;
};

export const LineTrends = forwardRef<ViewExportHandle, LineTrendsProps>(({
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

