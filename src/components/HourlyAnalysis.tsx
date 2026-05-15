"use client";

import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Users,
  ArrowLeftRight,
  ChevronDown,
  Clock,
  Sparkles,
  Download,
  Search,
  UserRound,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  Loader2,
} from "lucide-react";
import { cn, formatDateLabel } from "@/lib/shared/utils";
import { escapeCsvValue, sanitizeExportText } from "@/lib/shared/export-utils";
import { DEFAULT_LINES } from "@/lib/shared/constants";
import type { Sede } from "@/lib/shared/constants";
import type {
  HourlyAnalysisData,
  HourlyPersonContribution,
  HourlyPersonSalesSlot,
} from "@/types";

type HourlyAnalysisDashboardContext = "productividad" | "jornada-extendida";

interface HourlyAnalysisProps {
  availableDates: string[];
  availableSedes: Sede[];
  allowedLineIds?: string[];
  defaultDate?: string;
  defaultSede?: string;
  defaultLine?: string;
  sections?: Array<"map" | "overtime">;
  defaultSection?: "map" | "overtime";
  showTimeFilters?: boolean;
  showTopDateFilter?: boolean;
  showTopLineFilter?: boolean;
  showSedeFilters?: boolean;
  showDepartmentFilterInOvertime?: boolean;
  enableOvertimeDateRange?: boolean;
  alexConsistencyMode?: boolean;
  showComparison?: boolean;
  badgeLabel?: string;
  panelTitle?: string;
  panelDescription?: string;
  showPersonBreakdown?: boolean;
  defaultPersonBreakdownView?: PersonBreakdownView;
  hidePersonBreakdownTabs?: boolean;
  dashboardContext?: HourlyAnalysisDashboardContext;
  alexTotalsOverride?: {
    moreThan72With2: number;
    moreThan92: number;
    oddMarks: number;
    absences: number;
  };
  exportRef?: MutableRefObject<HourlyAnalysisExportHandle | null>;
  /** Rango del filtro global (p. ej. productividad). Si hay mas de un dia, el ranking de cajeros se agrega en el servidor; el detalle por franja solo aplica con un dia. */
  cashierDateRange?: { start: string; end: string };
  /** Compara ventas totales por cajero: mes anterior (completo) vs mes en curso hasta la fecha fin del filtro. */
  cashierMonthComparison?: boolean;
  onCashierMonthComparisonToggle?: () => void;
  /** Cuando el bloque de cajeros termina de cargar tras un cambio de modo (p. ej. aviso al padre para quitar overlay). */
  onCashierViewReady?: () => void;
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
type PersonBreakdownView = "individual" | "franjas";
type OvertimeSortField =
  | "fecha"
  | "horas"
  | "marcaciones"
  | "incidencia"
  | "nomina"
  | "departamento";
type OvertimeSortDirection = "asc" | "desc";
type CashierSortField = "totalSales" | "workedHours" | "vtaHr";

export type HourlyAnalysisExportHandle = {
  exportCsv: () => boolean;
  exportXlsx: () => Promise<boolean>;
};

const CASHIER_MONTH_TOP_N = 5;
/** Valor interno del `<select>` para filtrar cajeros sin cargo (no usar como cargo real). */
const CASHIER_CARGO_SELECT_EMPTY = "__sin_cargo__";

const totalPersonContributionSales = (person: HourlyPersonContribution) => {
  if (person.periodTotalSales != null) return person.periodTotalSales;
  return person.hourlySales.reduce((sum, slot) => sum + slot.sales, 0);
};

const getContributionLaborMinutes = (
  person: HourlyPersonContribution,
  bucketMinutes: number,
) => {
  const att = person.attendanceWorkedHours;
  if (typeof att === "number" && Number.isFinite(att) && att > 0) {
    return Math.round(att * 60);
  }
  const slots =
    (typeof person.activeSlotsCount === "number"
      ? person.activeSlotsCount
      : person.hourlySales.length) || 0;
  return slots * bucketMinutes;
};

const rankTopCashiers = (
  people: HourlyPersonContribution[] | undefined,
  limit: number,
  bucketMinutes: number,
): Array<{
  personKey: string;
  personName: string;
  personId: string | null;
  sales: number;
  hours: number;
  vtaHr: number;
}> => {
  if (!people?.length) return [];
  const withMetrics = people.map((p) => {
    const sales = totalPersonContributionSales(p);
    const minutes = getContributionLaborMinutes(p, bucketMinutes);
    const hours = minutes / 60;
    const vtaHr = hours > 0 ? sales / 1_000_000 / hours : 0;
    return {
      personKey: p.personKey,
      personName: p.personName,
      personId: p.personId?.trim() ? p.personId : null,
      sales,
      hours,
      vtaHr,
    };
  });
  withMetrics.sort((a, b) => {
    if (b.vtaHr !== a.vtaHr) return b.vtaHr - a.vtaHr;
    return b.sales - a.sales;
  });
  return withMetrics
    .filter((r) => r.sales > 0 && r.hours > 0)
    .slice(0, limit);
};

const rankImproveCashiers = (
  people: HourlyPersonContribution[] | undefined,
  limit: number,
  bucketMinutes: number,
): Array<{
  personKey: string;
  personName: string;
  personId: string | null;
  sales: number;
  hours: number;
  vtaHr: number;
}> => {
  if (!people?.length) return [];
  const withMetrics = people.map((p) => {
    const sales = totalPersonContributionSales(p);
    const minutes = getContributionLaborMinutes(p, bucketMinutes);
    const hours = minutes / 60;
    const vtaHr = hours > 0 ? sales / 1_000_000 / hours : 0;
    return {
      personKey: p.personKey,
      personName: p.personName,
      personId: p.personId?.trim() ? p.personId : null,
      sales,
      hours,
      vtaHr,
    };
  });
  withMetrics.sort((a, b) => {
    if (a.vtaHr !== b.vtaHr) return a.vtaHr - b.vtaHr;
    return b.sales - a.sales;
  });
  return withMetrics
    .filter((r) => r.sales > 0 && r.hours > 0)
    .slice(0, limit);
};

/** Mes calendario anterior (completo) vs mes que contiene `anchorISO`, desde el dia 1 hasta `anchorISO` (o fin de mes si es menor). */
const getCashierMonthComparisonRanges = (anchorISO: string) => {
  const [y, m, d] = anchorISO.split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  const yi = anchor.getFullYear();
  const mi = anchor.getMonth();

  const prevMonthLast = new Date(yi, mi, 0);
  const prevMonthFirst = new Date(yi, mi - 1, 1);
  const currMonthFirst = new Date(yi, mi, 1);
  const currMonthLast = new Date(yi, mi + 1, 0);

  const toKey = (dt: Date) => {
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${dt.getFullYear()}-${mm}-${dd}`;
  };

  const currentEnd = new Date(
    Math.min(anchor.getTime(), currMonthLast.getTime()),
  );

  const labelPrevious = `${formatDateLabel(toKey(prevMonthFirst), { day: "2-digit", month: "short" })} – ${formatDateLabel(
    toKey(prevMonthLast),
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  )}`;
  const labelCurrent = `${formatDateLabel(toKey(currMonthFirst), { day: "2-digit", month: "short" })} – ${formatDateLabel(
    toKey(currentEnd),
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  )}`;

  return {
    previous: { start: toKey(prevMonthFirst), end: toKey(prevMonthLast) },
    current: { start: toKey(currMonthFirst), end: toKey(currentEnd) },
    labelPrevious,
    labelCurrent,
  };
};

const PERSON_BREAKDOWN_VIEW_OPTIONS: Array<{
  value: PersonBreakdownView;
  label: string;
  hint: string;
}> = [
  {
    value: "individual",
    label: "Aporte individual",
    hint: "Cajeros, aporte y picos",
  },
  {
    value: "franjas",
    label: "Desglose por franjas",
    hint: "Horas, ventas y variaciones",
  },
];

const getHeatColor = (ratioPercent: number) => {
  if (ratioPercent >= 110) return "#16a34a";
  if (ratioPercent >= 100) return "#facc15";
  if (ratioPercent >= 90) return "#f97316";
  return "#dc2626";
};

const formatProductivity = (value: number) => value.toFixed(3);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

const formatCurrencyWithoutSixZeros = (value: number) =>
  `$ ${Math.round(value / 1_000_000).toLocaleString("es-CO")}`;

const formatCurrencyMillionsOneDecimal = (value: number) =>
  `$ ${(value / 1_000_000).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;

const getTopRankToneClass = (rank: number) => {
  switch (rank) {
    case 1:
      return "border-amber-300/90 bg-amber-50/85";
    case 2:
      return "border-slate-300/90 bg-slate-100/85";
    case 3:
      return "border-orange-300/90 bg-orange-50/85";
    case 4:
      return "border-sky-200/90 bg-sky-50/75";
    default:
      return "border-indigo-200/90 bg-indigo-50/70";
  }
};

const normalizeDateKeyForDisplay = (raw: string) => {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
};

const cashierHourDetailCacheKey = (personKey: string, isoDate: string) =>
  `${personKey}|||${isoDate}`;

const loadExcelJs = () => import("exceljs");

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

/** Horas desde minutos totales; maximo 2 decimales (tabla cajeros). */
const formatTotalLaborMinutesLabel = (totalMinutes: number) => {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0,00h";
  const hoursVal = totalMinutes / 60;
  const rounded = Math.round(hoursVal * 100) / 100;
  const str = rounded.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${str}h`;
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

/** Minutos laborales: prioriza `asistencia_horas` si el API cruzó cedula/nombre; si no, franjas con venta. */
const getCashierLaborMinutes = (
  person: HourlyPersonContribution,
  activeSlotsCount: number,
  bucketMinutes: number,
) => {
  const att = person.attendanceWorkedHours;
  if (typeof att === "number" && Number.isFinite(att) && att > 0) {
    return Math.round(att * 60);
  }
  return activeSlotsCount * bucketMinutes;
};

const cashierLaborHoursSourceTitle = (person: HourlyPersonContribution) => {
  const m = person.attendanceMatchMode;
  if (m === "cedula") {
    return "Horas desde asistencia (total_laborado_horas), cruce por cedula.";
  }
  if (m === "id_texto") {
    return "Horas desde asistencia, cruce por identificador (no numerico o corto).";
  }
  if (m === "nombre") {
    return "Horas desde asistencia, cruce por nombre unico en ventas y en asistencia con una sola cedula.";
  }
  return "Horas estimadas por franjas con venta; sin match fiable en asistencia.";
};

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

const OVERTIME_PAGE_SIZE = 150;
const OVERTIME_PAGE_TAB_WINDOW = 8;
const CASHIER_PAGE_SIZE = 30;
const CASHIER_PAGE_TAB_WINDOW = 8;
const ALERT_THRESHOLD_MINUTES = 9 * 60 + 20;
const TWO_MARKS_ALERT_THRESHOLD_MINUTES = 7 * 60 + 29;
const OVERTIME_TABLE_OUTER_BORDER_CLASS = "border border-slate-200/90";
const OVERTIME_TABLE_INNER_BORDER_CLASS = "border-slate-200";

const compareOvertimeText = (left: string, right: string) =>
  left.localeCompare(right, "es", { sensitivity: "base" });

const getOvertimeDateTimestamp = (employee: OvertimeEmployee) => {
  if (!employee.workedDate) return 0;
  const timestamp = new Date(employee.workedDate).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getOvertimeIncidentValue = (employee: OvertimeEmployee) =>
  employee.incident?.trim() ?? "";

const getOvertimeNominaValue = (employee: OvertimeEmployee) =>
  employee.nomina?.trim() ?? "";

const getOvertimeDepartmentValue = (employee: OvertimeEmployee) =>
  employee.department?.trim() || employee.lineName?.trim() || "";

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

const normalizeEmployeeType = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

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

        <div className="flex w-64 shrink-0 items-center justify-end gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
            {formatCurrency(totalSales)}
          </span>
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
        <div className="mt-2 ml-26 mr-64 rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
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
  defaultLine,
  sections = ["map", "overtime"],
  defaultSection = "map",
  showTimeFilters = true,
  showTopDateFilter = true,
  showTopLineFilter = true,
  showSedeFilters = true,
  showDepartmentFilterInOvertime = false,
  enableOvertimeDateRange = false,
  showComparison = true,
  badgeLabel = "Analisis por hora",
  panelTitle = "Desglose horario",
  panelDescription = "Filtra por linea para enfocar el comportamiento horario en todas las sedes.",
  showPersonBreakdown = false,
  defaultPersonBreakdownView = "individual",
  hidePersonBreakdownTabs = false,
  dashboardContext = "productividad",
  exportRef,
  cashierDateRange,
  cashierMonthComparison = false,
  onCashierMonthComparisonToggle,
  onCashierViewReady,
}: HourlyAnalysisProps) => {
  const enabledSections = useMemo(() => {
    const unique = Array.from(new Set(sections));
    return unique.length > 0 ? unique : (["map"] as Array<"map" | "overtime">);
  }, [sections]);
  const [selectedDate, setSelectedDate] = useState(defaultDate ?? "");
  const [selectedLine, setSelectedLine] = useState(defaultLine ?? "");
  const [selectedSedesState, setSelectedSedesState] = useState<string[]>(
    defaultSede ? [defaultSede] : [],
  );
  const [bucketMinutes, setBucketMinutes] = useState(60);
  const [minuteRangeStart, setMinuteRangeStart] = useState(6 * 60);
  const [minuteRangeEnd, setMinuteRangeEnd] = useState(21 * 60 + 50);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareDate, setCompareDate] = useState("");
  const [hourlyData, setHourlyData] = useState<HourlyAnalysisData | null>(null);
  const [hourlyResultKey, setHourlyResultKey] = useState("");
  const [compareData, setCompareData] = useState<HourlyAnalysisData | null>(
    null,
  );
  const [compareResultKey, setCompareResultKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [expandedSlotState, setExpandedSlotState] = useState<{
    requestKey: string;
    slotStart: number | null;
  }>({ requestKey: "", slotStart: null });
  const [hourlySectionState, setHourlySectionState] = useState<
    "map" | "overtime"
  >(
    enabledSections.includes(defaultSection)
      ? defaultSection
      : enabledSections[0],
  );
  const [overtimeRangeMin, setOvertimeRangeMin] = useState("");
  const [overtimeRangeMax, setOvertimeRangeMax] = useState("");
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
  const [overtimeAlertMode, setOvertimeAlertMode] = useState<
    "920" | "720-2marks"
  >("920");
  const [overtimeExcludedIds, setOvertimeExcludedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [overtimeSortField, setOvertimeSortField] =
    useState<OvertimeSortField>("fecha");
  const [overtimeSortDirection, setOvertimeSortDirection] =
    useState<OvertimeSortDirection>("desc");
  const [overtimeDateStartState, setOvertimeDateStartState] = useState(
    defaultDate ?? "",
  );
  const [overtimeDateEndState, setOvertimeDateEndState] = useState(
    defaultDate ?? "",
  );
  const [overtimePageState, setOvertimePageState] = useState<{
    scopeKey: string;
    page: number;
  }>({ scopeKey: "", page: 1 });
  const [cashierPageState, setCashierPageState] = useState<{
    scopeKey: string;
    page: number;
  }>({ scopeKey: "", page: 1 });
  const [overtimeSedeOpen, setOvertimeSedeOpen] = useState(false);
  const [overtimeDepartmentOpen, setOvertimeDepartmentOpen] = useState(false);
  const [overtimeSedePopoverPos, setOvertimeSedePopoverPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [overtimeDepartmentPopoverPos, setOvertimeDepartmentPopoverPos] =
    useState<{
      top?: number;
      bottom?: number;
      left: number;
      width: number;
      maxHeight: number;
    } | null>(null);
  const overtimeSedeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overtimeSedePanelRef = useRef<HTMLDivElement | null>(null);
  const overtimeDepartmentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overtimeDepartmentPanelRef = useRef<HTMLDivElement | null>(null);
  const [personCargoFilterOpen, setPersonCargoFilterOpen] = useState(false);
  const [personCargoFilterPopoverPos, setPersonCargoFilterPopoverPos] =
    useState<{
      top?: number;
      bottom?: number;
      left: number;
      width: number;
      maxHeight: number;
    } | null>(null);
  const personCargoFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const personCargoFilterPanelRef = useRef<HTMLDivElement | null>(null);
  const [personSearchQuery, setPersonSearchQuery] = useState("");
  /** Vacío = todos los cargos; incluye CASHIER_CARGO_SELECT_EMPTY para "sin cargo". */
  const [personCargoFilters, setPersonCargoFilters] = useState<string[]>([]);
  const deferredPersonSearchQuery = useDeferredValue(personSearchQuery);
  const [cashierSortField, setCashierSortField] =
    useState<CashierSortField>("totalSales");
  const [cashierSalesSortDirection, setCashierSalesSortDirection] = useState<"desc" | "asc">(
    "desc",
  );
  const [expandedPersonDailyKey, setExpandedPersonDailyKey] = useState<
    string | null
  >(null);
  const [cashierHourDetailSelection, setCashierHourDetailSelection] =
    useState<{ personKey: string; isoDate: string } | null>(null);
  const [cashierDayHourlySlots, setCashierDayHourlySlots] = useState<
    Record<string, HourlyPersonSalesSlot[]>
  >({});
  const [cashierDayHourlyError, setCashierDayHourlyError] = useState<
    Record<string, string>
  >({});
  const [cashierDayHourlyLoadingKey, setCashierDayHourlyLoadingKey] = useState<
    string | null
  >(null);
  const cashierHourDetailAbortRef = useRef<AbortController | null>(null);

  const [cashierMonthPrevData, setCashierMonthPrevData] =
    useState<HourlyAnalysisData | null>(null);
  const [cashierMonthCurrData, setCashierMonthCurrData] =
    useState<HourlyAnalysisData | null>(null);
  const [cashierMonthResultKey, setCashierMonthResultKey] = useState("");
  const [cashierMonthError, setCashierMonthError] = useState<string | null>(
    null,
  );
  const [cashierMonthShowImprove, setCashierMonthShowImprove] = useState(false);
  const [personBreakdownView, setPersonBreakdownView] =
    useState<PersonBreakdownView>(defaultPersonBreakdownView);

  useEffect(() => {
    // Al salir del modo comparativo de meses, volvemos a mostrar el Top 5 normal.
    if (!cashierMonthComparison) setCashierMonthShowImprove(false);
  }, [cashierMonthComparison]);
  const topSectionRef = useRef<HTMLDivElement | null>(null);
  const contributionSectionRef = useRef<HTMLDivElement | null>(null);
  const [showFloatingContributionBack, setShowFloatingContributionBack] =
    useState(false);

  const minuteRangeStepSeconds = useMemo(
    () => bucketMinutes * 60,
    [bucketMinutes],
  );
  const bucketOptions = useMemo(() => [60, 30, 20, 15, 10], []);
  // Modo estricto desactivado: usuarios con rol Alex pueden ajustar filtros libremente.
  const isAlexStrictMode = false;
  /** Nombres de sede seleccionadas (el filtro global usa id; los chips del mapa usan name). */
  const selectedSedes = useMemo(() => {
    const nameSet = new Set<string>();
    for (const token of selectedSedesState) {
      const match = availableSedes.find(
        (s) => s.name === token || s.id === token,
      );
      if (match) nameSet.add(match.name);
    }
    return Array.from(nameSet);
  }, [availableSedes, selectedSedesState]);
  const setSelectedSedes = setSelectedSedesState;
  const hourlySection = enabledSections.includes(hourlySectionState)
    ? hourlySectionState
    : enabledSections[0];
  const setHourlySection = setHourlySectionState;

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
  const showMapSection = enabledSections.includes("map");
  const showOvertimeSection = enabledSections.includes("overtime");
  const isOvertimeOnlyMode = showOvertimeSection && !showMapSection;
  const showSectionToggle = enabledSections.length > 1;
  const overtimeDateStart = overtimeDateStartState || selectedDate;
  const overtimeDateEnd = overtimeDateEndState || selectedDate;
  const isCashierMultiDayRange =
    showPersonBreakdown &&
    !cashierMonthComparison &&
    Boolean(
      cashierDateRange?.start &&
      cashierDateRange?.end &&
      cashierDateRange.start !== cashierDateRange.end,
    );
  const hourlyRequestDate =
    enableOvertimeDateRange && isOvertimeOnlyMode
      ? overtimeDateEnd
      : selectedDate;
  const setOvertimeDateStart = setOvertimeDateStartState;
  const setOvertimeDateEnd = setOvertimeDateEndState;

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
  }, [hourlyData, allowedLineSet, hasLineRestriction]);
  const requestedLine = defaultLine?.trim() || selectedLine;
  const effectiveSelectedLine =
    !defaultLine &&
    hasLineRestriction &&
    requestedLine &&
    !allowedLineSet.has(requestedLine.toLowerCase())
      ? ""
      : requestedLine;
  const hourlyRequestKey = useMemo(() => {
    if (!hourlyRequestDate) return "";
    return JSON.stringify({
      date: hourlyRequestDate,
      line: effectiveSelectedLine,
      bucketMinutes,
      sedes: selectedSedes,
      includePeople: showPersonBreakdown && !cashierMonthComparison,
      cashierMonthComparison,
      dashboardContext,
      cashierPeopleRange:
        isCashierMultiDayRange && cashierDateRange
          ? { start: cashierDateRange.start, end: cashierDateRange.end }
          : null,
      overtimeDateRange:
        enableOvertimeDateRange && isOvertimeOnlyMode
          ? {
              start: overtimeDateStart,
              end: overtimeDateEnd,
            }
          : null,
    });
  }, [
    bucketMinutes,
    cashierDateRange,
    cashierMonthComparison,
    dashboardContext,
    effectiveSelectedLine,
    enableOvertimeDateRange,
    hourlyRequestDate,
    isCashierMultiDayRange,
    isOvertimeOnlyMode,
    overtimeDateEnd,
    overtimeDateStart,
    selectedSedes,
    showPersonBreakdown,
  ]);
  const compareRequestKey = useMemo(() => {
    if (!compareEnabled || !compareDate) return "";
    return JSON.stringify({
      date: compareDate,
      line: effectiveSelectedLine,
      bucketMinutes,
      sedes: selectedSedes,
      dashboardContext,
    });
  }, [
    bucketMinutes,
    compareDate,
    compareEnabled,
    dashboardContext,
    effectiveSelectedLine,
    selectedSedes,
  ]);
  const cashierMonthRequestKey = useMemo(() => {
    if (!cashierMonthComparison || !showPersonBreakdown) return "";
    if (!selectedDate) return "";
    return JSON.stringify({
      anchor: selectedDate,
      line: effectiveSelectedLine,
      bucketMinutes,
      sedes: selectedSedes,
      dashboardContext,
    });
  }, [
    cashierMonthComparison,
    showPersonBreakdown,
    selectedDate,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
    dashboardContext,
  ]);

  const primaryHourlyLoading =
    Boolean(hourlyRequestKey) && hourlyResultKey !== hourlyRequestKey;
  const cashierMonthCompareLoading =
    Boolean(cashierMonthRequestKey) &&
    cashierMonthResultKey !== cashierMonthRequestKey;
  const isLoading = primaryHourlyLoading || cashierMonthCompareLoading;

  useEffect(() => {
    if (!onCashierViewReady || !showPersonBreakdown) return;
    if (cashierMonthComparison) {
      if (!cashierMonthRequestKey) return;
      if (cashierMonthCompareLoading || primaryHourlyLoading) return;
    } else {
      if (!hourlyRequestKey) return;
      if (primaryHourlyLoading) return;
    }
    onCashierViewReady();
  }, [
    cashierMonthCompareLoading,
    cashierMonthComparison,
    cashierMonthRequestKey,
    hourlyRequestKey,
    onCashierViewReady,
    primaryHourlyLoading,
    showPersonBreakdown,
  ]);

  const activeError =
    hourlyRequestKey && hourlyResultKey === hourlyRequestKey ? error : null;
  const activeHourlyData =
    hourlyRequestKey && hourlyResultKey === hourlyRequestKey
      ? hourlyData
      : null;
  const activeCompareData =
    compareRequestKey && compareResultKey === compareRequestKey
      ? compareData
      : null;
  const activeCompareError =
    compareRequestKey && compareResultKey === compareRequestKey
      ? compareError
      : null;
  const expandedSlotStart =
    expandedSlotState.requestKey === hourlyRequestKey
      ? expandedSlotState.slotStart
      : null;
  const setExpandedSlotStart = useCallback(
    (next: number | null | ((prev: number | null) => number | null)) => {
      setExpandedSlotState((prev) => {
        const previousSlot =
          prev.requestKey === hourlyRequestKey ? prev.slotStart : null;
        const resolvedSlot =
          typeof next === "function" ? next(previousSlot) : next;

        return {
          requestKey: hourlyRequestKey,
          slotStart: resolvedSlot,
        };
      });
    },
    [hourlyRequestKey],
  );
  const overtimeFilterControlClass =
    "mt-1 w-full rounded-full border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-all focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100";

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

  const togglePersonCargoFilter = (cargoValue: string) => {
    setPersonCargoFilters((prev) =>
      prev.includes(cargoValue)
        ? prev.filter((value) => value !== cargoValue)
        : [...prev, cargoValue],
    );
  };

  const clearPersonCargoFilters = () => {
    setPersonCargoFilters([]);
  };

  const getResponsivePopoverPosition = useCallback(
    (trigger: HTMLButtonElement) => {
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const viewportPadding = 16;
      const gap = 8;
      const minWidth = 260;
      const preferredMaxHeight = 320;
      const minimumVisibleHeight = 160;
      const width = Math.min(
        Math.max(minWidth, rect.width),
        Math.max(minWidth, viewportWidth - viewportPadding * 2),
      );
      const maxLeft = Math.max(
        viewportPadding,
        viewportWidth - viewportPadding - width,
      );
      const left = Math.min(Math.max(rect.left, viewportPadding), maxLeft);
      const availableBelow =
        viewportHeight - rect.bottom - gap - viewportPadding;
      const availableAbove = rect.top - gap - viewportPadding;
      const shouldOpenUpward =
        availableBelow < minimumVisibleHeight &&
        availableAbove > availableBelow;

      if (shouldOpenUpward) {
        return {
          bottom: Math.max(viewportPadding, viewportHeight - rect.top + gap),
          left,
          width,
          maxHeight: Math.max(
            minimumVisibleHeight,
            Math.min(preferredMaxHeight, availableAbove),
          ),
        };
      }

      return {
        top: rect.bottom + gap,
        left,
        width,
        maxHeight: Math.max(
          minimumVisibleHeight,
          Math.min(preferredMaxHeight, availableBelow),
        ),
      };
    },
    [],
  );

  const updateOvertimeSedePopoverPos = useCallback(() => {
    const trigger = overtimeSedeTriggerRef.current;
    if (!trigger) return;
    setOvertimeSedePopoverPos(getResponsivePopoverPosition(trigger));
  }, [getResponsivePopoverPosition]);

  const updateOvertimeDepartmentPopoverPos = useCallback(() => {
    const trigger = overtimeDepartmentTriggerRef.current;
    if (!trigger) return;
    setOvertimeDepartmentPopoverPos(getResponsivePopoverPosition(trigger));
  }, [getResponsivePopoverPosition]);

  const updatePersonCargoFilterPopoverPos = useCallback(() => {
    const trigger = personCargoFilterTriggerRef.current;
    if (!trigger) return;
    setPersonCargoFilterPopoverPos(getResponsivePopoverPosition(trigger));
  }, [getResponsivePopoverPosition]);

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
  }, [overtimeSedeOpen, updateOvertimeSedePopoverPos]);

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
  }, [overtimeDepartmentOpen, updateOvertimeDepartmentPopoverPos]);

  useEffect(() => {
    if (!personCargoFilterOpen) return;
    updatePersonCargoFilterPopoverPos();

    const onResizeOrScroll = () => updatePersonCargoFilterPopoverPos();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (personCargoFilterTriggerRef.current?.contains(target)) return;
      if (personCargoFilterPanelRef.current?.contains(target)) return;
      setPersonCargoFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPersonCargoFilterOpen(false);
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
  }, [personCargoFilterOpen, updatePersonCargoFilterPopoverPos]);

  useEffect(() => {
    if (!showPersonBreakdown) return;

    const updateFloatingBack = () => {
      const section = contributionSectionRef.current;
      if (!section) {
        setShowFloatingContributionBack(false);
        return;
      }
      const rect = section.getBoundingClientRect();
      const shouldShow = rect.top < -160;
      setShowFloatingContributionBack(shouldShow);
    };

    updateFloatingBack();
    window.addEventListener("scroll", updateFloatingBack, { passive: true });
    window.addEventListener("resize", updateFloatingBack);
    return () => {
      window.removeEventListener("scroll", updateFloatingBack);
      window.removeEventListener("resize", updateFloatingBack);
    };
  }, [showPersonBreakdown]);
  const floatingContributionBackVisible =
    showPersonBreakdown && showFloatingContributionBack;

  const fetchHourly = async (
    date: string,
    lineId: string,
    currentBucketMinutes: number,
    sedeNames: string[],
    includePeople: boolean,
    currentDashboardContext: HourlyAnalysisDashboardContext,
    overtimeOnly: boolean,
    overtimeDateRange?: { start: string; end: string },
    peopleRange?: { start: string; end: string },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ date });
    params.set("dashboardContext", currentDashboardContext);
    if (lineId) params.set("line", lineId);
    params.set("bucketMinutes", String(currentBucketMinutes));
    if (includePeople) params.set("includePeople", "1");
    if (overtimeOnly) params.set("overtimeOnly", "1");
    sedeNames.forEach((sede) => params.append("sede", sede));
    if (overtimeDateRange?.start)
      params.set("overtimeDateStart", overtimeDateRange.start);
    if (overtimeDateRange?.end)
      params.set("overtimeDateEnd", overtimeDateRange.end);
    if (
      includePeople &&
      peopleRange?.start &&
      peopleRange?.end &&
      peopleRange.start !== peopleRange.end
    ) {
      params.set("peopleDateStart", peopleRange.start);
      params.set("peopleDateEnd", peopleRange.end);
    }

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
    if (!hourlyRequestDate || !hourlyRequestKey) return;

    const controller = new AbortController();

    fetchHourly(
      hourlyRequestDate,
      effectiveSelectedLine,
      bucketMinutes,
      selectedSedes,
      showPersonBreakdown && !cashierMonthComparison,
      dashboardContext,
      isOvertimeOnlyMode,
      enableOvertimeDateRange && isOvertimeOnlyMode
        ? {
            start: overtimeDateStart,
            end: overtimeDateEnd,
          }
        : undefined,
      isCashierMultiDayRange && cashierDateRange ? cashierDateRange : undefined,
      controller.signal,
    )
      .then((data) => {
        setHourlyData(data);
        setError(null);
        setHourlyResultKey(hourlyRequestKey);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setHourlyData(null);
        setHourlyResultKey(hourlyRequestKey);
      });

    return () => controller.abort();
  }, [
    cashierDateRange,
    cashierMonthComparison,
    hourlyRequestDate,
    hourlyRequestKey,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
    showPersonBreakdown,
    dashboardContext,
    enableOvertimeDateRange,
    isCashierMultiDayRange,
    isOvertimeOnlyMode,
    overtimeDateStart,
    overtimeDateEnd,
  ]);

  useEffect(() => {
    if (!cashierMonthRequestKey || !selectedDate) return;

    const controller = new AbortController();
    const ranges = getCashierMonthComparisonRanges(selectedDate);

    const fetchPeriod = (range: { start: string; end: string }) => {
      const multi = range.start !== range.end;
      return fetchHourly(
        range.end,
        effectiveSelectedLine,
        bucketMinutes,
        selectedSedes,
        true,
        dashboardContext,
        false,
        undefined,
        multi ? range : undefined,
        controller.signal,
      );
    };

    Promise.all([fetchPeriod(ranges.previous), fetchPeriod(ranges.current)])
      .then(([prev, curr]) => {
        setCashierMonthPrevData(prev);
        setCashierMonthCurrData(curr);
        setCashierMonthResultKey(cashierMonthRequestKey);
        setCashierMonthError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCashierMonthPrevData(null);
        setCashierMonthCurrData(null);
        setCashierMonthError(
          err instanceof Error ? err.message : "Error al comparar meses",
        );
        setCashierMonthResultKey(cashierMonthRequestKey);
      });

    return () => controller.abort();
  }, [
    cashierMonthRequestKey,
    selectedDate,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
    dashboardContext,
  ]);

  useEffect(() => {
    if (!cashierHourDetailSelection) return;
    if (!showPersonBreakdown || cashierMonthComparison) return;
    if (expandedPersonDailyKey !== cashierHourDetailSelection.personKey)
      return;
    const { personKey, isoDate } = cashierHourDetailSelection;
    const ck = cashierHourDetailCacheKey(personKey, isoDate);
    if (!isCashierMultiDayRange) return;
    if (Object.hasOwn(cashierDayHourlySlots, ck)) return;

    cashierHourDetailAbortRef.current?.abort();
    const ac = new AbortController();
    cashierHourDetailAbortRef.current = ac;
    queueMicrotask(() => {
      if (ac.signal.aborted) return;
      setCashierDayHourlyLoadingKey(ck);
      setCashierDayHourlyError((prev) => {
        const next = { ...prev };
        delete next[ck];
        return next;
      });
    });

    void fetchHourly(
      isoDate,
      effectiveSelectedLine,
      bucketMinutes,
      selectedSedes,
      true,
      dashboardContext,
      false,
      undefined,
      undefined,
      ac.signal,
    )
      .then((data) => {
        if (ac.signal.aborted) return;
        const contrib = data.personContributions?.find(
          (row) => row.personKey === personKey,
        );
        const slots =
          contrib?.hourlySales
            ?.filter((s) => s.sales > 0)
            .sort((a, b) => a.slotStartMinute - b.slotStartMinute) ?? [];
        setCashierDayHourlySlots((prev) => ({ ...prev, [ck]: slots }));
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCashierDayHourlyError((prev) => ({
          ...prev,
          [ck]:
            err instanceof Error
              ? err.message
              : "No se pudieron cargar ventas por hora.",
        }));
      })
      .finally(() => {
        setCashierDayHourlyLoadingKey((k) => (k === ck ? null : k));
      });

    return () => {
      ac.abort();
      setCashierDayHourlyLoadingKey((k) => (k === ck ? null : k));
    };
  }, [
    cashierDayHourlySlots,
    cashierHourDetailSelection,
    cashierMonthComparison,
    dashboardContext,
    effectiveSelectedLine,
    expandedPersonDailyKey,
    isCashierMultiDayRange,
    bucketMinutes,
    selectedSedes,
    showPersonBreakdown,
  ]);

  useEffect(() => {
    if (!compareEnabled || !compareDate || !compareRequestKey) return;

    const controller = new AbortController();

    fetchHourly(
      compareDate,
      effectiveSelectedLine,
      bucketMinutes,
      selectedSedes,
      false,
      dashboardContext,
      false,
      undefined,
      undefined,
      controller.signal,
    )
      .then((data) => {
        setCompareData(data);
        setCompareError(null);
        setCompareResultKey(compareRequestKey);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCompareError(
          err instanceof Error ? err.message : "Error desconocido",
        );
        setCompareData(null);
        setCompareResultKey(compareRequestKey);
      });

    return () => controller.abort();
  }, [
    compareEnabled,
    compareDate,
    compareRequestKey,
    effectiveSelectedLine,
    bucketMinutes,
    selectedSedes,
    dashboardContext,
  ]);

  const rangedHours = useMemo(() => {
    if (!activeHourlyData) return [];
    return activeHourlyData.hours.filter(
      (h) =>
        h.slotStartMinute >= minuteRangeStart &&
        h.slotStartMinute <= minuteRangeEnd,
    );
  }, [activeHourlyData, minuteRangeEnd, minuteRangeStart]);

  const activeHours = useMemo(() => {
    if (!activeHourlyData) return [];
    return rangedHours.filter(
      (h) => h.totalSales > 0 || h.employeesPresent > 0,
    );
  }, [activeHourlyData, rangedHours]);

  const hourlyExportRows = useMemo(
    () =>
      activeHours.map((slot) => ({
        label: slot.label,
        sales: slot.totalSales,
        employees: slot.employeesPresent,
        productivity: calcVtaHr(
          slot.totalSales,
          slot.employeesPresent * (bucketMinutes / 60),
        ),
      })),
    [activeHours, bucketMinutes],
  );

  const mainBaselineSalesPerEmployee = useMemo(() => {
    if (!activeHourlyData) return 0;
    const totals = rangedHours.reduce(
      (acc, h) => {
        acc.sales += h.totalSales;
        acc.hours += h.employeesPresent * (bucketMinutes / 60);
        return acc;
      },
      { sales: 0, hours: 0 },
    );
    return calcVtaHr(totals.sales, totals.hours);
  }, [activeHourlyData, bucketMinutes, rangedHours]);

  const compareBaselineSalesPerEmployee = useMemo(() => {
    if (!activeCompareData) return 0;
    const compareRangeHours = activeCompareData.hours.filter(
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
  }, [activeCompareData, bucketMinutes, minuteRangeEnd, minuteRangeStart]);

  const computeHeatRatio = useCallback(
    (sales: number, employees: number, baselineSalesPerEmployee: number) => {
      const laborHours = employees * (bucketMinutes / 60);
      const vtaHr = calcVtaHr(sales, laborHours);
      if (baselineSalesPerEmployee > 0) {
        return (vtaHr / baselineSalesPerEmployee) * 100;
      }
      return 0;
    },
    [bucketMinutes],
  );

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
    if (!activeHourlyData) return [];

    const compareByHour = new Map(
      activeCompareData?.hours
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
          label: h.label,
          tickLabel: h.label.slice(0, 5),
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
        if (showPersonBreakdown) {
          return true;
        }
        if (compareEnabled && activeCompareData) {
          return h.mainSales > 0 || h.compareSales > 0;
        }
        return h.mainSales > 0;
      });
  }, [
    activeCompareData,
    activeHourlyData,
    bucketMinutes,
    compareBaselineSalesPerEmployee,
    compareEnabled,
    computeHeatRatio,
    mainBaselineSalesPerEmployee,
    minuteRangeEnd,
    minuteRangeStart,
    rangedHours,
    showPersonBreakdown,
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
    if (!activeHourlyData)
      return {
        sales: 0,
        avgProductivity: 0,
        peakEmployees: 0,
        activeHoursCount: 0,
      };
    if (
      activeHourlyData.personContributionsScope === "date-range" &&
      activeHourlyData.personContributions?.length
    ) {
      const sales = activeHourlyData.personContributions.reduce(
        (sum, p) => sum + (p.periodTotalSales ?? 0),
        0,
      );
      return {
        sales,
        avgProductivity: 0,
        peakEmployees: 0,
        activeHoursCount: 0,
      };
    }
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
  }, [activeHourlyData, bucketMinutes, rangedHours]);

  const isCashierPersonRangeResponse =
    activeHourlyData?.personContributionsScope === "date-range";

  const handleExportHourlyCsv = useCallback(() => {
    if (hourlyExportRows.length === 0) return false;
    const rows = [
      ["Franja", "Ventas", "Empleados", "Vta/Hr"],
      ...hourlyExportRows.map((row) => [
        sanitizeExportText(row.label),
        Math.round(row.sales),
        row.employees,
        Number.isFinite(row.productivity)
          ? row.productivity.toFixed(3)
          : "0.000",
      ]),
    ];
    const csv = rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateKey = selectedDate || "sin-fecha";
    link.href = url;
    link.download = `productividad-por-hora-${dateKey}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }, [hourlyExportRows, selectedDate]);

  const handleExportHourlyXlsx = useCallback(async () => {
    if (hourlyExportRows.length === 0) return false;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Productividad por hora");
    sheet.columns = [
      { key: "label", width: 12 },
      { key: "sales", width: 16 },
      { key: "employees", width: 14 },
      { key: "productivity", width: 12 },
    ];
    sheet.addRow(["Franja", "Ventas", "Empleados", "Vta/Hr"]);
    hourlyExportRows.forEach((row) => {
      sheet.addRow([
        sanitizeExportText(row.label),
        Math.round(row.sales),
        row.employees,
        Number.isFinite(row.productivity)
          ? Number(row.productivity.toFixed(3))
          : 0,
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
    const dateKey = selectedDate || "sin-fecha";
    link.href = url;
    link.download = `productividad-por-hora-${dateKey}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }, [hourlyExportRows, selectedDate]);

  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = {
      exportCsv: handleExportHourlyCsv,
      exportXlsx: handleExportHourlyXlsx,
    };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef, handleExportHourlyCsv, handleExportHourlyXlsx]);

  const hourDifferences = useMemo(() => {
    if (personBreakdownView !== "franjas") return [];
    return rangedHours.map((slot, index) => {
      const previous = index > 0 ? rangedHours[index - 1] : null;
      const deltaSales = previous
        ? slot.totalSales - previous.totalSales
        : slot.totalSales;
      const deltaPercent =
        previous && previous.totalSales > 0
          ? (deltaSales / previous.totalSales) * 100
          : null;
      return {
        slotStartMinute: slot.slotStartMinute,
        label: slot.label,
        sales: slot.totalSales,
        deltaSales,
        deltaPercent,
      };
    });
  }, [personBreakdownView, rangedHours]);

  const peopleBreakdown = useMemo(() => {
    if (personBreakdownView !== "individual") return [];
    const people = activeHourlyData?.personContributions ?? [];
    if (people.length === 0) return [];

    return people
      .map((person) => {
        if (
          person.periodTotalSales != null &&
          person.hourlySales.length === 0
        ) {
          const totalSales = person.periodTotalSales;
          const contributionShare =
            dayTotals.sales > 0 ? totalSales / dayTotals.sales : 0;
          return {
            ...person,
            activeSlots: [] as typeof person.hourlySales,
            slotDiffs: [] as Array<
              (typeof person.hourlySales)[number] & {
                deltaSales: number;
                deltaPercent: number | null;
              }
            >,
            totalSales,
            contributionShare,
            peakSlot: null,
            firstSlot: null,
            lastSlot: null,
          };
        }

        const activeSlots = person.hourlySales
          .filter(
            (slot) =>
              slot.slotStartMinute >= minuteRangeStart &&
              slot.slotStartMinute <= minuteRangeEnd &&
              slot.sales > 0,
          )
          .sort((a, b) => a.slotStartMinute - b.slotStartMinute);

        const totalSales = activeSlots.reduce(
          (sum, slot) => sum + slot.sales,
          0,
        );
        const contributionShare =
          dayTotals.sales > 0 ? totalSales / dayTotals.sales : 0;
        const slotDiffs = activeSlots.map((slot, index) => {
          const previous = index > 0 ? activeSlots[index - 1] : null;
          const deltaSales = previous
            ? slot.sales - previous.sales
            : slot.sales;
          const deltaPercent =
            previous && previous.sales > 0
              ? (deltaSales / previous.sales) * 100
              : null;
          return {
            ...slot,
            deltaSales,
            deltaPercent,
          };
        });
        const peakSlot =
          [...activeSlots].sort((a, b) => b.sales - a.sales)[0] ?? null;
        const firstSlot = activeSlots[0] ?? null;
        const lastSlot = activeSlots[activeSlots.length - 1] ?? null;

        return {
          ...person,
          activeSlots,
          slotDiffs,
          totalSales,
          contributionShare,
          peakSlot,
          firstSlot,
          lastSlot,
        };
      })
      .filter((person) => person.totalSales > 0)
      .sort((a, b) => b.totalSales - a.totalSales);
  }, [
    activeHourlyData?.personContributions,
    dayTotals.sales,
    minuteRangeEnd,
    minuteRangeStart,
    personBreakdownView,
  ]);

  const cashierCargoSelectOptions = useMemo(() => {
    const nonEmpty = new Set<string>();
    let hasEmpty = false;
    for (const p of peopleBreakdown) {
      const c = (p.personCargo ?? "").trim();
      if (!c) hasEmpty = true;
      else nonEmpty.add(c);
    }
    const sorted = [...nonEmpty].sort((a, b) =>
      a.localeCompare(b, "es", { sensitivity: "base" }),
    );
    return { sorted, hasEmpty };
  }, [peopleBreakdown]);

  const personCargoFilterButtonLabel = useMemo(() => {
    if (personCargoFilters.length === 0) return "Todos los cargos";
    const named = personCargoFilters.filter(
      (value) => value !== CASHIER_CARGO_SELECT_EMPTY,
    );
    const includesEmpty = personCargoFilters.includes(
      CASHIER_CARGO_SELECT_EMPTY,
    );
    if (personCargoFilters.length === 1) {
      if (includesEmpty) return "Sin cargo";
      return named[0] ?? "1 cargo";
    }
    const parts: string[] = [];
    if (named.length > 0) {
      parts.push(`${named.length} cargo(s)`);
    }
    if (includesEmpty) {
      parts.push("sin cargo");
    }
    return parts.join(" · ") || `${personCargoFilters.length} seleccionados`;
  }, [personCargoFilters]);

  const filteredPeopleBreakdown = useMemo(() => {
    if (personBreakdownView !== "individual") return [];
    let rows = peopleBreakdown;
    if (personCargoFilters.length > 0) {
      const allowEmpty = personCargoFilters.includes(CASHIER_CARGO_SELECT_EMPTY);
      const allowedNamed = new Set(
        personCargoFilters.filter((value) => value !== CASHIER_CARGO_SELECT_EMPTY),
      );
      rows = rows.filter((person) => {
        const cargo = (person.personCargo ?? "").trim();
        if (!cargo) return allowEmpty;
        return allowedNamed.has(cargo);
      });
    }
    const query = deferredPersonSearchQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((person) => {
      const name = person.personName.trim().toLowerCase();
      const id = person.personId?.trim().toLowerCase() ?? "";
      return name.includes(query) || id.includes(query);
    });
  }, [
    deferredPersonSearchQuery,
    peopleBreakdown,
    personBreakdownView,
    personCargoFilters,
  ]);

  const cashierListTotalSales = useMemo(
    () =>
      filteredPeopleBreakdown.reduce(
        (sum, person) => sum + person.totalSales,
        0,
      ),
    [filteredPeopleBreakdown],
  );
  const sortedPeopleBreakdown = useMemo(() => {
    const rows = [...filteredPeopleBreakdown];
    rows.sort((a, b) => {
      const aActiveSlots =
        (typeof a.activeSlotsCount === "number"
          ? a.activeSlotsCount
          : (a.activeSlots?.length ?? a.hourlySales.length)) || 0;
      const bActiveSlots =
        (typeof b.activeSlotsCount === "number"
          ? b.activeSlotsCount
          : (b.activeSlots?.length ?? b.hourlySales.length)) || 0;
      const aWorkedHours =
        getCashierLaborMinutes(a, aActiveSlots, bucketMinutes) / 60;
      const bWorkedHours =
        getCashierLaborMinutes(b, bActiveSlots, bucketMinutes) / 60;
      const aVtaHr = calcVtaHr(a.totalSales, aWorkedHours);
      const bVtaHr = calcVtaHr(b.totalSales, bWorkedHours);

      const aValue =
        cashierSortField === "workedHours"
          ? aWorkedHours
          : cashierSortField === "vtaHr"
            ? aVtaHr
            : a.totalSales;
      const bValue =
        cashierSortField === "workedHours"
          ? bWorkedHours
          : cashierSortField === "vtaHr"
            ? bVtaHr
            : b.totalSales;
      const diff = aValue - bValue;
      return cashierSalesSortDirection === "desc" ? -diff : diff;
    });
    return rows;
  }, [bucketMinutes, cashierSalesSortDirection, cashierSortField, filteredPeopleBreakdown]);

  const cashierPaginationScopeKey = useMemo(
    () =>
      JSON.stringify({
        request: hourlyRequestKey,
        search: deferredPersonSearchQuery.trim().toLowerCase(),
        cargos: [...personCargoFilters].sort(),
        sortField: cashierSortField,
        sortDirection: cashierSalesSortDirection,
        count: sortedPeopleBreakdown.length,
      }),
    [
      cashierSalesSortDirection,
      cashierSortField,
      deferredPersonSearchQuery,
      hourlyRequestKey,
      personCargoFilters,
      sortedPeopleBreakdown.length,
    ],
  );
  const cashierTotalPages = useMemo(
    () =>
      Math.max(1, Math.ceil(sortedPeopleBreakdown.length / CASHIER_PAGE_SIZE)),
    [sortedPeopleBreakdown.length],
  );
  const cashierPage =
    cashierPageState.scopeKey === cashierPaginationScopeKey
      ? Math.max(1, Math.min(cashierTotalPages, cashierPageState.page))
      : 1;
  const setCashierPage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setExpandedPersonDailyKey(null);
      setCashierHourDetailSelection(null);
      cashierHourDetailAbortRef.current?.abort();
      setCashierDayHourlyLoadingKey(null);
      setCashierPageState((prev) => {
        const previousPage =
          prev.scopeKey === cashierPaginationScopeKey ? prev.page : 1;
        const resolvedPage =
          typeof next === "function" ? next(previousPage) : next;
        return {
          scopeKey: cashierPaginationScopeKey,
          page: Math.max(1, Math.min(cashierTotalPages, resolvedPage)),
        };
      });
    },
    [cashierPaginationScopeKey, cashierTotalPages],
  );
  const pagedCashiers = useMemo(() => {
    const start = (cashierPage - 1) * CASHIER_PAGE_SIZE;
    return sortedPeopleBreakdown.slice(start, start + CASHIER_PAGE_SIZE);
  }, [cashierPage, sortedPeopleBreakdown]);
  const cashierPageTabs = useMemo(() => {
    const half = Math.floor(CASHIER_PAGE_TAB_WINDOW / 2);
    let start = Math.max(1, cashierPage - half);
    const end = Math.min(
      cashierTotalPages,
      start + CASHIER_PAGE_TAB_WINDOW - 1,
    );
    if (end - start + 1 < CASHIER_PAGE_TAB_WINDOW) {
      start = Math.max(1, end - CASHIER_PAGE_TAB_WINDOW + 1);
    }
    return Array.from({ length: end - start + 1 }, (_v, i) => start + i);
  }, [cashierPage, cashierTotalPages]);

  const handleCashierSortBy = useCallback((field: CashierSortField) => {
    if (cashierSortField === field) {
      setCashierSalesSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setCashierSortField(field);
    setCashierSalesSortDirection("desc");
  }, [cashierSortField]);

  const topContributor = useMemo(() => {
    if (cashierMonthComparison) return null;
    if (personBreakdownView !== "individual") return null;
    return filteredPeopleBreakdown[0] ?? peopleBreakdown[0] ?? null;
  }, [
    cashierMonthComparison,
    filteredPeopleBreakdown,
    peopleBreakdown,
    personBreakdownView,
  ]);

  const cashierMonthMeta = useMemo(() => {
    if (!selectedDate) return null;
    return getCashierMonthComparisonRanges(selectedDate);
  }, [selectedDate]);

  const cashierMonthCompareReady =
    cashierMonthComparison &&
    Boolean(cashierMonthRequestKey) &&
    cashierMonthResultKey === cashierMonthRequestKey;

  const cashierTop5PreviousMonth = useMemo(() => {
    if (!cashierMonthCompareReady) return [];
    return rankTopCashiers(
      cashierMonthPrevData?.personContributions,
      CASHIER_MONTH_TOP_N,
      bucketMinutes,
    );
  }, [bucketMinutes, cashierMonthCompareReady, cashierMonthPrevData]);

  const cashierTop5CurrentMonth = useMemo(() => {
    if (!cashierMonthCompareReady) return [];
    return rankTopCashiers(
      cashierMonthCurrData?.personContributions,
      CASHIER_MONTH_TOP_N,
      bucketMinutes,
    );
  }, [bucketMinutes, cashierMonthCompareReady, cashierMonthCurrData]);

  const cashierImprove5PreviousMonth = useMemo(() => {
    if (!cashierMonthCompareReady) return [];
    return rankImproveCashiers(
      cashierMonthPrevData?.personContributions,
      CASHIER_MONTH_TOP_N,
      bucketMinutes,
    );
  }, [bucketMinutes, cashierMonthCompareReady, cashierMonthPrevData]);

  const cashierImprove5CurrentMonth = useMemo(() => {
    if (!cashierMonthCompareReady) return [];
    return rankImproveCashiers(
      cashierMonthCurrData?.personContributions,
      CASHIER_MONTH_TOP_N,
      bucketMinutes,
    );
  }, [bucketMinutes, cashierMonthCompareReady, cashierMonthCurrData]);

  const cashierTop5SharedKeys = useMemo(() => {
    const prevKeys = new Set(cashierTop5PreviousMonth.map((r) => r.personKey));
    const shared = new Set<string>();
    for (const row of cashierTop5CurrentMonth) {
      if (prevKeys.has(row.personKey)) shared.add(row.personKey);
    }
    return shared;
  }, [cashierTop5CurrentMonth, cashierTop5PreviousMonth]);

  const cashierImprove5SharedKeys = useMemo(() => {
    const prevKeys = new Set(
      cashierImprove5PreviousMonth.map((r) => r.personKey),
    );
    const shared = new Set<string>();
    for (const row of cashierImprove5CurrentMonth) {
      if (prevKeys.has(row.personKey)) shared.add(row.personKey);
    }
    return shared;
  }, [cashierImprove5CurrentMonth, cashierImprove5PreviousMonth]);
  const cashierTop5PreviousTotalVtaHr = useMemo(() => {
    const sumSales = cashierTop5PreviousMonth.reduce(
      (sum, row) => sum + row.sales,
      0,
    );
    const sumHours = cashierTop5PreviousMonth.reduce(
      (sum, row) => sum + row.hours,
      0,
    );
    return sumHours > 0 ? calcVtaHr(sumSales, sumHours) : 0;
  }, [cashierTop5PreviousMonth]);

  const cashierTop5CurrentTotalVtaHr = useMemo(() => {
    const sumSales = cashierTop5CurrentMonth.reduce(
      (sum, row) => sum + row.sales,
      0,
    );
    const sumHours = cashierTop5CurrentMonth.reduce(
      (sum, row) => sum + row.hours,
      0,
    );
    return sumHours > 0 ? calcVtaHr(sumSales, sumHours) : 0;
  }, [cashierTop5CurrentMonth]);

  const cashierImprove5PreviousTotalVtaHr = useMemo(() => {
    const sumSales = cashierImprove5PreviousMonth.reduce(
      (sum, row) => sum + row.sales,
      0,
    );
    const sumHours = cashierImprove5PreviousMonth.reduce(
      (sum, row) => sum + row.hours,
      0,
    );
    return sumHours > 0 ? calcVtaHr(sumSales, sumHours) : 0;
  }, [cashierImprove5PreviousMonth]);

  const cashierImprove5CurrentTotalVtaHr = useMemo(() => {
    const sumSales = cashierImprove5CurrentMonth.reduce(
      (sum, row) => sum + row.sales,
      0,
    );
    const sumHours = cashierImprove5CurrentMonth.reduce(
      (sum, row) => sum + row.hours,
      0,
    );
    return sumHours > 0 ? calcVtaHr(sumSales, sumHours) : 0;
  }, [cashierImprove5CurrentMonth]);

  const cashierMonthPrevRows = cashierMonthShowImprove
    ? cashierImprove5PreviousMonth
    : cashierTop5PreviousMonth;
  const cashierMonthCurrRows = cashierMonthShowImprove
    ? cashierImprove5CurrentMonth
    : cashierTop5CurrentMonth;
  const cashierMonthSharedKeys = cashierMonthShowImprove
    ? cashierImprove5SharedKeys
    : cashierTop5SharedKeys;

  const cashierMonthPrevTotalVtaHr = cashierMonthShowImprove
    ? cashierImprove5PreviousTotalVtaHr
    : cashierTop5PreviousTotalVtaHr;
  const cashierMonthCurrTotalVtaHr = cashierMonthShowImprove
    ? cashierImprove5CurrentTotalVtaHr
    : cashierTop5CurrentTotalVtaHr;

  const cashierMonthRankLabel = cashierMonthShowImprove
    ? `5 a mejorar`
    : `top ${CASHIER_MONTH_TOP_N}`;

  const salesByHourCards = useMemo(() => {
    if (personBreakdownView !== "franjas") return [];
    return rangedHours.map((slot) => ({
      slotStartMinute: slot.slotStartMinute,
      label: slot.label,
      sales: slot.totalSales,
      productivity: calcVtaHr(
        slot.totalSales,
        slot.employeesPresent * (bucketMinutes / 60),
      ),
      employeesPresent: slot.employeesPresent,
    }));
  }, [bucketMinutes, personBreakdownView, rangedHours]);
  const shouldShowHourBars =
    !showPersonBreakdown || personBreakdownView === "franjas";

  const handleToggleHour = (hour: number) => {
    setExpandedSlotStart((prev) => (prev === hour ? null : hour));
  };

  const handleScrollToContributionStart = useCallback(() => {
    contributionSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleScrollToTop = useCallback(() => {
    topSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const selectedLineLabel =
    effectiveSelectedLine &&
    lineOptions.find((line) => line.id === effectiveSelectedLine)?.name;
  const overtimeEmployees = useMemo(
    () => activeHourlyData?.overtimeEmployees ?? [],
    [activeHourlyData],
  );
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
        const normalizedEmployeeType = normalizeEmployeeType(employeeType);
        const normalizedFilter = normalizeEmployeeType(
          overtimeEmployeeTypeFilter,
        );
        if (normalizedFilter === "36horas") {
          const has36 =
            normalizedEmployeeType.includes("36horas") ||
            normalizedEmployeeType.includes("36h");
          if (!has36) return false;
        } else if (normalizedEmployeeType !== normalizedFilter) {
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
    isAlexStrictMode,
    hasEmployeeTypeData,
    overtimePersonFilter,
    overtimeRangeMin,
    overtimeRangeMax,
  ]);
  const filteredOvertimeEmployees = useMemo(() => {
    const filtered = overtimeAbsenceOnly
      ? baseFilteredOvertimeEmployees.filter(
          (employee) =>
            employee.isAbsence || isAbsenceIncident(employee.incident),
        )
      : overtimeOddMarksOnly
        ? baseFilteredOvertimeEmployees.filter((employee) => {
            const marks = employee.marksCount ?? 0;
            return marks > 0 && marks % 2 !== 0;
          })
        : overtimeAlertOnly
          ? baseFilteredOvertimeEmployees.filter((employee) => {
              const employeeMinutes = decimalHoursToMinutes(
                employee.workedHours,
              );
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
    const compareByDate = (left: OvertimeEmployee, right: OvertimeEmployee) =>
      getOvertimeDateTimestamp(left) - getOvertimeDateTimestamp(right);
    const compareByHours = (left: OvertimeEmployee, right: OvertimeEmployee) =>
      left.workedHours - right.workedHours;
    const compareByMarks = (left: OvertimeEmployee, right: OvertimeEmployee) =>
      (left.marksCount ?? 0) - (right.marksCount ?? 0);
    const compareByIncident = (
      left: OvertimeEmployee,
      right: OvertimeEmployee,
    ) =>
      compareOvertimeText(
        getOvertimeIncidentValue(left),
        getOvertimeIncidentValue(right),
      );
    const compareByNomina = (left: OvertimeEmployee, right: OvertimeEmployee) =>
      compareOvertimeText(
        getOvertimeNominaValue(left),
        getOvertimeNominaValue(right),
      );
    const compareByDepartment = (
      left: OvertimeEmployee,
      right: OvertimeEmployee,
    ) =>
      compareOvertimeText(
        getOvertimeDepartmentValue(left),
        getOvertimeDepartmentValue(right),
      );
    const compareByName = (left: OvertimeEmployee, right: OvertimeEmployee) =>
      compareOvertimeText(left.employeeName, right.employeeName);

    return [...filtered].sort((a, b) => {
      const primaryDiff =
        overtimeSortField === "fecha"
          ? compareByDate(a, b)
          : overtimeSortField === "horas"
            ? compareByHours(a, b)
            : overtimeSortField === "marcaciones"
              ? compareByMarks(a, b)
              : overtimeSortField === "incidencia"
                ? compareByIncident(a, b)
                : overtimeSortField === "nomina"
                  ? compareByNomina(a, b)
                  : compareByDepartment(a, b);
      if (primaryDiff !== 0) {
        return overtimeSortDirection === "asc" ? primaryDiff : -primaryDiff;
      }

      if (overtimeSortField === "fecha") {
        const hoursDiff = compareByHours(a, b);
        if (hoursDiff !== 0) return -hoursDiff;
        return compareByName(a, b);
      }

      const dateDiff = compareByDate(a, b);
      if (dateDiff !== 0) {
        return -dateDiff;
      }

      if (overtimeSortField !== "horas") {
        const hoursDiff = compareByHours(a, b);
        if (hoursDiff !== 0) {
          return -hoursDiff;
        }
      }

      return compareByName(a, b);
    });
  }, [
    baseFilteredOvertimeEmployees,
    overtimeAbsenceOnly,
    overtimeOddMarksOnly,
    overtimeAlertOnly,
    overtimeAlertMode,
    overtimeSortDirection,
    overtimeSortField,
  ]);
  const overtimeAbsenceCount = useMemo(
    () =>
      baseFilteredOvertimeEmployees.filter(
        (employee) =>
          employee.isAbsence || isAbsenceIncident(employee.incident),
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

  const displayOvertimeAbsenceCount = overtimeAbsenceCount;
  const displayOddMarksCount = oddMarksCount;
  const displayAlexAlertCount920 = alexAlertCount920;
  const displayAlexAlertCount720 = alexAlertCount720;
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
  const overtimePaginationScopeKey = useMemo(
    () =>
      JSON.stringify({
        sede: [...overtimeSedeFilter].sort(),
        department: [...overtimeDepartmentFilter].sort(),
        employeeType: overtimeEmployeeTypeFilter,
        marks: overtimeMarksFilter,
        person: overtimePersonFilter.trim().toLowerCase(),
        sortField: overtimeSortField,
        sortDirection: overtimeSortDirection,
        rangeMin: overtimeRangeMin,
        rangeMax: overtimeRangeMax,
        absenceOnly: overtimeAbsenceOnly,
        oddMarksOnly: overtimeOddMarksOnly,
        alertOnly: overtimeAlertOnly,
        alertMode: overtimeAlertMode,
      }),
    [
      overtimeAlertMode,
      overtimeAlertOnly,
      overtimeAbsenceOnly,
      overtimeDepartmentFilter,
      overtimeEmployeeTypeFilter,
      overtimeMarksFilter,
      overtimeOddMarksOnly,
      overtimePersonFilter,
      overtimeRangeMax,
      overtimeRangeMin,
      overtimeSedeFilter,
      overtimeSortDirection,
      overtimeSortField,
    ],
  );
  const overtimePage =
    overtimePageState.scopeKey === overtimePaginationScopeKey
      ? Math.max(1, Math.min(overtimeTotalPages, overtimePageState.page))
      : 1;
  const setOvertimePage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setOvertimePageState((prev) => {
        const previousPage =
          prev.scopeKey === overtimePaginationScopeKey ? prev.page : 1;
        const resolvedPage =
          typeof next === "function" ? next(previousPage) : next;

        return {
          scopeKey: overtimePaginationScopeKey,
          page: Math.max(1, Math.min(overtimeTotalPages, resolvedPage)),
        };
      });
    },
    [overtimePaginationScopeKey, overtimeTotalPages],
  );
  const pagedOvertimeEmployees = useMemo(() => {
    const start = (overtimePage - 1) * OVERTIME_PAGE_SIZE;
    return visibleOvertimeEmployees.slice(start, start + OVERTIME_PAGE_SIZE);
  }, [visibleOvertimeEmployees, overtimePage]);
  const overtimePageTabs = useMemo(() => {
    const half = Math.floor(OVERTIME_PAGE_TAB_WINDOW / 2);
    let start = Math.max(1, overtimePage - half);
    const end = Math.min(
      overtimeTotalPages,
      start + OVERTIME_PAGE_TAB_WINDOW - 1,
    );
    if (end - start + 1 < OVERTIME_PAGE_TAB_WINDOW) {
      start = Math.max(1, end - OVERTIME_PAGE_TAB_WINDOW + 1);
    }
    return Array.from({ length: end - start + 1 }, (_v, i) => start + i);
  }, [overtimePage, overtimeTotalPages]);

  const handleOvertimeSort = (field: OvertimeSortField) => {
    if (overtimeSortField === field) {
      setOvertimeSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }

    setOvertimeSortField(field);
    setOvertimeSortDirection("desc");
  };

  const renderOvertimeSortHeader = (
    field: OvertimeSortField,
    label: string,
    align: "start" | "center" = "start",
  ) => {
    const isActive = overtimeSortField === field;
    return (
      <button
        type="button"
        onClick={() => handleOvertimeSort(field)}
        className={cn(
          "inline-flex w-full items-center gap-1 rounded-full border px-2 py-1 whitespace-nowrap transition-all",
          align === "center"
            ? "justify-center text-center"
            : "justify-start text-left",
          isActive
            ? "border-rose-200/80 bg-linear-to-r from-rose-50 via-white to-amber-50 text-rose-700 shadow-[0_10px_20px_-16px_rgba(225,29,72,0.65)]"
            : "border-transparent text-slate-500 hover:border-rose-100/80 hover:bg-white/80 hover:text-rose-600",
        )}
        aria-pressed={isActive}
      >
        <span>{label}</span>
        <ArrowUp
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-all",
            isActive
              ? "text-rose-600 opacity-100"
              : "text-slate-400 opacity-60",
            isActive && overtimeSortDirection === "desc" ? "rotate-180" : "",
          )}
        />
      </button>
    );
  };

  const handleExportOvertimeXlsx = async () => {
    const exportEmployees = filteredOvertimeEmployees.filter(
      (employee) => !overtimeExcludedIds.has(getOvertimeEmployeeKey(employee)),
    );
    if (exportEmployees.length === 0) return;

    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Horario");
    sheet.columns = [
      { header: "Cedula", key: "employeeId", width: 18 },
      { header: "Nombre", key: "employeeName", width: 34 },
      { header: "Sede", key: "sede", width: 20 },
      { header: "Cargo", key: "role", width: 22 },
      { header: "Incidencia", key: "incident", width: 18 },
      { header: "Nomina", key: "nomina", width: 18 },
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
        nomina: employee.nomina ?? "",
        department: employee.department ?? employee.lineName ?? "",
        workedDate:
          employee.workedDate ??
          activeHourlyData?.attendanceDateUsed ??
          selectedDate,
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
      ref={topSectionRef}
      data-animate="hourly-card"
      className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-linear-to-br from-white via-slate-50 to-amber-50/40 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.2)]"
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -left-12 -bottom-16 h-44 w-44 rounded-full bg-mercamio-200/30 blur-3xl" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            {badgeLabel}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">
            {panelTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-600">{panelDescription}</p>
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

      {showMapSection && showComparison && (
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

      {activeError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
          {activeError}
        </div>
      )}
      {cashierMonthError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
          {cashierMonthError}
        </div>
      )}
      {activeCompareError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
          {activeCompareError}
        </div>
      )}

      {isLoading && <HourlyLoadingSkeleton />}

      {!isLoading && !selectedDate && (
        <p className="py-10 text-center text-sm text-slate-600">
          Selecciona una fecha para ver el analisis horario.
        </p>
      )}

      {!isLoading && activeHourlyData && (
        <>
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
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Fecha
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatDateLabel(
                      activeHourlyData.date,
                      hourlyDateLabelOptions,
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Alcance
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {activeHourlyData.scopeLabel}
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
                {selectedLineLabel && (
                  <span className="rounded-full bg-mercamio-50 px-3 py-1 text-xs font-semibold text-mercamio-700 ring-1 ring-mercamio-200/70">
                    Linea: {selectedLineLabel}
                  </span>
                )}
                {activeHourlyData.attendanceDateUsed &&
                  activeHourlyData.attendanceDateUsed !==
                    activeHourlyData.date && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                      Asistencia usada: {activeHourlyData.attendanceDateUsed}
                    </span>
                  )}
                {activeHourlyData.salesDateUsed &&
                  activeHourlyData.salesDateUsed !== activeHourlyData.date && (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                      Ventas usadas: {activeHourlyData.salesDateUsed}
                    </span>
                  )}
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
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeAbsenceOnly
                      ? "bg-amber-600 text-white shadow-sm"
                      : "border border-amber-200/70 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {`Ver inasistencias (${displayOvertimeAbsenceCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly((prev) => !prev);
                    setOvertimeAlertOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
                    overtimeOddMarksOnly
                      ? "bg-amber-600 text-white shadow-sm"
                      : "border border-amber-200/70 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {`Ver marcaciones impares (${displayOddMarksCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
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
                  {`Ver personas >9:20h (${displayAlexAlertCount920})`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOvertimeAbsenceOnly(false);
                    setOvertimeOddMarksOnly(false);
                    setOvertimeRangeMin("");
                    setOvertimeRangeMax("");
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
                  {`Ver personas >7:20h con 2 marcaciones (${displayAlexAlertCount720})`}
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
                    ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7"
                    : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
                }`}
              >
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
                      setOvertimeRangeMax(e.target.value);
                    }}
                    className={overtimeFilterControlClass}
                  />
                </label>
              </div>
              {isAlexStrictMode && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  Modo Alex activo: el listado usa exactamente la misma regla
                  del reporte (superior a 9:20h) y bloquea filtros que cambian
                  el conteo.
                </p>
              )}

              {overtimeSedeOpen &&
                overtimeSedePopoverPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={overtimeSedePanelRef}
                    className="fixed z-9999 flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-2 shadow-2xl"
                    style={{
                      top: overtimeSedePopoverPos.top,
                      bottom: overtimeSedePopoverPos.bottom,
                      left: overtimeSedePopoverPos.left,
                      width: overtimeSedePopoverPos.width,
                      maxHeight: overtimeSedePopoverPos.maxHeight,
                      maxWidth: "calc(100vw - 32px)",
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
                    <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto pr-1">
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
                    className="fixed z-9999 flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-2 shadow-2xl"
                    style={{
                      top: overtimeDepartmentPopoverPos.top,
                      bottom: overtimeDepartmentPopoverPos.bottom,
                      left: overtimeDepartmentPopoverPos.left,
                      width: overtimeDepartmentPopoverPos.width,
                      maxHeight: overtimeDepartmentPopoverPos.maxHeight,
                      maxWidth: "calc(100vw - 32px)",
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
                    <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto pr-1">
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
                <div
                  className={`mt-3 overflow-hidden rounded-xl ${OVERTIME_TABLE_OUTER_BORDER_CLASS} bg-white`}
                >
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 border-b-2 ${OVERTIME_TABLE_INNER_BORDER_CLASS} bg-slate-50/70 px-2 py-2`}
                  >
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
                  <div
                    className={`grid grid-cols-[38px_52px_2.6fr_1fr_1.2fr_64px_56px_1.6fr_1fr_1fr_1.2fr] gap-1 border-b-2 ${OVERTIME_TABLE_INNER_BORDER_CLASS} bg-slate-50 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500`}
                  >
                    <span className="text-center whitespace-nowrap">#</span>
                    <span className="text-center whitespace-nowrap">Excel</span>
                    <span className="whitespace-nowrap">Empleado</span>
                    <span className="whitespace-nowrap">Sede</span>
                    {renderOvertimeSortHeader("fecha", "Fecha")}
                    {renderOvertimeSortHeader("horas", "Horas", "center")}
                    {renderOvertimeSortHeader("marcaciones", "Mar.", "center")}
                    <span className="whitespace-nowrap">Cargo</span>
                    {renderOvertimeSortHeader("incidencia", "Incid.")}
                    {renderOvertimeSortHeader("nomina", "Nomina", "center")}
                    {renderOvertimeSortHeader(
                      "departamento",
                      "Depto.",
                      "center",
                    )}
                  </div>
                  {pagedOvertimeEmployees.map((employee, index) => {
                    const employeeKey = getOvertimeEmployeeKey(employee);
                    const isAbsence =
                      employee.isAbsence ||
                      isAbsenceIncident(employee.incident);
                    const absoluteIndex =
                      (overtimePage - 1) * OVERTIME_PAGE_SIZE + index + 1;
                    return (
                      <div
                        key={employeeKey}
                        className={`grid grid-cols-[38px_52px_2.6fr_1fr_1.2fr_64px_56px_1.6fr_1fr_1fr_1.2fr] items-start gap-1 border-b-2 ${OVERTIME_TABLE_INNER_BORDER_CLASS} px-2 py-2 text-[12px] last:border-b-0 ${
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
                        <span className="text-center text-xs font-semibold text-slate-700 leading-tight wrap-break-word">
                          {employee.nomina ?? "-"}
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

          {showMapSection &&
            hourlySection === "map" &&
            !isCashierMultiDayRange &&
            !cashierMonthComparison && (
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

                <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Fecha
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {formatDateLabel(
                        activeHourlyData.date,
                        hourlyDateLabelOptions,
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Alcance
                    </p>
                    <p className="text-sm font-semibold text-slate-900">
                      {activeHourlyData.scopeLabel}
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

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {selectedLineLabel && (
                    <span className="rounded-full bg-mercamio-50 px-3 py-1 text-xs font-semibold text-mercamio-700 ring-1 ring-mercamio-200/70">
                      Linea: {selectedLineLabel}
                    </span>
                  )}
                  {activeHourlyData.attendanceDateUsed &&
                    activeHourlyData.attendanceDateUsed !==
                      activeHourlyData.date && (
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
                        Asistencia usada: {activeHourlyData.attendanceDateUsed}
                      </span>
                    )}
                  {activeHourlyData.salesDateUsed &&
                    activeHourlyData.salesDateUsed !==
                      activeHourlyData.date && (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                        Ventas usadas: {activeHourlyData.salesDateUsed}
                      </span>
                    )}
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
                              (slot.compareProductivity /
                                chartMaxProductivity) *
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
                                  {compareEnabled && activeCompareData && (
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
                                  {showTick ? slot.tickLabel : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {compareEnabled && activeCompareData && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700 ring-1 ring-sky-200">
                      Barra azul: dia comparado
                    </span>
                  </div>
                )}
              </div>
            )}

          {showMapSection && hourlySection === "map" && showPersonBreakdown && (
            <div
              ref={contributionSectionRef}
              className="mb-6 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Exploracion detallada
                  </p>
                  <p className="text-sm font-semibold text-slate-900"></p>
                </div>
                {!hidePersonBreakdownTabs && (
                  <div
                    role="tablist"
                    aria-label="Selector de detalle de cajas"
                    className="grid w-full grid-cols-1 rounded-2xl border border-slate-200/70 bg-slate-100/80 p-1 sm:grid-cols-2 lg:max-w-[540px]"
                  >
                    {PERSON_BREAKDOWN_VIEW_OPTIONS.map((option) => {
                      const isActive = personBreakdownView === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => setPersonBreakdownView(option.value)}
                          className={cn(
                            "flex w-full flex-col rounded-xl px-4 py-3 text-left transition-all",
                            isActive
                              ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                              : "text-slate-600 hover:bg-white/80 hover:text-slate-900",
                          )}
                        >
                          <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                            {option.label}
                          </span>
                          <span className="mt-1 text-xs text-slate-500">
                            {option.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-4">
                {personBreakdownView === "franjas" && (
                  <>
                    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Variacion por hora
                          </p>
                          <p className="text-sm font-semibold text-slate-900">
                            Cambio absoluto y porcentual dentro del rango
                            seleccionado
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                            Total intervalo: {formatCurrency(dayTotals.sales)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {hourDifferences
                          .filter((slot) => slot.sales > 0)
                          .map((slot) => {
                            const positive = slot.deltaSales >= 0;
                            return (
                              <div
                                key={`diff-${slot.slotStartMinute}`}
                                className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                      {slot.label}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                      {formatCurrency(slot.sales)}
                                    </p>
                                  </div>
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${
                                      positive
                                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70"
                                        : "bg-red-50 text-red-700 ring-red-200/70"
                                    }`}
                                  >
                                    {positive ? (
                                      <TrendingUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <TrendingDown className="h-3.5 w-3.5" />
                                    )}
                                    {`${positive ? "+" : "-"}${formatCurrency(Math.abs(slot.deltaSales))}`}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs text-slate-600">
                                  {slot.deltaPercent === null
                                    ? "Sin base previa para porcentaje."
                                    : `${positive ? "+" : "-"}${Math.abs(slot.deltaPercent).toFixed(1)}% vs. franja anterior`}
                                </p>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Venta x hora
                          </p>
                          <p className="text-sm font-semibold text-slate-900">
                            Facturacion y productividad por cada franja del
                            rango
                          </p>
                        </div>
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200/70">
                          {salesByHourCards.length} franjas
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {salesByHourCards.map((slot) => (
                          <div
                            key={`sales-hour-${slot.slotStartMinute}`}
                            className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {slot.label}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {formatCurrency(slot.sales)}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                              <span className="rounded-full bg-white px-2 py-1 text-slate-700 ring-1 ring-slate-200/70">
                                Vta/Hr {formatProductivity(slot.productivity)}
                              </span>
                              <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700 ring-1 ring-sky-200/70">
                                {slot.employeesPresent} pers.
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {personBreakdownView === "individual" && (
                  <div className="rounded-2xl border border-(--cashier-border) bg-(--cashier-surface) p-5 shadow-[0_1px_2px_0_color-mix(in_oklab,var(--cashier-text)_8%,transparent)] font-[Inter,var(--font-geist-sans),system-ui,sans-serif] [font-variant-numeric:tabular-nums]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--cashier-muted)">
                          {cashierMonthComparison
                            ? `Top ${CASHIER_MONTH_TOP_N}: mes anterior vs mes actual`
                            : "Aporte individual"}
                        </p>
                        {!cashierMonthComparison && (
                          <p className="text-sm font-semibold text-(--cashier-text)"></p>
                        )}
                      </div>
                      {topContributor && (
                        <span className="rounded-full border border-(--cashier-border) bg-(--cashier-top-bg) px-3 py-1 text-xs font-semibold text-(--cashier-top-text)">
                          Top: {topContributor.personName}{" "}
                          {formatCurrency(topContributor.totalSales)}
                        </span>
                      )}
                    </div>

                    {!cashierMonthComparison &&
                      isCashierPersonRangeResponse &&
                      activeHourlyData?.personContributionsRange && (
                        <p className="mt-3 rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-4 py-3 text-sm text-(--cashier-muted)">
                          Ventas de cajas sumadas del{" "}
                          <span className="font-semibold text-(--cashier-text)">
                            {formatDateLabel(
                              activeHourlyData.personContributionsRange.start,
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </span>{" "}
                          al{" "}
                          <span className="font-semibold text-(--cashier-text)">
                            {formatDateLabel(
                              activeHourlyData.personContributionsRange.end,
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </span>
                          . Para revisar venta por franja de cada persona, elige
                          un solo día en el calendario del encabezado.
                        </p>
                      )}

                    {!cashierMonthComparison && (
                      <div className="mt-4 flex flex-wrap items-end gap-3">
                        <label className="min-w-64 flex-1">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                            Filtrar cajero
                          </span>
                          <div className="mt-1 flex items-center gap-2 rounded-full border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2">
                            <Search className="h-4 w-4 text-(--cashier-muted)" />
                            <input
                              type="text"
                              value={personSearchQuery}
                              onChange={(e) =>
                                setPersonSearchQuery(e.target.value)
                              }
                              placeholder="Buscar por nombre o ID"
                              className="w-full bg-transparent text-sm text-(--cashier-text) outline-none placeholder:text-(--cashier-muted)"
                            />
                          </div>
                        </label>
                        <label className="min-w-[200px] shrink-0">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                            Cargo
                          </span>
                          <button
                            ref={personCargoFilterTriggerRef}
                            type="button"
                            onClick={() => {
                              if (!personCargoFilterOpen) {
                                updatePersonCargoFilterPopoverPos();
                              }
                              setPersonCargoFilterOpen((prev) => !prev);
                            }}
                            className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-full border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2 text-left text-sm font-medium text-(--cashier-text) outline-none ring-(--cashier-brand)/30 transition-colors hover:bg-(--cashier-surface) focus:ring-2"
                          >
                            <span className="truncate">
                              {personCargoFilterButtonLabel}
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 text-(--cashier-muted)" />
                          </button>
                        </label>
                        <span className="rounded-full border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2 text-xs font-semibold text-(--cashier-muted)">
                          {filteredPeopleBreakdown.length} cajero
                          {filteredPeopleBreakdown.length === 1 ? "" : "s"}
                          {cashierTotalPages > 1
                            ? ` · Pág. ${cashierPage}/${cashierTotalPages}`
                            : ""}
                        </span>
                        {(personSearchQuery || personCargoFilters.length > 0) && (
                          <button
                            type="button"
                            onClick={() => {
                              setPersonSearchQuery("");
                              clearPersonCargoFilters();
                            }}
                            className="rounded-full border border-slate-200/70 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                          >
                            Limpiar
                          </button>
                        )}
                        {onCashierMonthComparisonToggle && (
                          <button
                            type="button"
                            onClick={onCashierMonthComparisonToggle}
                            aria-pressed={cashierMonthComparison}
                            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-fuchsia-300/90 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-950 transition-all hover:bg-fuchsia-50"
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                            Top 5: mes anterior vs actual
                          </button>
                        )}
                      </div>
                    )}

                    {personCargoFilterOpen &&
                      personCargoFilterPopoverPos &&
                      typeof document !== "undefined" &&
                      createPortal(
                        <div
                          ref={personCargoFilterPanelRef}
                          className="fixed z-9999 flex flex-col overflow-hidden rounded-2xl border border-(--cashier-border) bg-(--cashier-surface) p-2 shadow-2xl"
                          style={{
                            top: personCargoFilterPopoverPos.top,
                            bottom: personCargoFilterPopoverPos.bottom,
                            left: personCargoFilterPopoverPos.left,
                            width: personCargoFilterPopoverPos.width,
                            maxHeight: personCargoFilterPopoverPos.maxHeight,
                            maxWidth: "calc(100vw - 32px)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={clearPersonCargoFilters}
                            className={`w-full rounded-full border px-3 py-2 text-sm font-semibold transition-all ${
                              personCargoFilters.length === 0
                                ? "border-(--cashier-brand)/40 bg-(--cashier-brand-soft) text-(--cashier-brand)"
                                : "border-(--cashier-border) bg-(--cashier-surface-soft) text-(--cashier-text) hover:bg-(--cashier-surface)"
                            }`}
                          >
                            Todos los cargos
                          </button>
                          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto pr-1">
                            {cashierCargoSelectOptions.sorted.map((cargo) => {
                              const checked = personCargoFilters.includes(cargo);
                              return (
                                <label
                                  key={cargo}
                                  className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-(--cashier-text) hover:bg-(--cashier-surface-soft)"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePersonCargoFilter(cargo)}
                                    className="mt-0.5 h-4 w-4 rounded border-(--cashier-border) text-(--cashier-brand) focus:ring-(--cashier-brand)/30"
                                  />
                                  <span className="whitespace-normal wrap-break-word leading-5">
                                    {cargo}
                                  </span>
                                </label>
                              );
                            })}
                            {cashierCargoSelectOptions.hasEmpty ? (
                              <label className="flex items-start gap-2 rounded-md px-2 py-1 text-sm text-(--cashier-text) hover:bg-(--cashier-surface-soft)">
                                <input
                                  type="checkbox"
                                  checked={personCargoFilters.includes(
                                    CASHIER_CARGO_SELECT_EMPTY,
                                  )}
                                  onChange={() =>
                                    togglePersonCargoFilter(
                                      CASHIER_CARGO_SELECT_EMPTY,
                                    )
                                  }
                                  className="mt-0.5 h-4 w-4 rounded border-(--cashier-border) text-(--cashier-brand) focus:ring-(--cashier-brand)/30"
                                />
                                <span className="whitespace-normal wrap-break-word leading-5">
                                  Sin cargo
                                </span>
                              </label>
                            ) : null}
                          </div>
                        </div>,
                        document.body,
                      )}

                    {cashierMonthComparison && (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl border border-fuchsia-200/80 bg-linear-to-br from-fuchsia-50/90 to-white px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-900">
                                Comparativo {cashierMonthRankLabel}
                              </p>
                              <p className="mt-1 text-sm text-slate-700">
                                Mes anterior:{" "}
                                <span className="font-semibold text-slate-900">
                                  {cashierMonthMeta?.labelPrevious ?? "--"}
                                </span>{" "}
                                vs mes en curso:{" "}
                                <span className="font-semibold text-slate-900">
                                  {cashierMonthMeta?.labelCurrent ?? "--"}
                                </span>
                              </p>
                            </div>
                            {onCashierMonthComparisonToggle && (
                              <button
                                type="button"
                                onClick={onCashierMonthComparisonToggle}
                                aria-pressed={cashierMonthComparison}
                                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-fuchsia-700 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-sm ring-1 ring-fuchsia-900/25 transition-all hover:bg-fuchsia-800"
                              >
                                <ArrowLeftRight className="h-4 w-4" />
                                Volver a periodo del filtro
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setCashierMonthShowImprove((v) => !v)
                              }
                              aria-pressed={cashierMonthShowImprove}
                              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-fuchsia-400/80 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-fuchsia-950 shadow-sm ring-1 ring-fuchsia-900/10 transition-all hover:bg-fuchsia-50 hover:shadow-md"
                            >
                              {cashierMonthShowImprove
                                ? `Ver ${CASHIER_MONTH_TOP_N} top`
                                : "Ver 5 a mejorar"}
                            </button>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                              Coinciden en ambos {cashierMonthRankLabel}
                            </p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-(--cashier-text)">
                              {cashierMonthSharedKeys.size}
                            </p>
                          </div>
                          <div className="rounded-xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                              VTA/Hr {cashierMonthRankLabel} mes anterior
                            </p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-(--cashier-text)">
                              {formatProductivity(cashierMonthPrevTotalVtaHr)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                              VTA/Hr {cashierMonthRankLabel} mes en curso
                            </p>
                            <p className="mt-1 text-lg font-bold tabular-nums text-(--cashier-text)">
                              {formatProductivity(cashierMonthCurrTotalVtaHr)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {cashierMonthComparison ? (
                      cashierMonthCompareLoading ? (
                        <p className="mt-4 rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-4 py-6 text-center text-sm text-(--cashier-muted)">
                          Cargando los {cashierMonthRankLabel} de cada mes…
                        </p>
                      ) : cashierMonthPrevRows.length === 0 &&
                        cashierMonthCurrRows.length === 0 ? (
                        <p className="mt-4 rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-4 py-6 text-center text-sm text-(--cashier-muted)">
                          No hay ventas de cajas en alguno de los dos periodos
                          para este filtro.
                        </p>
                      ) : (
                        <div className="mt-4 space-y-4">
                          {cashierMonthSharedKeys.size > 0 && (
                            <p className="rounded-2xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950">
                              <span className="font-semibold">
                                Cajeros que se mantienen en ambos{" "}
                                {cashierMonthRankLabel}:
                              </span>{" "}
                              {cashierMonthCurrRows
                                .filter((r) =>
                                  cashierMonthSharedKeys.has(r.personKey),
                                )
                                .map((r) => r.personName)
                                .sort((a, b) => a.localeCompare(b, "es"))
                                .join(", ")}
                              .
                            </p>
                          )}
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                Mes anterior ({cashierMonthRankLabel})
                              </p>
                              <p className="mt-1 text-xs text-(--cashier-muted)">
                                {cashierMonthMeta?.labelPrevious}
                              </p>
                              <ul className="mt-3 space-y-2">
                                {cashierMonthPrevRows.map((row, idx) => {
                                  const inBoth = cashierMonthSharedKeys.has(
                                    row.personKey,
                                  );
                                  return (
                                    <li
                                      key={row.personKey}
                                      className={cn(
                                        "flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm",
                                        getTopRankToneClass(idx + 1),
                                        inBoth && "ring-1 ring-emerald-300/80",
                                      )}
                                    >
                                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                                        <span className="shrink-0 font-semibold text-(--cashier-muted)">
                                          {idx + 1}.
                                        </span>
                                        <span className="min-w-0 font-semibold text-(--cashier-text)">
                                          <span className="inline-flex flex-wrap items-center gap-1.5">
                                            <UserRound className="h-3.5 w-3.5 shrink-0 text-(--cashier-brand)" />
                                            {row.personName}
                                            {inBoth && (
                                              <span className="rounded-full border border-emerald-400/80 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
                                                Tambien en mes actual
                                              </span>
                                            )}
                                            {row.personId && (
                                              <span className="text-[11px] font-normal text-(--cashier-muted)">
                                                ID {row.personId}
                                              </span>
                                            )}
                                          </span>
                                        </span>
                                      </span>
                                      <span className="shrink-0 tabular-nums font-semibold text-(--cashier-text)">
                                        {formatProductivity(row.vtaHr)}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                            <div className="rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                Mes en curso ({cashierMonthRankLabel})
                              </p>
                              <p className="mt-1 text-xs text-(--cashier-muted)">
                                {cashierMonthMeta?.labelCurrent}
                              </p>
                              <ul className="mt-3 space-y-2">
                                {cashierMonthCurrRows.map((row, idx) => {
                                  const inBoth = cashierMonthSharedKeys.has(
                                    row.personKey,
                                  );
                                  return (
                                    <li
                                      key={row.personKey}
                                      className={cn(
                                        "flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm",
                                        getTopRankToneClass(idx + 1),
                                        inBoth && "ring-1 ring-emerald-300/80",
                                      )}
                                    >
                                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                                        <span className="shrink-0 font-semibold text-(--cashier-muted)">
                                          {idx + 1}.
                                        </span>
                                        <span className="min-w-0 font-semibold text-(--cashier-text)">
                                          <span className="inline-flex flex-wrap items-center gap-1.5">
                                            <UserRound className="h-3.5 w-3.5 shrink-0 text-(--cashier-brand)" />
                                            {row.personName}
                                            {inBoth && (
                                              <span className="rounded-full border border-emerald-400/80 bg-emerald-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
                                                Tambien mes anterior
                                              </span>
                                            )}
                                            {row.personId && (
                                              <span className="text-[11px] font-normal text-(--cashier-muted)">
                                                ID {row.personId}
                                              </span>
                                            )}
                                          </span>
                                        </span>
                                      </span>
                                      <span className="shrink-0 tabular-nums font-semibold text-(--cashier-text)">
                                        {formatProductivity(row.vtaHr)}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )
                    ) : filteredPeopleBreakdown.length === 0 ? (
                      <p className="mt-4 rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-4 py-6 text-center text-sm text-(--cashier-muted)">
                        No se encontraron cajeros para ese filtro.
                      </p>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-4 py-3 shadow-sm">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                            Total listado
                          </p>
                          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm text-(--cashier-muted)">
                              Suma de ventas totales de{" "}
                              <span className="font-semibold text-(--cashier-text)">
                                {filteredPeopleBreakdown.length.toLocaleString(
                                  "es-CO",
                                )}
                              </span>{" "}
                              cajero
                              {filteredPeopleBreakdown.length === 1 ? "" : "s"}
                            </p>
                            <p className="text-lg font-bold tabular-nums text-(--cashier-text)">
                              {formatCurrencyMillionsOneDecimal(
                                cashierListTotalSales,
                              )}
                            </p>
                          </div>
                        </div>
                        {cashierTotalPages > 1 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setCashierPage((prev) => Math.max(1, prev - 1))
                                }
                                disabled={cashierPage === 1}
                                className="rounded-full border border-(--cashier-border) bg-(--cashier-surface) px-2.5 py-1 text-[11px] font-semibold text-(--cashier-text) disabled:opacity-50"
                              >
                                Anterior
                              </button>
                              {cashierPageTabs.map((tabPage) => (
                                <button
                                  key={tabPage}
                                  type="button"
                                  onClick={() => setCashierPage(tabPage)}
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors",
                                    tabPage === cashierPage
                                      ? "bg-(--cashier-brand) text-white"
                                      : "border border-(--cashier-border) bg-(--cashier-surface) text-(--cashier-text) hover:bg-(--cashier-surface-soft)",
                                  )}
                                >
                                  {tabPage}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  setCashierPage((prev) =>
                                    Math.min(cashierTotalPages, prev + 1),
                                  )
                                }
                                disabled={cashierPage === cashierTotalPages}
                                className="rounded-full border border-(--cashier-border) bg-(--cashier-surface) px-2.5 py-1 text-[11px] font-semibold text-(--cashier-text) disabled:opacity-50"
                              >
                                Siguiente
                              </button>
                            </div>
                            <span className="text-[11px] font-semibold text-(--cashier-muted)">
                              Mostrando {(cashierPage - 1) * CASHIER_PAGE_SIZE + 1}–
                              {Math.min(
                                cashierPage * CASHIER_PAGE_SIZE,
                                sortedPeopleBreakdown.length,
                              )}{" "}
                              de {sortedPeopleBreakdown.length}
                            </span>
                          </div>
                        )}
                        <div className="overflow-x-auto">
                          <table className="min-w-[920px] w-full border-collapse rounded-2xl border border-(--cashier-border) bg-(--cashier-surface-soft)">
                            <thead>
                              <tr className="border-b border-(--cashier-border) bg-(--cashier-surface)">
                                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  #
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  Nombre
                                </th>
                                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  ID
                                </th>
                                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  Cargo
                                </th>
                                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  <button
                                    type="button"
                                    onClick={() => handleCashierSortBy("totalSales")}
                                    className="inline-flex items-center gap-1 transition-colors hover:text-(--cashier-text)"
                                  >
                                    Ventas totales
                                    <ArrowUp
                                      className={cn(
                                        "h-3.5 w-3.5 transition-transform",
                                        cashierSortField !== "totalSales" && "opacity-40",
                                        cashierSortField === "totalSales" &&
                                          cashierSalesSortDirection === "asc" &&
                                          "rotate-180",
                                      )}
                                    />
                                  </button>
                                </th>
                                <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  <button
                                    type="button"
                                    title="Prioridad: cedula (solo digitos) > identificador texto > nombre solo si es unico en ventas y en asistencia con una sola cedula. Si no hay match, franjas con venta."
                                    onClick={() => handleCashierSortBy("workedHours")}
                                    className="inline-flex items-center gap-1 transition-colors hover:text-(--cashier-text)"
                                  >
                                    Horas laboradas
                                    <ArrowUp
                                      className={cn(
                                        "h-3.5 w-3.5 transition-transform",
                                        cashierSortField !== "workedHours" && "opacity-40",
                                        cashierSortField === "workedHours" &&
                                          cashierSalesSortDirection === "asc" &&
                                          "rotate-180",
                                      )}
                                    />
                                  </button>
                                </th>
                                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-(--cashier-muted)">
                                  <button
                                    type="button"
                                    onClick={() => handleCashierSortBy("vtaHr")}
                                    className="ml-auto inline-flex items-center gap-1 transition-colors hover:text-(--cashier-text)"
                                  >
                                    Vta/Hr
                                    <ArrowUp
                                      className={cn(
                                        "h-3.5 w-3.5 transition-transform",
                                        cashierSortField !== "vtaHr" && "opacity-40",
                                        cashierSortField === "vtaHr" &&
                                          cashierSalesSortDirection === "asc" &&
                                          "rotate-180",
                                      )}
                                    />
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedCashiers.map((person, index) => {
                                const rank =
                                  (cashierPage - 1) * CASHIER_PAGE_SIZE + index + 1;
                                const activeSlotsCount =
                                  (typeof person.activeSlotsCount === "number"
                                    ? person.activeSlotsCount
                                    : (person.activeSlots?.length ??
                                      person.hourlySales.length)) || 0;
                                const totalLaborMinutes = getCashierLaborMinutes(
                                  person,
                                  activeSlotsCount,
                                  bucketMinutes,
                                );
                                const workedHours = totalLaborMinutes / 60;
                                const salesPerHour = calcVtaHr(
                                  person.totalSales,
                                  workedHours,
                                );
                                const isExpanded =
                                  expandedPersonDailyKey === person.personKey;
                                const dailyRows = (person.dailySales ?? [])
                                  .slice()
                                  .sort((a, b) => a.date.localeCompare(b.date));
                                return (
                                  <Fragment key={person.personKey}>
                                    <tr
                                      className="cursor-pointer border-b border-(--cashier-border) transition-colors hover:bg-(--cashier-surface)"
                                      onClick={() => {
                                        cashierHourDetailAbortRef.current?.abort();
                                        setCashierHourDetailSelection(null);
                                        setCashierDayHourlyLoadingKey(null);
                                        setExpandedPersonDailyKey((prev) =>
                                          prev === person.personKey
                                            ? null
                                            : person.personKey,
                                        );
                                      }}
                                      title="Click para ver venta dia a dia"
                                    >
                                      <td className="px-3 py-2 text-right text-sm font-semibold text-(--cashier-muted)">
                                        {rank}
                                      </td>
                                      <td className="px-3 py-2 text-sm font-semibold text-(--cashier-text)">
                                        {person.personName}
                                      </td>
                                      <td className="px-3 py-2 text-center text-sm text-(--cashier-muted) tabular-nums">
                                        {person.personId || "-"}
                                      </td>
                                      <td className="max-w-[200px] px-3 py-2 text-left text-xs font-medium leading-snug wrap-break-word text-(--cashier-text)">
                                        {person.personCargo?.trim() || "—"}
                                      </td>
                                      <td className="px-3 py-2 text-center text-sm font-semibold tabular-nums text-(--cashier-text)">
                                        {formatCurrencyMillionsOneDecimal(
                                          person.totalSales,
                                        )}
                                      </td>
                                      <td
                                        className="px-3 py-2 text-center text-sm font-semibold tabular-nums text-(--cashier-text)"
                                        title={cashierLaborHoursSourceTitle(person)}
                                      >
                                        {formatTotalLaborMinutesLabel(
                                          totalLaborMinutes,
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right text-sm font-semibold text-(--cashier-text)">
                                        {formatProductivity(salesPerHour)}
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr className="border-b border-(--cashier-border) last:border-b-0">
                                        <td
                                          colSpan={7}
                                          className="bg-(--cashier-surface) px-4 py-3"
                                        >
                                          {!isCashierMultiDayRange ? (
                                            <div className="space-y-1">
                                              <div className="grid grid-cols-[minmax(0,1fr)_120px_100px] items-center px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                                                <span>Franja</span>
                                                <span className="text-center">
                                                  Venta
                                                </span>
                                                <span className="text-right">
                                                  Vta/Hr
                                                </span>
                                              </div>
                                              {[...person.hourlySales]
                                                .filter(
                                                  (slot) =>
                                                    slot.sales > 0 &&
                                                    slot.slotStartMinute >=
                                                      minuteRangeStart &&
                                                    slot.slotStartMinute <=
                                                      minuteRangeEnd,
                                                )
                                                .sort(
                                                  (a, b) =>
                                                    a.slotStartMinute -
                                                    b.slotStartMinute,
                                                )
                                                .map((slot) => (
                                                  <div
                                                    key={`${person.personKey}-single-${slot.slotStartMinute}`}
                                                    className="grid grid-cols-[minmax(0,1fr)_120px_100px] items-center gap-2 rounded border border-(--cashier-border)/60 bg-white/80 px-2 py-1.5 text-[11px]"
                                                  >
                                                    <span className="font-medium text-(--cashier-muted)">
                                                      {slot.label}
                                                    </span>
                                                    <span className="text-center font-semibold tabular-nums text-(--cashier-text)">
                                                      {formatCurrencyWithoutSixZeros(
                                                        slot.sales,
                                                      )}
                                                    </span>
                                                    <span className="text-right font-semibold tabular-nums text-(--cashier-text)">
                                                      {formatProductivity(
                                                        calcVtaHr(
                                                          slot.sales,
                                                          bucketMinutes / 60,
                                                        ),
                                                      )}
                                                    </span>
                                                  </div>
                                                ))}
                                            </div>
                                          ) : dailyRows.length === 0 ? (
                                            <p className="text-xs text-(--cashier-muted)">
                                              Sin detalle diario para este
                                              filtro.
                                            </p>
                                          ) : (
                                            <div className="space-y-1.5">
                                              <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_90px] items-center rounded-md border border-(--cashier-border) bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                                                <span className="text-left">Fecha</span>
                                                <span className="text-right">
                                                  Venta
                                                </span>
                                                <span className="text-right">
                                                  Horas
                                                </span>
                                                <span className="text-right">
                                                  Vta/Hr
                                                </span>
                                              </div>
                                              {dailyRows.map((day) => {
                                                const iso = normalizeDateKeyForDisplay(
                                                  day.date,
                                                );
                                                const dayLaborMinutes =
                                                  (day.activeSlotsCount ?? 0) *
                                                  bucketMinutes;
                                                const hourCk =
                                                  cashierHourDetailCacheKey(
                                                    person.personKey,
                                                    iso,
                                                  );
                                                const hourOpen =
                                                  expandedPersonDailyKey ===
                                                    person.personKey &&
                                                  cashierHourDetailSelection?.personKey ===
                                                    person.personKey &&
                                                  cashierHourDetailSelection?.isoDate ===
                                                    iso;
                                                const hourlySlotsForDay =
                                                  hourOpen && !isCashierMultiDayRange
                                                    ? [...person.hourlySales]
                                                        .filter(
                                                          (slot) =>
                                                            slot.sales > 0,
                                                        )
                                                        .sort(
                                                          (a, b) =>
                                                            a.slotStartMinute -
                                                            b.slotStartMinute,
                                                        )
                                                    : hourOpen &&
                                                        isCashierMultiDayRange
                                                      ? cashierDayHourlySlots[
                                                          hourCk
                                                        ] ?? []
                                                      : [];
                                                const hourSlotsLoading =
                                                  hourOpen &&
                                                  isCashierMultiDayRange &&
                                                  cashierDayHourlyLoadingKey ===
                                                    hourCk;
                                                const hourSlotsError =
                                                  hourOpen &&
                                                  isCashierMultiDayRange
                                                    ? cashierDayHourlyError[
                                                        hourCk
                                                      ]
                                                    : undefined;
                                                return (
                                                  <Fragment
                                                    key={`${person.personKey}-${day.date}-day`}
                                                  >
                                                    <button
                                                      type="button"
                                                      title="Ver ventas por franja horaria del dia"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        const nextIso =
                                                          normalizeDateKeyForDisplay(
                                                            day.date,
                                                          );
                                                        let closing = false;
                                                        setCashierHourDetailSelection(
                                                          (prev) => {
                                                            if (
                                                              prev?.personKey ===
                                                                person.personKey &&
                                                              prev?.isoDate ===
                                                                nextIso
                                                            ) {
                                                              closing = true;
                                                              return null;
                                                            }
                                                            return {
                                                              personKey:
                                                                person.personKey,
                                                              isoDate: nextIso,
                                                            };
                                                          },
                                                        );
                                                        if (closing) {
                                                          cashierHourDetailAbortRef.current?.abort();
                                                          setCashierDayHourlyLoadingKey(
                                                            null,
                                                          );
                                                        }
                                                      }}
                                                      className={cn(
                                                        "flex w-full items-center gap-2 rounded-md border border-(--cashier-border) bg-(--cashier-surface-soft) px-3 py-2 text-left text-xs transition-colors hover:bg-white",
                                                        hourOpen &&
                                                          "border-(--cashier-brand)/40 bg-white ring-1 ring-(--cashier-brand-soft)",
                                                      )}
                                                    >
                                                      <ChevronDown
                                                        aria-hidden
                                                        className={cn(
                                                          "h-4 w-4 shrink-0 text-(--cashier-muted) transition-transform",
                                                          hourOpen &&
                                                            "rotate-180 text-(--cashier-brand)",
                                                        )}
                                                      />
                                                      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_90px_90px_90px] items-center gap-3">
                                                        <span className="font-medium text-(--cashier-muted) text-left">
                                                          {formatDateLabel(iso, {
                                                            day: "2-digit",
                                                            month: "short",
                                                            year: "numeric",
                                                          })}
                                                        </span>
                                                        <span className="text-right font-semibold tabular-nums text-(--cashier-text)">
                                                          {formatCurrencyWithoutSixZeros(
                                                            day.sales,
                                                          )}
                                                        </span>
                                                        <span className="text-right font-semibold tabular-nums text-(--cashier-text)">
                                                          {formatTotalLaborMinutesLabel(
                                                            dayLaborMinutes,
                                                          )}
                                                        </span>
                                                        <span className="text-right font-semibold tabular-nums text-(--cashier-text)">
                                                          {formatProductivity(
                                                            calcVtaHr(
                                                              day.sales,
                                                              ((day.activeSlotsCount ??
                                                                0) *
                                                                bucketMinutes) /
                                                                60,
                                                            ),
                                                          )}
                                                        </span>
                                                      </div>
                                                    </button>
                                                    {hourOpen && (
                                                      <div className="ml-6 space-y-1 border-l border-dashed border-(--cashier-border) pl-4">
                                                        <div className="grid grid-cols-[minmax(0,1fr)_100px_80px] items-center px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-(--cashier-muted)">
                                                          <span>Franja</span>
                                                          <span className="text-center">
                                                            Venta
                                                          </span>
                                                          <span className="text-right">
                                                            Vta/Hr
                                                          </span>
                                                        </div>
                                                        {hourSlotsLoading && (
                                                          <div className="flex items-center gap-2 px-2 py-2 text-xs text-(--cashier-muted)">
                                                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                                            Cargando horas...
                                                          </div>
                                                        )}
                                                        {hourSlotsError && (
                                                          <p className="px-2 text-xs text-red-700">
                                                            {hourSlotsError}
                                                          </p>
                                                        )}
                                                        {!hourSlotsLoading &&
                                                          !hourSlotsError &&
                                                          hourlySlotsForDay.length ===
                                                            0 && (
                                                            <p className="px-2 py-1 text-xs text-(--cashier-muted)">
                                                              Sin ventas por franja
                                                              en este dia (o fuera
                                                              del filtro de horas).
                                                            </p>
                                                          )}
                                                        {!hourSlotsLoading &&
                                                          hourlySlotsForDay.map(
                                                            (slot) => (
                                                              <div
                                                                key={`${hourCk}-${slot.slotStartMinute}`}
                                                                className="grid grid-cols-[minmax(0,1fr)_100px_80px] items-center gap-2 rounded border border-(--cashier-border)/60 bg-white/80 px-2 py-1.5 text-[11px]"
                                                              >
                                                                <span className="font-medium text-(--cashier-muted)">
                                                                  {slot.label}
                                                                </span>
                                                                <span className="text-center font-semibold tabular-nums text-(--cashier-text)">
                                                                  {formatCurrencyWithoutSixZeros(
                                                                    slot.sales,
                                                                  )}
                                                                </span>
                                                                <span className="text-right font-semibold tabular-nums text-(--cashier-text)">
                                                                  {formatProductivity(
                                                                    calcVtaHr(
                                                                      slot.sales,
                                                                      bucketMinutes /
                                                                        60,
                                                                    ),
                                                                  )}
                                                                </span>
                                                              </div>
                                                            ),
                                                          )}
                                                      </div>
                                                    )}
                                                  </Fragment>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {showMapSection &&
            hourlySection === "map" &&
            shouldShowHourBars &&
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

          {floatingContributionBackVisible && (
            <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleScrollToContributionStart}
                className="inline-flex items-center gap-2 rounded-full border border-slate-900/90 bg-slate-900 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.75)] transition-all hover:-translate-y-0.5 hover:bg-slate-800"
              >
                <ArrowUp className="h-4 w-4" />
                Volver a la seccion
              </button>
              <button
                type="button"
                onClick={handleScrollToTop}
                className="inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-sky-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-sky-800 shadow-[0_18px_40px_-20px_rgba(14,165,233,0.45)] transition-all hover:-translate-y-0.5 hover:bg-sky-100"
              >
                <ArrowUp className="h-4 w-4" />
                Volver arriba
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
