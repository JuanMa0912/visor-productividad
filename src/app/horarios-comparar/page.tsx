"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { canAccessHorariosCompararBoard } from "@/lib/shared/special-role-features";
import {
  HORARIOS_COMPARAR_ENTRADA_ANTICIPO_MAX_MIN,
  HORARIOS_COMPARAR_SALIDA_EXTRA_MAX_MIN,
  HORARIOS_COMPARAR_TARDE_MAX_MIN,
  type ComparisonRow,
} from "@/lib/horarios/comparar-utils";
import {
  DEFAULT_LUNES_SCHEDULE_PRESETS,
  planMatchesLunesPreset,
} from "@/lib/horarios/lunes-schedule-presets";

type SedeOption = { id: string; name: string };

function formatDiff(min: number | null): string {
  if (min === null) return "—";
  if (min === 0) return "0 min";
  const sign = min > 0 ? "+" : "-";
  const abs = Math.abs(min);
  if (abs <= 59) {
    return `${sign}${abs} min`;
  }
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

function statusLabel(status: ComparisonRow["status"]): string {
  switch (status) {
    case "cumplio":
      return "Cumplió";
    case "no_cumplio":
      return "No cumplió";
  }
}

/**
 * Color y abreviatura para el estado real de `asistencia_horas.estado_asistencia`.
 * Mantenemos el texto crudo, pero asignamos un color segun categoria (laborado,
 * incidente, ausente, etc.) para que el operador escanee la columna rapido.
 */
function estadoAsistenciaTone(raw: string | null | undefined): {
  bg: string;
  text: string;
  border: string;
} {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) {
    return {
      bg: "bg-slate-100",
      text: "text-slate-500",
      border: "border-slate-200",
    };
  }
  if (t.includes("incidente") || t.includes("novedad")) {
    return {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
    };
  }
  if (
    t.includes("ausent") ||
    t.includes("falta") ||
    t.includes("no laboro") ||
    t.includes("no laboró")
  ) {
    return {
      bg: "bg-rose-50",
      text: "text-rose-700",
      border: "border-rose-200",
    };
  }
  if (t.includes("permiso") || t.includes("licencia") || t.includes("vacacion")) {
    return {
      bg: "bg-violet-50",
      text: "text-violet-700",
      border: "border-violet-200",
    };
  }
  if (t.includes("incapacid")) {
    return {
      bg: "bg-sky-50",
      text: "text-sky-700",
      border: "border-sky-200",
    };
  }
  if (t.includes("labor")) {
    return {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
    };
  }
  return {
    bg: "bg-slate-50",
    text: "text-slate-700",
    border: "border-slate-200",
  };
}

function isEntradaOutOfPolicy(diff: number | null): boolean {
  if (diff === null) return false;
  return (
    diff < -HORARIOS_COMPARAR_ENTRADA_ANTICIPO_MAX_MIN ||
    diff > HORARIOS_COMPARAR_TARDE_MAX_MIN
  );
}

function isIntermediaOutOfPolicy(diff: number | null): boolean {
  if (diff === null) return false;
  return diff > HORARIOS_COMPARAR_TARDE_MAX_MIN;
}

