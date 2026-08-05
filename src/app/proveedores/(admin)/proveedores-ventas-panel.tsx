"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import type {
  ProveedorVentasBySede,
  ProveedorVentasMetrics,
  ProveedorVentasRow,
} from "@/lib/proveedores/ventas-repo";

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const units = (value: number) =>
  value.toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  });

const MetricCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-xl font-black tabular-nums text-slate-900 sm:text-2xl">
      {value}
    </div>
    {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
  </div>
);

export function ProveedoresVentasPanel() {
  const [days, setDays] = useState(30);
  const [sede, setSede] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ProveedorVentasMetrics | null>(null);
  const [rows, setRows] = useState<ProveedorVentasRow[]>([]);
  const [bySede, setBySede] = useState<ProveedorVentasBySede[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (sede) params.set("sede", sede);
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(
        `/api/proveedores/ventas?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        metrics?: ProveedorVentasMetrics;
        rows?: ProveedorVentasRow[];
        bySede?: ProveedorVentasBySede[];
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setMetrics(data.metrics ?? null);
      setRows(data.rows ?? []);
      setBySede(data.bySede ?? []);
    } catch (err) {
      setMetrics(null);
      setRows([]);
      setBySede([]);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [days, q, sede]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      days: String(days),
    });
    if (sede) params.set("sede", sede);
    if (q.trim()) params.set("q", q.trim());
    window.open(`/api/proveedores/ventas?${params.toString()}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Ventana
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value={30}>Últimos 30 días</option>
              <option value={7}>Últimos 7 días</option>
              <option value={14}>Últimos 14 días</option>
              <option value={60}>Últimos 60 días</option>
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Sede
            <select
              value={sede}
              onChange={(e) => setSede(e.target.value)}
              className="mt-1 block h-9 min-w-40 rounded-lg border border-slate-200 px-3 text-sm"
            >
              <option value="">Todas</option>
              {PROVEEDORES_QR_SEDES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Proveedor o código"
              className="mt-1 block h-9 min-w-56 rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Cargando…" : "Actualizar"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            CSV
          </button>
        </div>
        {metrics?.fechaInicio && metrics.fechaFin ? (
          <p className="mt-3 text-[11px] text-slate-500">
            Ventana de datos: {metrics.fechaInicio} → {metrics.fechaFin} (
            {metrics.dias} días, anclada al último día con venta en la tabla).
            Venta neta = <span className="font-mono">venta_base</span>.
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {metrics ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Proveedores"
            value={String(metrics.proveedores)}
            hint="Con venta en la ventana"
          />
          <MetricCard
            label="Unidades"
            value={units(metrics.unidadesTotal)}
            hint={`Últimos ${metrics.dias} días`}
          />
          <MetricCard
            label="Venta neta"
            value={money(metrics.ventaNetaTotal)}
            hint="Sin IVA (venta_base)"
          />
          <MetricCard
            label="Venta + IVA"
            value={money(metrics.ventaConImpuestoTotal)}
          />
          <MetricCard
            label="Prom. / proveedor"
            value={
              metrics.ticketPromedioNeta == null
                ? "—"
                : money(metrics.ticketPromedioNeta)
            }
          />
          <MetricCard
            label="Concentración"
            value={
              metrics.top10SharePct == null
                ? "—"
                : `${metrics.top10SharePct.toLocaleString("es-CO")}%`
            }
            hint={
              metrics.top1SharePct == null
                ? "Top 10"
                : `Top 1: ${metrics.top1SharePct}% · Top 10`
            }
          />
        </section>
      ) : null}

      {bySede.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Venta neta por sede
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2 text-right">Proveedores</th>
                  <th className="px-3 py-2 text-right">Unidades</th>
                  <th className="px-3 py-2 text-right">Venta neta</th>
                </tr>
              </thead>
              <tbody>
                {bySede.map((row) => (
                  <tr key={row.sede} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.sede}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.proveedores}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {units(row.unidades)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(row.ventaNeta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          Proveedor · unidades · venta neta
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Proveedor</th>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5 text-right">Unidades</th>
                <th className="px-3 py-2.5 text-right">Venta neta</th>
                <th className="px-3 py-2.5 text-right">Venta + IVA</th>
                <th className="px-3 py-2.5 text-right">Sedes</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Cargando ventas…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Sin ventas de proveedor en la ventana.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.proveedor} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-medium text-slate-800">
                      {row.proveedor}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-500">
                      {row.codigo ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {units(row.unidades)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {money(row.ventaNeta)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {money(row.ventaConImpuesto)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {row.sedesActivas}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
