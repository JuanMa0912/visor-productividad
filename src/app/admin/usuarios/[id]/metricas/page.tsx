"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Clock,
  ExternalLink,
  Globe,
  Laptop,
  LayoutGrid,
  RefreshCw,
  Smartphone,
  Tablet,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { cn } from "@/lib/shared/utils";
import { getPathLabel } from "@/lib/shared/path-labels";
import type {
  UserMetricsDailyActivity,
  UserMetricsDevice,
  UserMetricsPeriodStats,
  UserMetricsResponse,
  UserMetricsTopPath,
} from "@/app/api/admin/users/[id]/metrics/route";

type ApiResponse = UserMetricsResponse & { error?: string };

const formatMinutes = (minutes: number): string => {
  if (!minutes || minutes < 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours} h`;
  return `${hours} h ${remainder} min`;
};

const formatRelativeTime = (iso: string | null): string => {
  if (!iso) return "—";
  const eventTime = new Date(iso).getTime();
  if (!Number.isFinite(eventTime)) return "—";
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

const formatAbsolute = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatDateLabel = (day: string): string => {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      day: "2-digit",
      month: "short",
    }).format(new Date(`${day}T12:00:00`));
  } catch {
    return day;
  }
};

const PeriodCard = ({
  label,
  stats,
}: {
  label: string;
  stats: UserMetricsPeriodStats;
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <span className="text-[10px] text-slate-400">{stats.sessions} sesiones</span>
    </div>
    <p className="mt-2 text-2xl font-semibold text-slate-900">
      {formatMinutes(stats.activeMinutes)}
    </p>
    <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1">
        <CalendarDays className="h-3 w-3" />
        {stats.activeDays} día{stats.activeDays === 1 ? "" : "s"} activos
      </span>
      <span className="inline-flex items-center gap-1">
        <Activity className="h-3 w-3" />
        {stats.observations} pings
      </span>
    </div>
  </div>
);

const DailyActivityChart = ({
  data,
}: {
  data: UserMetricsDailyActivity[];
}) => {
  const maxMinutes = useMemo(
    () => Math.max(60, ...data.map((d) => d.activeMinutes)),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        Aún no hay datos de actividad para este usuario.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">
          Actividad diaria · últimos 30 días
        </h3>
        <span className="text-[11px] text-slate-500">
          máx · {formatMinutes(maxMinutes)}
        </span>
      </div>
      <div className="flex h-32 items-end gap-1">
        {data.map((row) => {
          const heightPct =
            maxMinutes > 0 ? (row.activeMinutes / maxMinutes) * 100 : 0;
          return (
            <div
              key={row.day}
              className="group flex flex-1 flex-col items-center justify-end"
              title={`${formatDateLabel(row.day)} — ${formatMinutes(row.activeMinutes)}`}
            >
              <div
                className={cn(
                  "w-full min-h-[3px] rounded-t bg-amber-400 transition-colors group-hover:bg-amber-500",
                  row.activeMinutes === 0 && "bg-slate-100",
                )}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>{data[0] ? formatDateLabel(data[0].day) : ""}</span>
        <span>
          {data.length > 0 ? formatDateLabel(data[data.length - 1].day) : ""}
        </span>
      </div>
    </div>
  );
};

const TopPathsList = ({ paths }: { paths: UserMetricsTopPath[] }) => {
  const maxMinutes = useMemo(
    () => Math.max(1, ...paths.map((p) => p.activeMinutes)),
    [paths],
  );

  if (paths.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        Sin secciones registradas aún en los últimos 30 días.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">
        Top secciones · últimos 30 días
      </h3>
      <ul className="space-y-2">
        {paths.map((entry) => {
          const widthPct = (entry.activeMinutes / maxMinutes) * 100;
          return (
            <li key={entry.path} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {getPathLabel(entry.path)}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatMinutes(entry.activeMinutes)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400">{entry.path}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const deviceIconFor = (device: string) => {
  if (device === "Móvil") return Smartphone;
  if (device === "Tablet") return Tablet;
  return Laptop;
};

const DevicesList = ({ devices }: { devices: UserMetricsDevice[] }) => {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        Sin dispositivos registrados en los últimos 60 días.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">
        Dispositivos · últimos 60 días
      </h3>
      <ul className="space-y-2">
        {devices.map((entry) => {
          const Icon = deviceIconFor(entry.device);
          return (
            <li
              key={`${entry.browser}-${entry.os}-${entry.device}-${entry.browserVersion ?? ""}`}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/40 p-2.5"
            >
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {entry.browser}
                  {entry.browserVersion ? ` ${entry.browserVersion}` : ""} ·{" "}
                  {entry.os}
                </p>
                <p className="text-[11px] text-slate-500">
                  {entry.device} · {entry.loginCount} login
                  {entry.loginCount === 1 ? "" : "s"} · {""}
                  {formatRelativeTime(entry.lastSeenAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default function UserMetricsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const [data, setData] = useState<UserMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/admin/users/${userId}/metrics`,
          { signal },
        );
        const payload = (await response.json()) as ApiResponse;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }
        if (!response.ok) {
          setError(payload.error ?? "No se pudieron cargar las métricas.");
          return;
        }
        setData(payload);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Error desconocido al cargar.",
        );
      } finally {
        setLoading(false);
      }
    },
    [router, userId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppTopBar backHref="/admin/usuarios" backLabel="Volver a usuarios" />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 hover:text-slate-800"
            >
              <LayoutGrid className="h-3 w-3" />
              Admin · Usuarios
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {data?.user.username ?? "Métricas de usuario"}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              {data?.user.role === "admin" ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Administrador
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Usuario
                </span>
              )}
              {data?.user.sede && (
                <span className="text-slate-600">· {data.user.sede}</span>
              )}
              {data && !data.user.isActive && (
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                  Inactivo
                </span>
              )}
            </div>
            {data?.lastActivity.observedAt && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                <Clock className="h-3 w-3" />
                Última actividad: {getPathLabel(data.lastActivity.path)} ·{" "}
                {formatRelativeTime(data.lastActivity.observedAt)}
                <span className="ml-1 text-slate-400">
                  ({formatAbsolute(data.lastActivity.observedAt)})
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5 border-slate-200 bg-white"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
              />
              Actualizar
            </Button>
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver
            </Link>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{error}</p>
              <p className="text-xs text-rose-700/80">
                Verifica que el usuario exista y que tengas sesión activa.
              </p>
            </div>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Cargando métricas...
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <PeriodCard label="Últimos 7 días" stats={data.periods.last7Days} />
              <PeriodCard
                label="Últimos 30 días"
                stats={data.periods.last30Days}
              />
              <PeriodCard
                label="Últimos 90 días"
                stats={data.periods.last90Days}
              />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <DailyActivityChart data={data.dailyActivity} />
              </div>
              <div className="lg:col-span-1">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                    Resumen
                  </h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Cuenta creada</dt>
                      <dd className="text-slate-800">
                        {formatAbsolute(data.user.createdAt)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Último login</dt>
                      <dd className="text-slate-800">
                        {data.user.lastLoginAt
                          ? formatRelativeTime(data.user.lastLoginAt)
                          : "Nunca"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500">Estado</dt>
                      <dd
                        className={cn(
                          "font-medium",
                          data.user.isActive
                            ? "text-emerald-700"
                            : "text-rose-700",
                        )}
                      >
                        {data.user.isActive ? "Activo" : "Inactivo"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <Link
                      href={`/admin/usuarios/accesos?user=${encodeURIComponent(data.user.username)}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-amber-700"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Ver registro de accesos
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TopPathsList paths={data.topPaths} />
              <DevicesList devices={data.devices} />
            </section>

            <footer className="flex flex-wrap items-center justify-center gap-2 pt-4 text-xs text-slate-400">
              <Globe className="h-3 w-3" />
              <span>
                Generado · {formatAbsolute(data.generatedAt)}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
