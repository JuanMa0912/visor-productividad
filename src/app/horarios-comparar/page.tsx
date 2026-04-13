"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { canAccessHorariosCompararBoard } from "@/lib/special-role-features";
import type { ComparisonRow } from "@/lib/horarios-comparar-utils";

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

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type EstadoFilter = "all" | "cumplio" | "no_cumplio";

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
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "operacion")
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
    return out;
  }, [rows, employeeNameFilter, estadoFilter]);

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
  }, [employeeNameFilter, estadoFilter]);

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
          <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
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
              <span className="min-w-[8.5rem] text-center text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
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
                  const rowTint =
                    globalIdx % 2 === 0 ? "bg-white" : "bg-slate-50/80";
                  return (
                  <tr
                    key={`${r.workedDate}-${r.sede}-${r.employeeName}-${r.planillaId}-${globalIdx}`}
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
                    <td className="border border-violet-200/80 bg-violet-50/90 px-1 py-1.5 text-center font-medium text-slate-800">
                      {formatDiff(r.diffMin.entrada)}
                    </td>
                    <td className="border border-violet-200/80 bg-violet-50/90 px-1 py-1.5 text-center font-medium text-slate-800">
                      {formatDiff(r.diffMin.intermedia1)}
                    </td>
                    <td className="border border-violet-200/80 bg-violet-50/90 px-1 py-1.5 text-center font-medium text-slate-800">
                      {formatDiff(r.diffMin.intermedia2)}
                    </td>
                    <td className="border border-violet-200/80 bg-violet-50/90 px-1 py-1.5 text-center font-medium text-slate-800">
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
          <strong className="text-emerald-800">Cumplió</strong>: planilla con marcaciones y todas las
          diferencias ≤ +10 min (o anticipo); filas solo asistencia con al menos una hora.{" "}
          <strong className="text-rose-800">No cumplió</strong>: plan en planilla sin marcaciones, o
          alguna diferencia +11 min o mas. Diferencia = asistencia menos planilla. Emparejamiento por
          nombre, sede y fecha.
        </p>
      </div>
    </div>
  );
}
