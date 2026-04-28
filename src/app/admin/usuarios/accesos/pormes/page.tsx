"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, LayoutGrid, LogOut, Search, Sparkles } from "lucide-react";

const APP_VERSION_LABEL = "UAID V4.0";
const USER_FILTER_DEBOUNCE_MS = 400;

type MonthlyUserAccessRow = {
  user_id: string;
  username: string;
  days_count: number;
};

const getInitialMonthKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

export default function AdminUsuariosAccesosPorMesPage() {
  const router = useRouter();
  const [monthKey, setMonthKey] = useState(() => getInitialMonthKey());
  const [userInput, setUserInput] = useState("");
  const [debouncedUser, setDebouncedUser] = useState("");
  const [monthlyUsers, setMonthlyUsers] = useState<MonthlyUserAccessRow[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedUser(userInput.trim());
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

  const fetchMonthlySummary = useCallback(async () => {
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const params = new URLSearchParams({
        summary: "monthly_days",
        month: monthKey,
      });
      if (debouncedUser) params.set("user", debouncedUser);
      const res = await fetch(`/api/admin/login-logs?${params.toString()}`);
      if (handleAuthFailure(res.status)) return;
      if (!res.ok) {
        throw new Error("No se pudo cargar el resumen mensual de accesos.");
      }
      const data = (await res.json()) as { users?: MonthlyUserAccessRow[] };
      setMonthlyUsers(data.users ?? []);
    } catch (err) {
      setMonthlyError(
        err instanceof Error ? err.message : "Error inesperado en resumen mensual.",
      );
      setMonthlyUsers([]);
    } finally {
      setMonthlyLoading(false);
    }
  }, [debouncedUser, handleAuthFailure, monthKey]);

  useEffect(() => {
    void fetchMonthlySummary();
  }, [fetchMonthlySummary]);

  const monthLabel = useMemo(() => {
    const dt = new Date(`${monthKey}-01T00:00:00`);
    if (Number.isNaN(dt.getTime())) return monthKey;
    return new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
    }).format(dt);
  }, [monthKey]);

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
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-600 to-emerald-700 text-white shadow-lg shadow-emerald-600/25">
              <Sparkles className="h-6 w-6" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Administración <span className="text-slate-400">●</span>{" "}
                {APP_VERSION_LABEL}
              </p>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Usuarios / accesos por mes
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                Cada usuario suma un día por fecha con ingreso dentro del mes
                seleccionado (máximo 31 por usuario).
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

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.12)]">
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-44 flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Mes
                </span>
                <input
                  type="month"
                  value={monthKey}
                  onChange={(e) => setMonthKey(e.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <label className="flex min-w-48 flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Mes seleccionado: <span className="font-semibold">{monthLabel}</span>
            </p>
          </div>

          {monthlyError && (
            <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:mx-6">
              {monthlyError}
            </div>
          )}
          <div className="overflow-x-auto">
            {monthlyLoading ? (
              <div className="flex min-h-[180px] items-center justify-center py-10">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
                  <p className="text-sm font-medium">Cargando resumen mensual…</p>
                </div>
              </div>
            ) : monthlyUsers.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                Sin usuarios con accesos en el mes seleccionado.
              </p>
            ) : (
              <table className="w-full min-w-[460px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="w-14 px-4 py-3 sm:px-6">#</th>
                    <th className="px-4 py-3 sm:px-6">Usuario</th>
                    <th className="px-4 py-3 text-right sm:px-6">Días del mes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlyUsers.map((user, idx) => (
                    <tr key={`${user.user_id}-${user.username}`}>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-500 sm:px-6">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 sm:px-6">
                        {user.username}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700 sm:px-6">
                        {Math.min(31, Math.max(0, user.days_count))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
