"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import {
  inasistenciaHorasFromUnidades,
  inasistenciaPersonasFromUnidades,
} from "@/lib/proveedores/inasistencia";
import type {
  ProveedorVentasMetrics,
  ProveedorVentasRow,
} from "@/lib/proveedores/ventas-repo";

const money = (value: number) =>
  `$ ${(value / 1_000_000).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;

const units = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 1 });

const people = (value: number) =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const hours = (value: number) =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

type SortDir = "asc" | "desc";
type SortKey = "proveedor" | "unidades" | "horas" | "personas" | "ventaNeta";

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

export function ProveedoresInasistenciaPanel() {
  const [days, setDays] = useState(30);
  const [sede, setSede] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ProveedorVentasMetrics | null>(null);
  const [rows, setRows] = useState<ProveedorVentasRow[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "personas",
    dir: "desc",
  });

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
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setMetrics(data.metrics ?? null);
      setRows(data.rows ?? []);
    } catch (err) {
      setMetrics(null);
      setRows([]);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [days, q, sede]);

  useEffect(() => {
    void load();
  }, [load]);

  const withInasistencia = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        horas: inasistenciaHorasFromUnidades(row.unidades),
        personas: inasistenciaPersonasFromUnidades(row.unidades),
      })),
    [rows],
  );

  const totals = useMemo(() => {
    const unidades = metrics?.unidadesTotal ?? 0;
    return {
      horas: inasistenciaHorasFromUnidades(unidades),
      personas: inasistenciaPersonasFromUnidades(unidades),
      ventaNeta: metrics?.ventaNetaTotal ?? 0,
    };
  }, [metrics]);

  const sorted = useMemo(() => {
    const list = [...withInasistencia];
    const mul = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "proveedor") {
        return a.proveedor.localeCompare(b.proveedor, "es") * mul;
      }
      if (sort.key === "unidades") return (a.unidades - b.unidades) * mul;
      if (sort.key === "horas") return (a.horas - b.horas) * mul;
      if (sort.key === "ventaNeta") return (a.ventaNeta - b.ventaNeta) * mul;
      return (a.personas - b.personas) * mul;
    });
    return list;
  }, [sort, withInasistencia]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "proveedor" ? "asc" : "desc" },
    );
  };

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      days: String(days),
    });
    if (sede) params.set("sede", sede);
    if (q.trim()) params.set("q", q.trim());
    window.open(`/api/proveedores/ventas?${params.toString()}`, "_blank");
  };

  const SortBtn = ({
    label,
    k,
    align = "left",
  }: {
    label: string;
    k: SortKey;
    align?: "left" | "right";
  }) => (
    <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2">
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex w-full items-center gap-1 font-bold uppercase tracking-wide ${
          align === "right" ? "justify-end" : "justify-start"
        } ${sort.key === k ? "text-sky-800" : "text-slate-500 hover:text-slate-800"}`}
      >
        {label}
        <span className="tabular-nums text-[9px] opacity-80" aria-hidden>
          {sort.key === k ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );

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
        <p className="mt-3 text-[11px] text-slate-500">
          Inasistencia = personas-mes para surtir la venta: unidades ÷ 350
          (horas) ÷ 7 (jornada) ÷ 30 (días). Valor = venta neta del proveedor
          (visual ÷ 1.000.000). Ventana de 30 días = lectura mensual.
        </p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {metrics ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Unidades"
            value={units(metrics.unidadesTotal)}
            hint={`${metrics.proveedores} proveedores`}
          />
          <MetricCard
            label="Horas surtido"
            value={hours(totals.horas)}
            hint="Unidades ÷ 350"
          />
          <MetricCard
            label="Inasistencia"
            value={people(totals.personas)}
            hint="Personas-mes (÷ 7 ÷ 30)"
          />
          <MetricCard
            label="Valor"
            value={money(totals.ventaNeta)}
            hint="Venta neta · visual / 1.000.000"
          />
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
          Inasistencia por proveedor
        </div>
        <div className="max-h-[min(70vh,52rem)] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr>
                <SortBtn label="Proveedor" k="proveedor" />
                <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 text-left font-bold uppercase tracking-wide text-slate-500">
                  Código
                </th>
                <SortBtn label="Unidades" k="unidades" align="right" />
                <SortBtn label="Horas" k="horas" align="right" />
                <SortBtn label="Inasistencia" k="personas" align="right" />
                <SortBtn label="Valor" k="ventaNeta" align="right" />
              </tr>
            </thead>
            <tbody>
              {loading && sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Calculando inasistencia…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Sin ventas de proveedor en la ventana.
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {hours(row.horas)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {people(row.personas)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {money(row.ventaNeta)}
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
