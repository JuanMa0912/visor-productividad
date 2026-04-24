"use client";

import * as ExcelJS from "exceljs";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { HourlyAnalysis } from "@/components/HourlyAnalysis";
import { DEFAULT_SEDES } from "@/lib/constants";
import type { Sede } from "@/lib/constants";
import { normalizeKeySpaced } from "@/lib/normalize";

type ApiResponse = {
  dates?: string[];
  sedes?: Sede[];
  defaultSede?: string | null;
  canSeeAlexReport?: boolean;
  error?: string;
};

type AlexReportRow = {
  sede: string;
  moreThan72With2: number;
  moreThan92: number;
  oddMarks: number;
  absences: number;
};

type AlexReportTotals = {
  moreThan72With2: number;
  moreThan92: number;
  oddMarks: number;
  absences: number;
};

type AlexReportResponse = {
  usedRange?: { start: string; end: string } | null;
  rows?: AlexReportRow[];
  totals?: AlexReportTotals;
  departments?: string[];
  error?: string;
};

type AlexComparisonMetricKey = keyof AlexReportTotals;
type AlexComparisonRow = {
  sede: string;
  yesterday: AlexReportTotals;
  monthToDate: AlexReportTotals;
};
type AlexComparisonTotals = {
  yesterday: AlexReportTotals;
  monthToDate: AlexReportTotals;
};
type AlexComparisonPeriodMeta = {
  title: string;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
};

type AlexExportFieldKey = AlexComparisonMetricKey;
type AlexSortField = "sede" | AlexExportFieldKey;
type AlexSortDirection = "asc" | "desc";

type AlexExportField = {
  key: AlexExportFieldKey;
  header: string;
  toggleLabel: string;
  width: number;
  comparisonHeader: string;
};

const normalizeSedeKey = normalizeKeySpaced;

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeKey("Calle 5ta");
  }
  return normalized;
};

const OVERTIME_EXTRA_SEDES: Sede[] = [
  { id: "Panificadora", name: "Panificadora" },
  { id: "Planta Desposte Mixto", name: "Planta Desposte Mixto" },
  { id: "Planta Desprese Pollo", name: "Planta Desprese Pollo" },
];

const ALEX_EXPORT_FIELDS: AlexExportField[] = [
  {
    key: "moreThan72With2",
    header: "+ 7:20h con 2 marcaciones",
    toggleLabel: "+ 7:20h / 2 marcas",
    width: 32,
    comparisonHeader: "Mas 7.2",
  },
  {
    key: "moreThan92",
    header: "+ 9:20h",
    toggleLabel: "+ 9:20h",
    width: 18,
    comparisonHeader: "Mas 9.2",
  },
  {
    key: "oddMarks",
    header: "Marc. impares",
    toggleLabel: "Marc. impares",
    width: 22,
    comparisonHeader: "Marc. impares",
  },
  {
    key: "absences",
    header: "Inasistencias",
    toggleLabel: "Inasistencias",
    width: 18,
    comparisonHeader: "Inasist.",
  },
];

const createEmptyAlexTotals = (): AlexReportTotals => ({
  moreThan72With2: 0,
  moreThan92: 0,
  oddMarks: 0,
  absences: 0,
});

const createEmptyAlexComparisonTotals = (): AlexComparisonTotals => ({
  yesterday: createEmptyAlexTotals(),
  monthToDate: createEmptyAlexTotals(),
});

const toAlexTotalsSnapshot = (
  row?: Partial<AlexReportRow> | null,
): AlexReportTotals => ({
  moreThan72With2: row?.moreThan72With2 ?? 0,
  moreThan92: row?.moreThan92 ?? 0,
  oddMarks: row?.oddMarks ?? 0,
  absences: row?.absences ?? 0,
});

const formatAlexMetric = (value: number) => (value === 0 ? "-" : value);

const sanitizeExcelText = (value: string) => {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  return /^[=+\-@\t]/.test(normalized) ? `'${normalized}` : normalized;
};

const PERIOD_ONE_FILL = "FFF7F0C8";
const PERIOD_TWO_FILL = "FFE5EEF9";
const PERIOD_ONE_BODY_FILL = "FFFFF8DC";
const PERIOD_TWO_BODY_FILL = "FFF2F7FD";
const ALEX_SEDE_COLUMN_WIDTH = 196;
const ALEX_BASE_METRIC_COLUMN_WIDTH = 124;
const ALEX_COMPARE_METRIC_COLUMN_WIDTH = 90;
const ALEX_TABLE_OUTER_BORDER_CLASS = "border-2 border-slate-950";
const ALEX_TABLE_CELL_BORDER_CLASS = "border-2 border-slate-900";

