"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";
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

type SortDir = "asc" | "desc";

type SedeSortKey = "sede" | "proveedores" | "unidades" | "ventaNeta";
type ProvSortKey =
  | "proveedor"
  | "codigo"
  | "unidades"
  | "ventaNeta"
  | "ventaConImpuesto"
  | "sedesActivas";

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

const SortTh = ({
  label,
  active,
  dir,
  align = "left",
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onClick: () => void;
}) => (
  <th className="px-3 py-2">
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-full items-center gap-1 font-bold uppercase tracking-wide ${
        align === "right" ? "justify-end" : "justify-start"
      } ${active ? "text-sky-800" : "text-slate-500 hover:text-slate-800"}`}
    >
      {label}
      <span className="tabular-nums text-[9px] opacity-80" aria-hidden>
        {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  </th>
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
  const [sedeSort, setSedeSort] = useState<{ key: SedeSortKey; dir: SortDir }>({
    key: "sede",
    dir: "asc",
  });
  const [provSort, setProvSort] = useState<{ key: ProvSortKey; dir: SortDir }>({
    key: "ventaNeta",
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

  const toggleSedeSort = (key: SedeSortKey) => {
    setSedeSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir: key === "sede" ? "asc" : "desc",
          },
    );
  };

  const toggleProvSort = (key: ProvSortKey) => {
    setProvSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir: key === "proveedor" || key === "codigo" ? "asc" : "desc",
          },
    );
  };

  const sortedBySede = useMemo(() => {
    const list = [...bySede];
    const mul = sedeSort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sedeSort.key === "sede") {
        const ia = getSedeOrderIndexForRawName(a.sede);
        const ib = getSedeOrderIndexForRawName(b.sede);
        if (ia !== ib) return (ia - ib) * mul;
        return a.sede.localeCompare(b.sede, "es") * mul;
      }
      if (sedeSort.key === "proveedores") {
        return (a.proveedores - b.proveedores) * mul;
      }
      if (sedeSort.key === "unidades") {
        return (a.unidades - b.unidades) * mul;
      }
      return (a.ventaNeta - b.ventaNeta) * mul;
    });
    return list;
  }, [bySede, sedeSort]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const mul = provSort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (provSort.key === "proveedor") {
        return a.proveedor.localeCompare(b.proveedor, "es") * mul;
      }
      if (provSort.key === "codigo") {
        return (a.codigo ?? "").localeCompare(b.codigo ?? "", "es") * mul;
      }
      if (provSort.key === "unidades") {
        return (a.unidades - b.unidades) * mul;
      }
      if (provSort.key === "ventaConImpuesto") {
        return (a.ventaConImpuesto - b.ventaConImpuesto) * mul;
      }
      if (provSort.key === "sedesActivas") {
        return (a.sedesActivas - b.sedesActivas) * mul;
      }
      return (a.ventaNeta - b.ventaNeta) * mul;
    });
    return list;
  }, [provSort, rows]);

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

      {sortedBySede.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Venta neta por sede
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px]">
                <tr>
                  <SortTh
                    label="Sede"
                    active={sedeSort.key === "sede"}
                    dir={sedeSort.dir}
                    onClick={() => toggleSedeSort("sede")}
                  />
                  <SortTh
                    label="Proveedores"
                    active={sedeSort.key === "proveedores"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("proveedores")}
                  />
                  <SortTh
                    label="Unidades"
                    active={sedeSort.key === "unidades"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("unidades")}
                  />
                  <SortTh
                    label="Venta neta"
                    active={sedeSort.key === "ventaNeta"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("ventaNeta")}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedBySede.map((row) => (
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
            <thead className="bg-slate-50 text-[10px]">
              <tr>
                <SortTh
                  label="Proveedor"
                  active={provSort.key === "proveedor"}
                  dir={provSort.dir}
                  onClick={() => toggleProvSort("proveedor")}
                />
                <SortTh
                  label="Código"
                  active={provSort.key === "codigo"}
                  dir={provSort.dir}
                  onClick={() => toggleProvSort("codigo")}
                />
                <SortTh
                  label="Unidades"
                  active={provSort.key === "unidades"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("unidades")}
                />
                <SortTh
                  label="Venta neta"
                  active={provSort.key === "ventaNeta"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("ventaNeta")}
                />
                <SortTh
                  label="Venta + IVA"
                  active={provSort.key === "ventaConImpuesto"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("ventaConImpuesto")}
                />
                <SortTh
                  label="Sedes"
                  active={provSort.key === "sedesActivas"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("sedesActivas")}
                />
              </tr>
            </thead>
            <tbody>
              {loading && sortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Cargando ventas…
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    Sin ventas de proveedor en la ventana.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => (
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
