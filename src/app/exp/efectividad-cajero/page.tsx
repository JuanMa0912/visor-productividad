"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import {
  buildCashierEffectivenessRows,
  CAJERO_CONTRACT_WEEKLY_HOURS,
  formatMinuteOfDay,
} from "@/lib/efectividad-cajero/metrics";
import { BRANCH_LOCATIONS } from "@/lib/shared/constants";
import type { HourlyAnalysisData } from "@/types";

/** Sedes cableadas en análisis horario (sin Dinastía / plantas). */
const EFECTIVIDAD_SEDES = BRANCH_LOCATIONS.filter(
  (name) =>
    ![
      "Dinastia 1 Santa Elena",
      "Dinastia 2 CR Primera",
    ].includes(name),
);

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const hoursLabel = (value: number) =>
  `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} h`;

const toISODate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const defaultRange = () => {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: toISODate(start), end: toISODate(end) };
};

export default function ExpEfectividadCajeroPage() {
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const initial = useMemo(() => defaultRange(), []);
  const [dateStart, setDateStart] = useState(initial.start);
  const [dateEnd, setDateEnd] = useState(initial.end);
  const [sede, setSede] = useState(EFECTIVIDAD_SEDES[0] ?? "Floresta");
  const [bucketMinutes, setBucketMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<HourlyAnalysisData["personContributions"]>(
    [],
  );

  const load = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date: dateEnd,
        includePeople: "1",
        peopleDateStart: dateStart,
        peopleDateEnd: dateEnd,
        line: "cajas",
        bucketMinutes: String(bucketMinutes),
        sede,
      });
      const response = await fetch(`/api/hourly-analysis?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as HourlyAnalysisData & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar el análisis.");
      }
      setPeople(data.personContributions ?? []);
    } catch (err) {
      setPeople([]);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [bucketMinutes, dateEnd, dateStart, sede]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    void load();
  }, [status, isAdmin, load]);

  const rows = useMemo(
    () => buildCashierEffectivenessRows(people, bucketMinutes),
    [people, bucketMinutes],
  );

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-900">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Experimental · no está en el menú
          </span>
          <Link
            href="/secciones"
            className="text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
          >
            Volver a secciones
          </Link>
        </div>

        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Efectividad de cajero
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Compara horas con facturas reales (`hora_final_hora` en ventas cajas)
          contra horas marcadas en asistencia (entrada / almuerzo / salida).
          Contrato de referencia: {CAJERO_CONTRACT_WEEKLY_HOURS} h/semana.
        </p>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Desde
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Hasta
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Sede
              <select
                value={sede}
                onChange={(e) => setSede(e.target.value)}
                className="mt-1 block h-9 min-w-40 rounded-lg border border-slate-200 px-3 text-sm"
              >
                {EFECTIVIDAD_SEDES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Franja
              <select
                value={bucketMinutes}
                onChange={(e) => setBucketMinutes(Number(e.target.value))}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-snug text-slate-500">
            % efectividad = horas con venta ÷ horas marcadas. Una franja cuenta
            si hubo ≥1 factura del cajero en ese intervalo.
          </p>
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Cajero</th>
                  <th className="px-3 py-2.5 text-right">Venta</th>
                  <th className="px-3 py-2.5 text-right">Horas marca</th>
                  <th className="px-3 py-2.5 text-right">Horas c/venta</th>
                  <th className="px-3 py-2.5 text-right">% efect.</th>
                  <th className="px-3 py-2.5 text-right">vs 42h sem</th>
                  <th className="px-3 py-2.5 text-right">1ª / últ. factura</th>
                  <th className="px-3 py-2.5 text-right">Días</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Cargando cajeros…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Sin datos para el rango / sede.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.personKey}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {row.personName}
                        </div>
                        {row.personId ? (
                          <div className="text-[11px] text-slate-400">
                            {row.personId}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {money(row.sales)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {hoursLabel(row.markedHours)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-cyan-800">
                        {hoursLabel(row.productiveHours)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {row.effectivenessPct == null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={
                              row.effectivenessPct >= 70
                                ? "font-bold text-emerald-700"
                                : row.effectivenessPct >= 45
                                  ? "font-bold text-amber-700"
                                  : "font-bold text-rose-700"
                            }
                          >
                            {row.effectivenessPct.toLocaleString("es-CO", {
                              maximumFractionDigits: 1,
                            })}
                            %
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {hoursLabel(row.productiveHours)} /{" "}
                        {row.contractWeeklyHours}h
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {formatMinuteOfDay(row.firstSaleMinute)} –{" "}
                        {formatMinuteOfDay(row.lastSaleMinute)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {row.daysWithSales}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