export default function JornadaExtendidaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [availableSedes, setAvailableSedes] = useState<Sede[]>([]);
  const [defaultSede, setDefaultSede] = useState<string | undefined>(undefined);
  const [canSeeAlexReport, setCanSeeAlexReport] = useState(false);
  const [alexStartDate, setAlexStartDate] = useState("");
  const [alexEndDate, setAlexEndDate] = useState("");
  const [alexRows, setAlexRows] = useState<AlexReportRow[]>([]);
  const [alexTotals, setAlexTotals] = useState<AlexReportTotals>(
    createEmptyAlexTotals,
  );
  const [alexSelectedSede, setAlexSelectedSede] = useState("all");
  const [alexSelectedDepartment, setAlexSelectedDepartment] = useState("all");
  const [alexAvailableDepartments, setAlexAvailableDepartments] = useState<
    string[]
  >([]);
  const [alexLoading, setAlexLoading] = useState(false);
  const [alexError, setAlexError] = useState<string | null>(null);
  const [exportingAlexExcel, setExportingAlexExcel] = useState(false);
  const [isAlexExportMenuOpen, setIsAlexExportMenuOpen] = useState(false);
  const [alexSelectedFields, setAlexSelectedFields] = useState<
    AlexExportFieldKey[]
  >(() => ALEX_EXPORT_FIELDS.map((field) => field.key));
  const [alexSortField, setAlexSortField] = useState<AlexSortField | null>(
    null,
  );
  const [alexSortDirection, setAlexSortDirection] =
    useState<AlexSortDirection>("desc");
  const [alexExportError, setAlexExportError] = useState<string | null>(null);
  const [exportingAlexCompareExcel, setExportingAlexCompareExcel] =
    useState(false);
  const [alexCompareOpen, setAlexCompareOpen] = useState(false);
  const [alexCompareLoading, setAlexCompareLoading] = useState(false);
  const [alexCompareError, setAlexCompareError] = useState<string | null>(null);
  const [alexCompareRows, setAlexCompareRows] = useState<AlexComparisonRow[]>(
    [],
  );
  const [alexCompareTotals, setAlexCompareTotals] =
    useState<AlexComparisonTotals>(createEmptyAlexComparisonTotals);
  const [alexComparePeriods, setAlexComparePeriods] = useState<{
    yesterday: AlexComparisonPeriodMeta;
    monthToDate: AlexComparisonPeriodMeta;
  } | null>(null);
  const [alexCompareRawData, setAlexCompareRawData] = useState<{
    yesterdayRows: AlexReportRow[];
    monthToDateRows: AlexReportRow[];
    yesterdayTotals: AlexReportTotals;
    monthToDateTotals: AlexReportTotals;
  } | null>(null);
  const alexExportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/jornada-extendida/meta", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as ApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar la informacion");
        }

        if (!isMounted) return;

        const dates = Array.from(new Set(payload.dates ?? [])).sort();
        const resolvedSedes =
          payload.sedes && payload.sedes.length > 0
            ? payload.sedes
            : DEFAULT_SEDES;
        const forcedSedeKey = payload.defaultSede
          ? canonicalizeSedeKey(payload.defaultSede)
          : null;
        const forcedSede = forcedSedeKey
          ? resolvedSedes.find((sede) => {
              const idKey = canonicalizeSedeKey(sede.id || sede.name);
              const nameKey = canonicalizeSedeKey(sede.name);
              return idKey === forcedSedeKey || nameKey === forcedSedeKey;
            })
          : null;
        const visibleSedes =
          forcedSede && resolvedSedes.length === 1
            ? [forcedSede]
            : Array.from(
                new Map(
                  [...resolvedSedes, ...OVERTIME_EXTRA_SEDES].map((sede) => [
                    canonicalizeSedeKey(sede.name || sede.id),
                    sede,
                  ]),
                ).values(),
              );

        setAvailableDates(dates);
        setAvailableSedes(visibleSedes);
        setDefaultSede(
          forcedSede && resolvedSedes.length === 1
            ? forcedSede.name
            : undefined,
        );
        setCanSeeAlexReport(Boolean(payload.canSeeAlexReport));
        const latest = dates[dates.length - 1] ?? "";
        setAlexStartDate(latest);
        setAlexEndDate(latest);
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
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
  }, [router]);

  const defaultDate = useMemo(
    () =>
      availableDates.length > 0
        ? availableDates[availableDates.length - 1]
        : "",
    [availableDates],
  );
  const alexRangeLabel = useMemo(() => {
    if (!alexStartDate || !alexEndDate) return "";
    const fmt = (value: string) => {
      const dt = new Date(`${value}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return value;
      const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(
        dt,
      );
      const day = String(dt.getDate()).padStart(2, "0");
      const year = dt.getFullYear();
      return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day} de ${year}`;
    };
    if (alexStartDate === alexEndDate) return fmt(alexStartDate);
    return `${fmt(alexStartDate)} a ${fmt(alexEndDate)}`;
  }, [alexEndDate, alexStartDate]);

  const formatRangeLabel = useCallback((start: string, end: string) => {
    if (!start || !end) return "";
    const fmt = (value: string) => {
      const dt = new Date(`${value}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return value;
      const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(
        dt,
      );
      const day = String(dt.getDate()).padStart(2, "0");
      const year = dt.getFullYear();
      return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day} de ${year}`;
    };
    if (start === end) return fmt(start);
    return `${fmt(start)} a ${fmt(end)}`;
  }, []);

  const getMonthStart = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${date.getFullYear()}-${month}-01`;
  }, []);

  const formatDayBadge = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return String(date.getDate()).padStart(2, "0");
  }, []);

  const formatMonthBadge = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value.toUpperCase();
    return new Intl.DateTimeFormat("es-CO", { month: "long" })
      .format(date)
      .toUpperCase();
  }, []);

  const alexCurrentPeriodShortLabel = useMemo(() => {
    if (!alexStartDate || !alexEndDate) return "ACT";
    return alexStartDate === alexEndDate ? formatDayBadge(alexEndDate) : "ACT";
  }, [alexEndDate, alexStartDate, formatDayBadge]);
  const alexCurrentPeriodLabel = useMemo(
    () => alexRangeLabel || "Actual",
    [alexRangeLabel],
  );
  const alexSedeOptions = useMemo(
    () =>
      availableSedes
        .map((sede) => sede.name?.trim())
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    [availableSedes],
  );

  const buildAlexComparisonRows = useCallback(
    (yesterdayRows: AlexReportRow[], monthToDateRows: AlexReportRow[]) => {
      const yesterdayMap = new Map(yesterdayRows.map((row) => [row.sede, row]));
      const monthToDateMap = new Map(
        monthToDateRows.map((row) => [row.sede, row]),
      );
      return Array.from(
        new Set([
          ...yesterdayRows.map((row) => row.sede),
          ...monthToDateRows.map((row) => row.sede),
        ]),
      )
        .sort((left, right) =>
          left.localeCompare(right, "es", { sensitivity: "base" }),
        )
        .map((sede) => ({
          sede,
          yesterday: toAlexTotalsSnapshot(yesterdayMap.get(sede)),
          monthToDate: toAlexTotalsSnapshot(monthToDateMap.get(sede)),
        }));
    },
    [],
  );

  const alexCompareConfig = useMemo(() => {
    const minAvailableDate = availableDates[0] ?? "";
    if (!alexEndDate || !minAvailableDate) {
      return {
        canCompare: false,
        reason: "Selecciona una fecha fin valida para comparar.",
        periods: null as {
          yesterday: AlexComparisonPeriodMeta;
          monthToDate: AlexComparisonPeriodMeta;
        } | null,
      };
    }

    const monthStart = getMonthStart(alexEndDate);
    const boundedMonthStart =
      monthStart < minAvailableDate ? minAvailableDate : monthStart;
    const periods = {
      yesterday: {
        title: "Dia",
        label: alexCurrentPeriodLabel,
        shortLabel: alexCurrentPeriodShortLabel,
        start: alexStartDate,
        end: alexEndDate,
      },
      monthToDate: {
        title: "Mes al dia",
        label: formatRangeLabel(boundedMonthStart, alexEndDate),
        shortLabel: formatMonthBadge(alexEndDate),
        start: boundedMonthStart,
        end: alexEndDate,
      },
    };

    if (!alexStartDate || alexStartDate > alexEndDate) {
      return {
        canCompare: false,
        reason:
          "Define un periodo actual valido para construir el comparativo.",
        periods,
      };
    }

    return {
      canCompare: true,
      reason: null as string | null,
      periods,
    };
  }, [
    alexEndDate,
    alexStartDate,
    alexCurrentPeriodLabel,
    alexCurrentPeriodShortLabel,
    availableDates,
    formatMonthBadge,
    formatRangeLabel,
    getMonthStart,
  ]);

  const alexIncludedFields = useMemo(
    () =>
      ALEX_EXPORT_FIELDS.filter((field) =>
        alexSelectedFields.includes(field.key),
      ),
    [alexSelectedFields],
  );
  const sortAlexRows = useCallback(
    (rows: AlexReportRow[]) => {
      if (!alexSortField) return rows;

      return [...rows].sort((a, b) => {
        const primaryDiff =
          alexSortField === "sede"
            ? a.sede.localeCompare(b.sede, "es", { sensitivity: "base" })
            : a[alexSortField] - b[alexSortField];
        if (primaryDiff !== 0) {
          return alexSortDirection === "asc" ? primaryDiff : -primaryDiff;
        }

        return a.sede.localeCompare(b.sede, "es", { sensitivity: "base" });
      });
    },
    [alexSortDirection, alexSortField],
  );
  const sortedAlexRows = useMemo(() => {
    if (!alexSortField) return alexRows;

    return sortAlexRows(alexRows);
  }, [alexRows, alexSortField, sortAlexRows]);
  const alexCompareRowMap = useMemo(
    () => new Map(alexCompareRows.map((row) => [row.sede, row])),
    [alexCompareRows],
  );
  const displayedAlexRows = useMemo(() => {
    if (!alexCompareOpen) return sortedAlexRows;

    const currentRowsBySede = new Map(alexRows.map((row) => [row.sede, row]));
    const mergedRows = Array.from(
      new Set([
        ...alexRows.map((row) => row.sede),
        ...alexCompareRows.map((row) => row.sede),
      ]),
    ).map((sede) => ({
      sede,
      ...createEmptyAlexTotals(),
      ...(currentRowsBySede.get(sede) ?? {}),
    }));

    return sortAlexRows(mergedRows);
  }, [
    alexCompareOpen,
    alexCompareRows,
    alexRows,
    sortAlexRows,
    sortedAlexRows,
  ]);

  const getAlexCompareMetricValue = useCallback(
    (
      sede: string,
      period: "yesterday" | "monthToDate",
      key: AlexComparisonMetricKey,
    ) => alexCompareRowMap.get(sede)?.[period][key] ?? 0,
    [alexCompareRowMap],
  );
  const alexTableMinWidth = alexCompareOpen
    ? ALEX_SEDE_COLUMN_WIDTH +
      ALEX_EXPORT_FIELDS.length * ALEX_COMPARE_METRIC_COLUMN_WIDTH * 2
    : ALEX_SEDE_COLUMN_WIDTH +
      ALEX_EXPORT_FIELDS.length * ALEX_BASE_METRIC_COLUMN_WIDTH;

  const toggleAlexSelectedField = (fieldKey: AlexExportFieldKey) => {
    setAlexExportError(null);
    setAlexSelectedFields((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((value) => value !== fieldKey)
        : [...prev, fieldKey],
    );
  };
  const handleAlexSort = (field: AlexSortField) => {
    if (alexSortField === field) {
      setAlexSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setAlexSortField(field);
    setAlexSortDirection(field === "sede" ? "asc" : "desc");
  };
  const renderAlexSortHeader = (
    field: AlexSortField,
    label: string,
    align: "left" | "right" | "center" = "left",
  ) => {
    const isActive = alexSortField === field;
    return (
      <button
        type="button"
        onClick={() => handleAlexSort(field)}
        className={`inline-flex w-full items-center gap-1 font-bold transition-colors ${
          align === "right"
            ? "justify-end text-right"
            : align === "center"
              ? "justify-center text-center"
              : "justify-start text-left"
        } ${isActive ? "text-red-700" : "text-slate-800 hover:text-red-700"}`}
        aria-pressed={isActive}
      >
        <span>{label}</span>
        <ArrowUp
          className={`h-3.5 w-3.5 shrink-0 transition-all ${
            isActive
              ? `text-red-600 opacity-100 ${
                  alexSortDirection === "desc" ? "rotate-180" : ""
                }`
              : "text-slate-400 opacity-50"
          }`}
        />
      </button>
    );
  };

  const buildAlexTableSheet = (
    workbook: ExcelJS.Workbook,
    sheetName: string,
    title: string,
    subtitle: string,
    rangeLabel: string,
    rows: AlexReportRow[],
    totals: AlexReportTotals,
  ) => {
    const sheet = workbook.addWorksheet(sheetName);
    const exportColumns = [
      {
        key: "sede" as const,
        header: "Sede",
        width: 22,
        align: "left" as const,
      },
      ...alexIncludedFields.map((field) => ({
        key: field.key,
        header: field.header,
        width: field.width,
        align: "right" as const,
      })),
    ];
    const lastColumn = exportColumns.length;
    const mergeRow = (rowNumber: number) => {
      sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    };

    sheet.columns = exportColumns.map((column) => ({
      key: column.key,
      width: column.width,
    }));
    sheet.properties.defaultRowHeight = 22;

    const titleRow = sheet.addRow([title]);
    mergeRow(titleRow.number);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: "middle", horizontal: "left" };

    const subtitleRow = sheet.addRow([subtitle]);
    mergeRow(subtitleRow.number);
    subtitleRow.font = { size: 11, color: { argb: "FF475569" } };
    subtitleRow.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true,
    };

    const rangeRow = sheet.addRow([rangeLabel]);
    mergeRow(rangeRow.number);
    rangeRow.font = { bold: true, color: { argb: "FFB91C1C" } };
    rangeRow.alignment = { vertical: "middle", horizontal: "left" };

    sheet.addRow([]);

    const headerRow = sheet.addRow(
      exportColumns.map((column) => column.header),
    );
    headerRow.eachCell((cell, colNumber) => {
      const column = exportColumns[colNumber - 1];
      cell.font = { bold: true, color: { argb: "FF0F172A" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: column.align,
      };
    });

    rows.forEach((row) => {
      const dataRow = sheet.addRow([
        sanitizeExcelText(row.sede),
        ...alexIncludedFields.map((field) => formatAlexMetric(row[field.key])),
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber === 1 ? "left" : "right",
        };
      });
    });

    const totalRow = sheet.addRow([
      "TOTAL",
      ...alexIncludedFields.map((field) => totals[field.key]),
    ]);
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: "FF0F172A" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 ? "left" : "right",
      };
    });

    sheet.views = [{ state: "frozen", ySplit: headerRow.number }];
    sheet.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: lastColumn },
    };

    return sheet;
  };

  const buildAlexComparisonSheet = (
    workbook: ExcelJS.Workbook,
    sheetName: string,
    title: string,
    periodOneShortLabel: string,
    periodTwoShortLabel: string,
    sedeOrder: string[],
    periodOneRows: AlexReportRow[],
    periodTwoRows: AlexReportRow[],
    periodOneTotals: AlexReportTotals,
    periodTwoTotals: AlexReportTotals,
  ) => {
    const sheet = workbook.addWorksheet(sheetName);
    const metricColumns = ALEX_EXPORT_FIELDS.map((field) => ({
      key: field.key,
      header: field.comparisonHeader,
      width: Math.max(10, Math.min(12, field.comparisonHeader.length + 1)),
      align: "right" as const,
    }));
    const metricCount = metricColumns.length;
    const totalColumns = 1 + metricCount * 2;

    const mergeRow = (rowNumber: number) => {
      sheet.mergeCells(rowNumber, 1, rowNumber, totalColumns);
    };

    sheet.getColumn(1).width = 22;
    metricColumns.forEach((column, index) => {
      const baseColumnIndex = 2 + index * 2;
      sheet.getColumn(baseColumnIndex).width = column.width;
      sheet.getColumn(baseColumnIndex + 1).width = column.width;
    });
    sheet.properties.defaultRowHeight = 22;

    const titleRow = sheet.addRow([title]);
    mergeRow(titleRow.number);
    titleRow.font = { bold: true, size: 16 };
    titleRow.alignment = { vertical: "middle", horizontal: "center" };

    sheet.addRow([]);

    const labelRowNumber = 3;
    const headerRowNumber = 4;

    sheet.mergeCells(labelRowNumber, 1, headerRowNumber, 1);
    const sedeHeader = sheet.getCell(labelRowNumber, 1);
    sedeHeader.value = "Sede";
    sedeHeader.font = { bold: true, color: { argb: "FF0F172A" } };
    sedeHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    sedeHeader.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    sedeHeader.alignment = { vertical: "middle", horizontal: "left" };

    metricColumns.forEach((column, index) => {
      const periodOneColumnIndex = 2 + index * 2;
      const periodTwoColumnIndex = periodOneColumnIndex + 1;

      const periodOneDateCell = sheet.getCell(
        labelRowNumber,
        periodOneColumnIndex,
      );
      periodOneDateCell.value = periodOneShortLabel;
      periodOneDateCell.font = { bold: true, color: { argb: "FFDC2626" } };
      periodOneDateCell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      periodOneDateCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_ONE_FILL },
      };
      periodOneDateCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };

      const periodTwoDateCell = sheet.getCell(
        labelRowNumber,
        periodTwoColumnIndex,
      );
      periodTwoDateCell.value = periodTwoShortLabel;
      periodTwoDateCell.font = { bold: true, color: { argb: "FFDC2626" } };
      periodTwoDateCell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
      periodTwoDateCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_TWO_FILL },
      };
      periodTwoDateCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };

      const periodOneMetricCell = sheet.getCell(
        headerRowNumber,
        periodOneColumnIndex,
      );
      periodOneMetricCell.value = column.header;
      periodOneMetricCell.font = { bold: true, color: { argb: "FF0F172A" } };
      periodOneMetricCell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      periodOneMetricCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_ONE_FILL },
      };
      periodOneMetricCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };

      const periodTwoMetricCell = sheet.getCell(
        headerRowNumber,
        periodTwoColumnIndex,
      );
      periodTwoMetricCell.value = column.header;
      periodTwoMetricCell.font = { bold: true, color: { argb: "FF0F172A" } };
      periodTwoMetricCell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true,
      };
      periodTwoMetricCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_TWO_FILL },
      };
      periodTwoMetricCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });

    const periodOneMap = new Map(periodOneRows.map((row) => [row.sede, row]));
    const periodTwoMap = new Map(periodTwoRows.map((row) => [row.sede, row]));
    const allSedes =
      sedeOrder.length > 0
        ? sedeOrder
        : Array.from(
            new Set([
              ...periodOneRows.map((row) => row.sede),
              ...periodTwoRows.map((row) => row.sede),
            ]),
          );

    allSedes.forEach((sede, rowIndex) => {
      const rowNumber = headerRowNumber + 1 + rowIndex;
      const periodOneRow = periodOneMap.get(sede);
      const periodTwoRow = periodTwoMap.get(sede);

      const sedeCell = sheet.getCell(rowNumber, 1);
      sedeCell.value = sanitizeExcelText(sede);
      sedeCell.border = {
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      sedeCell.alignment = { vertical: "middle", horizontal: "left" };

      metricColumns.forEach((column, index) => {
        const periodOneColumnIndex = 2 + index * 2;
        const periodTwoColumnIndex = periodOneColumnIndex + 1;

        const leftCell = sheet.getCell(rowNumber, periodOneColumnIndex);
        leftCell.value = formatAlexMetric(periodOneRow?.[column.key] ?? 0);
        leftCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: PERIOD_ONE_BODY_FILL },
        };
        leftCell.border = {
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
        leftCell.alignment = { vertical: "middle", horizontal: "right" };

        const rightCell = sheet.getCell(rowNumber, periodTwoColumnIndex);
        rightCell.value = formatAlexMetric(periodTwoRow?.[column.key] ?? 0);
        rightCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: PERIOD_TWO_BODY_FILL },
        };
        rightCell.border = {
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
        rightCell.alignment = { vertical: "middle", horizontal: "right" };
      });
    });

    const totalRowNumber = headerRowNumber + 1 + allSedes.length;
    const totalLabelCell = sheet.getCell(totalRowNumber, 1);
    totalLabelCell.value = "TOTAL";
    totalLabelCell.font = { bold: true, color: { argb: "FF0F172A" } };
    totalLabelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8FAFC" },
    };
    totalLabelCell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
    totalLabelCell.alignment = { vertical: "middle", horizontal: "left" };

    metricColumns.forEach((column, index) => {
      const periodOneColumnIndex = 2 + index * 2;
      const periodTwoColumnIndex = periodOneColumnIndex + 1;

      const leftCell = sheet.getCell(totalRowNumber, periodOneColumnIndex);
      leftCell.value = periodOneTotals[column.key];
      leftCell.font = { bold: true, color: { argb: "FF0F172A" } };
      leftCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_ONE_FILL },
      };
      leftCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      leftCell.alignment = { vertical: "middle", horizontal: "right" };

      const rightCell = sheet.getCell(totalRowNumber, periodTwoColumnIndex);
      rightCell.value = periodTwoTotals[column.key];
      rightCell.font = { bold: true, color: { argb: "FF0F172A" } };
      rightCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: PERIOD_TWO_FILL },
      };
      rightCell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
      rightCell.alignment = { vertical: "middle", horizontal: "right" };
    });

    sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];
    return sheet;
  };

  useEffect(() => {
    if (!isAlexExportMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!alexExportMenuRef.current?.contains(target)) {
        setIsAlexExportMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAlexExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAlexExportMenuOpen]);

  const handleExportAlexTableExcel = async () => {
    if (alexRows.length === 0) return;

    setExportingAlexExcel(true);
    setAlexExportError(null);
    try {
      const workbook = new ExcelJS.Workbook();
      buildAlexTableSheet(
        workbook,
        "Tablero Informe de Tiempos",
        "Tablero Informe de Tiempos",
        "Tabla exportable con el mismo desglose visible por sede",
        alexRangeLabel || `${alexStartDate} a ${alexEndDate}`,
        sortedAlexRows,
        alexTotals,
      );

      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporte-alex-${alexStartDate || "inicio"}-${alexEndDate || "fin"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsAlexExportMenuOpen(false);
    } catch (error) {
      console.error("[jornada-extendida] Error exportando Excel Alex:", error);
      setAlexExportError("No se pudo exportar el Excel.");
    } finally {
      setExportingAlexExcel(false);
    }
  };

  const fetchAlexReportRange = useCallback(
    async (start: string, end: string, signal?: AbortSignal) => {
      const response = await fetch(
        `/api/jornada-extendida/alex-report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&sede=${encodeURIComponent(alexSelectedSede)}&department=${encodeURIComponent(alexSelectedDepartment)}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as AlexReportResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo cargar el reporte Alex.");
      }
      return {
        rows: payload.rows ?? [],
        totals: payload.totals ?? createEmptyAlexTotals(),
      };
    },
    [alexSelectedDepartment, alexSelectedSede],
  );

  const handleExportAlexCompareExcel = async () => {
    if (!alexComparePeriods || !alexCompareRawData) {
      setAlexCompareError(
        "Primero genera el comparativo visual para exportarlo.",
      );
      return;
    }

    setExportingAlexCompareExcel(true);
    setAlexCompareError(null);
    try {
      const workbook = new ExcelJS.Workbook();
      buildAlexComparisonSheet(
        workbook,
        "Comparacion periodos",
        "Comparacion de periodos",
        alexComparePeriods.yesterday.shortLabel,
        alexComparePeriods.monthToDate.shortLabel,
        displayedAlexRows.map((row) => row.sede),
        alexCompareRawData.yesterdayRows,
        alexCompareRawData.monthToDateRows,
        alexCompareRawData.yesterdayTotals,
        alexCompareRawData.monthToDateTotals,
      );

      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `comparacion-periodos-${alexComparePeriods.yesterday.start}-${alexComparePeriods.monthToDate.start}-${alexComparePeriods.monthToDate.end}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsAlexExportMenuOpen(false);
    } catch (error) {
      console.error(
        "[jornada-extendida] Error exportando comparacion de periodos:",
        error,
      );
      setAlexCompareError("No se pudo exportar la comparacion de periodos.");
    } finally {
      setExportingAlexCompareExcel(false);
    }
  };

  useEffect(() => {
    if (alexSelectedDepartment === "all") return;
    if (alexAvailableDepartments.includes(alexSelectedDepartment)) return;
    setAlexSelectedDepartment("all");
  }, [alexAvailableDepartments, alexSelectedDepartment]);

  useEffect(() => {
    if (!alexCompareOpen) return;

    const periods = alexCompareConfig.periods;
    setAlexComparePeriods(periods);

    if (!alexCompareConfig.canCompare || !periods) {
      setAlexCompareLoading(false);
      setAlexCompareRows([]);
      setAlexCompareTotals(createEmptyAlexComparisonTotals());
      setAlexCompareRawData(null);
      setAlexCompareError(
        alexCompareConfig.reason ??
          "No se pudo construir el comparativo con la fecha seleccionada.",
      );
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadComparison = async () => {
      setAlexCompareLoading(true);
      setAlexCompareError(null);
      try {
        const [yesterdayData, monthToDateData] = await Promise.all([
          fetchAlexReportRange(
            periods.yesterday.start,
            periods.yesterday.end,
            controller.signal,
          ),
          fetchAlexReportRange(
            periods.monthToDate.start,
            periods.monthToDate.end,
            controller.signal,
          ),
        ]);

        if (!isMounted) return;

        setAlexCompareRows(
          buildAlexComparisonRows(yesterdayData.rows, monthToDateData.rows),
        );
        setAlexCompareTotals({
          yesterday: yesterdayData.totals,
          monthToDate: monthToDateData.totals,
        });
        setAlexCompareRawData({
          yesterdayRows: yesterdayData.rows,
          monthToDateRows: monthToDateData.rows,
          yesterdayTotals: yesterdayData.totals,
          monthToDateTotals: monthToDateData.totals,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (!isMounted) return;
        console.error(
          "[jornada-extendida] Error cargando comparacion visual:",
          error,
        );
        setAlexCompareRows([]);
        setAlexCompareTotals(createEmptyAlexComparisonTotals());
        setAlexCompareRawData(null);
        setAlexCompareError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar el comparativo visual.",
        );
      } finally {
        if (isMounted) {
          setAlexCompareLoading(false);
        }
      }
    };

    void loadComparison();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    alexSelectedDepartment,
    alexSelectedSede,
    alexCompareConfig,
    alexCompareOpen,
    buildAlexComparisonRows,
    fetchAlexReportRange,
  ]);

  useEffect(() => {
    if (!canSeeAlexReport) return;
    if (!alexStartDate || !alexEndDate) return;
    if (alexStartDate > alexEndDate) return;
    let isMounted = true;
    const controller = new AbortController();

    const loadAlexReport = async () => {
      setAlexLoading(true);
      setAlexError(null);
      try {
        const response = await fetch(
          `/api/jornada-extendida/alex-report?start=${encodeURIComponent(alexStartDate)}&end=${encodeURIComponent(alexEndDate)}&sede=${encodeURIComponent(alexSelectedSede)}&department=${encodeURIComponent(alexSelectedDepartment)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as AlexReportResponse;
        if (!response.ok) {
          throw new Error(
            payload.error ?? "No se pudo cargar el reporte Alex.",
          );
        }
        if (!isMounted) return;
        setAlexRows(payload.rows ?? []);
        setAlexTotals(payload.totals ?? createEmptyAlexTotals());
        setAlexAvailableDepartments(payload.departments ?? []);
        setAlexExportError(null);
        setIsAlexExportMenuOpen(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!isMounted) return;
        setAlexError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (isMounted) {
          setAlexLoading(false);
        }
      }
    };

    void loadAlexReport();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    alexEndDate,
    alexSelectedDepartment,
    alexSelectedSede,
    alexStartDate,
    canSeeAlexReport,
  ]);

  if (!ready || isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando modulo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              Operacion
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Horarios</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Consulta horarios, detecta jornadas extendidas y revisa novedades
              operativas como marcaciones impares, inasistencias y consolidados
              por sede en un mismo lugar.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <Link
              href="/horario"
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
            >
              Cambiar seccion
            </Link>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-3">
                <Image
                  src="/logos/mercamio.jpeg"
                  alt="Logo Mercamio"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
                <Image
                  src="/logos/mercatodo.jpeg"
                  alt="Logo Mercatodo"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            {canSeeAlexReport && (
              <div className="mb-5 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                      Tablero de tiempos
                    </p>
                    <h2 className="mt-1 text-lg font-bold leading-tight text-slate-900 sm:text-[1.6rem]">
                      + 7:20h con 2 marcaciones, + 9:20h, marc. impares e
                      inasistencias
                    </h2>
                    {alexRangeLabel && (
                      <p className="mt-1 text-base font-bold text-red-700">
                        {alexRangeLabel}
                      </p>
                    )}
                  </div>
                  <div className="w-full xl:max-w-2xl">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Fecha inicio
                        <input
                          type="date"
                          value={alexStartDate}
                          onChange={(e) => setAlexStartDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm"
                          min={availableDates[0]}
                          max={availableDates[availableDates.length - 1]}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Fecha fin
                        <input
                          type="date"
                          value={alexEndDate}
                          onChange={(e) => setAlexEndDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm"
                          min={availableDates[0]}
                          max={availableDates[availableDates.length - 1]}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Sedes
                        <select
                          value={alexSelectedSede}
                          onChange={(e) => setAlexSelectedSede(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm normal-case text-slate-900 shadow-sm"
                        >
                          <option value="all">Todas las sedes</option>
                          {alexSedeOptions.map((sede) => (
                            <option key={sede} value={sede}>
                              {sede}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Departamentos
                        <select
                          value={alexSelectedDepartment}
                          onChange={(e) =>
                            setAlexSelectedDepartment(e.target.value)
                          }
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm normal-case text-slate-900 shadow-sm"
                        >
                          <option value="all">Todos los departamentos</option>
                          {alexAvailableDepartments.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 xl:items-end">
                      <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <div
                          ref={alexExportMenuRef}
                          className="relative w-full sm:w-auto"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setIsAlexExportMenuOpen((prev) => !prev)
                            }
                            disabled={
                              alexLoading ||
                              alexRows.length === 0 ||
                              exportingAlexExcel ||
                              exportingAlexCompareExcel
                            }
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                          >
                            {exportingAlexExcel || exportingAlexCompareExcel
                              ? "Generando Excel..."
                              : isAlexExportMenuOpen
                                ? "Cerrar Excel"
                                : "Excel tabla"}
                          </button>
                          {isAlexExportMenuOpen && (
                            <div className="mt-2 w-full rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)] sm:absolute sm:right-0 sm:z-10 sm:w-[30rem]">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                  Columnas a incluir
                                </p>
                                <p className="text-xs text-slate-500">
                                  {alexSelectedFields.length ===
                                  ALEX_EXPORT_FIELDS.length
                                    ? "Sede + todas las métricas"
                                    : `Sede + ${alexIncludedFields.length} columna(s)`}
                                </p>
                              </div>
                              <p className="mt-2 text-xs text-slate-500">
                                Deja marcadas solo las métricas que quieres
                                exportar.
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {ALEX_EXPORT_FIELDS.map((field) => {
                                  const selected = alexSelectedFields.includes(
                                    field.key,
                                  );
                                  return (
                                    <label
                                      key={field.key}
                                      className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() =>
                                          toggleAlexSelectedField(field.key)
                                        }
                                        className="h-4 w-4 rounded border-slate-300 text-slate-900"
                                      />
                                      <span>{field.toggleLabel}</span>
                                    </label>
                                  );
                                })}
                              </div>
                              {alexExportError && (
                                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                                  {alexExportError}
                                </div>
                              )}
                              <div className="mt-3 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleExportAlexTableExcel()
                                  }
                                  disabled={exportingAlexExcel}
                                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {exportingAlexExcel
                                    ? "Generando Excel..."
                                    : "Exportar Excel"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                          <button
                            type="button"
                            onClick={() => setAlexCompareOpen((prev) => !prev)}
                            disabled={
                              exportingAlexCompareExcel ||
                              (!alexCompareOpen &&
                                (alexLoading ||
                                  alexRows.length === 0 ||
                                  !alexCompareConfig.canCompare))
                            }
                            aria-pressed={alexCompareOpen}
                            className={`inline-flex min-h-11 w-full items-center justify-center rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${
                              alexCompareOpen
                                ? "border-sky-300/80 bg-sky-100 text-sky-800 hover:border-sky-400 hover:bg-sky-200/70"
                                : "border-emerald-200/70 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                            }`}
                          >
                            {alexCompareOpen
                              ? "Ocultar comparativo"
                              : "Comparar periodos"}
                          </button>
                          {alexCompareOpen && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleExportAlexCompareExcel()
                              }
                              disabled={
                                alexCompareLoading ||
                                exportingAlexCompareExcel ||
                                !alexCompareRawData
                              }
                              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-sky-200/80 bg-sky-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-800 transition-all hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                            >
                              {exportingAlexCompareExcel
                                ? "Generando Excel..."
                                : "Excel comparativo"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {!alexCompareOpen && alexCompareConfig.reason && (
                      <p className="mt-2 text-xs text-amber-700 sm:text-right">
                        {alexCompareConfig.reason}
                      </p>
                    )}
                  </div>
                </div>
                {alexStartDate > alexEndDate && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    La fecha inicio no puede ser mayor que la fecha fin.
                  </div>
                )}

                {alexError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {alexError}
                  </div>
                ) : alexLoading ? (
                  <p className="mt-3 text-sm text-slate-600">
                    Cargando reporte Alex...
                  </p>
                ) : (
                  <>
                    {alexCompareOpen && alexCompareError && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        {alexCompareError}
                      </div>
                    )}
                    {alexCompareOpen && alexComparePeriods && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        {alexComparePeriods.yesterday.title}:{" "}
                        {alexComparePeriods.yesterday.label} |{" "}
                        {alexComparePeriods.monthToDate.title}:{" "}
                        {alexComparePeriods.monthToDate.label}
                      </div>
                    )}
                    <div
                      className={`mt-3 overflow-x-auto overflow-y-visible rounded-xl ${ALEX_TABLE_OUTER_BORDER_CLASS}`}
                      style={{ scrollbarGutter: "stable" }}
                    >
                      <table
                        className="w-full table-fixed border-collapse text-sm"
                        style={{ minWidth: `${alexTableMinWidth}px` }}
                      >
                        <colgroup>
                          <col
                            style={{ width: `${ALEX_SEDE_COLUMN_WIDTH}px` }}
                          />
                          {alexCompareOpen
                            ? ALEX_EXPORT_FIELDS.flatMap((field) => [
                                <col
                                  key={`${field.key}-compare-day`}
                                  style={{
                                    width: `${ALEX_COMPARE_METRIC_COLUMN_WIDTH}px`,
                                  }}
                                />,
                                <col
                                  key={`${field.key}-compare-month`}
                                  style={{
                                    width: `${ALEX_COMPARE_METRIC_COLUMN_WIDTH}px`,
                                  }}
                                />,
                              ])
                            : ALEX_EXPORT_FIELDS.map((field) => (
                                <col
                                  key={`${field.key}-base`}
                                  style={{
                                    width: `${ALEX_BASE_METRIC_COLUMN_WIDTH}px`,
                                  }}
                                />
                              ))}
                        </colgroup>
                        <thead className="text-slate-800">
                          {alexCompareOpen ? (
                            <>
                              <tr>
                                <th
                                  rowSpan={2}
                                  className={`sticky left-0 z-20 ${ALEX_TABLE_CELL_BORDER_CLASS} bg-white px-3 py-2 text-left font-bold`}
                                  aria-sort={
                                    alexSortField === "sede"
                                      ? alexSortDirection === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                >
                                  {renderAlexSortHeader("sede", "Sede")}
                                </th>
                                {ALEX_EXPORT_FIELDS.map((field) => (
                                  <th
                                    key={`${field.key}-group`}
                                    className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-white px-3 py-2 text-center font-bold`}
                                    colSpan={2}
                                    aria-sort={
                                      alexSortField === field.key
                                        ? alexSortDirection === "asc"
                                          ? "ascending"
                                          : "descending"
                                        : "none"
                                    }
                                  >
                                    {renderAlexSortHeader(
                                      field.key,
                                      field.comparisonHeader,
                                      "center",
                                    )}
                                  </th>
                                ))}
                              </tr>
                              <tr>
                                {ALEX_EXPORT_FIELDS.map((field) => (
                                  <Fragment key={`${field.key}-expanded`}>
                                    <th
                                      className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#fde9a8] px-3 py-2 text-center font-bold text-red-600`}
                                      title={
                                        alexComparePeriods?.yesterday.label
                                      }
                                    >
                                      {alexComparePeriods?.yesterday
                                        .shortLabel ?? "--"}
                                    </th>
                                    <th
                                      className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#c9dbef] px-3 py-2 text-center font-bold text-red-600`}
                                      title={
                                        alexComparePeriods?.monthToDate.label
                                      }
                                    >
                                      {alexComparePeriods?.monthToDate
                                        .shortLabel ?? "--"}
                                    </th>
                                  </Fragment>
                                ))}
                              </tr>
                            </>
                          ) : (
                            <tr className="bg-slate-100">
                              <th
                                className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-left font-bold`}
                                aria-sort={
                                  alexSortField === "sede"
                                    ? alexSortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                {renderAlexSortHeader("sede", "Sede")}
                              </th>
                              <th
                                className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right font-bold`}
                                aria-sort={
                                  alexSortField === "moreThan72With2"
                                    ? alexSortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                {renderAlexSortHeader(
                                  "moreThan72With2",
                                  "+ 7:20h con 2 marcaciones",
                                  "right",
                                )}
                              </th>
                              <th
                                className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right font-bold`}
                                aria-sort={
                                  alexSortField === "moreThan92"
                                    ? alexSortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                {renderAlexSortHeader(
                                  "moreThan92",
                                  "+ 9:20h",
                                  "right",
                                )}
                              </th>
                              <th
                                className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right font-bold`}
                                aria-sort={
                                  alexSortField === "oddMarks"
                                    ? alexSortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                {renderAlexSortHeader(
                                  "oddMarks",
                                  "Marc. impares",
                                  "right",
                                )}
                              </th>
                              <th
                                className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right font-bold`}
                                aria-sort={
                                  alexSortField === "absences"
                                    ? alexSortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                              >
                                {renderAlexSortHeader(
                                  "absences",
                                  "Inasistencias",
                                  "right",
                                )}
                              </th>
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {displayedAlexRows.map((row) => (
                            <tr key={row.sede}>
                              <td
                                className={`sticky left-0 z-10 ${ALEX_TABLE_CELL_BORDER_CLASS} bg-white px-3 py-2 font-semibold text-slate-900`}
                              >
                                {row.sede}
                              </td>
                              {alexCompareOpen ? (
                                <>
                                  {ALEX_EXPORT_FIELDS.map((field) => (
                                    <Fragment key={`${row.sede}-${field.key}`}>
                                      <td
                                        className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#fff0b8] px-3 py-2 text-center text-slate-800`}
                                      >
                                        {alexCompareLoading
                                          ? "..."
                                          : formatAlexMetric(
                                              getAlexCompareMetricValue(
                                                row.sede,
                                                "yesterday",
                                                field.key,
                                              ),
                                            )}
                                      </td>
                                      <td
                                        className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#d6e5f5] px-3 py-2 text-center text-slate-800`}
                                      >
                                        {alexCompareLoading
                                          ? "..."
                                          : formatAlexMetric(
                                              getAlexCompareMetricValue(
                                                row.sede,
                                                "monthToDate",
                                                field.key,
                                              ),
                                            )}
                                      </td>
                                    </Fragment>
                                  ))}
                                </>
                              ) : (
                                <>
                                  <td
                                    className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right text-slate-800`}
                                  >
                                    {formatAlexMetric(row.moreThan72With2)}
                                  </td>
                                  <td
                                    className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right text-slate-800`}
                                  >
                                    {formatAlexMetric(row.moreThan92)}
                                  </td>
                                  <td
                                    className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right text-slate-800`}
                                  >
                                    {formatAlexMetric(row.oddMarks)}
                                  </td>
                                  <td
                                    className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right text-slate-800`}
                                  >
                                    {formatAlexMetric(row.absences)}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                          <tr className="bg-slate-50 font-bold text-slate-900">
                            <td
                              className={`sticky left-0 z-10 ${ALEX_TABLE_CELL_BORDER_CLASS} bg-slate-50 px-3 py-2`}
                            >
                              TOTAL
                            </td>
                            {alexCompareOpen ? (
                              <>
                                {ALEX_EXPORT_FIELDS.map((field) => (
                                  <Fragment key={`totals-${field.key}`}>
                                    <td
                                      className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#f8df8c] px-3 py-2 text-center`}
                                    >
                                      {alexCompareLoading
                                        ? "..."
                                        : formatAlexMetric(
                                            alexCompareTotals.yesterday[
                                              field.key
                                            ],
                                          )}
                                    </td>
                                    <td
                                      className={`${ALEX_TABLE_CELL_BORDER_CLASS} bg-[#bdd4ec] px-3 py-2 text-center`}
                                    >
                                      {alexCompareLoading
                                        ? "..."
                                        : formatAlexMetric(
                                            alexCompareTotals.monthToDate[
                                              field.key
                                            ],
                                          )}
                                    </td>
                                  </Fragment>
                                ))}
                              </>
                            ) : (
                              <>
                                <td
                                  className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right`}
                                >
                                  {alexTotals.moreThan72With2}
                                </td>
                                <td
                                  className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right`}
                                >
                                  {alexTotals.moreThan92}
                                </td>
                                <td
                                  className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right`}
                                >
                                  {alexTotals.oddMarks}
                                </td>
                                <td
                                  className={`${ALEX_TABLE_CELL_BORDER_CLASS} px-3 py-2 text-right`}
                                >
                                  {alexTotals.absences}
                                </td>
                              </>
                            )}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            <HourlyAnalysis
              availableDates={availableDates}
              availableSedes={availableSedes}
              defaultDate={defaultDate}
              defaultSede={defaultSede}
              sections={["overtime"]}
              defaultSection="overtime"
              showTimeFilters={false}
              showTopDateFilter={false}
              showTopLineFilter={false}
              showSedeFilters={false}
              showDepartmentFilterInOvertime
              enableOvertimeDateRange
              alexConsistencyMode={canSeeAlexReport}
              alexTotalsOverride={canSeeAlexReport ? alexTotals : undefined}
              dashboardContext="jornada-extendida"
            />
          </>
        )}
      </div>
    </div>
  );
}
