"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarRange,
  ChevronLeft,
  Download,
  LayoutGrid,
  Loader2,
  LogOut,
  Sparkles,
  Users,
} from "lucide-react";
import { BRANCH_LOCATIONS } from "@/lib/shared/constants";
import type { PortalProfileId } from "@/lib/auth/types";
import {
  PORTAL_PROFILE_OPTIONS,
  getPortalProfileLabel,
} from "@/lib/shared/portal-profiles";
import {
  buildTableroUsageExportFilename,
  downloadTableroUsageCsv,
  formatUsageMinutes,
  type TableroUsagePathRow,
} from "@/lib/admin/tablero-usage-utils";
import {
  getLoginLogDateRangeForShortcut,
  LOGIN_LOG_DATE_SHORTCUTS,
  type LoginLogDateShortcutId,
} from "@/lib/admin/login-logs-utils";
import type {
  TableroUsageKpis,
  TableroUsageResponse,
} from "@/app/api/admin/uso-tableros/route";
import { getPathLabel } from "@/lib/shared/path-labels";
import { AppTopBar } from "@/components/portal/app-top-bar";

const APP_VERSION_LABEL = "UAID V4.0";
const SEDE_FILTER_OPTIONS = ["", ...BRANCH_LOCATIONS];

type SortKey = "activeMinutes" | "uniqueUsers" | "observations";

const defaultRange = () => getLoginLogDateRangeForShortcut("last30");

