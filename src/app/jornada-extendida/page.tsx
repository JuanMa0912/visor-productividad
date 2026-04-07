"use client";

import * as ExcelJS from "exceljs";
import { toJpeg } from "html-to-image";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { HourlyAnalysis } from "@/components/HourlyAnalysis";
import { DEFAULT_SEDES } from "@/lib/constants";
import type { Sede } from "@/lib/constants";

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
  error?: string;
};

type AlexExportFieldKey = keyof AlexReportTotals;
type AlexSortField = "sede" | AlexExportFieldKey;
type AlexSortDirection = "asc" | "desc";

type AlexExportField = {
  key: AlexExportFieldKey;
  header: string;
  toggleLabel: string;
  width: number;
};

const normalizeSedeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

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
    header: "Más de 7:20h con 2 marcaciones",
    toggleLabel: "7:20h / 2 marcas",
    width: 32,
  },
  {
    key: "moreThan92",
    header: "Más de 9:20h",
    toggleLabel: "Más de 9:20h",
    width: 18,
  },
  {
    key: "oddMarks",
    header: "Marcaciones impares",
    toggleLabel: "Impares",
    width: 22,
  },
  {
    key: "absences",
    header: "Inasistencias",
    toggleLabel: "Inasistencias",
    width: 18,
  },
];

const formatAlexMetric = (value: number) => (value === 0 ? "-" : value);

