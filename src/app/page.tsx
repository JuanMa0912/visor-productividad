"use client";

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  useDeferredValue,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { animate, remove } from "animejs";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { logExportDownload } from "@/lib/client/log-export-download";
import {
  escapeCsvValue,
  formatPdfDate,
  sanitizeExportText,
} from "@/lib/shared/export-utils";
import type { Row, Worksheet } from "exceljs";
import { LineCard } from "@/components/LineCard";
import { LineComparisonTable } from "@/components/LineComparisonTable";
import { TopBar } from "@/components/TopBar";
import { EmptyState } from "@/components/productividad/EmptyState";
import { LoadingSkeleton } from "@/components/productividad/LoadingSkeleton";
import { SearchAndSort } from "@/components/productividad/SearchAndSort";
import { ViewToggle } from "@/components/productividad/ViewToggle";
import { hasLaborDataForLine } from "@/lib/shared/calc";
import { DEFAULT_LINES, SEDE_GROUPS } from "@/lib/shared/constants";
import { DailyProductivity, LineMetrics } from "@/types";
import type {
  DateRange,
  ViewExportHandle,
  ExportPayload,
} from "@/features/productividad/types";
import {
  toDateKey,
  formatRangeLabel,
  getPreviousComparableRange,
} from "@/features/productividad/date-utils";
import { useProductivityData } from "@/features/productividad/use-productivity-data";
import {
  normalizeSedeKey,
  sortSedesByOrder,
  buildCompanyOptions,
  resolveSelectedSedeIds,
} from "@/features/productividad/sede-utils";
import { ChartVisualization } from "@/features/productividad/chart-visualization";
import { LineTrends } from "@/features/productividad/line-trends";
import { M2MetricsSection } from "@/features/productividad/m2-metrics-section";

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

const loadExcelJs = () => import("exceljs");

