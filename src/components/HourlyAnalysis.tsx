"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  DollarSign,
  ChevronDown,
  Clock,
  Sparkles,
  Download,
} from "lucide-react";
import * as ExcelJS from "exceljs";
import { formatDateLabel } from "@/lib/utils";
import { DEFAULT_LINES } from "@/lib/constants";
import type { Sede } from "@/lib/constants";
import type { HourlyAnalysisData } from "@/types";

interface HourlyAnalysisProps {
  availableDates: string[];
  availableSedes: Sede[];
  allowedLineIds?: string[];
  defaultDate?: string;
  defaultSede?: string;
  sections?: Array<"map" | "overtime">;
  defaultSection?: "map" | "overtime";
  showTimeFilters?: boolean;
  showTopDateFilter?: boolean;
  showTopLineFilter?: boolean;
  showSedeFilters?: boolean;
  showDepartmentFilterInOvertime?: boolean;
  enableOvertimeDateRange?: boolean;
  alexConsistencyMode?: boolean;
}

const hourlyDateLabelOptions: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
};

type OvertimeEmployee = NonNullable<
  HourlyAnalysisData["overtimeEmployees"]
>[number];

const getHeatColor = (ratioPercent: number) => {
  if (ratioPercent >= 110) return "#16a34a";
  if (ratioPercent >= 100) return "#facc15";
  if (ratioPercent >= 90) return "#f97316";
  return "#dc2626";
};

const formatProductivity = (value: number) => value.toFixed(3);

const formatHoursBase60 = (value: number) => {
  if (!Number.isFinite(value)) return "0.00";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let hours = Math.floor(abs);
  let minutes = Math.round((abs - hours) * 60);
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  return `${sign}${hours}.${String(minutes).padStart(2, "0")}`;
};

const decimalHoursToMinutes = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 60);
};

const parseBase60HoursInputToMinutes = (value: string): number | null => {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace(",", ".");
  const [hoursPartRaw, minutesPartRaw] = normalized.split(".");
  const hours = Number(hoursPartRaw);
  if (!Number.isFinite(hours) || hours < 0) return null;

  if (minutesPartRaw === undefined) {
    return Math.round(hours * 60);
  }

  const onlyDigits = minutesPartRaw.replace(/\D/g, "");
  if (!onlyDigits) return Math.round(hours * 60);

  // 9.2 -> 9:20, 9.12 -> 9:12
  const paddedMinutes =
    onlyDigits.length === 1 ? `${onlyDigits}0` : onlyDigits.slice(0, 2);
  const minutes = Number(paddedMinutes);
  if (!Number.isFinite(minutes)) return null;

  return Math.round(hours) * 60 + Math.min(59, Math.max(0, minutes));
};

const calcVtaHr = (sales: number, laborHours: number) =>
  laborHours > 0 ? sales / 1_000_000 / laborHours : 0;

const parseTimeToMinute = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return 0;
  }
  return hours * 60 + minutes;
};

const OVERTIME_QUICK_RANGE_OPTIONS: Array<{
  value: string;
  label: string;
  min: number;
  max: number;
}> = Array.from({ length: 16 }, (_value, hour) => ({
  value: `${hour}-${hour + 1}`,
  label: `${hour} - ${hour + 1} horas`,
  min: hour,
  max: hour + 1,
}));

const OVERTIME_PAGE_SIZE = 150;
const OVERTIME_PAGE_TAB_WINDOW = 8;
const ALERT_THRESHOLD_MINUTES = 9 * 60 + 20;
const TWO_MARKS_ALERT_THRESHOLD_MINUTES = 7 * 60 + 29;

