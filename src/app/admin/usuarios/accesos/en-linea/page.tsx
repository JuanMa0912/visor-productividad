"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ChevronLeft,
  LayoutGrid,
  LogOut,
  Radio,
} from "lucide-react";
import { formatUserAgentLabel } from "@/lib/parse-user-agent";
import { getPortalProfileLabel } from "@/lib/shared/portal-profiles";
import { getPathLabel } from "@/lib/shared/path-labels";
import { AppTopBar } from "@/components/portal/app-top-bar";
import type { OnlineSessionRow } from "@/app/api/admin/online-sessions/route";

const APP_VERSION_LABEL = "UAID V4.0";
const PRESENCE_ACTIVE_MS = 10 * 60_000;
const REFRESH_MS = 20_000;

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

const formatAbsoluteDateTime = (isoDate: string) =>
  new Date(isoDate).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

export default function AdminUsuariosAccesosEnLineaPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<OnlineSessionRow[]>([]);
  const [activeNow, setActiveNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());

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

  const fetchSessions = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/admin/online-sessions", {
        cache: "no-store",
      });
      if (handleAuthFailure(response.status)) return;
      if (!response.ok) {
        throw new Error("No se pudo cargar quién está en línea.");
      }
      const payload = (await response.json()) as {
        sessions?: OnlineSessionRow[];
        activeNow?: number;
      };
      setSessions(payload.sessions ?? []);
      setActiveNow(payload.activeNow ?? 0);
      setPresenceNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setSessions([]);
      setActiveNow(0);
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    void fetchSessions();
    const intervalId = window.setInterval(() => {
      void fetchSessions();
    }, REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchSessions]);

  useEffect(() => {
    const tickId = window.setInterval(() => setPresenceNow(Date.now()), 30_000);
    return () => window.clearInterval(tickId);
  }, []);

  const idleSessions = useMemo(
    () =>
      sessions.filter(
        (row) =>
          presenceNow - new Date(row.lastActivityAt).getTime() > PRESENCE_ACTIVE_MS,
      ),
    [presenceNow, sessions],
  );

  const handleLogout = async () => {
    const token = getCookieValue("vp_csrf");
    if (!token) return;
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    router.replace("/login");
  };

  const renderRow = (row: OnlineSessionRow, live: boolean) => {
    const pathLabel = getPathLabel(row.lastPath);
    return (
      <tr key={row.userId} className="transition hover:bg-indigo-50/40">
        <td className="px-4 py-3">
          <Link
            href={`/admin/usuarios/${row.userId}/metricas`}
            className="font-semibold text-indigo-700 hover:underline"
          >
            {row.username}
          </Link>
          {!row.isActive ? (
            <span className="mt-1 block text-[11px] font-medium text-amber-700">
              Cuenta inactiva
            </span>
          ) : null}
        </td>
        <td className="px-4 py-3 text-sm text-slate-700">
          {row.sede ?? "—"}
        </td>
        <td className="px-4 py-3 text-sm text-slate-700">
          {getPortalProfileLabel(
            (row.portalProfile as Parameters<typeof getPortalProfileLabel>[0]) ??
              "personalizado",
          )}
        </td>
        <td className="px-4 py-3">
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Activo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              Inactivo
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-800">{pathLabel}</td>
        <td
          suppressHydrationWarning
          className="px-4 py-3 text-xs text-slate-500"
        >
          {formatRelativeTime(row.lastActivityAt)}
        </td>
        <td className="hidden px-4 py-3 font-mono text-xs text-slate-600 md:table-cell">
          {row.ip ?? "—"}
        </td>
        <td className="hidden px-4 py-3 text-xs text-slate-600 lg:table-cell">
          {formatUserAgentLabel(row.userAgent)}
        </td>
        <td
          suppressHydrationWarning
          className="hidden px-4 py-3 text-xs text-slate-500 xl:table-cell"
        >
          {formatAbsoluteDateTime(row.sessionStartedAt)}
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-slate-900">
      <AppTopBar backHref="/admin/usuarios/accesos" backLabel="Volver a accesos" />
      <div className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[min(100%,80rem)] flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-600/25">
                <Radio className="h-6 w-6" strokeWidth={2} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Administración <span className="text-slate-400">●</span>{" "}
                  {APP_VERSION_LABEL}
                </p>
                <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Quién está en línea
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                  Sesiones abiertas en el portal. «Activo» = actividad en los
                  últimos 10 minutos (heartbeat).
                </p>
                <Link
                  href="/admin/usuarios/accesos"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 transition hover:text-sky-700 hover:underline"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Volver a accesos
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

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                Activos ahora
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-900">
                {loading ? "—" : activeNow}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Sesiones abiertas
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
                {loading ? "—" : sessions.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Actualización
              </p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <Activity className="h-4 w-4 text-indigo-600" />
                Cada {REFRESH_MS / 1000}s
              </p>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {error}
            </div>
          ) : null}

          <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
              <h2 className="text-base font-bold text-slate-900">
                Sesiones con actividad reciente
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {loading
                  ? "Cargando…"
                  : `${activeNow} usuario(s) con actividad en los últimos 10 min.`}
              </p>
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex min-h-[200px] items-center justify-center py-12">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">
                  No hay sesiones abiertas en este momento.
                </p>
              ) : (
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Usuario</th>
                      <th className="px-4 py-3">Sede</th>
                      <th className="px-4 py-3">Perfil</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Tablero actual</th>
                      <th className="px-4 py-3">Última actividad</th>
                      <th className="hidden px-4 py-3 md:table-cell">IP</th>
                      <th className="hidden px-4 py-3 lg:table-cell">Dispositivo</th>
                      <th className="hidden px-4 py-3 xl:table-cell">
                        Sesión desde
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions
                      .filter(
                        (row) =>
                          presenceNow -
                            new Date(row.lastActivityAt).getTime() <=
                          PRESENCE_ACTIVE_MS,
                      )
                      .map((row) => renderRow(row, true))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {!loading && idleSessions.length > 0 ? (
            <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
                <h2 className="text-base font-bold text-slate-900">
                  Sesiones abiertas sin actividad reciente
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Cookie de sesión vigente, pero sin heartbeat en los últimos 10
                  minutos.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {idleSessions.map((row) => renderRow(row, false))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