const useAnimations = (
  isLoading: boolean,
  filteredLinesCount: number,
  viewMode:
    | "cards"
    | "comparison"
    | "chart"
    | "trends"
    | "hourly"
    | "cashier"
    | "m2",
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

      if (viewMode === "hourly" || viewMode === "cashier") {
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

const aggregateLines = (
  dailyData: DailyProductivity[],
  options?: { allowedLineIds?: string[] },
): LineMetrics[] => {
  const lineMap = new Map<
    string,
    { id: string; name: string; sales: number; hours: number; cost: number }
  >();

  const allowedIds =
    options?.allowedLineIds && options.allowedLineIds.length > 0
      ? new Set(options.allowedLineIds.map((id) => id.toLowerCase()))
      : null;

  dailyData.forEach((day) => {
    day.lines.forEach((line) => {
      if (allowedIds && !allowedIds.has(line.id.toLowerCase())) return;
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

  const padLines = allowedIds
    ? DEFAULT_LINES.filter((line) => allowedIds.has(line.id))
    : DEFAULT_LINES;

  padLines.forEach((line) => {
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
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Home() {
  // Estado para controlar hidratación
  const [mounted, setMounted] = useState(false);
  const { user: authUser, status: authStatus } = useRequireAuth();
  const { isAdmin, hasSection, hasSubsection } = usePermissions();
  // `authLoaded` y `username` se derivan ahora del provider central.
  const authLoaded = authStatus !== "loading";
  const username = authUser?.username ?? null;
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
    "cards" | "comparison" | "chart" | "trends" | "hourly" | "cashier" | "m2"
  >("cards");
  const [cashierMonthCompare, setCashierMonthCompare] = useState(false);
  const [cashierCompareTransitionLoading, setCashierCompareTransitionLoading] =
    useState(false);

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
          .map((line) =>
            typeof line === "string" ? line.trim().toLowerCase() : "",
          )
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
          viewMode?:
            | "cards"
            | "comparison"
            | "chart"
            | "trends"
            | "hourly"
            | "cashier"
            | "m2";
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
          | "cashier"
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
  const {
    dailyDataSet: rawDailyDataSet,
    availableSedes,
    isLoading,
    error,
  } = useProductivityData();
  const dailyDataSet = useMemo(() => {
    if (isAdmin || allowedLineIds.length === 0) return rawDailyDataSet;
    const allowedSet = new Set(allowedLineIds);
    return rawDailyDataSet
      .map((item) => ({
        ...item,
        lines: item.lines.filter((line) =>
          allowedSet.has(line.id.toLowerCase()),
        ),
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
  const exportMaxDate = allAvailableDates[allAvailableDates.length - 1] ?? "";

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

  /**
   * Al abrir la pagina (una sola vez por sesion), forzar el rango por defecto a
   * "el dia de ayer" (dia anterior al actual). Si la app no tiene aun datos de
   * ayer, caemos al ultimo dia con informacion disponible. Cualquier ajuste
   * manual posterior del usuario se respeta hasta el proximo F5.
   */
  const yesterdayDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (!prefsReady) return;
    if (availableDates.length === 0) return;
    if (yesterdayDefaultAppliedRef.current) return;
    yesterdayDefaultAppliedRef.current = true;

    const min = availableDates[0];
    const max = availableDates[availableDates.length - 1];

    const todayObj = new Date();
    todayObj.setHours(12, 0, 0, 0);
    const yesterdayObj = new Date(todayObj);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    let target = toDateKey(yesterdayObj);

    if (target > max) target = max;
    if (target < min) target = min;

    setDateRange({ start: target, end: target });
  }, [availableDates, prefsReady]);

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

  const scopedLineIds =
    !isAdmin && allowedLineIds.length > 0 ? allowedLineIds : undefined;

  const lines = useMemo(
    () => aggregateLines(rangeDailyData, { allowedLineIds: scopedLineIds }),
    [rangeDailyData, scopedLineIds],
  );
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
    (options?: {
      sedeIds?: string[];
      dateRange?: DateRange;
    }): ExportPayload => {
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

      const exportLines = aggregateLines(rangeData, {
        allowedLineIds: scopedLineIds,
      });
      const previousLines = aggregateLines(previousRangeData, {
        allowedLineIds: scopedLineIds,
      });
      const previousLineMap = new Map(
        previousLines.map((line) => [line.id, line]),
      );
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
          const currentLine = item.lines.find(
            (candidate) => candidate.id === line.id,
          );
          if (!currentLine) return;
          const existing = currentBySede.get(item.sede) ?? {
            sales: 0,
            hours: 0,
            sedeName:
              orderedSedes.find((sede) => sede.id === item.sede)?.name ??
              item.sede,
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
          const previousLine = item.lines.find(
            (candidate) => candidate.id === line.id,
          );
          if (!previousLine) return;
          const existing = previousBySede.get(item.sede) ?? {
            sales: 0,
            hours: 0,
            sedeName:
              orderedSedes.find((sede) => sede.id === item.sede)?.name ??
              item.sede,
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
            previous.hours > 0
              ? previous.sales / 1_000_000 / previous.hours
              : 0;
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
      scopedLineIds,
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
    if (authStatus !== "authenticated" || !authUser) return;
    if (!hasSection("producto") || !hasSubsection("mix-y-linea")) {
      router.replace("/secciones");
      return;
    }
    setPendingSedeKey(resolveUsernameSedeKey(authUser.username));
    setAllowedLineIds(resolveAllowedLineIds(authUser.allowedLines));
  }, [
    authStatus,
    authUser,
    hasSection,
    hasSubsection,
    resolveAllowedLineIds,
    resolveUsernameSedeKey,
    router,
  ]);

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
  }, [
    dateRange.end,
    dateRange.start,
    exportMaxDate,
    exportMinDate,
    selectedSedeIds,
  ]);

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
    (
      value:
        | "cards"
        | "comparison"
        | "chart"
        | "trends"
        | "hourly"
        | "cashier"
        | "m2",
    ) => {
      setViewMode(value);
      if (value !== "cashier") {
        setCashierMonthCompare(false);
        setCashierCompareTransitionLoading(false);
      }
    },
    [],
  );

  const handleCashierViewReady = useCallback(() => {
    setCashierCompareTransitionLoading(false);
  }, []);

  const handleCashierMonthComparisonToggle = useCallback(() => {
    setCashierCompareTransitionLoading(true);
    setCashierMonthCompare((value) => !value);
  }, []);

  const handleSortOrderToggle = useCallback(() => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  }, []);

  const handleDownloadCsv = useCallback(
    (payload?: ExportPayload) => {
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
    },
    [buildExportPayload],
  );

  const handleDownloadXlsx = useCallback(
    async (payload?: ExportPayload) => {
      const ExcelJS = await loadExcelJs();
      const {
        pdfLines: exportLines,
        selectedScopeLabel: exportScopeLabel,
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
              typeof currentFont.name === "string"
                ? currentFont.name
                : "Calibri",
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
        [
          "Rango comparativo:",
          comparisonDateRangeLabel || "Sin rango definido",
        ],
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
        currentHoursTotal > 0
          ? currentSalesTotal / 1_000_000 / currentHoursTotal
          : 0;
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
            ? (currentSalesPerHour - previousSalesPerHour) /
              previousSalesPerHour
            : null,
        ],
        ["Líneas incluidas", pdfLines.length, pdfLines.length, 0, null],
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
          row.getCell(2).numFmt = "#,##0.00";
          row.getCell(3).numFmt = "#,##0.00";
          row.getCell(4).numFmt = "#,##0.00";
        } else if (metric === "Vta/Hr consolidada") {
          row.getCell(2).numFmt = "#,##0.000";
          row.getCell(3).numFmt = "#,##0.000";
          row.getCell(4).numFmt = "#,##0.000";
        } else {
          row.getCell(2).numFmt = "#,##0";
          row.getCell(3).numFmt = "#,##0";
          row.getCell(4).numFmt = "#,##0";
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
          linesWithWorstDelta[0]?.salesDeltaPct !== null &&
          linesWithWorstDelta[0]
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
          previousHoursTotal !== 0
            ? totalHoursDelta / previousHoursTotal
            : null,
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
          row.getCell(2).numFmt = "#,##0.00";
          row.getCell(3).numFmt = "#,##0.00";
          row.getCell(4).numFmt = "#,##0.00";
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
          new Map(
            rankedSedes.map((detail, index) => [detail.sedeId, index + 1]),
          ),
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
      allLinesSheet.getColumn(5).numFmt = "#,##0.000";
      allLinesSheet.getColumn(6).numFmt = "#,##0.000";
      allLinesSheet.getColumn(7).numFmt = "#,##0.00";
      allLinesSheet.getColumn(8).numFmt = "#,##0.00";
      comparisonSheet.getColumn(4).numFmt = '"$"#,##0';
      comparisonSheet.getColumn(5).numFmt = "#,##0.00";
      comparisonSheet.getColumn(6).numFmt = "#,##0.000";
      comparisonSheet.getColumn(7).numFmt = '"$"#,##0';
      comparisonSheet.getColumn(8).numFmt = "#,##0.00";
      comparisonSheet.getColumn(9).numFmt = "#,##0.000";
      rankingSheet.getColumn(4).numFmt = '"$"#,##0';
      rankingSheet.getColumn(5).numFmt = "0.00%";
      rankingSheet.getColumn(6).numFmt = "#,##0.00";
      rankingSheet.getColumn(7).numFmt = "0.00%";
      rankingSheet.getColumn(8).numFmt = "#,##0.000";
      rankingSheet.getColumn(9).numFmt = '"$"#,##0';
      rankingSheet.getColumn(10).numFmt = '"$"#,##0';
      rankingSheet.getColumn(11).numFmt = "0.00%";
      detailSheet.getColumn(6).numFmt = '"$"#,##0';
      detailSheet.getColumn(7).numFmt = "0.00%";
      detailSheet.getColumn(8).numFmt = "#,##0.00";
      detailSheet.getColumn(9).numFmt = "#,##0.000";
      detailSheet.getColumn(10).numFmt = '"$"#,##0';
      detailSheet.getColumn(11).numFmt = "#,##0.00";
      detailSheet.getColumn(12).numFmt = "#,##0.000";
      dailyLineSheet.getColumn(5).numFmt = '"$"#,##0';
      dailyLineSheet.getColumn(6).numFmt = "#,##0.00";
      dailyLineSheet.getColumn(7).numFmt = "#,##0.000";
      dailySedeLineSheet.getColumn(7).numFmt = '"$"#,##0';
      dailySedeLineSheet.getColumn(8).numFmt = "#,##0.00";
      dailySedeLineSheet.getColumn(9).numFmt = "#,##0.000";
      linesWithSedesSheet.getColumn(3).numFmt = '"$"#,##0';
      linesWithSedesSheet.getColumn(4).numFmt = '"$"#,##0';
      linesWithSedesSheet.getColumn(5).numFmt = '"$"#,##0';
      linesWithSedesSheet.getColumn(6).numFmt = "0.00%";
      linesWithSedesSheet.getColumn(7).numFmt = "#,##0.000";
      linesWithSedesSheet.getColumn(8).numFmt = "#,##0.00";
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
    },
    [buildExportPayload],
  );

  const handleDownloadPdf = useCallback(
    async (payload?: ExportPayload) => {
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
        (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable
          ?.finalY ?? 0;
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
        [
          "Rango comparativo:",
          comparisonDateRangeLabel || "Sin rango definido",
        ],
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
              : [
                  [
                    "",
                    "Sin datos de sede para esta línea",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                    "-",
                  ],
                ];

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
    },
    [buildExportPayload],
  );

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
          logExportDownload({
            panelPath: "/",
            exportKind: "productividad-lineas",
            format,
            fileName:
              format === "xlsx"
                ? "reporte-productividad.xlsx"
                : `reporte-productividad-${format}`,
            dateFrom: payload.dateRange.start,
            dateTo: payload.dateRange.end,
            filters: { sedes: exportSedeIds, viewMode },
            rowCount: payload.pdfLines.length,
          });

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
              ? (chartExportRef.current?.exportCsv() ?? false)
              : ((await chartExportRef.current?.exportXlsx?.()) ?? false);
        } else if (viewMode === "trends") {
          exported =
            format === "csv"
              ? (trendsExportRef.current?.exportCsv() ?? false)
              : ((await trendsExportRef.current?.exportXlsx?.()) ?? false);
        } else if (viewMode === "hourly" || viewMode === "cashier") {
          exported =
            format === "csv"
              ? (hourlyExportRef.current?.exportCsv() ?? false)
              : ((await hourlyExportRef.current?.exportXlsx?.()) ?? false);
        } else if (viewMode === "m2") {
          exported =
            format === "csv"
              ? (m2ExportRef.current?.exportCsv() ?? false)
              : ((await m2ExportRef.current?.exportXlsx?.()) ?? false);
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
          if (prev === "hourly") return "cashier";
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
    <div className="min-h-screen bg-background text-foreground">
      <AppTopBar backHref="/productividad" backLabel="Volver a productividad" />
      <div className="px-3 pb-8 pt-4 sm:px-4 sm:pb-12 sm:pt-6 md:px-8 md:pb-16 md:pt-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-6 md:gap-10">
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
          />

          {exportModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="max-h-[min(92dvh,40rem)] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200/70 bg-white p-5 shadow-2xl sm:p-6">
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
                        onClick={() =>
                          setExportSedeIds(orderedSedes.map((sede) => sede.id))
                        }
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
                          onChange={(e) =>
                            handleExportStartChange(e.target.value)
                          }
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
                          onChange={(e) =>
                            handleExportEndChange(e.target.value)
                          }
                          className="rounded-lg border border-slate-200/70 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-mercamio-400 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Rango disponible: {exportMinDate || "--"} a{" "}
                      {exportMaxDate || "--"}
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
                  key={`hourly-${dateRange.start}-${dateRange.end}-${selectedSede}`}
                  availableDates={availableDates}
                  availableSedes={orderedSedes}
                  defaultDate={dateRange.end}
                  defaultSede={selectedSede || undefined}
                  allowedLineIds={!isAdmin ? allowedLineIds : undefined}
                  sections={["map"]}
                  showTopDateFilter={false}
                  dashboardContext="productividad"
                  exportRef={hourlyExportRef}
                />
              ) : viewMode === "cashier" ? (
                <div className="relative min-h-[240px]">
                  {cashierCompareTransitionLoading && (
                    <div
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-3xl bg-background/75 backdrop-blur-sm"
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <Loader2 className="h-10 w-10 animate-spin text-fuchsia-700" />
                      <span className="text-sm font-medium text-slate-700">
                        Cargando cajeros…
                      </span>
                    </div>
                  )}
                  <HourlyAnalysis
                    key={`cashier-${dateRange.start}-${dateRange.end}-${selectedSede}-${cashierMonthCompare ? "mc" : "p"}-${scopedLineIds?.[0] ?? "all"}`}
                    availableDates={availableDates}
                    availableSedes={orderedSedes}
                    defaultDate={dateRange.end}
                    defaultSede={selectedSede || undefined}
                    defaultLine={scopedLineIds?.[0] ?? "cajas"}
                    allowedLineIds={!isAdmin ? allowedLineIds : undefined}
                    sections={["map"]}
                    showTopDateFilter={false}
                    showComparison={false}
                    showPersonBreakdown
                    defaultPersonBreakdownView="individual"
                    hidePersonBreakdownTabs
                    dashboardContext="productividad"
                    exportRef={hourlyExportRef}
                    cashierDateRange={dateRange}
                    cashierMonthComparison={cashierMonthCompare}
                    onCashierMonthComparisonToggle={
                      handleCashierMonthComparisonToggle
                    }
                    onCashierViewReady={handleCashierViewReady}
                  />
                </div>
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
                    <LineCard
                      key={line.id}
                      line={line}
                      hasData={hasRangeData}
                    />
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
    </div>
  );
}
