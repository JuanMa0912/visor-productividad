"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Loader2,
  LogOut,
  Radio,
  Search,
  Sparkles,
  Trash2,
  LayoutGrid,
  X,
} from "lucide-react";
import { BRANCH_LOCATIONS } from "@/lib/shared/constants";
import {
  PORTAL_PROFILE_OPTIONS,
  getPortalProfileLabel,
} from "@/lib/shared/portal-profiles";
import {
  buildLoginLogsExportFilename,
  downloadLoginLogsCsv,
  fetchAllLoginLogs,
  getLoginLogDateRangeForShortcut,
  LOGIN_LOG_DATE_SHORTCUTS,
  type LoginLogDateShortcutId,
  type LoginLogRow,
} from "@/lib/admin/login-logs-utils";
import { formatUserAgentLabel } from "@/lib/parse-user-agent";
import { getPathLabel } from "@/lib/shared/path-labels";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { LoginLogDetailPanel } from "@/app/admin/usuarios/accesos/login-log-detail-panel";

const APP_VERSION_LABEL = "UAID V4.0";
const PAGE_SIZE = 15;
const PRESENCE_REFRESH_MS = 20_000;
const PRESENCE_ACTIVE_MAX_MS = 10 * 60_000;
const SEDE_FILTER_OPTIONS = ["", ...BRANCH_LOCATIONS];

type AccessKpis = {
  loginsToday: number;
  logins7d: number;
  uniqueUsers7d: number;
  uniqueUsers30d: number;
  usersActive: number;
  usersTotal: number;
  usersInactive: number;
  activeAccountRate: number;
  onlineNow: number;
};

type PresenceEntry = {
  lastActivityAt: string;
  lastPath: string | null;
};

type SortKey = "logged_at" | "username";