const minuteToTime = (value: number) => {
  const safe = Math.max(0, Math.min(1439, value));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const normalizeSedeValue = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const canonicalizeSedeValue = (value: string) => {
  const normalized = normalizeSedeValue(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeValue("Calle 5ta");
  }
  return normalized;
};

const PPT_SEDE_KEYS = new Set([
  "panificadora",
  "planta desposte mixto",
  "planta desprese pollo",
]);

const isPptSede = (sedeName: string) =>
  PPT_SEDE_KEYS.has(canonicalizeSedeValue(sedeName));

const normalizeIncidentValue = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const isAbsenceIncident = (value: string | null | undefined) =>
  normalizeIncidentValue(value).includes("inasistencia");

const HourlyLoadingSkeleton = () => (
  <div className="space-y-3 animate-pulse">
    {Array.from({ length: 14 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <div className="h-4 w-16 shrink-0 rounded-full bg-slate-200/70" />
        <div className="h-9 flex-1 rounded-full bg-slate-200/70" />
        <div className="h-4 w-24 shrink-0 rounded-full bg-slate-200/70" />
      </div>
    ))}
  </div>
);

const HourBar = ({
  label,
  productivity,
  totalSales,
  employeesPresent,
  maxProductivity,
  isExpanded,
  onToggle,
  lines,
  employeesByLine,
  heatColor,
  bucketMinutes,
}: {
  label: string;
  productivity: number;
  totalSales: number;
  employeesPresent: number;
  maxProductivity: number;
  isExpanded: boolean;
  onToggle: () => void;
  lines: HourlyAnalysisData["hours"][number]["lines"];
  employeesByLine?: Record<string, number>;
  heatColor: string;
  bucketMinutes: number;
}) => {
  const percentage =
    maxProductivity > 0 ? (productivity / maxProductivity) * 100 : 0;
  const hasActivity = totalSales > 0 || employeesPresent > 0;

  return (
    <div className="group rounded-2xl border border-slate-200/60 bg-white/80 p-2 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] transition-all hover:-translate-y-0.5 hover:border-amber-200/70 hover:bg-white">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasActivity}
        className="flex w-full items-center gap-3 text-left transition-opacity disabled:opacity-40"
      >
        <div className="w-26 shrink-0 text-right">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/60">
            {label}
          </span>
        </div>

        <div className="relative h-9 flex-1 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
          {percentage > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(percentage, 2)}%`,
                backgroundColor: heatColor,
              }}
            />
          )}
          {hasActivity && (
            <div className="absolute inset-0 flex items-center justify-between px-3">
              <span className="inline-flex items-center rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200/60">
                Vta/Hr: {formatProductivity(productivity)}
              </span>
            </div>
          )}
        </div>

        <div className="flex w-40 shrink-0 items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
            <Users className="h-3.5 w-3.5" />
            {employeesPresent}
          </span>
          {hasActivity && (
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 transition-transform group-hover:text-mercamio-600 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          )}
        </div>
      </button>

      {isExpanded && hasActivity && (
        <div className="mt-2 ml-26 mr-40 rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
          <div className="grid grid-cols-12 gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500 ring-1 ring-slate-200/60">
            <span className="col-span-8">Linea</span>
            <span className="col-span-4 text-right">Vta/Hr</span>
          </div>
          <div className="mt-2 space-y-2">
            {lines
              .filter((l) => l.sales > 0)
              .sort((a, b) => b.sales - a.sales)
              .map((line) => {
                const lineEmployees = employeesByLine?.[line.lineId] ?? 0;
                const lineLaborHours = lineEmployees * (bucketMinutes / 60);
                const lineProductivity = calcVtaHr(line.sales, lineLaborHours);
                return (
                  <div
                    key={line.lineId}
                    className="grid grid-cols-12 items-center gap-2 rounded-xl border border-slate-200/60 bg-white px-3 py-2 text-sm shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)]"
                  >
                    <div className="col-span-8">
                      <p className="font-semibold text-slate-900">
                        {line.lineName}
                      </p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: "100%",
                            backgroundColor: heatColor,
                          }}
                        />
                      </div>
                    </div>
                    <span className="col-span-4 text-right font-semibold text-slate-800">
                      {formatProductivity(lineProductivity)}
                    </span>
                  </div>
                );
              })}
          </div>
          {lines.every((l) => l.sales === 0) && (
            <p className="py-2 text-center text-xs text-slate-500">
              Sin ventas registradas en esta hora
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const HourlyAnalysis = ({
  availableDates,
  availableSedes,
  allowedLineIds,
  defaultDate,
  defaultSede,
  sections = ["map", "overtime"],
  defaultSection = "map",
  showTimeFilters = true,
  showTopDateFilter = true,
  showTopLineFilter = true,
  showSedeFilters = true,
  showDepartmentFilterInOvertime = false,
  enableOvertimeDateRange = false,
  alexConsistencyMode = false,
}: HourlyAnalysisProps) => {
  const enabledSections = useMemo(() => {
    const unique = Array.from(new Set(sections));
    return unique.length > 0 ? unique : (["map"] as Array<"map" | "overtime">);
  }, [sections]);
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? "");
  const [selectedLine, setSelectedLine] = useState("");
  const [selectedSedes, setSelectedSedes] = useState<string[]>(
    defaultSede ? [defaultSede] : [],
  );
  const [bucketMinutes, setBucketMinutes] = useState(60);
  const [minuteRangeStart, setMinuteRangeStart] = useState(6 * 60);
  const [minuteRangeEnd, setMinuteRangeEnd] = useState(21 * 60 + 50);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDate, setCompareDate] = useState("");
  const [hourlyData, setHourlyData] = useState<HourlyAnalysisData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [compareData, setCompareData] = useState<HourlyAnalysisData | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [expandedSlotStart, setExpandedSlotStart] = useState<number | null>(
    null,
  );
  const [hourlySection, setHourlySection] = useState<"map" | "overtime">(
    enabledSections.includes(defaultSection)
      ? defaultSection
      : enabledSections[0],
  );
  const [overtimeRangeMin, setOvertimeRangeMin] = useState("8");
  const [overtimeRangeMax, setOvertimeRangeMax] = useState("10");
  const [overtimeSedeFilter, setOvertimeSedeFilter] = useState<string[]>([]);
  const [overtimePersonFilter, setOvertimePersonFilter] = useState("");
  const [overtimeDepartmentFilter, setOvertimeDepartmentFilter] = useState<
    string[]
  >([]);
  const [overtimeEmployeeTypeFilter, setOvertimeEmployeeTypeFilter] =
    useState("all");
  const [overtimeMarksFilter, setOvertimeMarksFilter] = useState("all");
  const [overtimeAlertOnly, setOvertimeAlertOnly] = useState(false);
  const [overtimeAbsenceOnly, setOvertimeAbsenceOnly] = useState(false);
  const [overtimeOddMarksOnly, setOvertimeOddMarksOnly] = useState(false);
  const [overtimeAlertMode, setOvertimeAlertMode] = useState<"920" | "720-2marks">(
    "920",
  );
  const [overtimeExcludedIds, setOvertimeExcludedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [overtimeQuickRange, setOvertimeQuickRange] = useState("custom");
  const [overtimeDateOrder, setOvertimeDateOrder] = useState<"asc" | "desc">(
    "desc",
  );
  const [overtimeDateStart, setOvertimeDateStart] = useState(defaultDate ?? "");
  const [overtimeDateEnd, setOvertimeDateEnd] = useState(defaultDate ?? "");
  const [overtimePage, setOvertimePage] = useState(1);
  const [overtimeSedeOpen, setOvertimeSedeOpen] = useState(false);
  const [overtimeDepartmentOpen, setOvertimeDepartmentOpen] = useState(false);
  const [overtimeSedePopoverPos, setOvertimeSedePopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [overtimeDepartmentPopoverPos, setOvertimeDepartmentPopoverPos] =
    useState<{
      top: number;
      left: number;
      width: number;
    } | null>(null);
  const overtimeSedeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overtimeSedePanelRef = useRef<HTMLDivElement | null>(null);
  const overtimeDepartmentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overtimeDepartmentPanelRef = useRef<HTMLDivElement | null>(null);

  const minuteRangeStepSeconds = useMemo(
    () => bucketMinutes * 60,
    [bucketMinutes],
  );
  const bucketOptions = useMemo(() => [60, 30, 20, 15, 10], []);
  // Modo estricto desactivado: usuarios con rol Alex pueden ajustar filtros libremente.
  const isAlexStrictMode = false;

  const availableDateRange = useMemo(() => {
    if (availableDates.length === 0) return { min: "", max: "" };
    const sorted = [...availableDates].sort();
    return { min: sorted[0], max: sorted[sorted.length - 1] };
  }, [availableDates]);

  const allowedLineSet = useMemo(
    () =>
      new Set(
        (allowedLineIds ?? [])
          .map((line) => line.trim().toLowerCase())
          .filter(Boolean),
      ),
    [allowedLineIds],
  );
  const hasLineRestriction = allowedLineSet.size > 0;

  const lineOptions = useMemo(() => {
    const fallback = DEFAULT_LINES.map((line) => ({
      id: line.id,
      name: line.name,
    })).filter((line) =>
      hasLineRestriction ? allowedLineSet.has(line.id.toLowerCase()) : true,
    );
    if (!hourlyData) return fallback;

    const map = new Map<string, string>();
    fallback.forEach((line) => map.set(line.id, line.name));
    hourlyData.hours.forEach((slot) => {
      slot.lines.forEach((line) => {
        if (
          hasLineRestriction &&
          !allowedLineSet.has(line.lineId.toLowerCase())
        ) {
          return;
        }
        if (!map.has(line.lineId)) {
          map.set(line.lineId, line.lineName);
        }
      });
    });

    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allowedLineSet, hasLineRestriction, hourlyData]);
  const effectiveSelectedLine =
    hasLineRestriction &&
    selectedLine &&
    !allowedLineSet.has(selectedLine.toLowerCase())
      ? ""
      : selectedLine;

  useEffect(() => {
    const available = new Set(availableSedes.map((s) => s.name));
    setSelectedSedes((prev) => {
      const next = prev.filter((name) => available.has(name));
      if (
        next.length === prev.length &&
        next.every((name, index) => name === prev[index])
      ) {
        return prev;
      }
      return next;
    });
  }, [availableSedes]);

  useEffect(() => {
    if (!enabledSections.includes(hourlySection)) {
      setHourlySection(enabledSections[0]);
    }
  }, [enabledSections, hourlySection]);

  const showMapSection = enabledSections.includes("map");
  const showOvertimeSection = enabledSections.includes("overtime");
  const isOvertimeOnlyMode = showOvertimeSection && !showMapSection;
  const showSectionToggle = enabledSections.length > 1;
  const overtimeFilterControlClass =
    "mt-1 w-full rounded-full border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100";

  useEffect(() => {
    if (!enableOvertimeDateRange || !isOvertimeOnlyMode) return;
    if (!overtimeDateStart && selectedDate) setOvertimeDateStart(selectedDate);
    if (!overtimeDateEnd && selectedDate) setOvertimeDateEnd(selectedDate);
  }, [
    enableOvertimeDateRange,
    isOvertimeOnlyMode,
    overtimeDateEnd,
    overtimeDateStart,
    selectedDate,
  ]);

  useEffect(() => {
    if (!enableOvertimeDateRange || !isOvertimeOnlyMode) return;
    if (overtimeDateEnd && selectedDate !== overtimeDateEnd) {
      setSelectedDate(overtimeDateEnd);
    }
  }, [
    enableOvertimeDateRange,
    isOvertimeOnlyMode,
    overtimeDateEnd,
    selectedDate,
  ]);

  const toggleSede = (sedeName: string) => {
    setSelectedSedes((prev) =>
      prev.includes(sedeName)
        ? prev.filter((name) => name !== sedeName)
        : [...prev, sedeName],
    );
  };

  const pptSedeNames = useMemo(
    () =>
      availableSedes.map((sede) => sede.name).filter((name) => isPptSede(name)),
    [availableSedes],
  );

  const isPptSelected = useMemo(
    () =>
      pptSedeNames.length > 0 &&
      pptSedeNames.every((name) => selectedSedes.includes(name)),
    [pptSedeNames, selectedSedes],
  );

  const togglePptSedes = () => {
    if (pptSedeNames.length === 0) return;
    setSelectedSedes((prev) => {
      const allSelected = pptSedeNames.every((name) => prev.includes(name));
      if (allSelected) {
        return prev.filter((name) => !pptSedeNames.includes(name));
      }
      const next = new Set(prev);
      pptSedeNames.forEach((name) => next.add(name));
      return Array.from(next);
    });
  };

  const sedeFilterButtons = useMemo(() => {
    const buttons: Array<
      | { key: string; label: string; type: "single"; sedeName: string }
      | { key: string; label: string; type: "ppt" }
    > = [];
    let pptAdded = false;

    for (const sede of availableSedes) {
      if (isPptSede(sede.name)) {
        if (!pptAdded) {
          buttons.push({ key: "ppt", label: "PPT", type: "ppt" });
          pptAdded = true;
        }
        continue;
      }
      buttons.push({
        key: sede.id,
        label: sede.name,
        type: "single",
        sedeName: sede.name,
      });
    }

    return buttons;
  }, [availableSedes]);

  const toggleAllSedes = () => {
    setSelectedSedes((prev) =>
      prev.length === availableSedes.length
        ? []
        : availableSedes.map((sede) => sede.name),
    );
  };

  const toggleOvertimeSede = (sedeName: string) => {
    setOvertimeSedeFilter((prev) =>
      prev.includes(sedeName)
        ? prev.filter((name) => name !== sedeName)
        : [...prev, sedeName],
    );
  };

  const clearOvertimeSedeFilter = () => {
    setOvertimeSedeFilter([]);
  };

  const toggleOvertimeDepartment = (departmentName: string) => {
    setOvertimeDepartmentFilter((prev) =>
      prev.includes(departmentName)
        ? prev.filter((name) => name !== departmentName)
        : [...prev, departmentName],
    );
  };

  const clearOvertimeDepartmentFilter = () => {
    setOvertimeDepartmentFilter([]);
  };

  const updateOvertimeSedePopoverPos = () => {
    const trigger = overtimeSedeTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setOvertimeSedePopoverPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
    });
  };

  const updateOvertimeDepartmentPopoverPos = () => {
    const trigger = overtimeDepartmentTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setOvertimeDepartmentPopoverPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!overtimeSedeOpen) return;
    updateOvertimeSedePopoverPos();

    const onResizeOrScroll = () => updateOvertimeSedePopoverPos();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (overtimeSedeTriggerRef.current?.contains(target)) return;
      if (overtimeSedePanelRef.current?.contains(target)) return;
      setOvertimeSedeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOvertimeSedeOpen(false);
    };

    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overtimeSedeOpen]);

  useEffect(() => {
    if (!overtimeDepartmentOpen) return;
    updateOvertimeDepartmentPopoverPos();

    const onResizeOrScroll = () => updateOvertimeDepartmentPopoverPos();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (overtimeDepartmentTriggerRef.current?.contains(target)) return;
      if (overtimeDepartmentPanelRef.current?.contains(target)) return;
      setOvertimeDepartmentOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOvertimeDepartmentOpen(false);
    };

    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overtimeDepartmentOpen]);

  const fetchHourly = async (
    date: string,
    lineId: string,
    currentBucketMinutes: number,
    sedeNames: string[],
    overtimeDateRange?: { start: string; end: string },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ date });
    if (lineId) params.set("line", lineId);
    params.set("bucketMinutes", String(currentBucketMinutes));
    sedeNames.forEach((sede) => params.append("sede", sede));
    if (overtimeDateRange?.start)
      params.set("overtimeDateStart", overtimeDateRange.start);
    if (overtimeDateRange?.end)
      params.set("overtimeDateEnd", overtimeDateRange.end);

    const res = await fetch(`/api/hourly-analysis?${params.toString()}`, {
      signal,
    });
    const json = (await res.json()) as HourlyAnalysisData | { error?: string };

    if (!res.ok) {
      throw new Error(
        (json as { error?: string }).error ?? "Error al obtener datos",
      );
    }

    return json as HourlyAnalysisData;
  };

  useEffect(() => {
    if (!selectedDate) {
      setHourlyData(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setExpandedSlotStart(null);

    fetchHourly(
      selectedDate,
      effectiveSelectedLine,
      bucketMinutes,
      selectedSedes,
      enableOvertimeDateRange && isOvertimeOnlyMode
        ? {
            start: overtimeDateStart || selectedDate,
            end: overtimeDateEnd || selectedDate,
          }
        : undefined,
      controller.signal,
    )
      .then((data) => {
        setHourlyData(data);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setHourlyData(null);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [
    selectedDate,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
    enableOvertimeDateRange,
    isOvertimeOnlyMode,
    overtimeDateStart,
    overtimeDateEnd,
  ]);

  useEffect(() => {
    if (!compareEnabled || !compareDate) {
      setCompareData(null);
      setCompareError(null);
      return;
    }

    const controller = new AbortController();
    setCompareError(null);

    fetchHourly(
      compareDate,
      effectiveSelectedLine,
      bucketMinutes,
      selectedSedes,
      undefined,
      controller.signal,
    )
      .then((data) => {
        setCompareData(data);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCompareError(
          err instanceof Error ? err.message : "Error desconocido",
        );
        setCompareData(null);
      });

    return () => controller.abort();
  }, [
    compareEnabled,
    compareDate,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
  ]);

  const rangedHours = useMemo(() => {
    if (!hourlyData) return [];
    return hourlyData.hours.filter(
      (h) =>
        h.slotStartMinute >= minuteRangeStart &&
        h.slotStartMinute <= minuteRangeEnd,
    );
  }, [hourlyData, minuteRangeEnd, minuteRangeStart]);

  const activeHours = useMemo(() => {
    if (!hourlyData) return [];
    return rangedHours.filter(
      (h) => h.totalSales > 0 || h.employeesPresent > 0,
    );
  }, [hourlyData, rangedHours]);

  const mainBaselineSalesPerEmployee = useMemo(() => {
    if (!hourlyData) return 0;
    const totals = rangedHours.reduce(
      (acc, h) => {
        acc.sales += h.totalSales;
        acc.hours += h.employeesPresent * (bucketMinutes / 60);
        return acc;
      },
      { sales: 0, hours: 0 },
    );
    return calcVtaHr(totals.sales, totals.hours);
  }, [rangedHours, hourlyData, bucketMinutes]);

  const compareBaselineSalesPerEmployee = useMemo(() => {
    if (!compareData) return 0;
    const compareRangeHours = compareData.hours.filter(
      (h) =>
        h.slotStartMinute >= minuteRangeStart &&
        h.slotStartMinute <= minuteRangeEnd,
    );
    const totals = compareRangeHours.reduce(
      (acc, h) => {
        acc.sales += h.totalSales;
        acc.hours += h.employeesPresent * (bucketMinutes / 60);
        return acc;
      },
      { sales: 0, hours: 0 },
    );
    return calcVtaHr(totals.sales, totals.hours);
  }, [compareData, minuteRangeEnd, minuteRangeStart, bucketMinutes]);

  const computeHeatRatio = (
    sales: number,
    employees: number,
    baselineSalesPerEmployee: number,
  ) => {
    const laborHours = employees * (bucketMinutes / 60);
    const vtaHr = calcVtaHr(sales, laborHours);
    if (baselineSalesPerEmployee > 0) {
      return (vtaHr / baselineSalesPerEmployee) * 100;
    }
    return 0;
  };

  const maxProductivity = useMemo(() => {
    if (activeHours.length === 0) return 1;
    return Math.max(
      ...activeHours.map((h) => {
        const laborHours = h.employeesPresent * (bucketMinutes / 60);
        return calcVtaHr(h.totalSales, laborHours);
      }),
      1,
    );
  }, [activeHours, bucketMinutes]);

  const chartHours = useMemo(() => {
    if (!hourlyData) return [];

    const compareByHour = new Map(
      compareData?.hours
        .filter(
          (h) =>
            h.slotStartMinute >= minuteRangeStart &&
            h.slotStartMinute <= minuteRangeEnd,
        )
        .map((h) => [h.slotStartMinute, h]) ?? [],
    );

    return rangedHours
      .map((h) => {
        const compareSlot = compareByHour.get(h.slotStartMinute);

        const mainHeatRatio = computeHeatRatio(
          h.totalSales,
          h.employeesPresent,
          mainBaselineSalesPerEmployee,
        );

        const compareSales = compareSlot?.totalSales ?? 0;
        const compareEmployees = compareSlot?.employeesPresent ?? 0;
        const compareHeatRatio = computeHeatRatio(
          compareSales,
          compareEmployees,
          compareBaselineSalesPerEmployee,
        );
        const mainProductivity = calcVtaHr(
          h.totalSales,
          h.employeesPresent * (bucketMinutes / 60),
        );
        const compareProductivity = calcVtaHr(
          compareSales,
          compareEmployees * (bucketMinutes / 60),
        );

        return {
          slotStartMinute: h.slotStartMinute,
          label: h.label.slice(0, 5),
          mainSales: h.totalSales,
          mainProductivity,
          mainHeatRatio,
          mainHeatColor: getHeatColor(mainHeatRatio),
          compareSales,
          compareProductivity,
          compareHeatRatio,
          compareHeatColor: getHeatColor(compareHeatRatio),
        };
      })
      .filter((h) => {
        if (compareEnabled && compareData) {
          return h.mainSales > 0 || h.compareSales > 0;
        }
        return h.mainSales > 0;
      });
  }, [
    compareBaselineSalesPerEmployee,
    compareData,
    compareEnabled,
    bucketMinutes,
    minuteRangeEnd,
    minuteRangeStart,
    hourlyData,
    mainBaselineSalesPerEmployee,
    rangedHours,
  ]);

  const chartTickEvery = useMemo(() => {
    const count = chartHours.length;
    if (count <= 6) return 1;
    return Math.ceil(count / 6);
  }, [chartHours]);

  const chartColumnWidth = useMemo(() => {
    if (chartHours.length <= 8) return 56;
    if (chartHours.length <= 16) return 42;
    return 26;
  }, [chartHours.length]);

  const chartMaxProductivity = useMemo(() => {
    if (chartHours.length === 0) return 1;
    return Math.max(
      ...chartHours.map((h) =>
        Math.max(h.mainProductivity, h.compareProductivity),
      ),
      1,
    );
  }, [chartHours]);

  const dayTotals = useMemo(() => {
    if (!hourlyData)
      return {
        sales: 0,
        avgProductivity: 0,
        peakEmployees: 0,
        activeHoursCount: 0,
      };
    const sales = rangedHours.reduce((sum, h) => sum + h.totalSales, 0);
    const productivityValues = rangedHours.reduce(
      (acc, h) => {
        acc.sales += h.totalSales;
        acc.hours += h.employeesPresent * (bucketMinutes / 60);
        return acc;
      },
      { sales: 0, hours: 0 },
    );
    const avgProductivity = calcVtaHr(
      productivityValues.sales,
      productivityValues.hours,
    );
    const peakEmployees = Math.max(
      ...rangedHours.map((h) => h.employeesPresent),
      0,
    );
    const activeHoursCount = rangedHours.filter(
      (h) => h.totalSales > 0 || h.employeesPresent > 0,
    ).length;
    return { sales, avgProductivity, peakEmployees, activeHoursCount };
  }, [hourlyData, rangedHours, bucketMinutes]);

  const handleToggleHour = (hour: number) => {
    setExpandedSlotStart((prev) => (prev === hour ? null : hour));
  };

  const selectedLineLabel =
    effectiveSelectedLine &&
    lineOptions.find((line) => line.id === effectiveSelectedLine)?.name;
  const overtimeEmployees = hourlyData?.overtimeEmployees ?? [];
  const overtimeEmployeesResolved = useMemo(() => {
    if (overtimeEmployees.length === 0) return [];
    return overtimeEmployees.map((employee) => {
      const rawSede = employee.sede?.trim();
      if (!rawSede) return employee;

        const normalizedRaw = canonicalizeSedeValue(rawSede);
        const match = availableSedes.find((sede) => {
          const normalizedSede = canonicalizeSedeValue(sede.name);
          return (
            normalizedSede === normalizedRaw ||
            normalizedSede.includes(normalizedRaw) ||
          normalizedRaw.includes(normalizedSede)
        );
      });

      if (!match) return employee;
      return { ...employee, sede: match.name };
    });
  }, [overtimeEmployees, availableSedes]);
  const overtimeSedeOptions = useMemo(() => {
    const fromAvailable = availableSedes
      .map((sede) => sede.name?.trim())
      .filter((value): value is string => Boolean(value));
    const fromData = overtimeEmployeesResolved
      .map((employee) => employee.sede?.trim())
      .filter((value): value is string => Boolean(value));
    const values = Array.from(
      new Set(fromAvailable.length > 0 ? fromAvailable : fromData),
    );
    const plantKeywords = [
      "panificadora",
      "planta desposte mixto",
      "planta desprese pollo",
    ];
      const isPlant = (value: string) =>
        plantKeywords.some((keyword) =>
          canonicalizeSedeValue(value).includes(keyword),
        );
    return values.sort((a, b) => {
      const aPlant = isPlant(a);
      const bPlant = isPlant(b);
      if (aPlant !== bPlant) return aPlant ? 1 : -1;
      return a.localeCompare(b, "es");
    });
  }, [availableSedes, overtimeEmployeesResolved]);
  const overtimePersonOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        overtimeEmployeesResolved
          .map((employee) => {
            const id = employee.employeeId?.toString().trim() ?? "";
            const name = employee.employeeName.trim();
            if (!name) return "";
            return id ? `${name} | ${id}` : name;
          })
          .filter(Boolean),
      ),
    );
    return values.sort((a, b) => a.localeCompare(b, "es"));
  }, [overtimeEmployeesResolved]);
  const overtimeDepartmentOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        overtimeEmployeesResolved
          .map((employee) => employee.department?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    return values.sort((a, b) => a.localeCompare(b, "es"));
  }, [overtimeEmployeesResolved]);
  const hasEmployeeTypeData = useMemo(
    () =>
      overtimeEmployeesResolved.some(
        (employee) => employee.employeeType?.trim() ?? "",
      ),
    [overtimeEmployeesResolved],
  );
  const overtimeEmployeeTypeOptions = useMemo(
    () => ["36 horas", "Tiempo completo", "Medio tiempo"],
    [],
  );
  const baseFilteredOvertimeEmployees = useMemo(() => {
    const validMinMinutes = isAlexStrictMode
      ? null
      : parseBase60HoursInputToMinutes(overtimeRangeMin);
    const validMaxMinutes = isAlexStrictMode
      ? null
      : parseBase60HoursInputToMinutes(overtimeRangeMax);
    const effectiveMarksFilter = isAlexStrictMode ? "2" : overtimeMarksFilter;

    const filtered = overtimeEmployeesResolved.filter((employee) => {
      const employeeMinutes = decimalHoursToMinutes(employee.workedHours);
      if (!isAlexStrictMode && overtimeSedeFilter.length > 0) {
        const employeeSede = canonicalizeSedeValue(employee.sede ?? "");
        const anyMatch = overtimeSedeFilter.some(
          (name) => canonicalizeSedeValue(name) === employeeSede,
        );
        if (!anyMatch) return false;
      }
      if (!isAlexStrictMode && overtimeDepartmentFilter.length > 0) {
        const employeeDepartment = employee.department ?? "";
        if (!overtimeDepartmentFilter.includes(employeeDepartment)) {
          return false;
        }
      }
      if (effectiveMarksFilter !== "all") {
        const marks = employee.marksCount ?? 0;
        if (marks !== Number(effectiveMarksFilter)) return false;
      }
      if (
        !isAlexStrictMode &&
        hasEmployeeTypeData &&
        overtimeEmployeeTypeFilter !== "all"
      ) {
        const employeeType = employee.employeeType?.trim() ?? "";
        if (
          employeeType.toLowerCase() !==
          overtimeEmployeeTypeFilter.toLowerCase()
        ) {
          return false;
        }
      }
      const selected = isAlexStrictMode
        ? ""
        : overtimePersonFilter.trim().toLowerCase();
      if (selected) {
        const id = employee.employeeId?.toString().trim() ?? "";
        const name = employee.employeeName.trim();
        const employeeKey = id
          ? `${name} | ${id}`.toLowerCase()
          : name.toLowerCase();
        const idKey = id.toLowerCase();
        if (
          !employeeKey.includes(selected) &&
          !name.toLowerCase().includes(selected) &&
          (!idKey || !idKey.includes(selected))
        ) {
          return false;
        }
      }
      if (validMinMinutes !== null && employeeMinutes < validMinMinutes)
        return false;
      if (validMaxMinutes !== null && employeeMinutes > validMaxMinutes)
        return false;
      return true;
    });
    return filtered;
  }, [
    overtimeEmployeesResolved,
    overtimeSedeFilter,
    overtimeDepartmentFilter,
    overtimeEmployeeTypeFilter,
    overtimeMarksFilter,
    alexConsistencyMode,
    isAlexStrictMode,
    hasEmployeeTypeData,
    overtimePersonFilter,
    overtimeRangeMin,
    overtimeRangeMax,
  ]);
  const filteredOvertimeEmployees = useMemo(() => {
    const filtered = overtimeAbsenceOnly
      ? baseFilteredOvertimeEmployees.filter(
          (employee) => employee.isAbsence || isAbsenceIncident(employee.incident),
        )
      : overtimeOddMarksOnly
        ? baseFilteredOvertimeEmployees.filter((employee) => {
            const marks = employee.marksCount ?? 0;
            return marks > 0 && marks % 2 !== 0;
          })
      : overtimeAlertOnly
        ? baseFilteredOvertimeEmployees.filter((employee) => {
          const employeeMinutes = decimalHoursToMinutes(employee.workedHours);
          if (overtimeAlertMode === "720-2marks") {
            const marks = employee.marksCount ?? 0;
            return (
              employeeMinutes > TWO_MARKS_ALERT_THRESHOLD_MINUTES &&
              employeeMinutes <= ALERT_THRESHOLD_MINUTES &&
              marks === 2
            );
          }
          return employeeMinutes > ALERT_THRESHOLD_MINUTES;
          })
        : baseFilteredOvertimeEmployees;
    return [...filtered].sort((a, b) => {
      const hoursDiff = a.workedHours - b.workedHours;
      if (hoursDiff !== 0) {
        return overtimeDateOrder === "asc" ? hoursDiff : -hoursDiff;
      }
      const aDateTs = a.workedDate ? new Date(a.workedDate).getTime() : 0;
      const bDateTs = b.workedDate ? new Date(b.workedDate).getTime() : 0;
      const dateDiff = aDateTs - bDateTs;
      if (dateDiff !== 0) {
        return overtimeDateOrder === "asc" ? dateDiff : -dateDiff;
      }
      return a.employeeName.localeCompare(b.employeeName, "es");
    });
  }, [
    baseFilteredOvertimeEmployees,
    overtimeAbsenceOnly,
    overtimeOddMarksOnly,
    overtimeAlertOnly,
    overtimeAlertMode,
    overtimeDateOrder,
  ]);
  const overtimeAbsenceCount = useMemo(
    () =>
      baseFilteredOvertimeEmployees.filter(
        (employee) => employee.isAbsence || isAbsenceIncident(employee.incident),
      ).length,
    [baseFilteredOvertimeEmployees],
  );
  const alexAlertCount720 = useMemo(
    () =>
      baseFilteredOvertimeEmployees.filter((employee) => {
        const minutes = decimalHoursToMinutes(employee.workedHours);
        const marks = employee.marksCount ?? 0;
        return (
          minutes > TWO_MARKS_ALERT_THRESHOLD_MINUTES &&
          minutes <= ALERT_THRESHOLD_MINUTES &&
          marks === 2
        );
      }).length,
    [baseFilteredOvertimeEmployees],
  );
  const alexAlertCount920 = useMemo(
    () =>
      baseFilteredOvertimeEmployees.filter((employee) => {
        const minutes = decimalHoursToMinutes(employee.workedHours);
        return minutes > ALERT_THRESHOLD_MINUTES;
      }).length,
    [baseFilteredOvertimeEmployees],
  );
  const oddMarksCount = useMemo(
    () =>
      baseFilteredOvertimeEmployees.filter((employee) => {
        const marks = employee.marksCount ?? 0;
        return marks > 0 && marks % 2 !== 0;
      }).length,
    [baseFilteredOvertimeEmployees],
  );
  useEffect(() => {
    if (!isAlexStrictMode) return;
    setOvertimeSedeFilter([]);
    setOvertimeDepartmentFilter([]);
    setOvertimePersonFilter("");
    setOvertimeEmployeeTypeFilter("all");
    setOvertimeRangeMin("");
    setOvertimeRangeMax("");
    setOvertimeExcludedIds(new Set());
    setOvertimeSedeOpen(false);
    setOvertimeDepartmentOpen(false);
  }, [isAlexStrictMode]);
  const getOvertimeEmployeeKey = (employee: OvertimeEmployee) =>
    `${employee.employeeId ?? "sin-id"}-${employee.employeeName}-${employee.workedDate ?? "sin-fecha"}-${employee.sede ?? "sin-sede"}-${employee.department ?? "sin-depto"}`;
  const toggleExcludeEmployee = (employeeKey: string) => {
    setOvertimeExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeKey)) {
        next.delete(employeeKey);
      } else {
        next.add(employeeKey);
      }
      return next;
    });
  };
  const visibleOvertimeEmployees = useMemo(
    () =>
      filteredOvertimeEmployees.filter(
        (employee) =>
          !overtimeExcludedIds.has(getOvertimeEmployeeKey(employee)),
      ),
    [filteredOvertimeEmployees, overtimeExcludedIds],
  );
  const overtimeTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(visibleOvertimeEmployees.length / OVERTIME_PAGE_SIZE),
      ),
    [visibleOvertimeEmployees.length],
  );
  const pagedOvertimeEmployees = useMemo(() => {
    const start = (overtimePage - 1) * OVERTIME_PAGE_SIZE;
    return visibleOvertimeEmployees.slice(start, start + OVERTIME_PAGE_SIZE);
  }, [visibleOvertimeEmployees, overtimePage]);
  const overtimePageTabs = useMemo(() => {
    const half = Math.floor(OVERTIME_PAGE_TAB_WINDOW / 2);
    let start = Math.max(1, overtimePage - half);
    let end = Math.min(
      overtimeTotalPages,
      start + OVERTIME_PAGE_TAB_WINDOW - 1,
    );
    if (end - start + 1 < OVERTIME_PAGE_TAB_WINDOW) {
      start = Math.max(1, end - OVERTIME_PAGE_TAB_WINDOW + 1);
    }
    return Array.from({ length: end - start + 1 }, (_v, i) => start + i);
  }, [overtimePage, overtimeTotalPages]);

  useEffect(() => {
    setOvertimePage(1);
  }, [
    overtimeSedeFilter,
    overtimeDepartmentFilter,
    overtimeEmployeeTypeFilter,
    overtimeMarksFilter,
    overtimePersonFilter,
    overtimeDateOrder,
    overtimeRangeMin,
    overtimeRangeMax,
    overtimeAbsenceOnly,
    overtimeOddMarksOnly,
    overtimeAlertOnly,
  ]);

  useEffect(() => {
    setOvertimePage((prev) => Math.min(prev, overtimeTotalPages));
  }, [overtimeTotalPages]);

  const handleExportOvertimeXlsx = async () => {
    const exportEmployees = filteredOvertimeEmployees.filter(
      (employee) => !overtimeExcludedIds.has(getOvertimeEmployeeKey(employee)),
    );
    if (exportEmployees.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Horario");
    sheet.columns = [
      { header: "Cedula", key: "employeeId", width: 18 },
      { header: "Nombre", key: "employeeName", width: 34 },
      { header: "Sede", key: "sede", width: 20 },
      { header: "Cargo", key: "role", width: 22 },
      { header: "Incidencia", key: "incident", width: 18 },
      { header: "Departamento", key: "department", width: 22 },
      { header: "Fecha", key: "workedDate", width: 16 },
      { header: "Hora entrada", key: "markIn", width: 16 },
      { header: "Hora intermedia 1", key: "markBreak1", width: 18 },
      { header: "Hora intermedia 2", key: "markBreak2", width: 18 },
      { header: "Hora salida", key: "markOut", width: 16 },
      { header: "Horas trabajadas", key: "workedHours", width: 18 },
    ];

    exportEmployees.forEach((employee) => {
      const rawId = employee.employeeId?.toString().trim() ?? "";
      const numericId = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
      const workedHoursValue = Number.isFinite(employee.workedHours)
        ? Math.max(0, employee.workedHours) / 24
        : null;
      sheet.addRow({
        employeeId: numericId,
        employeeName: employee.employeeName,
        sede: employee.sede ?? "",
        role: employee.role ?? "",
        incident: employee.incident ?? "",
        department: employee.department ?? employee.lineName ?? "",
        workedDate:
          employee.workedDate ?? hourlyData?.attendanceDateUsed ?? selectedDate,
        markIn: employee.markIn ?? "",
        markBreak1: employee.markBreak1 ?? "",
        markBreak2: employee.markBreak2 ?? "",
        markOut: employee.markOut ?? "",
        workedHours: workedHoursValue,
      });
    });

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getColumn("employeeId").numFmt = "0";
    sheet.getColumn("workedHours").numFmt = "[h]:mm";
    sheet.getColumn("workedHours").alignment = {
      vertical: "middle",
      horizontal: "right",
    };

    const dateKey =
      enableOvertimeDateRange &&
      isOvertimeOnlyMode &&
      overtimeDateStart &&
      overtimeDateEnd
        ? `${overtimeDateStart}_a_${overtimeDateEnd}`
        : selectedDate || new Date().toISOString().slice(0, 10);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `horario-${dateKey}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-animate="hourly-card"
      className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-linear-to-br from-white via-slate-50 to-amber-50/40 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.2)]"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -left-12 -bottom-16 h-44 w-44 rounded-full bg-mercamio-200/30 blur-3xl" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Analisis por hora
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">
            Desglose horario
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Filtra por linea para enfocar el comportamiento horario en todas las
            sedes.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">
          <Clock className="h-4 w-4 text-mercamio-600" />
          Vista horaria
        </div>
      </div>

      {(showTopDateFilter || showTopLineFilter || showTimeFilters) && (
        <div className="mb-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
          <div
            className={`grid gap-3 sm:grid-cols-2 ${
              showTimeFilters ? "lg:grid-cols-5" : "lg:grid-cols-2"
            }`}
          >
            {showTopDateFilter && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">
                  Fecha
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  min={availableDateRange.min}
                  max={availableDateRange.max}
                  className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                />
              </label>
            )}

            {showTopLineFilter && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">
                  Linea
                </span>
                <select
                  value={effectiveSelectedLine}
                  onChange={(e) => setSelectedLine(e.target.value)}
                  className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                >
                  <option value="">Todas las lineas</option>
                  {lineOptions.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {showTimeFilters && (
              <>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Intervalo
                  </span>
                  <select
                    value={bucketMinutes}
                    onChange={(e) => setBucketMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                  >
                    {bucketOptions.map((minutes) => (
                      <option key={`bucket-${minutes}`} value={minutes}>
                        {minutes} minutos
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Desde (HH:mm)
                  </span>
                  <input
                    type="time"
                    step={minuteRangeStepSeconds}
                    value={minuteToTime(minuteRangeStart)}
                    onChange={(e) => {
                      const nextStart = parseTimeToMinute(e.target.value);
                      setMinuteRangeStart(nextStart);
                      setMinuteRangeEnd((prev) =>
                        prev < nextStart ? nextStart : prev,
                      );
                    }}
                    className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Hasta (HH:mm)
                  </span>
                  <input
                    type="time"
                    step={minuteRangeStepSeconds}
                    value={minuteToTime(minuteRangeEnd)}
                    onChange={(e) => {
                      const nextEnd = parseTimeToMinute(e.target.value);
                      setMinuteRangeEnd(nextEnd);
                      setMinuteRangeStart((prev) =>
                        prev > nextEnd ? nextEnd : prev,
                      );
                    }}
                    className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}

      {showSedeFilters && (
        <div className="mt-4 border-t border-slate-200/70 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Sedes
            </span>
            <button
              type="button"
              onClick={toggleAllSedes}
              className="rounded-full border border-slate-200/70 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700 transition-all hover:border-slate-300"
            >
              {selectedSedes.length === availableSedes.length
                ? "Quitar todas"
                : "Seleccionar todas"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedSedes([])}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedSedes.length === 0
                  ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-300 shadow-sm"
                  : "border-slate-200/70 bg-slate-50 text-slate-600 hover:border-slate-300"
              }`}
            >
              Todas
            </button>
            {sedeFilterButtons.map((button) => {
              const selected =
                button.type === "ppt"
                  ? isPptSelected
                  : selectedSedes.includes(button.sedeName);
              const onClick =
                button.type === "ppt"
                  ? togglePptSedes
                  : () => toggleSede(button.sedeName);

              return (
                <button
                  key={button.key}
                  type="button"
                  onClick={onClick}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    selected
                      ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-300 shadow-sm"
                      : "border-slate-200/70 bg-slate-50 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {button.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {selectedSedes.length === 0
              ? "Sin seleccion manual: se usan todas las sedes."
              : `${selectedSedes.length} sede(s) seleccionada(s).`}
          </p>
        </div>
      )}

      {showMapSection && (
        <div className="mb-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Comparar
              </p>
              <p className="text-sm font-semibold text-slate-900">
                Compara dos dias
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompareEnabled((prev) => !prev)}
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] transition-all ${
                compareEnabled
                  ? "bg-mercamio-50 text-mercamio-700 ring-1 ring-mercamio-200/70"
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200/70"
              }`}
            >
              {compareEnabled ? "Comparando" : "Comparar"}
            </button>
          </div>

          {compareEnabled && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">
                  Fecha a comparar
                </span>
                <input
                  type="date"
                  value={compareDate}
                  onChange={(e) => setCompareDate(e.target.value)}
                  min={availableDateRange.min}
                  max={availableDateRange.max}
                  className="mt-1 w-full rounded-full border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-300 focus:outline-none focus:ring-2 focus:ring-mercamio-100"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
          {error}
        </div>
      )}
      {compareError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
          {compareError}
        </div>
      )}

      {isLoading && <HourlyLoadingSkeleton />}

      {!isLoading && !selectedDate && (
        <p className="py-10 text-center text-sm text-slate-600">
          Selecciona una fecha para ver el analisis horario.
        </p>
      )}

      {!isLoading && hourlyData && (
        <>
          <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Fecha
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatDateLabel(hourlyData.date, hourlyDateLabelOptions)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Alcance
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {hourlyData.scopeLabel}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Rango
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {minuteToTime(minuteRangeStart)} -{" "}
                  {minuteToTime(minuteRangeEnd)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/70">
                Intervalo: {bucketMinutes} min
              </span>
              {selectedLineLabel && (
                <span className="rounded-full bg-mercamio-50 px-3 py-1 text-xs font-semibold text-mercamio-700 ring-1 ring-mercamio-200/70">
                  Linea: {selectedLineLabel}
                </span>
              )}
              {hourlyData.attendanceDateUsed &&
                hourlyData.attendanceDateUsed !== hourlyData.date && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                    Asistencia usada: {hourlyData.attendanceDateUsed}
                  </span>
                )}
              {hourlyData.salesDateUsed &&
                hourlyData.salesDateUsed !== hourlyData.date && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                    Ventas usadas: {hourlyData.salesDateUsed}
                  </span>
                )}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="flex items-center gap-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <DollarSign className="h-3.5 w-3.5" />
                Vta/Hr prom: {formatProductivity(dayTotals.avgProductivity)}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-sky-200/70 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
                <Users className="h-3.5 w-3.5" />
                Pico: {dayTotals.peakEmployees} empleados
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-100/80 px-3 py-2 text-xs font-semibold text-slate-700">
                {dayTotals.activeHoursCount} horas con actividad
              </div>
            </div>
          </div>

          {showSectionToggle && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {showMapSection && (
                <button
                  type="button"
                  onClick={() => setHourlySection("map")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] transition-all ${
                    hourlySection === "map"
                      ? "bg-mercamio-50 text-mercamio-700 ring-1 ring-mercamio-200/70"
                      : "bg-slate-100 text-slate-600 ring-1 ring-slate-200/70"
                  }`}
                >
                  Mapa por hora
                </button>
              )}
              {showOvertimeSection && (
                <button
                  type="button"
                  onClick={() => setHourlySection("overtime")}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] transition-all ${
                    hourlySection === "overtime"
                      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70"
                      : "bg-slate-100 text-slate-600 ring-1 ring-slate-200/70"
                  }`}
                >
                  Horario
                </button>
              )}
            </div>
          )}

          {showOvertimeSection && hourlySection === "overtime" && (
            <div className="mb-6 overflow-visible rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Horario
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  Consulta horarios y total de horas trabajadas
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200/70">
                  {visibleOvertimeEmployees.length} empleado(s)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly((prev) => !prev);
                    setOvertimeOddMarksOnly(false);
                    setOvertimeAlertOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
                    setOvertimeQuickRange("custom");
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeAbsenceOnly
                      ? "bg-amber-600 text-white shadow-sm"
                      : "border border-amber-200/70 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {`Ver inasistencias (${overtimeAbsenceCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly((prev) => !prev);
                    setOvertimeAlertOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
                    setOvertimeQuickRange("custom");
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeOddMarksOnly
                      ? "bg-amber-600 text-white shadow-sm"
                      : "border border-amber-200/70 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {`Ver marcaciones impares (${oddMarksCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
                    setOvertimeQuickRange("custom");
                    setOvertimeAlertMode("920");
                    setOvertimeAlertOnly((prev) =>
                      prev && overtimeAlertMode === "920" ? false : true,
                    );
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeAlertOnly && overtimeAlertMode === "920"
                      ? "bg-red-600 text-white shadow-sm"
                      : "border border-red-200/70 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
                  }`}
                >
                  {`Ver personas >9:20h (${alexAlertCount920})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
                    setOvertimeQuickRange("custom");
                    setOvertimeAlertMode("720-2marks");
                    setOvertimeAlertOnly((prev) =>
                      prev && overtimeAlertMode === "720-2marks" ? false : true,
                    );
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeAlertOnly && overtimeAlertMode === "720-2marks"
                      ? "bg-red-600 text-white shadow-sm"
                      : "border border-red-200/70 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100"
                  }`}
                >
                  {`Ver personas >7:20h con 2 marcaciones (${alexAlertCount720})`}
                </button>
                {overtimeExcludedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setOvertimeExcludedIds(new Set())}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                  >
                    Restaurar ocultos
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleExportOvertimeXlsx()}
                  disabled={filteredOvertimeEmployees.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar Excel
                </button>
              </div>

              {enableOvertimeDateRange && isOvertimeOnlyMode && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">
                      Fecha desde
                    </span>
                    <input
                      type="date"
                      value={overtimeDateStart}
                      min={availableDateRange.min}
                      max={availableDateRange.max}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOvertimeDateStart(next);
                        setOvertimeDateEnd((prev) =>
                          prev && prev < next ? next : prev,
                        );
                      }}
                      className="mt-1 w-full rounded-2xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">
                      Fecha hasta
                    </span>
                    <input
                      type="date"
                      value={overtimeDateEnd}
                      min={availableDateRange.min}
                      max={availableDateRange.max}
                      onChange={(e) => {
                        const next = e.target.value;
                        setOvertimeDateEnd(next);
                        setOvertimeDateStart((prev) =>
                          prev && prev > next ? next : prev,
                        );
                      }}
                      className={overtimeFilterControlClass}
                    />
                  </label>
                </div>
              )}

              <div
                className={`mt-3 grid gap-3 ${
                  showDepartmentFilterInOvertime
                    ? "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9"
                    : "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"
                }`}
              >
                <label className="block xl:col-span-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Orden
                  </span>
                  <select
                    value={overtimeDateOrder}
                    onChange={(e) =>
                      setOvertimeDateOrder(e.target.value as "asc" | "desc")
                    }
                    className={`${overtimeFilterControlClass} min-w-0`}
                  >
                    <option value="asc">Ascendente</option>
                    <option value="desc">Descendente</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Sede
                  </span>
                  <button
                    ref={overtimeSedeTriggerRef}
                    type="button"
                    disabled={isAlexStrictMode}
                    onClick={() => {
                      if (!overtimeSedeOpen) updateOvertimeSedePopoverPos();
                      setOvertimeSedeOpen((prev) => !prev);
                    }}
                    className={`${overtimeFilterControlClass} mt-1 flex items-center justify-between disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                  >
                    <span>
                      {overtimeSedeFilter.length === 0
                        ? "Todas"
                        : `${overtimeSedeFilter.length} sede(s)`}
                    </span>
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  </button>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Empleado
                  </span>
                  <input
                    list="overtime-person-options"
                    value={overtimePersonFilter}
                    disabled={isAlexStrictMode}
                    onChange={(e) => {
                      const next = e.target.value;
                      setOvertimePersonFilter(next === "Todos" ? "" : next);
                    }}
                    placeholder="Nombre o cedula"
                    className={`${overtimeFilterControlClass} placeholder:text-slate-400`}
                  />
                  <datalist id="overtime-person-options">
                    <option value="Todos" />
                    {overtimePersonOptions.map((person) => (
                      <option key={person} value={person} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Tipo de empleado
                  </span>
                  <select
                    value={overtimeEmployeeTypeFilter}
                    disabled={isAlexStrictMode || !hasEmployeeTypeData}
                    onChange={(e) =>
                      setOvertimeEmployeeTypeFilter(e.target.value)
                    }
                    className={`${overtimeFilterControlClass} ${
                      hasEmployeeTypeData
                        ? "bg-white text-slate-900"
                        : "cursor-not-allowed bg-slate-100 text-slate-500"
                    }`}
                  >
                    <option value="all">
                      {hasEmployeeTypeData ? "Todos" : "Sin datos"}
                    </option>
                    {overtimeEmployeeTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Marcaciones
                  </span>
                  <select
                    value={isAlexStrictMode ? "2" : overtimeMarksFilter}
                    onChange={(e) => setOvertimeMarksFilter(e.target.value)}
                    className={overtimeFilterControlClass}
                    disabled={isAlexStrictMode}
                  >
                    {isAlexStrictMode ? (
                      <option value="2">2</option>
                    ) : (
                      <>
                        <option value="all">Todas</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                      </>
                    )}
                  </select>
                </label>
                {showDepartmentFilterInOvertime && (
                  <label className="block">
                    <span className="text-xs font-semibold text-slate-700">
                      Departamento
                    </span>
                    <button
                      ref={overtimeDepartmentTriggerRef}
                      type="button"
                      disabled={isAlexStrictMode}
                      onClick={() => {
                        if (!overtimeDepartmentOpen) {
                          updateOvertimeDepartmentPopoverPos();
                        }
                        setOvertimeDepartmentOpen((prev) => !prev);
                      }}
                      className={`${overtimeFilterControlClass} mt-1 flex items-center justify-between disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                    >
                      <span>
                        {overtimeDepartmentFilter.length === 0
                          ? "Todos"
                          : `${overtimeDepartmentFilter.length} depto(s)`}
                      </span>
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    </button>
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Horas min
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overtimeRangeMin}
                    disabled={isAlexStrictMode}
                    onChange={(e) => {
                      setOvertimeQuickRange("custom");
                      setOvertimeRangeMin(e.target.value);
                    }}
                    className={overtimeFilterControlClass}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">
                    Horas max
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overtimeRangeMax}
                    disabled={isAlexStrictMode}
                    onChange={(e) => {
                      setOvertimeQuickRange("custom");
                      setOvertimeRangeMax(e.target.value);
                    }}
                    className={overtimeFilterControlClass}
                  />
                </label>
              </div>
              {isAlexStrictMode && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Modo Alex activo: el listado usa exactamente la misma regla del
                  reporte (superior a 9:20h) y
                  bloquea filtros que cambian el conteo.
                </p>
              )}

              {overtimeSedeOpen &&
                overtimeSedePopoverPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={overtimeSedePanelRef}
                    className="fixed z-9999 min-w-60 rounded-2xl border border-slate-200/70 bg-white p-2 shadow-2xl"
                    style={{
                      top: overtimeSedePopoverPos.top,
                      left: overtimeSedePopoverPos.left,
                      width: Math.max(260, overtimeSedePopoverPos.width),
                    }}
                  >
                    <button
                      type="button"
                      onClick={clearOvertimeSedeFilter}
                      className={`w-full rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                        overtimeSedeFilter.length === 0
                          ? "border-rose-200/70 bg-rose-50 text-rose-700"
                          : "border-slate-200/70 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todas
                    </button>
                    <div className="mt-2 max-h-64 space-y-1 overflow-auto pr-1">
                      {overtimeSedeOptions.map((sede) => {
                        const checked = overtimeSedeFilter.includes(sede);
                        return (
                          <label
                            key={sede}
                            className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOvertimeSede(sede)}
                              className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-200"
                            />
                            <span className="whitespace-normal wrap-break-word leading-5">
                              {sede}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>,
                  document.body,
                )}

              {overtimeDepartmentOpen &&
                overtimeDepartmentPopoverPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={overtimeDepartmentPanelRef}
                    className="fixed z-9999 min-w-60 rounded-2xl border border-slate-200/70 bg-white p-2 shadow-2xl"
                    style={{
                      top: overtimeDepartmentPopoverPos.top,
                      left: overtimeDepartmentPopoverPos.left,
                      width: Math.max(260, overtimeDepartmentPopoverPos.width),
                    }}
                  >
                    <button
                      type="button"
                      onClick={clearOvertimeDepartmentFilter}
                      className={`w-full rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                        overtimeDepartmentFilter.length === 0
                          ? "border-rose-200/70 bg-rose-50 text-rose-700"
                          : "border-slate-200/70 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todos
                    </button>
                    <div className="mt-2 max-h-64 space-y-1 overflow-auto pr-1">
                      {overtimeDepartmentOptions.map((department) => {
                        const checked =
                          overtimeDepartmentFilter.includes(department);
                        return (
                          <label
                            key={department}
                            className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleOvertimeDepartment(department)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-200"
                            />
                            <span className="whitespace-normal wrap-break-word leading-5">
                              {department}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>,
                  document.body,
                )}

              {overtimeDepartmentOpen &&
                overtimeDepartmentPopoverPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={overtimeDepartmentPanelRef}
                    className="fixed z-9999 min-w-60 rounded-2xl border border-slate-200/70 bg-white p-2 shadow-2xl"
                    style={{
                      top: overtimeDepartmentPopoverPos.top,
                      left: overtimeDepartmentPopoverPos.left,
                      width: Math.max(260, overtimeDepartmentPopoverPos.width),
                    }}
                  >
                    <button
                      type="button"
                      onClick={clearOvertimeDepartmentFilter}
                      className={`w-full rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                        overtimeDepartmentFilter.length === 0
                          ? "border-rose-200/70 bg-rose-50 text-rose-700"
                          : "border-slate-200/70 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todos
                    </button>
                    <div className="mt-2 max-h-64 space-y-1 overflow-auto pr-1">
                      {overtimeDepartmentOptions.map((department) => {
                        const checked =
                          overtimeDepartmentFilter.includes(department);
                        return (
                          <label
                            key={department}
                            className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleOvertimeDepartment(department)
                              }
                              className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-200"
                            />
                            <span className="whitespace-normal wrap-break-word leading-5">
                              {department}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>,
                  document.body,
                )}

              {visibleOvertimeEmployees.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No hay empleados para ese filtro de horas.
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/70 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 bg-slate-50/70 px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOvertimePage((prev) => Math.max(1, prev - 1))
                        }
                        disabled={overtimePage === 1}
                        className="rounded-full border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Anterior
                      </button>
                      {overtimePageTabs.map((tabPage) => (
                        <button
                          key={tabPage}
                          type="button"
                          onClick={() => setOvertimePage(tabPage)}
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            tabPage === overtimePage
                              ? "bg-rose-600 text-white"
                              : "border border-slate-200/70 bg-white text-slate-700"
                          }`}
                        >
                          {tabPage}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setOvertimePage((prev) =>
                            Math.min(overtimeTotalPages, prev + 1),
                          )
                        }
                        disabled={overtimePage === overtimeTotalPages}
                        className="rounded-full border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Siguiente
                      </button>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-600">
                      Pagina {overtimePage} de {overtimeTotalPages} | Mostrando{" "}
                      {pagedOvertimeEmployees.length} de{" "}
                      {visibleOvertimeEmployees.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[38px_52px_2.6fr_1fr_1.2fr_64px_56px_1.6fr_1fr_1.2fr] gap-1 border-b border-slate-200/70 bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <span className="text-center whitespace-nowrap">#</span>
                    <span className="text-center whitespace-nowrap">Excel</span>
                    <span className="whitespace-nowrap">Empleado</span>
                    <span className="whitespace-nowrap">Sede</span>
                    <span className="whitespace-nowrap">Fecha</span>
                    <span className="text-center whitespace-nowrap">Horas</span>
                    <span className="text-center whitespace-nowrap">Mar.</span>
                    <span className="whitespace-nowrap">Cargo</span>
                    <span className="whitespace-nowrap">Incid.</span>
                    <span className="text-center whitespace-nowrap">
                      Depto.
                    </span>
                  </div>
                  {pagedOvertimeEmployees.map((employee, index) => {
                    const employeeKey = getOvertimeEmployeeKey(employee);
                    const isAbsence =
                      employee.isAbsence || isAbsenceIncident(employee.incident);
                    const absoluteIndex =
                      (overtimePage - 1) * OVERTIME_PAGE_SIZE + index + 1;
                    return (
                      <div
                        key={employeeKey}
                        className={`grid grid-cols-[38px_52px_2.6fr_1fr_1.2fr_64px_56px_1.6fr_1fr_1.2fr] items-start gap-1 border-b border-slate-100 px-2 py-2 text-[12px] last:border-b-0 ${
                          isAbsence
                            ? "bg-red-50/80"
                            : (employee.marksCount ?? 0) % 2 !== 0 ||
                                (employee.incident ?? "")
                                  .toLowerCase()
                                  .includes("no marco")
                              ? "bg-amber-50/70"
                              : ""
                        }`}
                      >
                        <span className="text-center text-xs font-semibold text-slate-500">
                          {absoluteIndex}
                        </span>
                        <span className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => toggleExcludeEmployee(employeeKey)}
                            disabled={isAlexStrictMode}
                            className="h-4 w-4 accent-rose-600"
                            aria-label="Excluir del Excel"
                          />
                        </span>
                        <span className="font-semibold text-slate-900 leading-tight">
                          {employee.employeeName}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 leading-tight">
                          {employee.sede ?? "-"}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 leading-tight">
                          {employee.workedDate ?? "-"}
                        </span>
                        <span className="text-center text-xs font-semibold text-amber-700">
                          {isAbsence
                            ? "0.00h"
                            : `${formatHoursBase60(employee.workedHours)}h`}
                        </span>
                        <span className="text-center text-xs font-semibold text-slate-700">
                          {employee.marksCount ?? 0}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 leading-tight wrap-break-word">
                          {employee.role ?? "-"}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 leading-tight wrap-break-word">
                          {employee.incident ?? "-"}
                        </span>
                        <span className="text-center text-xs font-semibold text-sky-700 leading-tight wrap-break-word">
                          {employee.department ?? employee.lineName ?? "-"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showMapSection && hourlySection === "map" && (
            <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Diferencias por hora
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    Colores por rendimiento (formula de mapa de calor)
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {compareEnabled && compareDate && (
                    <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200/70">
                      Comparado: {compareDate}
                    </span>
                  )}
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                    Max Vta/Hr: {formatProductivity(maxProductivity)}
                  </span>
                </div>
              </div>

              <div className="w-full rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3">
                {chartHours.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500">
                    Sin horas con ventas para graficar.
                  </p>
                ) : (
                  <div className="overflow-x-auto pb-2">
                    <div
                      className="relative h-52"
                      style={{
                        width: `${Math.max(chartHours.length * chartColumnWidth, 920)}px`,
                      }}
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-[20%] border-t border-dashed border-slate-300/70" />
                      <div className="pointer-events-none absolute inset-x-0 top-[40%] border-t border-dashed border-slate-300/70" />
                      <div className="pointer-events-none absolute inset-x-0 top-[60%] border-t border-dashed border-slate-300/70" />
                      <div className="pointer-events-none absolute inset-x-0 top-[80%] border-t border-dashed border-slate-300/70" />
                      <div className="absolute inset-x-0 bottom-5 border-t border-slate-300/80" />

                      <div className="relative flex h-full items-end gap-1">
                        {chartHours.map((slot, index) => {
                          const mainHeight =
                            (slot.mainProductivity / chartMaxProductivity) *
                            100;
                          const compareHeight =
                            (slot.compareProductivity / chartMaxProductivity) *
                            100;
                          const showTick =
                            index % chartTickEvery === 0 ||
                            index === chartHours.length - 1;

                          return (
                            <div
                              key={slot.slotStartMinute}
                              className="group flex shrink-0 flex-col items-center justify-end gap-1"
                              style={{ width: `${chartColumnWidth}px` }}
                            >
                              <div className="flex h-44 w-full items-end justify-center gap-0.75">
                                <div
                                  className="w-[46%] min-h-0.75 rounded-t-md shadow-[0_8px_18px_-14px_rgba(15,23,42,0.6)] transition-all duration-200 group-hover:brightness-110"
                                  style={{
                                    height: `${Math.max(mainHeight, slot.mainProductivity > 0 ? 2.5 : 0)}%`,
                                    backgroundColor: slot.mainHeatColor,
                                  }}
                                  title={`${slot.label} | Vta/Hr ${formatProductivity(slot.mainProductivity)} | ${slot.mainHeatRatio.toFixed(0)}%`}
                                />
                                {compareEnabled && compareData && (
                                  <div
                                    className="w-[34%] min-h-0.75 rounded-t-md bg-sky-400/85 shadow-[0_8px_18px_-14px_rgba(14,165,233,0.8)]"
                                    style={{
                                      height: `${Math.max(compareHeight, slot.compareProductivity > 0 ? 2.5 : 0)}%`,
                                    }}
                                    title={`${slot.label} comparado | Vta/Hr ${formatProductivity(slot.compareProductivity)} | ${slot.compareHeatRatio.toFixed(0)}%`}
                                  />
                                )}
                              </div>
                              <span className="text-[10px] font-semibold text-slate-500">
                                {showTick ? slot.label : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {compareEnabled && compareData && (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                  <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700 ring-1 ring-sky-200">
                    Barra azul: dia comparado
                  </span>
                </div>
              )}
            </div>
          )}

          {showMapSection &&
            hourlySection === "map" &&
            (activeHours.length > 0 ? (
              <div className="space-y-3">
                {activeHours.map((slot) => {
                  const heatRatio = computeHeatRatio(
                    slot.totalSales,
                    slot.employeesPresent,
                    mainBaselineSalesPerEmployee,
                  );
                  const heatColor = getHeatColor(heatRatio);

                  return (
                    <HourBar
                      key={slot.slotStartMinute}
                      label={slot.label}
                      productivity={calcVtaHr(
                        slot.totalSales,
                        slot.employeesPresent * (bucketMinutes / 60),
                      )}
                      totalSales={slot.totalSales}
                      employeesPresent={slot.employeesPresent}
                      maxProductivity={maxProductivity}
                      isExpanded={expandedSlotStart === slot.slotStartMinute}
                      onToggle={() => handleToggleHour(slot.slotStartMinute)}
                      lines={slot.lines}
                      employeesByLine={slot.employeesByLine}
                      heatColor={heatColor}
                      bucketMinutes={bucketMinutes}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-600">
                No hay actividad registrada para este filtro.
              </p>
            ))}
        </>
      )}
    </div>
  );
};