function isSalidaOutOfPolicy(diff: number | null): boolean {
  if (diff === null) return false;
  return diff > HORARIOS_COMPARAR_SALIDA_EXTRA_MAX_MIN;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const buildCompararExportStamp = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}_${h}${min}`;
};

const safeExportFileSegment = (value: string) =>
  value.replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 48) || "export";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type EstadoFilter = "all" | "cumplio" | "no_cumplio";
const ALL_SCHEDULE_FILTER = "__all__";

function normalizeNameForFilter(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export default function HorariosCompararPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [{ start, end }, setRange] = useState(defaultDateRange);
  const [sede, setSede] = useState("");
  const [sedes, setSedes] = useState<SedeOption[]>([]);
  const [defaultSede, setDefaultSede] = useState<string | null>(null);
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(1);
  const [employeeNameFilter, setEmployeeNameFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("all");
  const [scheduleFilter, setScheduleFilter] = useState<string>(ALL_SCHEDULE_FILTER);
  const [hoveredNoCumplioKey, setHoveredNoCumplioKey] = useState<string | null>(
    null,
  );
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Muestra el boton flotante "Volver arriba" cuando el usuario hizo suficiente
  // scroll vertical como para perder de vista los filtros y el header sticky.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateVisibility = () => {
      setShowBackToTop(window.scrollY > 400);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateVisibility);
    };
  }, []);

  const handleScrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
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
            allowedDashboards?: string[] | null;
            allowedSubdashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          (!canAccessPortalSection(payload.user?.allowedDashboards, "operacion") ||
            !canAccessPortalSubsection(
              payload.user?.allowedSubdashboards,
              "planilla-vs-asistencia",
            ))
        ) {
          router.replace("/secciones");
          return;
        }
        if (!canAccessHorariosCompararBoard(payload.user?.specialRoles, isAdmin)) {
          router.replace("/horario");
          return;
        }
        if (isMounted) setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const loadComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("start", start);
      params.set("end", end);
      if (sede) params.set("sede", sede);
      const response = await fetch(`/api/horarios-comparar?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        rows?: ComparisonRow[];
        meta?: { sedes?: SedeOption[]; defaultSede?: string | null };
        error?: string;
      };
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        router.replace("/horario");
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo cargar la comparacion.");
      }
      setRows(payload.rows ?? []);
      setPage(1);
      if (payload.meta?.sedes) {
        setSedes(payload.meta.sedes);
        setDefaultSede(payload.meta.defaultSede ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido.");
      setRows([]);
      setPage(1);
    } finally {
      setLoading(false);
    }
  }, [end, router, sede, start]);

  useEffect(() => {
    if (!ready) return;
    void loadComparison();
  }, [ready, loadComparison]);

  useEffect(() => {
    if (defaultSede && !sede) {
      setSede(defaultSede);
    }
  }, [defaultSede, sede]);

  const filteredRows = useMemo(() => {
    let out = rows;
    const q = employeeNameFilter.trim();
    if (q) {
      const needle = normalizeNameForFilter(q);
      if (needle) {
        out = out.filter((r) =>
          normalizeNameForFilter(r.employeeName).includes(needle),
        );
      }
    }
    if (estadoFilter === "cumplio") {
      out = out.filter((r) => r.status === "cumplio");
    } else if (estadoFilter === "no_cumplio") {
      out = out.filter((r) => r.status === "no_cumplio");
    }
    if (scheduleFilter !== ALL_SCHEDULE_FILTER) {
      const preset = DEFAULT_LUNES_SCHEDULE_PRESETS.find(
        (p) => p.key === scheduleFilter,
      );
      if (preset) {
        out = out.filter(
          (r) =>
            !r.isRestDay &&
            r.planillaId > 0 &&
            planMatchesLunesPreset(r.plan, preset),
        );
      }
    }
    return out;
  }, [rows, employeeNameFilter, estadoFilter, scheduleFilter]);

  const counts = useMemo(() => {
    let cumplio = 0;
    let noCumplio = 0;
    for (const r of filteredRows) {
      if (r.status === "cumplio") cumplio += 1;
      else noCumplio += 1;
    }
    return { cumplio, noCumplio, total: filteredRows.length };
  }, [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStartIdx = (currentPage - 1) * pageSize;
  const paginatedRows = useMemo(
    () => filteredRows.slice(pageStartIdx, pageStartIdx + pageSize),
    [filteredRows, pageStartIdx, pageSize],
  );
  const rangeFrom = filteredRows.length === 0 ? 0 : pageStartIdx + 1;
  const rangeTo = Math.min(pageStartIdx + pageSize, filteredRows.length);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [employeeNameFilter, estadoFilter, scheduleFilter]);

  useEffect(() => {
    if (scheduleFilter === ALL_SCHEDULE_FILTER) return;
    const valid = DEFAULT_LUNES_SCHEDULE_PRESETS.some(
      (p) => p.key === scheduleFilter,
    );
    if (!valid) setScheduleFilter(ALL_SCHEDULE_FILTER);
  }, [scheduleFilter]);

  const handleExportExcel = useCallback(async () => {
    if (filteredRows.length === 0 || exportingExcel || loading) return;
    setExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Comparar");
      sheet.columns = [
        { header: "Fecha", key: "fecha", width: 12 },
        { header: "Sede", key: "sede", width: 22 },
        { header: "Empleado", key: "empleado", width: 28 },
        { header: "Planilla", key: "planilla", width: 10 },
        { header: "Estado", key: "estado", width: 14 },
        { header: "Plan HE1", key: "pHe1", width: 9 },
        { header: "Plan HS1", key: "pHs1", width: 9 },
        { header: "Plan HE2", key: "pHe2", width: 9 },
        { header: "Plan HS2", key: "pHs2", width: 9 },
        { header: "Asist entrada", key: "aEnt", width: 11 },
        { header: "Asist int1", key: "aI1", width: 11 },
        { header: "Asist int2", key: "aI2", width: 11 },
        { header: "Asist salida", key: "aSal", width: 11 },
        { header: "Estado BD", key: "estadoBd", width: 22 },
        { header: "Diff entrada", key: "dEnt", width: 12 },
        { header: "Diff int1", key: "dI1", width: 12 },
        { header: "Diff int2", key: "dI2", width: 12 },
        { header: "Diff salida", key: "dSal", width: 12 },
      ];
      // Las columnas de diferencias se escriben como NUMEROS (minutos enteros con
      // signo, null si no hay dato) y se les aplica un numFmt con sufijo " min"
      // para que sigan leyendose en estilo "+15 min" / "-30 min" pero Excel las
      // pueda sumar y autosumar.
      const DIFF_NUM_FMT = '+0" min";-0" min";0" min";@';
      const diffCellCols = ["dEnt", "dI1", "dI2", "dSal"] as const;

      for (const r of filteredRows) {
        const addedRow = sheet.addRow({
          fecha: r.workedDate,
          sede: r.sede,
          empleado: r.employeeName,
          planilla: r.planillaId > 0 ? `#${r.planillaId}` : "—",
          estado: statusLabel(r.status),
          pHe1: r.plan.he1 || "",
          pHs1: r.plan.hs1 || "",
          pHe2: r.plan.he2 || "",
          pHs2: r.plan.hs2 || "",
          aEnt: r.attendance?.horaEntrada ?? "",
          aI1: r.attendance?.horaIntermedia1 ?? "",
          aI2: r.attendance?.horaIntermedia2 ?? "",
          aSal: r.attendance?.horaSalida ?? "",
          estadoBd: r.attendance?.estadoAsistencia ?? "",
          dEnt: r.diffMin.entrada,
          dI1: r.diffMin.intermedia1,
          dI2: r.diffMin.intermedia2,
          dSal: r.diffMin.salida,
        });
        diffCellCols.forEach((key) => {
          const cell = addedRow.getCell(key);
          if (typeof cell.value === "number") {
            cell.numFmt = DIFF_NUM_FMT;
          }
        });
      }
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF1F5F9" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      });
      const planCols = [6, 7, 8, 9];
      const attendanceCols = [10, 11, 12, 13];
      const estadoBdCol = 14;
      const diffCols = [15, 16, 17, 18];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          planCols.forEach((idx) => {
            const c = row.getCell(idx);
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
          });
          attendanceCols.forEach((idx) => {
            const c = row.getCell(idx);
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
          });
          /** Cabecera "Estado BD" en ambar claro para distinguirla del estado calculado. */
          row.getCell(estadoBdCol).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFEF3C7" },
          };
          diffCols.forEach((idx) => {
            const c = row.getCell(idx);
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
          });
          return;
        }
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });
        planCols.forEach((idx) => {
          const c = row.getCell(idx);
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F9FF" } };
          c.alignment = { horizontal: "center" };
        });
        attendanceCols.forEach((idx) => {
          const c = row.getCell(idx);
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
          c.alignment = { horizontal: "center" };
        });
        const estadoBdCell = row.getCell(estadoBdCol);
        estadoBdCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFFBEB" },
        };
        estadoBdCell.alignment = { horizontal: "center" };
        diffCols.forEach((idx) => {
          const c = row.getCell(idx);
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAF5FF" } };
          c.alignment = { horizontal: "center" };
        });
        const statusCell = row.getCell(5);
        const statusValue = String(statusCell.value ?? "");
        statusCell.font = { bold: true, color: { argb: "FF111827" } };
        statusCell.alignment = { horizontal: "center" };
        statusCell.fill =
          statusValue === "Cumplió"
            ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } }
            : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      });
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sedeTag = safeExportFileSegment(sede || "todas");
      a.download = `comparar-horarios_${sedeTag}_${start}_${end}_${buildCompararExportStamp()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExportingExcel(false);
    }
  }, [end, exportingExcel, filteredRows, loading, sede, start]);

  const handleExportPdf = useCallback(() => {
    if (filteredRows.length === 0 || exportingPdf || loading) return;
    setExportingPdf(true);
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(11);
      doc.text("Comparar horarios (planilla vs asistencia)", 14, 12);
      doc.setFontSize(8);
      doc.text(
        `Periodo: ${start} al ${end} | Sede: ${sede || "Todas"} | Filas: ${filteredRows.length}`,
        14,
        18,
      );
      autoTable(doc, {
        startY: 23,
        styles: { fontSize: 5, cellPadding: 0.8 },
        headStyles: { fillColor: [241, 245, 249], textColor: 30, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        head: [[
          "Fecha",
          "Sede",
          "Empleado",
          "Pl.",
          "Estado",
          "P.HE1",
          "P.HS1",
          "P.HE2",
          "P.HS2",
          "A.Ent",
          "A.I1",
          "A.I2",
          "A.Sal",
          "Estado BD",
          "D.Ent",
          "D.I1",
          "D.I2",
          "D.Sal",
        ]],
        body: filteredRows.map((r) => [
          r.workedDate,
          r.sede,
          r.employeeName,
          r.planillaId > 0 ? String(r.planillaId) : "—",
          statusLabel(r.status),
          r.plan.he1 || "—",
          r.plan.hs1 || "—",
          r.plan.he2 || "—",
          r.plan.hs2 || "—",
          r.attendance?.horaEntrada || "—",
          r.attendance?.horaIntermedia1 || "—",
          r.attendance?.horaIntermedia2 || "—",
          r.attendance?.horaSalida || "—",
          r.attendance?.estadoAsistencia || "—",
          formatDiff(r.diffMin.entrada),
          formatDiff(r.diffMin.intermedia1),
          formatDiff(r.diffMin.intermedia2),
          formatDiff(r.diffMin.salida),
        ]),
        margin: { left: 6, right: 6 },
        didParseCell: (data) => {
          const col = data.column.index;
          if (data.section === "head") {
            if (col >= 5 && col <= 8) data.cell.styles.fillColor = [224, 242, 254];
            if (col >= 9 && col <= 12) data.cell.styles.fillColor = [220, 252, 231];
            if (col === 13) data.cell.styles.fillColor = [254, 243, 199];
            if (col >= 14 && col <= 17) data.cell.styles.fillColor = [237, 233, 254];
            return;
          }
          if (data.section !== "body") return;
          if (col >= 5 && col <= 8) data.cell.styles.fillColor = [240, 249, 255];
          if (col >= 9 && col <= 12) data.cell.styles.fillColor = [240, 253, 244];
          if (col === 13) data.cell.styles.fillColor = [255, 251, 235];
          if (col >= 14 && col <= 17) data.cell.styles.fillColor = [250, 245, 255];
          if (col === 4) {
            const status = String(data.cell.raw ?? "");
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.halign = "center";
            data.cell.styles.fillColor =
              status === "Cumplió" ? [209, 250, 229] : [254, 226, 226];
          }
        },
      });
      const sedeTag = safeExportFileSegment(sede || "todas");
      doc.save(
        `comparar-horarios_${sedeTag}_${start}_${end}_${buildCompararExportStamp()}.pdf`,
      );
    } finally {
      setExportingPdf(false);
    }
  }, [end, exportingPdf, filteredRows, loading, sede, start]);

  const Kpi = ({
    label,
    value,
    tone = "default",
  }: {
    label: string;
    value: string;
    tone?: "default" | "good" | "bad";
  }) => {
    const toneClass =
      tone === "good"
        ? "bg-emerald-100/80 text-emerald-800"
        : tone === "bad"
          ? "bg-rose-100/80 text-rose-800"
          : "bg-slate-100 text-slate-900";
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 shadow-xs">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${toneClass}`}>
          {value}
        </span>
      </div>
    );
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground antialiased">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <p className="text-sm text-slate-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3.5 lg:px-8">
          <Link href="/portal" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-indigo-600 to-indigo-700 shadow-elevated">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Operación · UAID
              </span>
              <span className="font-display text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                Comparar horarios
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => router.push("/horario")}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground shadow-xs transition-all hover:border-foreground/20 hover:shadow-soft"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver a Horario
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-8 lg:py-10">
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs">
          <div className="h-[3px] w-full bg-rose-600" />
          <div className="space-y-6 p-5 lg:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
                  Operación
                </span>
                <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-foreground">
                  Comparar horarios
                </h1>
                <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                  Cruza lo registrado en planillas con las marcaciones reales de asistencia: entrada,
                  intermedias y salida.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleExportExcel()}
                  disabled={loading || filteredRows.length === 0 || exportingExcel}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-100/60 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800 transition-all hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={loading || filteredRows.length === 0 || exportingPdf}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-300/40 bg-rose-100/60 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-800 transition-all hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 lg:grid-cols-[140px_140px_1fr_auto] lg:items-end">
              <label className="space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Desde
                </span>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 font-mono text-[12px] font-semibold shadow-xs"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 font-mono text-[12px] font-semibold shadow-xs"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Sede
                </span>
                <select
                  value={sede}
                  onChange={(e) => setSede(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-[12px] shadow-xs"
                >
                  <option value="">Todas visibles</option>
                  {sedes.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void loadComparison()}
                disabled={loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-elevated transition-all hover:-translate-y-0.5 hover:shadow-floating disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {loading ? "Cargando..." : "Actualizar"}
              </button>

              <label className="space-y-1.5 lg:col-span-2">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Nombre
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={employeeNameFilter}
                    onChange={(e) => setEmployeeNameFilter(e.target.value)}
                    placeholder="Filtrar por nombre del empleado..."
                    autoComplete="off"
                    disabled={loading}
                    className="h-10 w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-[12px] shadow-xs placeholder:text-slate-400 disabled:opacity-60"
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Estado
                </span>
                <select
                  value={estadoFilter}
                  onChange={(e) => setEstadoFilter(e.target.value as EstadoFilter)}
                  disabled={loading}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-[12px] shadow-xs disabled:opacity-60"
                >
                  <option value="all">Todos</option>
                  <option value="cumplio">Cumplió</option>
                  <option value="no_cumplio">No cumplió</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Horario predeterminado
                </span>
                <select
                  value={scheduleFilter}
                  onChange={(e) => setScheduleFilter(e.target.value)}
                  disabled={loading}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-[12px] shadow-xs disabled:opacity-60"
                >
                  <option value={ALL_SCHEDULE_FILTER}>Todos</option>
                  {DEFAULT_LUNES_SCHEDULE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col justify-between gap-4 border-y border-border/60 py-4 lg:flex-row lg:items-center">
              <div className="flex flex-wrap gap-2">
                <Kpi
                  label="Registros"
                  value={counts.total.toLocaleString("es-CO")}
                />
                <Kpi
                  label="Cumplió"
                  value={counts.cumplio.toLocaleString("es-CO")}
                  tone="good"
                />
                <Kpi
                  label="No cumplió"
                  value={counts.noCumplio.toLocaleString("es-CO")}
                  tone="bad"
                />
              </div>
              <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <span>Filas por página</span>
                <div className="relative">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!PAGE_SIZE_OPTIONS.includes(v as PageSize)) return;
                      setPageSize(v as PageSize);
                      setPage(1);
                    }}
                    disabled={loading}
                    className="inline-flex h-9 appearance-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 pr-8 font-mono text-[12px] text-foreground shadow-xs disabled:opacity-60"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                </div>
                <span>
                  Página {currentPage} de {totalPages}
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/70 shadow-xs">
              <div className="overflow-x-auto">
                <table className="min-w-[1320px] border-collapse text-left text-[11px]">
                  <thead className="sticky top-[73px] z-30 bg-white shadow-xs">
                    <tr className="border-b border-border/70">
                      <th className="bg-white px-3 py-3 font-semibold text-foreground">Fecha</th>
                      <th className="bg-white px-3 py-3 font-semibold text-foreground">Sede</th>
                      <th className="bg-white px-3 py-3 font-semibold text-foreground">Empleado</th>
                      <th className="bg-white px-3 py-3 font-semibold text-foreground">Planilla</th>
                      <th className="bg-white px-3 py-3 font-semibold text-foreground">Estado</th>
                      <th colSpan={4} className="bg-sky-100 px-3 py-3 text-center font-semibold text-sky-700">
                        Plan
                      </th>
                      <th colSpan={4} className="bg-emerald-100 px-3 py-3 text-center font-semibold text-emerald-700">
                        Asistencia
                      </th>
                      <th className="bg-amber-100 px-3 py-3 text-center font-semibold text-amber-800">
                        Estado BD
                      </th>
                      <th colSpan={4} className="bg-slate-100 px-3 py-3 text-center font-semibold text-slate-600">
                        Diferencia
                      </th>
                    </tr>
                    <tr className="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      <th className="bg-slate-50 px-3 py-2" />
                      <th className="bg-slate-50 px-3 py-2" />
                      <th className="bg-slate-50 px-3 py-2" />
                      <th className="bg-slate-50 px-3 py-2" />
                      <th className="bg-slate-50 px-3 py-2" />
                      <th className="bg-sky-50 px-3 py-2 text-center">HE1</th>
                      <th className="bg-sky-50 px-3 py-2 text-center">HS1</th>
                      <th className="bg-sky-50 px-3 py-2 text-center">HE2</th>
                      <th className="bg-sky-50 px-3 py-2 text-center">HS2</th>
                      <th className="bg-emerald-50 px-3 py-2 text-center">Ent</th>
                      <th className="bg-emerald-50 px-3 py-2 text-center">Int1</th>
                      <th className="bg-emerald-50 px-3 py-2 text-center">Int2</th>
                      <th className="bg-emerald-50 px-3 py-2 text-center">Sal</th>
                      <th className="bg-amber-50 px-3 py-2 text-center">Estado</th>
                      <th className="bg-slate-100 px-3 py-2 text-center">D1</th>
                      <th className="bg-slate-100 px-3 py-2 text-center">D2</th>
                      <th className="bg-slate-100 px-3 py-2 text-center">D3</th>
                      <th className="bg-slate-100 px-3 py-2 text-center">D4</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && !loading ? (
                      <tr>
                        <td colSpan={18} className="px-4 py-10 text-center text-slate-500">
                          No hay filas en este rango. Ajusta fechas o sede.
                        </td>
                      </tr>
                    ) : rows.length === 0 && loading ? (
                      <tr>
                        <td colSpan={18} className="px-4 py-10 text-center text-slate-500">
                          Cargando...
                        </td>
                      </tr>
                    ) : filteredRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={18}
                          className="bg-amber-50/50 px-4 py-10 text-center text-sm text-amber-900"
                        >
                          Ningún registro coincide con los filtros de nombre o estado.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((r, idx) => {
                        const globalIdx = pageStartIdx + idx;
                        const rowKey = `${r.workedDate}-${r.sede}-${r.employeeName}-${r.planillaId}-${globalIdx}`;
                        const highlightNoCumplioFields =
                          r.status === "no_cumplio" && hoveredNoCumplioKey === rowKey;
                        const highlightEntrada =
                          highlightNoCumplioFields && isEntradaOutOfPolicy(r.diffMin.entrada);
                        const highlightIntermedia1 =
                          highlightNoCumplioFields &&
                          isIntermediaOutOfPolicy(r.diffMin.intermedia1);
                        const highlightIntermedia2 =
                          highlightNoCumplioFields &&
                          isIntermediaOutOfPolicy(r.diffMin.intermedia2);
                        const highlightSalida =
                          highlightNoCumplioFields && isSalidaOutOfPolicy(r.diffMin.salida);
                        return (
                          <tr
                            key={rowKey}
                            className="border-b border-border/60 bg-card transition-colors hover:bg-muted/30"
                          >
                            <td className="px-3 py-2.5 font-mono text-slate-700">{r.workedDate}</td>
                            <td className="px-3 py-2.5 text-slate-700">{r.sede}</td>
                            <td className="px-3 py-2.5 font-semibold uppercase tracking-[0.02em] text-slate-900">
                              {r.employeeName}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-slate-600">
                              {r.planillaId > 0 ? `#${r.planillaId}` : "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] ${
                                  r.status === "cumplio"
                                    ? "bg-emerald-100/80 text-emerald-800"
                                    : "bg-rose-100/80 text-rose-800"
                                }`}
                                onMouseEnter={() => {
                                  if (r.status === "no_cumplio") setHoveredNoCumplioKey(rowKey);
                                }}
                                onMouseLeave={() => {
                                  if (r.status === "no_cumplio") setHoveredNoCumplioKey(null);
                                }}
                              >
                                {statusLabel(r.status)}
                              </span>
                            </td>
                            <td className="bg-sky-50/70 px-3 py-2.5 text-center font-mono">{r.plan.he1 || "—"}</td>
                            <td className="bg-sky-50/70 px-3 py-2.5 text-center font-mono">{r.plan.hs1 || "—"}</td>
                            <td className="bg-sky-50/70 px-3 py-2.5 text-center font-mono">{r.plan.he2 || "—"}</td>
                            <td className="bg-sky-50/70 px-3 py-2.5 text-center font-mono">{r.plan.hs2 || "—"}</td>
                            <td className="bg-emerald-50 px-3 py-2.5 text-center font-mono">{r.attendance?.horaEntrada || "—"}</td>
                            <td className="bg-emerald-50 px-3 py-2.5 text-center font-mono">{r.attendance?.horaIntermedia1 || "—"}</td>
                            <td className="bg-emerald-50 px-3 py-2.5 text-center font-mono">{r.attendance?.horaIntermedia2 || "—"}</td>
                            <td className="bg-emerald-50 px-3 py-2.5 text-center font-mono">{r.attendance?.horaSalida || "—"}</td>
                            <td className="bg-amber-50/40 px-3 py-2.5 text-center">
                              {(() => {
                                const raw = r.attendance?.estadoAsistencia ?? null;
                                if (!raw) {
                                  return <span className="text-[10px] text-slate-400">—</span>;
                                }
                                const tone = estadoAsistenciaTone(raw);
                                return (
                                  <span
                                    title={raw}
                                    className={`inline-flex max-w-[140px] truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${tone.bg} ${tone.text} ${tone.border}`}
                                  >
                                    {raw}
                                  </span>
                                );
                              })()}
                            </td>
                            <td
                              className={`relative bg-slate-100/80 px-3 py-2.5 text-center font-mono ${
                                highlightEntrada
                                  ? "font-extrabold text-slate-900"
                                  : ""
                              }`}
                            >
                              <span className="relative z-10">{formatDiff(r.diffMin.entrada)}</span>
                              {highlightEntrada ? (
                                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-rose-500/75" />
                              ) : null}
                            </td>
                            <td
                              className={`relative bg-slate-100/80 px-3 py-2.5 text-center font-mono ${
                                highlightIntermedia1
                                  ? "font-extrabold text-slate-900"
                                  : ""
                              }`}
                            >
                              <span className="relative z-10">
                                {formatDiff(r.diffMin.intermedia1)}
                              </span>
                              {highlightIntermedia1 ? (
                                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-rose-500/75" />
                              ) : null}
                            </td>
                            <td
                              className={`relative bg-slate-100/80 px-3 py-2.5 text-center font-mono ${
                                highlightIntermedia2
                                  ? "font-extrabold text-slate-900"
                                  : ""
                              }`}
                            >
                              <span className="relative z-10">
                                {formatDiff(r.diffMin.intermedia2)}
                              </span>
                              {highlightIntermedia2 ? (
                                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-rose-500/75" />
                              ) : null}
                            </td>
                            <td
                              className={`relative bg-slate-100/80 px-3 py-2.5 text-center font-mono ${
                                highlightSalida
                                  ? "font-extrabold text-slate-900"
                                  : ""
                              }`}
                            >
                              <span className="relative z-10">{formatDiff(r.diffMin.salida)}</span>
                              {highlightSalida ? (
                                <span className="pointer-events-none absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-rose-500/75" />
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span>
                Mostrando {rangeFrom}–{rangeTo} de {filteredRows.length.toLocaleString("es-CO")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || filteredRows.length === 0 || currentPage <= 1}
                  className="rounded-lg border border-border bg-muted px-3 py-2 text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={loading || filteredRows.length === 0 || currentPage >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-xs transition-all hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Siguiente
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              <strong className="text-emerald-800">Cumplió</strong>: planilla con marcaciones;
              entrada entre −15 min y +10 min respecto al plan, intermedias hasta +10 min, salida
              hasta +150 min (2 h 30 min) por horas extra; filas solo asistencia con al menos una
              hora. <strong className="text-rose-800">No cumplió</strong>: plan en planilla sin
              marcaciones, o entrada antes de −15 min o después de +10 min, o intermedias +11 min o
              más, o salida +151 min o más. Diferencia = asistencia menos planilla. Emparejamiento por
              nombre, sede y fecha.
            </p>
          </div>
        </section>
      </main>

      {/* Boton flotante para volver al inicio. Aparece tras 400px de scroll
          vertical para que no estorbe al cargar la pagina, y respeta
          prefers-reduced-motion al desplazarse. */}
      <button
        type="button"
        onClick={handleScrollToTop}
        aria-label="Volver arriba"
        title="Volver arriba"
        className={`fixed bottom-6 right-6 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-elevated transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-floating focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${
          showBackToTop
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <ArrowUp className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