const USER_FILTER_DEBOUNCE_MS = 400;

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
  const searchParams = useSearchParams();
  const initialUserFilter = (searchParams.get("user") ?? "").trim();
  const [logs, setLogs] = useState<LoginLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortKey>("logged_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sedeFilter, setSedeFilter] = useState("");
  const [profileFilter, setProfileFilter] = useState("");
  const [userInput, setUserInput] = useState(initialUserFilter);
  const [debouncedUser, setDebouncedUser] = useState(initialUserFilter);
  const skipUserDebouncePageReset = useRef(!initialUserFilter);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purgeConfirmAll, setPurgeConfirmAll] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [kpis, setKpis] = useState<AccessKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presenceByUserId, setPresenceByUserId] = useState<
    Record<string, PresenceEntry>
  >({});
  const [presenceNow, setPresenceNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = userInput.trim();
      setDebouncedUser(next);
      if (skipUserDebouncePageReset.current) {
        skipUserDebouncePageReset.current = false;
      } else {
        setPage(1);
      }
    }, USER_FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [userInput]);

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
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (debouncedUser) params.set("user", debouncedUser);
      if (sedeFilter) params.set("sede", sedeFilter);
      if (profileFilter) params.set("profile", profileFilter);
      const res = await fetch(`/api/admin/login-logs?${params.toString()}`);
      if (handleAuthFailure(res.status)) return;
      if (!res.ok) {
        throw new Error("No se pudo cargar el registro de accesos.");
      }
      const data = (await res.json()) as { logs: LoginLogRow[]; total?: number };
      setLogs(data.logs ?? []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure, page, sortBy, order, dateFrom, dateTo, debouncedUser, sedeFilter, profileFilter]);

  const fetchKpis = useCallback(async () => {
    setKpisLoading(true);
    try {
      const response = await fetch("/api/admin/login-logs?summary=kpis");
      if (handleAuthFailure(response.status)) return;
      if (!response.ok) return;
      const payload = (await response.json()) as AccessKpis;
      setKpis(payload);
    } catch {
      setKpis(null);
    } finally {
      setKpisLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    void fetchKpis();
  }, [fetchKpis]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    let cancelled = false;
    const fetchPresence = async () => {
      try {
        const response = await fetch("/api/admin/user-presence", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          presence?: Array<{
            userId: string;
            lastActivityAt: string;
            lastPath: string | null;
          }>;
        };
        if (cancelled) return;
        const next: Record<string, PresenceEntry> = {};
        for (const entry of payload.presence ?? []) {
          if (entry?.userId && entry.lastActivityAt) {
            next[entry.userId] = {
              lastActivityAt: entry.lastActivityAt,
              lastPath: entry.lastPath ?? null,
            };
          }
        }
        setPresenceByUserId(next);
        setPresenceNow(Date.now());
      } catch {
        // ignore - retry next tick
      }
    };

    void fetchPresence();
    const intervalId = window.setInterval(fetchPresence, PRESENCE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const tickId = window.setInterval(() => {
      setPresenceNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(tickId);
  }, []);

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

  const activeDateShortcut = useMemo((): LoginLogDateShortcutId | null => {
    if (!dateFrom || !dateTo) return null;
    for (const shortcut of LOGIN_LOG_DATE_SHORTCUTS) {
      const range = getLoginLogDateRangeForShortcut(shortcut.id);
      if (range.from === dateFrom && range.to === dateTo) {
        return shortcut.id;
      }
    }
    return null;
  }, [dateFrom, dateTo]);

  const applyDateShortcut = (shortcut: LoginLogDateShortcutId) => {
    const range = getLoginLogDateRangeForShortcut(shortcut);
    setDateFrom(range.from);
    setDateTo(range.to);
    setPage(1);
  };

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { rows, total, truncated } = await fetchAllLoginLogs({
        sort: sortBy,
        order,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        user: debouncedUser || undefined,
        sede: sedeFilter || undefined,
        profile: profileFilter || undefined,
      });
      if (rows.length === 0) {
        toast.message("No hay accesos para exportar con el filtro actual.");
        return;
      }
      downloadLoginLogsCsv(
        rows,
        buildLoginLogsExportFilename({
          from: dateFrom || undefined,
          to: dateTo || undefined,
          user: debouncedUser || undefined,
          sede: sedeFilter || undefined,
          profile: profileFilter || undefined,
        }),
      );
      toast.success(
        truncated
          ? `Exportados ${rows.length.toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")} registros (límite de exportación).`
          : `Exportados ${rows.length.toLocaleString("es-CO")} accesos.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo exportar el CSV.",
      );
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteLogs = async () => {
    const hasScope = Boolean(
      dateFrom || dateTo || debouncedUser || sedeFilter || profileFilter,
    );
    if (!purgeConfirmAll && !hasScope) {
      toast.error(
        "Define un filtro (fechas, usuario, sede o perfil) o marca borrar todo el historial.",
      );
      return;
    }
    const message = purgeConfirmAll
      ? "¿Borrar TODO el historial de accesos? Esta acción no se puede deshacer."
      : "¿Borrar los accesos que coinciden con el filtro actual?";
    if (!confirm(message)) return;

    const csrfToken = getCookieValue("vp_csrf");
    if (!csrfToken) {
      toast.error("No se encontró token CSRF.");
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch("/api/admin/login-logs", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          from: dateFrom || undefined,
          to: dateTo || undefined,
          user: debouncedUser || undefined,
          sede: sedeFilter || undefined,
          profile: profileFilter || undefined,
          confirmAll: purgeConfirmAll,
        }),
      });
      if (handleAuthFailure(response.status)) return;
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "No se pudieron borrar los accesos.");
      }
      const payload = (await response.json()) as { deleted?: number };
      toast.success(
        `Se eliminaron ${(payload.deleted ?? 0).toLocaleString("es-CO")} registro(s).`,
      );
      setExpandedLogId(null);
      setPage(1);
      void fetchLogs();
      void fetchKpis();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al borrar.");
    } finally {
      setDeleting(false);
    }
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
    <div className="min-h-screen bg-[#f7f7f8] text-slate-900">
      <AppTopBar backHref="/admin/usuarios" backLabel="Volver a usuarios" />
      <div className="px-4 py-8 sm:px-6 lg:px-8">
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
                Inicios de sesión en el portal.                 Filtra por rango de fechas y por usuario (se aplican al
                instante), ordena y navega por páginas.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <Link
                  href="/admin/usuarios"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-sky-200/80 bg-sky-50/70 px-3.5 text-sm font-semibold text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Volver a usuarios
                </Link>
                <Link
                  href="/admin/usuarios/accesos/en-linea"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200/80 bg-linear-to-r from-emerald-50 to-teal-50/70 px-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-800 shadow-sm transition hover:border-emerald-300 hover:from-emerald-100 hover:to-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                >
                  <Radio className="h-4 w-4" aria-hidden />
                  Quién está en línea
                </Link>
                <Link
                  href="/admin/usuarios/accesos/pormes"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200/80 bg-linear-to-r from-emerald-50 to-emerald-100/70 px-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-800 shadow-sm transition hover:border-emerald-300 hover:from-emerald-100 hover:to-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                >
                  Ver accesos por mes
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <Link
                  href="/admin/usuarios/uso-tableros"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-violet-200/80 bg-linear-to-r from-violet-50 to-indigo-50/70 px-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-violet-800 shadow-sm transition hover:border-violet-300 hover:from-violet-100 hover:to-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden />
                  Uso de tableros
                </Link>
                <Link
                  href="/admin/usuarios/auditoria"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200/80 bg-linear-to-r from-rose-50 to-orange-50/70 px-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-rose-800 shadow-sm transition hover:border-rose-300 hover:from-rose-100 hover:to-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40"
                >
                  Auditoría
                </Link>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Logins hoy",
              value: kpis?.loginsToday,
              hint: "Inicios de sesión exitosos",
            },
            {
              label: "Logins 7 días",
              value: kpis?.logins7d,
              hint: `${kpis?.uniqueUsers7d ?? "—"} usuarios únicos`,
            },
            {
              label: "En línea ahora",
              value: kpis?.onlineNow,
              hint: "Actividad últimos 10 min",
            },
            {
              label: "Cuentas activas",
              value: kpis
                ? `${kpis.usersActive}/${kpis.usersTotal}`
                : undefined,
              hint: kpis ? `${kpis.activeAccountRate}% del total` : "—",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {card.label}
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                {kpisLoading
                  ? "—"
                  : typeof card.value === "number"
                    ? card.value.toLocaleString("es-CO")
                    : (card.value ?? "—")}
              </p>
              <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.12)]">
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
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
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
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
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Nombre de usuario…"
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Sede
                </span>
                <select
                  value={sedeFilter}
                  onChange={(e) => {
                    setSedeFilter(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">Todas</option>
                  {SEDE_FILTER_OPTIONS.filter(Boolean).map((sede) => (
                    <option key={sede} value={sede}>
                      {sede}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-44 flex-1 flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500">
                  Perfil
                </span>
                <select
                  value={profileFilter}
                  onChange={(e) => {
                    setProfileFilter(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">Todos</option>
                  {PORTAL_PROFILE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2 pb-0.5 lg:ml-auto">
                <button
                  type="button"
                  onClick={() => void handleExportCsv()}
                  disabled={exporting || loading}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-xs font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setSedeFilter("");
                    setProfileFilter("");
                    setUserInput("");
                    setDebouncedUser("");
                    skipUserDebouncePageReset.current = true;
                    setPage(1);
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Limpiar
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500">
                Atajos:
              </span>
              {LOGIN_LOG_DATE_SHORTCUTS.map((shortcut) => {
                const isActive = activeDateShortcut === shortcut.id;
                return (
                  <button
                    key={shortcut.id}
                    type="button"
                    onClick={() => applyDateShortcut(shortcut.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
            {(dateFrom || dateTo || debouncedUser || sedeFilter || profileFilter) && (
              <p className="mt-3 text-[11px] text-slate-500">
                Activo:{" "}
                {[
                  dateFrom && `desde ${dateFrom.replace(/-/g, "/")}`,
                  dateTo && `hasta ${dateTo.replace(/-/g, "/")}`,
                  debouncedUser && `usuario “${debouncedUser}”`,
                  sedeFilter && `sede “${sedeFilter}”`,
                  profileFilter &&
                    `perfil “${getPortalProfileLabel(profileFilter as Parameters<typeof getPortalProfileLabel>[0])}”`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-linear-to-r from-slate-50/90 to-indigo-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Historial de inicios de sesión
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Cada fila es un login exitoso. La columna «En línea ahora» refleja
                la sesión activa actual, no el momento del acceso.
              </p>
              <p className="mt-1 text-xs text-slate-500">
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
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="hidden w-12 px-4 py-3 sm:table-cell">#</th>
                    <th className="w-10 px-2 py-3" aria-label="Detalle" />
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Fecha y hora</th>
                    <th className="hidden px-4 py-3 md:table-cell">Relativo</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">En línea ahora</th>
                    <th className="hidden min-w-[180px] px-4 py-3 lg:table-cell">
                      Navegador / dispositivo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log, i) => {
                    const n = (page - 1) * PAGE_SIZE + i + 1;
                    const presence = presenceByUserId[log.user_id];
                    const elapsedMs = presence
                      ? presenceNow -
                        new Date(presence.lastActivityAt).getTime()
                      : null;
                    const isOnline =
                      presence !== undefined &&
                      elapsedMs !== null &&
                      Number.isFinite(elapsedMs) &&
                      elapsedMs <= PRESENCE_ACTIVE_MAX_MS;
                    const pathLabel = presence
                      ? getPathLabel(presence.lastPath)
                      : "—";
                    return (
                      <Fragment key={log.id}>
                      <tr
                        className="transition hover:bg-indigo-50/40"
                      >
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-400 sm:table-cell">
                          {n}
                        </td>
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLogId((current) =>
                                current === log.id ? null : log.id,
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                            aria-expanded={expandedLogId === log.id}
                            aria-label={
                              expandedLogId === log.id
                                ? "Ocultar detalle de sesión"
                                : "Ver detalle de sesión"
                            }
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition ${
                                expandedLogId === log.id ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/admin/usuarios/${log.user_id}/metricas`}
                              className="inline-flex w-fit items-center gap-1 font-semibold text-indigo-700 transition hover:text-indigo-900 hover:underline"
                              title="Ver métricas de actividad"
                            >
                              {log.username}
                              <BarChart3
                                className="h-3.5 w-3.5 shrink-0 opacity-70"
                                aria-hidden
                              />
                            </Link>
                            <Link
                              href={`/admin/usuarios/accesos?user=${encodeURIComponent(log.username)}`}
                              className="w-fit text-[11px] font-medium text-slate-500 transition hover:text-slate-700 hover:underline"
                            >
                              Filtrar accesos
                            </Link>
                          </div>
                        </td>
                        <td
                          suppressHydrationWarning
                          className="whitespace-nowrap px-4 py-3 text-slate-700"
                        >
                          {formatAbsoluteDateTime(log.logged_at)}
                        </td>
                        <td
                          suppressHydrationWarning
                          className="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-500 md:table-cell"
                        >
                          {formatRelativeTime(log.logged_at)}
                        </td>
                        <td
                          className="px-4 py-3"
                          title={log.user_agent ?? "Sin User-Agent registrado"}
                        >
                          <span className="font-mono text-xs text-slate-600">
                            {log.ip ?? "—"}
                          </span>
                          <span className="mt-1 block text-[11px] leading-snug text-slate-500 lg:hidden">
                            {formatUserAgentLabel(log.user_agent)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          {isOnline && presence ? (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700"
                              title={presence.lastPath ?? undefined}
                            >
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                              {pathLabel}
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-medium text-slate-400"
                              title="Sin sesion activa"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                              Desconectado
                            </span>
                          )}
                        </td>
                        <td className="hidden max-w-md px-4 py-3 text-xs leading-snug text-slate-600 lg:table-cell">
                          <span
                            className="font-medium text-slate-700"
                            title={log.user_agent ?? undefined}
                          >
                            {formatUserAgentLabel(log.user_agent)}
                          </span>
                        </td>
                      </tr>
                      {expandedLogId === log.id ? (
                        <tr>
                          <td colSpan={9} className="p-0">
                            <LoginLogDetailPanel logId={log.id} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
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

        <section className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-rose-950">
                Borrar historial de accesos
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-rose-900/80">
                Por defecto se eliminan solo los registros que coinciden con los
                filtros activos. Marca la casilla inferior solo si necesitas
                vaciar todo el historial.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-rose-950">
                <input
                  type="checkbox"
                  checked={purgeConfirmAll}
                  onChange={(e) => setPurgeConfirmAll(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-200"
                />
                <span>
                  Borrar <strong>todo</strong> el historial (ignorar filtros)
                </span>
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteLogs()}
              disabled={deleting}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Borrar accesos
            </button>
          </div>
        </section>

        </div>
      </div>
    </div>
  );
}
