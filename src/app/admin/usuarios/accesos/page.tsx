"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  LogOut,
  Search,
  Sparkles,
  X,
} from "lucide-react";

const APP_VERSION_LABEL = "UAID V4.0";
const PAGE_SIZE = 15;

type LogRow = {
  id: number;
  logged_at: string;
  ip: string | null;
  user_agent: string | null;
  user_id: string;
  username: string;
};

type SortKey = "logged_at" | "username";

type FilterState = { from: string; to: string; user: string };

const emptyFilters = (): FilterState => ({ from: "", to: "", user: "" });

const formatAbsoluteDateTime = (isoDate: string) =>
  new Date(isoDate).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const formatRelativeTime = (isoDate: string) => {
  const eventTime = new Date(isoDate).getTime();
  const now = Date.now();
  const diffMs = eventTime - now;
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

  if (absMinutes < 1) return "ahora";
  if (absMinutes < 60) return rtf.format(Math.round(diffMs / 60000), "minute");

  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), "hour");

  return rtf.format(Math.round(diffMs / 86400000), "day");
};

const truncateUa = (ua: string | null, max = 72) => {
  if (!ua) return "—";
  const t = ua.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
};

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

function buildPageList(current: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 1) return [1];
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | "gap")[] = [];
  const add = (n: number | "gap") => {
    if (pages.length && pages[pages.length - 1] === n) return;
    pages.push(n);
  };

  add(1);
  const showLeft = current > 4;
  const showRight = current < totalPages - 3;

  if (!showLeft) {
    for (let p = 2; p <= Math.min(7, totalPages - 1); p++) add(p);
    if (totalPages > 8) add("gap");
  } else if (!showRight) {
    if (totalPages > 8) add("gap");
    for (let p = Math.max(2, totalPages - 6); p <= totalPages - 1; p++) add(p);
  } else {
    add("gap");
    for (let p = current - 2; p <= current + 2; p++) {
      if (p > 1 && p < totalPages) add(p);
    }
    add("gap");
  }
  add(totalPages);
  return pages;
}

export default function AdminUsuariosAccesosPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortKey>("logged_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [filterDraft, setFilterDraft] = useState<FilterState>(emptyFilters);
  const [filterApplied, setFilterApplied] = useState<FilterState>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(
    (status: number) => {
      if (status === 401) {
        router.replace("/login");
        return true;
      }
      if (status === 403) {
        router.replace("/secciones");
        return true;
      }
      return false;
    },
    [router],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const pageList = useMemo(
    () => buildPageList(page, totalPages),
    [page, totalPages],
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const offset = (page - 1) * PAGE_SIZE;
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: sortBy,
        order,
      });
      const f = filterApplied;
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      const u = f.user.trim();
      if (u) params.set("user", u);
      const res = await fetch(`/api/admin/login-logs?${params.toString()}`);
      if (handleAuthFailure(res.status)) return;
      if (!res.ok) {
        throw new Error("No se pudo cargar el registro de accesos.");
      }
      const data = (await res.json()) as { logs: LogRow[]; total?: number };
      setLogs(data.logs ?? []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure, page, sortBy, order, filterApplied]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const toggleSort = (column: SortKey) => {
    setPage(1);
    if (sortBy === column) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setOrder(column === "username" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortBy !== column) {
      return (
        <ArrowUpDown
          className="ml-1 inline h-3.5 w-3.5 opacity-40"
          aria-hidden
        />
      );
    }
    return order === "asc" ? (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5 text-indigo-600" aria-hidden />
    ) : (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5 text-indigo-600" aria-hidden />
    );
  };

  const handleLogout = async () => {
    const token = getCookieValue("vp_csrf");
    if (!token) return;
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[min(100%,72rem)] flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-600/25">
              <Sparkles className="h-6 w-6" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Administración <span className="text-slate-400">●</span>{" "}
                {APP_VERSION_LABEL}
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Registro de accesos
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                Inicios de sesión en el portal. Filtra por rango de fechas y por
                usuario, ordena y navega por páginas.
              </p>
              <Link
                href="/admin/usuarios"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 transition hover:text-sky-700 hover:underline"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Volver a usuarios
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Link
              href="/secciones"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <LayoutGrid className="h-4 w-4 text-slate-500" />
              Ir a secciones
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.12)]">
          <form
            className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6"
            onSubmit={(e) => {
              e.preventDefault();
              setFilterApplied({ ...filterDraft });
              setPage(1);
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange
                className="h-4 w-4 shrink-0 text-indigo-600"
                aria-hidden
              />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Filtros
              </h3>
            </div>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
              <label className="flex min-w-40 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Desde
                </span>
                <input
                  type="date"
                  value={filterDraft.from}
                  max={filterDraft.to || undefined}
                  onChange={(e) =>
                    setFilterDraft((prev) => ({
                      ...prev,
                      from: e.target.value,
                    }))
                  }
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={filterDraft.to}
                  min={filterDraft.from || undefined}
                  onChange={(e) =>
                    setFilterDraft((prev) => ({ ...prev, to: e.target.value }))
                  }
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <label className="flex min-w-48 flex-[1.2] flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Usuario
                </span>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={filterDraft.user}
                    onChange={(e) =>
                      setFilterDraft((prev) => ({
                        ...prev,
                        user: e.target.value,
                      }))
                    }
                    placeholder="Nombre de usuario…"
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </label>
              <div className="flex flex-wrap gap-2 pb-0.5 lg:ml-auto">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Aplicar filtros
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const z = emptyFilters();
                    setFilterDraft(z);
                    setFilterApplied(z);
                    setPage(1);
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Limpiar
                </button>
              </div>
            </div>
            {(filterApplied.from ||
              filterApplied.to ||
              filterApplied.user.trim()) && (
              <p className="mt-3 text-[11px] text-slate-500">
                Activo:{" "}
                {[
                  filterApplied.from &&
                    `desde ${filterApplied.from.replace(/-/g, "/")}`,
                  filterApplied.to &&
                    `hasta ${filterApplied.to.replace(/-/g, "/")}`,
                  filterApplied.user.trim() &&
                    `usuario “${filterApplied.user.trim()}”`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </form>
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-linear-to-r from-slate-50/90 to-indigo-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Historial de inicios de sesión
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {loading
                  ? "Cargando…"
                  : total === 0
                    ? "Sin registros"
                    : `Mostrando ${rangeStart}–${rangeEnd} de ${total.toLocaleString("es-CO")}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Orden
              </span>
              <button
                type="button"
                onClick={() => toggleSort("logged_at")}
                className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  sortBy === "logged_at"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Fecha
                <SortIcon column="logged_at" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort("username")}
                className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  sortBy === "username"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Usuario
                <SortIcon column="username" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                  <p className="text-sm font-medium">Cargando accesos…</p>
                </div>
              </div>
            ) : logs.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-500">
                Sin accesos registrados.
              </p>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="hidden w-12 px-4 py-3 sm:table-cell">#</th>
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Fecha y hora</th>
                    <th className="hidden px-4 py-3 md:table-cell">Relativo</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="hidden min-w-[200px] px-4 py-3 lg:table-cell">
                      Navegador / dispositivo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log, i) => {
                    const n = (page - 1) * PAGE_SIZE + i + 1;
                    return (
                      <tr
                        key={`${log.id}-${log.logged_at}`}
                        className="transition hover:bg-indigo-50/40"
                      >
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-400 sm:table-cell">
                          {n}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-900">
                            {log.username}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {formatAbsoluteDateTime(log.logged_at)}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-500 md:table-cell">
                          {formatRelativeTime(log.logged_at)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {log.ip ?? "—"}
                        </td>
                        <td className="hidden max-w-md px-4 py-3 text-xs leading-snug text-slate-500 lg:table-cell">
                          <span title={log.user_agent ?? undefined}>
                            {truncateUa(log.user_agent)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && total > 0 && totalPages > 1 ? (
            <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:flex-row sm:px-6">
              <p className="text-xs text-slate-500">
                Página{" "}
                <span className="font-semibold text-slate-800">{page}</span> de{" "}
                <span className="font-semibold text-slate-800">{totalPages}</span>
              </p>
              <nav
                className="flex flex-wrap items-center justify-center gap-1"
                aria-label="Paginación"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Primera página"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {pageList.map((item, idx) =>
                  item === "gap" ? (
                    <span
                      key={`gap-${idx}`}
                      className="px-1 text-slate-400"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item)}
                      className={`min-w-9 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                        page === item
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "border border-transparent text-slate-600 hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Página siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Última página"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </nav>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
