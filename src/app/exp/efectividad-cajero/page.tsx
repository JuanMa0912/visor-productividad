"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import {
  CAJERO_CONTRACT_WEEKLY_HOURS,
  DEFAULT_MAX_ACTIVE_GAP_MINUTES,
  type CashierEffectivenessRow,
  type CashierEffectivenessSummary,
  type CashierSignal,
} from "@/lib/efectividad-cajero/metrics";
import { BRANCH_LOCATIONS } from "@/lib/shared/constants";

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

const EFECTIVIDAD_SEDES = BRANCH_LOCATIONS.filter(
  (name) =>
    !["Dinastia 1 Santa Elena", "Dinastia 2 CR Primera"].includes(name),
);

const signalLabel = (signal: CashierSignal): string | null => {
  if (signal === "sin_marca") return "Sin marca";
  if (signal === "baja_efectividad") return "Baja efect.";
  if (signal === "ritmo_denso") return "Ritmo denso";
  return null;
};

const signalClass = (signal: CashierSignal): string => {
  if (signal === "sin_marca") return "border-slate-300 bg-slate-100 text-slate-700";
  if (signal === "baja_efectividad")
    return "border-rose-300 bg-rose-50 text-rose-800";
  if (signal === "ritmo_denso")
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "";
};

export default function ExpEfectividadCajeroPage() {
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const initial = useMemo(() => defaultRange(), []);
  const [dateStart, setDateStart] = useState(initial.start);
  const [dateEnd, setDateEnd] = useState(initial.end);
  const [sede, setSede] = useState(EFECTIVIDAD_SEDES[0] ?? "Floresta");
  const [maxGapMinutes, setMaxGapMinutes] = useState(
    DEFAULT_MAX_ACTIVE_GAP_MINUTES,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CashierEffectivenessRow[]>([]);
  const [summary, setSummary] = useState<CashierEffectivenessSummary | null>(
    null,
  );
  const [ruleSummary, setRuleSummary] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        dateStart,
        dateEnd,
        sede,
        maxGapMinutes: String(maxGapMinutes),
      });
      const response = await fetch(
        `/api/exp/efectividad-cajero?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        rows?: CashierEffectivenessRow[];
        summary?: CashierEffectivenessSummary;
        rule?: { summary?: string };
      };
      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar el experimento.");
      }
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setRuleSummary(data.rule?.summary ?? "");
      setExpanded({});
    } catch (err) {
      setRows([]);
      setSummary(null);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, maxGapMinutes, sede]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    void load();
  }, [status, isAdmin, load]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando…</p>
      </div>
    );
  }

  const colCount = 11;

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6">
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
          Mide si el cajero estuvo en ritmo continuo de facturación. Si entre
          facturas pasan ≤ N minutos (ej. cada 2–5 min), esos minutos cuentan.
          Si hay huecos largos (2–3 ventas aisladas en una hora),{" "}
          <strong>no</strong> se llena la hora: solo suman las brechas cortas.
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
              Brecha máx. continua
              <select
                value={maxGapMinutes}
                onChange={(e) => setMaxGapMinutes(Number(e.target.value))}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
                title="Si pasan más minutos entre dos facturas, ese tramo no cuenta"
              >
                <option value={3}>3 min</option>
                <option value={5}>5 min</option>
                <option value={7}>7 min</option>
                <option value={10}>10 min</option>
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
            {ruleSummary ||
              `% efectividad = horas efectivas (brechas ≤ ${maxGapMinutes} min) ÷ horas marcadas.`}
          </p>
        </section>

        {summary && rows.length > 0 ? (
          <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                % sede
              </div>
              <div className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                {summary.sedeEffectivenessPct == null
                  ? "—"
                  : `${summary.sedeEffectivenessPct.toLocaleString("es-CO", {
                      maximumFractionDigits: 1,
                    })}%`}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {hoursLabel(summary.totalProductiveHours)} efect. /{" "}
                {hoursLabel(summary.totalMarkedHours)} marca
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Cajeros
              </div>
              <div className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                {summary.cashierCount}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {summary.withMarkCount} con marca · {summary.noMarkCount} sin
                marca
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Venta / facturas
              </div>
              <div className="mt-1 text-xl font-black tabular-nums text-slate-900">
                {money(summary.totalSales)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {summary.totalInvoices.toLocaleString("es-CO")} facturas
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Señales
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                  {summary.lowEffectivenessCount} baja efect.
                </span>
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                  {summary.denseRhythmCount} ritmo denso
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Baja = &lt;35% con ≥4 h marca. Denso = brecha media ≤4 min.
              </div>
            </div>
          </section>
        ) : null}

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
                  <th className="px-3 py-2.5 w-8" aria-label="Expandir" />
                  <th className="px-3 py-2.5">Cajero</th>
                  <th className="px-3 py-2.5 text-right">Venta</th>
                  <th className="px-3 py-2.5 text-right">Facturas</th>
                  <th className="px-3 py-2.5 text-right">Horas marca</th>
                  <th className="px-3 py-2.5 text-right">Horas efectivas</th>
                  <th className="px-3 py-2.5 text-right">% efect.</th>
                  <th className="px-3 py-2.5 text-right">Brecha med.</th>
                  <th className="px-3 py-2.5 text-right">Tickets/h</th>
                  <th className="px-3 py-2.5 text-right">Idle ventana</th>
                  <th className="px-3 py-2.5 text-right">Días</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Cargando cajeros…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Sin datos para el rango / sede.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const open = Boolean(expanded[row.personKey]);
                    const label = signalLabel(row.signal);
                    return (
                      <Fragment key={row.personKey}>
                        <tr className="border-t border-slate-100">
                          <td className="px-2 py-2.5">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              aria-expanded={open}
                              aria-label={
                                open ? "Ocultar días" : "Ver desglose por día"
                              }
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [row.personKey]: !prev[row.personKey],
                                }))
                              }
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900">
                              {row.personName}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {row.personId ? (
                                <span className="text-[11px] text-slate-400">
                                  {row.personId}
                                </span>
                              ) : null}
                              {label ? (
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${signalClass(row.signal)}`}
                                >
                                  {label}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                            {money(row.sales)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {row.invoiceCount.toLocaleString("es-CO")}
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
                            {row.avgActiveGapMinutes == null
                              ? "—"
                              : `${row.avgActiveGapMinutes.toLocaleString("es-CO", {
                                  maximumFractionDigits: 1,
                                })} min`}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {row.ticketsPerEffectiveHour == null
                              ? "—"
                              : row.ticketsPerEffectiveHour.toLocaleString(
                                  "es-CO",
                                  { maximumFractionDigits: 1 },
                                )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {hoursLabel(row.idleInSpanHours)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {row.daysWithSales}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-t border-slate-50 bg-slate-50/80">
                            <td colSpan={colCount} className="px-4 py-3">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                Desglose por día · 1ª–últ. periodo:{" "}
                                {row.firstSaleLabel} – {row.lastSaleLabel}
                              </div>
                              <div className="mt-2 overflow-x-auto">
                                <table className="min-w-[520px] text-xs">
                                  <thead className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                                    <tr>
                                      <th className="pr-3 py-1">Fecha</th>
                                      <th className="pr-3 py-1 text-right">
                                        Facturas
                                      </th>
                                      <th className="pr-3 py-1 text-right">
                                        Efectivas
                                      </th>
                                      <th className="pr-3 py-1 text-right">
                                        Brecha med.
                                      </th>
                                      <th className="py-1 text-right">
                                        Idle ventana
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.dayBreakdown.map((day) => (
                                      <tr
                                        key={day.date}
                                        className="border-t border-slate-200/60"
                                      >
                                        <td className="pr-3 py-1.5 font-medium text-slate-700">
                                          {day.date}
                                        </td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums">
                                          {day.invoiceCount}
                                        </td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums text-cyan-800">
                                          {hoursLabel(day.productiveHours)}
                                        </td>
                                        <td className="pr-3 py-1.5 text-right tabular-nums">
                                          {day.avgActiveGapMinutes == null
                                            ? "—"
                                            : `${day.avgActiveGapMinutes} min`}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {hoursLabel(day.idleInSpanHours)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