export default function AdminUsoTablerosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dateFrom, setDateFrom] = useState(
    () => searchParams.get("from") ?? defaultRange().from,
  );
  const [dateTo, setDateTo] = useState(
    () => searchParams.get("to") ?? defaultRange().to,
  );
  const [sedeFilter, setSedeFilter] = useState(
    () => searchParams.get("sede") ?? "",
  );
  const [profileFilter, setProfileFilter] = useState(
    () => searchParams.get("profile") ?? "",
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    () => (searchParams.get("sort") as SortKey) || "activeMinutes",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    () => (searchParams.get("order") === "asc" ? "asc" : "desc"),
  );

  const [kpis, setKpis] = useState<TableroUsageKpis | null>(null);
  const [paths, setPaths] = useState<TableroUsagePathRow[]>([]);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
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

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort: sortKey,
        order: sortOrder,
      });
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (sedeFilter) params.set("sede", sedeFilter);
      if (profileFilter) params.set("profile", profileFilter);

      const response = await fetch(
        `/api/admin/uso-tableros?${params.toString()}`,
      );
      if (handleAuthFailure(response.status)) return;
      if (!response.ok) {
        throw new Error("No se pudo cargar el uso de tableros.");
      }
      const payload = (await response.json()) as TableroUsageResponse;
      setKpis(payload.kpis);
      setPaths(payload.paths);
      setPeriod(payload.period);
    } catch (err) {
      setKpis(null);
      setPaths([]);
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }, [
    dateFrom,
    dateTo,
    sedeFilter,
    profileFilter,
    sortKey,
    sortOrder,
    handleAuthFailure,
  ]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  const maxActiveMinutes = useMemo(
    () => Math.max(1, ...paths.map((row) => row.activeMinutes)),
    [paths],
  );

  const applyDateShortcut = (shortcut: LoginLogDateShortcutId) => {
    const range = getLoginLogDateRangeForShortcut(shortcut);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(key);
    setSortOrder("desc");
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) {
      return <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 opacity-40" />;
    }
    return sortOrder === "desc" ? (
      <ArrowDown className="ml-1 inline h-3.5 w-3.5" />
    ) : (
      <ArrowUp className="ml-1 inline h-3.5 w-3.5" />
    );
  };

  const handleExport = async () => {
    if (paths.length === 0) {
      toast.error("No hay datos para exportar con los filtros actuales.");
      return;
    }
    setExporting(true);
    try {
      downloadTableroUsageCsv(
        paths,
        buildTableroUsageExportFilename({
          from: period?.from ?? dateFrom,
          to: period?.to ?? dateTo,
          sede: sedeFilter || undefined,
          profile: profileFilter || undefined,
        }),
      );
      toast.success("CSV exportado.");
    } finally {
      setExporting(false);
    }
  };

  const getCookieValue = (name: string) => {
    if (typeof document === "undefined") return null;
    const value = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));
    if (!value) return null;
    return decodeURIComponent(value.split("=").slice(1).join("="));
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
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-600 to-indigo-700 text-white shadow-lg shadow-violet-600/25">
                <LayoutGrid className="h-6 w-6" strokeWidth={2} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Administración <span className="text-slate-400">●</span>{" "}
                  {APP_VERSION_LABEL}
                </p>
                <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Uso de tableros
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
                  Analítica de uso del portal por ruta: minutos con interacción,
                  usuarios únicos y ranking de tableros según heartbeats de
                  actividad.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <Link
                    href="/admin/usuarios"
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-sky-200/80 bg-sky-50/70 px-3.5 text-sm font-semibold text-sky-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-100/70"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Usuarios
                  </Link>
                  <Link
                    href="/admin/usuarios/accesos"
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Registro de accesos
                  </Link>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </header>

          {error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {error}
            </div>
          ) : null}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Usuarios activos",
                value: kpis?.uniqueUsers,
                hint: "Con al menos un ping en el periodo",
                icon: Users,
              },
              {
                label: "Tableros distintos",
                value: kpis?.uniquePaths,
                hint: "Rutas con actividad registrada",
                icon: LayoutGrid,
              },
              {
                label: "Pings totales",
                value: kpis?.totalObservations,
                hint: "Observaciones en activity_log",
                icon: Sparkles,
              },
              {
                label: "Minutos activos",
                value: kpis
                  ? formatUsageMinutes(kpis.totalActiveMinutes)
                  : undefined,
                hint: "Usuario × minuto con interacción",
                icon: BarChart3,
                isText: true,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <card.icon className="h-4 w-4 text-indigo-500" />
                  {card.label}
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
                  {loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                  ) : card.isText ? (
                    card.value ?? "—"
                  ) : (
                    (card.value ?? "—")
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">{card.hint}</p>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Filtros</h2>
                {period ? (
                  <p className="mt-1 text-sm text-slate-500">
                    Periodo:{" "}
                    <strong className="font-semibold text-slate-700">
                      {period.from} → {period.to}
                    </strong>{" "}
                    (Bogotá). Sin fechas explícitas se usan los últimos 30 días.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading || paths.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Exportar CSV
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {LOGIN_LOG_DATE_SHORTCUTS.map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  onClick={() => applyDateShortcut(shortcut.id)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  {shortcut.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">
                  <CalendarRange className="h-3.5 w-3.5" />
                  Desde
                </span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Hasta
                </span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Sede
                </span>
                <select
                  value={sedeFilter}
                  onChange={(e) => setSedeFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Todas</option>
                  {SEDE_FILTER_OPTIONS.filter(Boolean).map((sede) => (
                    <option key={sede} value={sede}>
                      {sede}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Perfil portal
                </span>
                <select
                  value={profileFilter}
                  onChange={(e) => setProfileFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Todos</option>
                  {PORTAL_PROFILE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(sedeFilter || profileFilter) && (
              <p className="mt-3 text-xs text-slate-500">
                Filtros activos:
                {sedeFilter ? ` sede ${sedeFilter}` : ""}
                {profileFilter
                  ? ` perfil ${getPortalProfileLabel(profileFilter as PortalProfileId)}`
                  : ""}
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="text-base font-bold text-slate-900">
                Ranking de tableros
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Hasta 100 rutas. El porcentaje es la fracción del tiempo activo
                agregado por tablero.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando métricas…
              </div>
            ) : paths.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-slate-500">
                Sin actividad en el periodo seleccionado. Verifica que la
                migración <code className="text-xs">user_activity_log</code> esté
                aplicada en el servidor.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="w-12 px-4 py-3 sm:px-6">#</th>
                      <th className="px-4 py-3 sm:px-6">Tablero</th>
                      <th className="px-4 py-3 sm:px-6">
                        <button
                          type="button"
                          onClick={() => toggleSort("uniqueUsers")}
                          className="inline-flex items-center font-semibold uppercase"
                        >
                          Usuarios
                          <SortIcon column="uniqueUsers" />
                        </button>
                      </th>
                      <th className="px-4 py-3 sm:px-6">
                        <button
                          type="button"
                          onClick={() => toggleSort("observations")}
                          className="inline-flex items-center font-semibold uppercase"
                        >
                          Pings
                          <SortIcon column="observations" />
                        </button>
                      </th>
                      <th className="px-4 py-3 sm:px-6">
                        <button
                          type="button"
                          onClick={() => toggleSort("activeMinutes")}
                          className="inline-flex items-center font-semibold uppercase"
                        >
                          Minutos
                          <SortIcon column="activeMinutes" />
                        </button>
                      </th>
                      <th className="px-4 py-3 sm:px-6">% tiempo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paths.map((row, idx) => (
                      <tr key={row.path} className="hover:bg-violet-50/30">
                        <td className="px-4 py-3 text-xs tabular-nums text-slate-500 sm:px-6">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3 sm:px-6">
                          <div className="font-semibold text-slate-900">
                            {getPathLabel(row.path)}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                            {row.path}
                          </div>
                          <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-linear-to-r from-violet-500 to-indigo-500"
                              style={{
                                width: `${Math.max(4, (row.activeMinutes / maxActiveMinutes) * 100)}%`,
                              }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-slate-800 sm:px-6">
                          {row.uniqueUsers}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 sm:px-6">
                          {row.observations}
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-indigo-700 sm:px-6">
                          {formatUsageMinutes(row.activeMinutes)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-700 sm:px-6">
                          {row.sharePercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
