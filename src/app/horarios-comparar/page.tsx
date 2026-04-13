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
    case "solo_plan":
      return "Solo plan";
    case "solo_marcacion":
      return "Solo marcacion";
    case "ninguno":
      return "—";
  }
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
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
      if (payload.meta?.sedes) {
        setSedes(payload.meta.sedes);
        setDefaultSede(payload.meta.defaultSede ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido.");
      setRows([]);
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

  const counts = useMemo(() => {
    let cumplio = 0;
    let soloPlan = 0;
    let soloMarcacion = 0;
    let ninguno = 0;
    for (const r of rows) {
      if (r.status === "cumplio") cumplio += 1;
      else if (r.status === "solo_plan") soloPlan += 1;
      else if (r.status === "solo_marcacion") soloMarcacion += 1;
      else ninguno += 1;
    }
    return { cumplio, soloPlan, soloMarcacion, ninguno, total: rows.length };
  }, [rows]);

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

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
          <span>
            Registros: <strong className="text-slate-900">{counts.total}</strong>
          </span>
          <span>
            Cumplió: <strong className="text-emerald-700">{counts.cumplio}</strong>
          </span>
          <span>
            Solo plan: <strong className="text-amber-700">{counts.soloPlan}</strong>
          </span>
          <span>
            Solo marcacion: <strong className="text-sky-700">{counts.soloMarcacion}</strong>
          </span>
          <span>
            —: <strong className="text-slate-500">{counts.ninguno}</strong>
          </span>
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
              ) : (
                rows.map((r, idx) => {
                  const rowTint = idx % 2 === 0 ? "bg-white" : "bg-slate-50/80";
                  return (
                  <tr
                    key={`${r.workedDate}-${r.sede}-${r.employeeName}-${r.planillaId}-${idx}`}
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
                      {r.status === "ninguno" ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            r.status === "solo_plan"
                              ? "bg-amber-100 text-amber-800"
                              : r.status === "solo_marcacion"
                                ? "bg-sky-100 text-sky-800"
                                : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {statusLabel(r.status)}
                        </span>
                      )}
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
          Diferencia = asistencia menos planilla. Hasta 59 min se muestra en minutos; desde 60 min en
          horas y minutos (ej. +1h 5m). Positivo indica marcacion mas tarde que lo planificado en ese
          punto. Emparejamiento por nombre normalizado, sede y fecha.
        </p>
      </div>
    </div>
  );
}