const sanitizeExcelText = (value: string) => {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  return /^[=+\-@\t]/.test(normalized) ? `'${normalized}` : normalized;
};

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
  const [alexTotals, setAlexTotals] = useState<AlexReportTotals>({
    moreThan72With2: 0,
    moreThan92: 0,
    oddMarks: 0,
    absences: 0,
  });
  const [alexLoading, setAlexLoading] = useState(false);
  const [alexError, setAlexError] = useState<string | null>(null);
  const [exportingAlexExcel, setExportingAlexExcel] = useState(false);
  const [exportingAlexJpg, setExportingAlexJpg] = useState(false);
  const [isAlexExportMenuOpen, setIsAlexExportMenuOpen] = useState(false);
  const [alexSelectedFields, setAlexSelectedFields] = useState<AlexExportFieldKey[]>(
    () => ALEX_EXPORT_FIELDS.map((field) => field.key),
  );
  const [alexSortField, setAlexSortField] = useState<AlexSortField | null>(null);
  const [alexSortDirection, setAlexSortDirection] =
    useState<AlexSortDirection>("desc");
  const [alexExportError, setAlexExportError] = useState<string | null>(null);
  const alexExportMenuRef = useRef<HTMLDivElement | null>(null);
  const alexTableRef = useRef<HTMLDivElement | null>(null);

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
          payload.sedes && payload.sedes.length > 0 ? payload.sedes : DEFAULT_SEDES;
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
        const visibleSedes = forcedSede && resolvedSedes.length === 1
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
          forcedSede && resolvedSedes.length === 1 ? forcedSede.name : undefined,
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
    () => (availableDates.length > 0 ? availableDates[availableDates.length - 1] : ""),
    [availableDates],
  );
  const alexRangeLabel = useMemo(() => {
    if (!alexStartDate || !alexEndDate) return "";
    const fmt = (value: string) => {
      const dt = new Date(`${value}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return value;
      const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(dt);
      const day = String(dt.getDate()).padStart(2, "0");
      const year = dt.getFullYear();
      return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day} de ${year}`;
    };
    if (alexStartDate === alexEndDate) return fmt(alexStartDate);
    return `${fmt(alexStartDate)} a ${fmt(alexEndDate)}`;
  }, [alexEndDate, alexStartDate]);

  const alexIncludedFields = useMemo(
    () =>
      ALEX_EXPORT_FIELDS.filter((field) =>
        alexSelectedFields.includes(field.key),
      ),
    [alexSelectedFields],
  );
  const sortedAlexRows = useMemo(() => {
    if (!alexSortField) return alexRows;

    return [...alexRows].sort((a, b) => {
      const primaryDiff =
        alexSortField === "sede"
          ? a.sede.localeCompare(b.sede, "es", { sensitivity: "base" })
          : a[alexSortField] - b[alexSortField];
      if (primaryDiff !== 0) {
        return alexSortDirection === "asc" ? primaryDiff : -primaryDiff;
      }

      return a.sede.localeCompare(b.sede, "es", { sensitivity: "base" });
    });
  }, [alexRows, alexSortDirection, alexSortField]);

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
    align: "left" | "right" = "left",
  ) => {
    const isActive = alexSortField === field;
    return (
      <button
        type="button"
        onClick={() => handleAlexSort(field)}
        className={`inline-flex w-full items-center gap-1 font-bold transition-colors ${
          align === "right"
            ? "justify-end text-right"
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
      const sheet = workbook.addWorksheet("Reporte Alex");
      const title = "Reporte Alex";
      const subtitle =
        "Tabla exportable con el mismo desglose visible por sede";
      const range = alexRangeLabel || `${alexStartDate} a ${alexEndDate}`;
      const exportColumns = [
        { key: "sede" as const, header: "Sede", width: 22, align: "left" as const },
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

      const rangeRow = sheet.addRow([range]);
      mergeRow(rangeRow.number);
      rangeRow.font = { bold: true, color: { argb: "FFB91C1C" } };
      rangeRow.alignment = { vertical: "middle", horizontal: "left" };

      sheet.addRow([]);

      const headerRow = sheet.addRow(exportColumns.map((column) => column.header));
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

      sortedAlexRows.forEach((row) => {
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
        ...alexIncludedFields.map((field) => alexTotals[field.key]),
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

  const handleExportAlexTableJpg = async () => {
    if (!alexTableRef.current) return;
    if (alexRows.length === 0) return;
    const tableNode = alexTableRef.current;
    const tableElement = tableNode.querySelector("table") as HTMLElement | null;
    setExportingAlexJpg(true);
    try {
      if (!tableElement) {
        setAlexExportError("No se pudo preparar el JPG.");
        return;
      }

      const dataUrl = await toJpeg(tableElement, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        width: tableElement.scrollWidth,
        height: tableElement.scrollHeight + 24,
        style: {
          overflow: "visible",
          backgroundColor: "#ffffff",
        },
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `reporte-alex-${alexStartDate || "inicio"}-${alexEndDate || "fin"}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("[jornada-extendida] Error exportando JPG Alex:", error);
      setAlexExportError("No se pudo exportar el JPG.");
    } finally {
      setExportingAlexJpg(false);
    }
  };

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
          `/api/jornada-extendida/alex-report?start=${encodeURIComponent(alexStartDate)}&end=${encodeURIComponent(alexEndDate)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as AlexReportResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar el reporte Alex.");
        }
        if (!isMounted) return;
        setAlexRows(payload.rows ?? []);
        setAlexTotals(
          payload.totals ?? {
            moreThan72With2: 0,
            moreThan92: 0,
            oddMarks: 0,
            absences: 0,
          },
        );
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
  }, [alexEndDate, alexStartDate, canSeeAlexReport]);

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
              href="/secciones"
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
                      Reporte Alex
                    </p>
                    <h2 className="mt-1 text-lg font-bold leading-tight text-slate-900 sm:text-[1.6rem]">
                      Laboraron mas de 7:20h con 2 marcaciones, mas de 9:20h, marcaciones impares e inasistencias
                    </h2>
                    {alexRangeLabel && (
                      <p className="mt-1 text-base font-bold text-red-700">{alexRangeLabel}</p>
                    )}
                  </div>
                  <div className="w-full xl:max-w-2xl">
                    <div className="grid gap-3 sm:grid-cols-2">
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
                    </div>
                    <div className="mt-3 flex justify-start sm:justify-end">
                      <div
                        ref={alexExportMenuRef}
                        className="relative w-full sm:w-auto"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setIsAlexExportMenuOpen((prev) => !prev)
                          }
                          disabled={alexLoading || alexRows.length === 0 || exportingAlexExcel}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          {exportingAlexExcel
                            ? "Generando Excel..."
                            : isAlexExportMenuOpen
                              ? "Cerrar Excel"
                              : "Excel tabla"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleExportAlexTableJpg()}
                          disabled={alexLoading || alexRows.length === 0 || exportingAlexJpg}
                          className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-amber-200/70 bg-amber-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700 transition-all hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0 sm:ml-2 sm:w-auto"
                        >
                          {exportingAlexJpg ? "Generando JPG..." : "Exportar JPG"}
                        </button>
                        {isAlexExportMenuOpen && (
                          <div className="mt-2 w-full rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)] sm:absolute sm:right-0 sm:z-10 sm:w-[30rem]">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                Columnas a incluir
                              </p>
                              <p className="text-xs text-slate-500">
                                {alexSelectedFields.length === ALEX_EXPORT_FIELDS.length
                                  ? "Sede + todas las métricas"
                                  : `Sede + ${alexIncludedFields.length} columna(s)`}
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              Deja marcadas solo las métricas que quieres exportar.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {ALEX_EXPORT_FIELDS.map((field) => {
                                const selected = alexSelectedFields.includes(field.key);
                                return (
                                  <label
                                    key={field.key}
                                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={() => toggleAlexSelectedField(field.key)}
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
                                onClick={() => void handleExportAlexTableExcel()}
                                disabled={exportingAlexExcel}
                                className="inline-flex min-h-10 items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {exportingAlexExcel ? "Generando Excel..." : "Exportar Excel"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
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
                  <p className="mt-3 text-sm text-slate-600">Cargando reporte Alex...</p>
                ) : (
                  <div
                    ref={alexTableRef}
                    className="mt-3 overflow-x-auto overflow-y-visible rounded-xl border border-slate-200"
                    style={{ scrollbarGutter: "stable" }}
                  >
                    <table className="min-w-[820px] w-full text-sm">
                      <thead className="bg-slate-100 text-slate-800">
                        <tr>
                          <th
                            className="border-b border-slate-200 px-3 py-2 text-left font-bold"
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
                            className="border-b border-slate-200 px-3 py-2 text-right font-bold"
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
                              "Más de 7:20h con 2 marcaciones",
                              "right",
                            )}
                          </th>
                          <th
                            className="border-b border-slate-200 px-3 py-2 text-right font-bold"
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
                              "Más de 9:20h",
                              "right",
                            )}
                          </th>
                          <th
                            className="border-b border-slate-200 px-3 py-2 text-right font-bold"
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
                              "Marcaciones impares",
                              "right",
                            )}
                          </th>
                          <th
                            className="border-b border-slate-200 px-3 py-2 text-right font-bold"
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
                      </thead>
                      <tbody>
                        {sortedAlexRows.map((row) => (
                          <tr key={row.sede} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-semibold text-slate-900">{row.sede}</td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.moreThan72With2 === 0 ? "-" : row.moreThan72With2}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.moreThan92 === 0 ? "-" : row.moreThan92}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.oddMarks === 0 ? "-" : row.oddMarks}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.absences === 0 ? "-" : row.absences}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold text-slate-900">
                          <td className="px-3 py-2">TOTAL</td>
                          <td className="px-3 py-2 text-right">{alexTotals.moreThan72With2}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.moreThan92}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.oddMarks}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.absences}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
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
