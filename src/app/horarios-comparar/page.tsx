"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";
import { canAccessHorariosCompararBoard } from "@/lib/special-role-features";
import {
  HORARIOS_COMPARAR_ENTRADA_ANTICIPO_MAX_MIN,
  HORARIOS_COMPARAR_SALIDA_EXTRA_MAX_MIN,
  HORARIOS_COMPARAR_TARDE_MAX_MIN,
  type ComparisonRow,
} from "@/lib/horarios-comparar-utils";
import {
  DEFAULT_LUNES_SCHEDULE_PRESETS,
  planMatchesLunesPreset,
} from "@/lib/lunes-schedule-presets";

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
        { header: "Diff entrada", key: "dEnt", width: 12 },
        { header: "Diff int1", key: "dI1", width: 12 },
        { header: "Diff int2", key: "dI2", width: 12 },
        { header: "Diff salida", key: "dSal", width: 12 },
      ];
      for (const r of filteredRows) {
        sheet.addRow({
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
          dEnt: formatDiff(r.diffMin.entrada),
          dI1: formatDiff(r.diffMin.intermedia1),
          dI2: formatDiff(r.diffMin.intermedia2),
          dSal: formatDiff(r.diffMin.salida),
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
      const diffCols = [14, 15, 16, 17];
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
            if (col >= 13 && col <= 16) data.cell.styles.fillColor = [237, 233, 254];
            return;
          }
          if (data.section !== "body") return;
          if (col >= 5 && col <= 8) data.cell.styles.fillColor = [240, 249, 255];
          if (col >= 9 && col <= 12) data.cell.styles.fillColor = [240, 253, 244];
          if (col >= 13 && col <= 16) data.cell.styles.fillColor = [250, 245, 255];
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-[min(100%,96rem)] rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-rose-700">
              Operacion
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              Comparar horarios
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Cruza lo registrado en planillas (ingresar horarios) con las marcaciones reales en
              asistencia: entrada, intermedias y salida.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push("/horario")}
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
            >
              Volver a Horario
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Desde
            <input
              type="date"
              value={start}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Hasta
            <input
              type="date"
              value={end}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Sede
            <select
              value={sede}
              onChange={(e) => setSede(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Todas (visibles)</option>
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
            className="inline-flex items-center rounded-full border border-slate-900 bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <label className="flex min-w-[min(100%,14rem)] flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Nombre
            <input
              type="search"
              value={employeeNameFilter}
              onChange={(e) => setEmployeeNameFilter(e.target.value)}
              placeholder="Filtrar por nombre del empleado..."
              autoComplete="off"
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 placeholder:text-slate-400 disabled:opacity-60"
            />
          </label>
          <label className="flex min-w-[min(100%,16rem)] flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Estado
            <select
              value={estadoFilter}
              onChange={(e) =>
                setEstadoFilter(e.target.value as EstadoFilter)
              }
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 disabled:opacity-60"
            >
              <option value="all">Todos</option>
              <option value="cumplio">Cumplió</option>
              <option value="no_cumplio">No cumplió</option>
            </select>
          </label>
          <label className="flex min-w-[min(100%,16rem)] flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
            Horario predeterminado
            <select
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900 disabled:opacity-60"
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

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
          <span>
            Registros: <strong className="text-slate-900">{counts.total}</strong>
            {rows.length > 0 && filteredRows.length !== rows.length ? (
              <span className="text-slate-400">
                {" "}
                (de {rows.length} cargados)
              </span>
            ) : null}
          </span>
          <span>
            Cumplió: <strong className="text-emerald-700">{counts.cumplio}</strong>
          </span>
          <span>
            No cumplió: <strong className="text-rose-700">{counts.noCumplio}</strong>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={
              loading || filteredRows.length === 0 || exportingExcel
            }
            className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportingExcel ? "Exportando..." : "Descargar Excel"}
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={loading || filteredRows.length === 0 || exportingPdf}
            className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportingPdf ? "Exportando..." : "Descargar PDF"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <p className="text-sm text-slate-600">
            {filteredRows.length === 0 && rows.length > 0 ? (
              <span className="text-amber-800">
                Ningún registro coincide con nombre o estado. Ajusta los filtros.
              </span>
            ) : filteredRows.length === 0 ? (
              <span className="text-slate-500">Sin filas para mostrar.</span>
            ) : (
              <>
                Mostrando{" "}
                <strong className="text-slate-900 tabular-nums">
                  {rangeFrom}–{rangeTo}
                </strong>{" "}
                de <strong className="text-slate-900">{filteredRows.length}</strong>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Filas por pagina
            </label>
            <select
              value={pageSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!PAGE_SIZE_OPTIONS.includes(v as PageSize)) return;
                setPageSize(v as PageSize);
                setPage(1);
              }}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-sky-300 focus:ring-2 focus:ring-sky-100 disabled:opacity-60"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={
                  loading || filteredRows.length === 0 || currentPage <= 1
                }
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="min-w-34 text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Pagina {currentPage} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={
                  loading ||
                  filteredRows.length === 0 ||
                  currentPage >= totalPages
                }
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 max-w-full overflow-x-auto rounded-2xl border border-slate-200/80">
          <table className="w-full min-w-[1200px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="text-slate-800">
                <th className="border border-slate-200 bg-slate-100 px-2 py-2">Fecha</th>
                <th className="border border-slate-200 bg-slate-100 px-2 py-2">Sede</th>
                <th className="border border-slate-200 bg-slate-100 px-2 py-2">Empleado</th>
                <th className="border border-slate-200 bg-slate-100 px-2 py-2">Planilla</th>
                <th className="border border-slate-200 bg-slate-100 px-2 py-2">Estado</th>
                <th
                  className="border border-sky-200 bg-sky-200/90 px-2 py-2 text-center text-sky-950"
                  colSpan={4}
                >
                  Plan (HE1 / HS1 / HE2 / HS2)
                </th>
                <th
                  className="border border-emerald-200 bg-emerald-200/90 px-2 py-2 text-center text-emerald-950"
                  colSpan={4}
                >
                  Asistencia (Ent / Int1 / Int2 / Sal)
                </th>
                <th
                  className="border border-violet-200 bg-violet-100 px-2 py-2 text-center text-violet-950"
                  colSpan={4}
                >
                  Diferencia
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td
                    colSpan={17}
                    className="border border-slate-200 px-4 py-8 text-center text-slate-500"
                  >
                    No hay filas en este rango. Ajusta fechas o sede.
                  </td>
                </tr>
              ) : rows.length === 0 && loading ? (
                <tr>
                  <td
                    colSpan={17}
                    className="border border-slate-200 px-4 py-8 text-center text-slate-500"
                  >
                    Cargando...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={17}
                    className="border border-amber-100 bg-amber-50/50 px-4 py-8 text-center text-sm text-amber-900"
                  >
                    Ningún registro coincide con los filtros de nombre o estado.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, idx) => {
                  const globalIdx = pageStartIdx + idx;
                  const rowKey = `${r.workedDate}-${r.sede}-${r.employeeName}-${r.planillaId}-${globalIdx}`;
                  const rowTint =
                    globalIdx % 2 === 0 ? "bg-white" : "bg-slate-50/80";
                  const highlightNoCumplioFields =
                    r.status === "no_cumplio" && hoveredNoCumplioKey === rowKey;
                  const highlightEntrada =
                    highlightNoCumplioFields &&
                    isEntradaOutOfPolicy(r.diffMin.entrada);
                  const highlightIntermedia1 =
                    highlightNoCumplioFields &&
                    isIntermediaOutOfPolicy(r.diffMin.intermedia1);
                  const highlightIntermedia2 =
                    highlightNoCumplioFields &&
                    isIntermediaOutOfPolicy(r.diffMin.intermedia2);
                  const highlightSalida =
                    highlightNoCumplioFields &&
                    isSalidaOutOfPolicy(r.diffMin.salida);
                  return (
                  <tr
                    key={rowKey}
                  >
                    <td
                      className={`border border-slate-200 px-2 py-1.5 whitespace-nowrap text-slate-800 ${rowTint}`}
                    >
                      {r.workedDate}
                    </td>
                    <td className={`border border-slate-200 px-2 py-1.5 text-slate-800 ${rowTint}`}>
                      {r.sede}
                    </td>
                    <td className={`border border-slate-200 px-2 py-1.5 text-slate-900 ${rowTint}`}>
                      {r.employeeName}
                    </td>
                    <td className={`border border-slate-200 px-2 py-1.5 text-slate-600 ${rowTint}`}>
                      {r.planillaId > 0 ? `#${r.planillaId}` : "—"}
                    </td>
                    <td className={`border border-slate-200 px-2 py-1.5 ${rowTint}`}>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          r.status === "cumplio"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-rose-100 text-rose-900"
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
                    <td className="border border-sky-200/80 bg-sky-50 px-1 py-1.5 text-center text-slate-800">
                      {r.plan.he1 || "—"}
                    </td>
                    <td className="border border-sky-200/80 bg-sky-50 px-1 py-1.5 text-center text-slate-800">
                      {r.plan.hs1 || "—"}
                    </td>
                    <td className="border border-sky-200/80 bg-sky-50 px-1 py-1.5 text-center text-slate-800">
                      {r.plan.he2 || "—"}
                    </td>
                    <td className="border border-sky-200/80 bg-sky-50 px-1 py-1.5 text-center text-slate-800">
                      {r.plan.hs2 || "—"}
                    </td>
                    <td className="border border-emerald-200/80 bg-emerald-50 px-1 py-1.5 text-center text-slate-800">
                      {r.attendance?.horaEntrada || "—"}
                    </td>
                    <td className="border border-emerald-200/80 bg-emerald-50 px-1 py-1.5 text-center text-slate-800">
                      {r.attendance?.horaIntermedia1 || "—"}
                    </td>
                    <td className="border border-emerald-200/80 bg-emerald-50 px-1 py-1.5 text-center text-slate-800">
                      {r.attendance?.horaIntermedia2 || "—"}
                    </td>
                    <td className="border border-emerald-200/80 bg-emerald-50 px-1 py-1.5 text-center text-slate-800">
                      {r.attendance?.horaSalida || "—"}
                    </td>
                    <td
                      className={`border px-1 py-1.5 text-center font-medium ${
                        highlightEntrada
                          ? "border-rose-500 bg-rose-300 text-rose-950 font-extrabold ring-2 ring-rose-500/60"
                          : "border-violet-200/80 bg-violet-50/90 text-slate-800"
                      }`}
                    >
                      {formatDiff(r.diffMin.entrada)}
                    </td>
                    <td
                      className={`border px-1 py-1.5 text-center font-medium ${
                        highlightIntermedia1
                          ? "border-rose-500 bg-rose-300 text-rose-950 font-extrabold ring-2 ring-rose-500/60"
                          : "border-violet-200/80 bg-violet-50/90 text-slate-800"
                      }`}
                    >
                      {formatDiff(r.diffMin.intermedia1)}
                    </td>
                    <td
                      className={`border px-1 py-1.5 text-center font-medium ${
                        highlightIntermedia2
                          ? "border-rose-500 bg-rose-300 text-rose-950 font-extrabold ring-2 ring-rose-500/60"
                          : "border-violet-200/80 bg-violet-50/90 text-slate-800"
                      }`}
                    >
                      {formatDiff(r.diffMin.intermedia2)}
                    </td>
                    <td
                      className={`border px-1 py-1.5 text-center font-medium ${
                        highlightSalida
                          ? "border-rose-500 bg-rose-300 text-rose-950 font-extrabold ring-2 ring-rose-500/60"
                          : "border-violet-200/80 bg-violet-50/90 text-slate-800"
                      }`}
                    >
                      {formatDiff(r.diffMin.salida)}
                    </td>
                  </tr>
                );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          <strong className="text-emerald-800">Cumplió</strong>: planilla con marcaciones;
          entrada entre −15 min y +10 min respecto al plan, intermedias hasta +10 min, salida hasta
          +150 min (2 h 30 min) por horas extra; filas solo asistencia con al menos una hora.{" "}
          <strong className="text-rose-800">No cumplió</strong>: plan en planilla sin marcaciones, o
          entrada antes de −15 min o despues de +10 min, o intermedias +11 min o mas, o salida +151
          min o mas. Diferencia = asistencia menos planilla. Emparejamiento por nombre, sede y fecha.
        </p>
      </div>
    </div>
  );
}
