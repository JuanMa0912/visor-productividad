"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import type {
  ProveedorVentasByDay,
  ProveedorVentasBySede,
  ProveedorVentasMetrics,
  ProveedorVentasRow,
} from "@/lib/proveedores/ventas-repo";

/** Solo visual: quita 6 ceros (÷ 1.000.000), igual que productividad / rotación. */
const money = (value: number) =>
  `$ ${(value / 1_000_000).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;

const units = (value: number) =>
  value.toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  });


const shortLabel = (value: string, max = 20) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const shortDay = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
};

type SortDir = "asc" | "desc";

type SedeSortKey = "sede" | "proveedores" | "unidades" | "ventaNeta";
type ProvSortKey =
  | "proveedor"
  | "codigo"
  | "unidades"
  | "ventaNeta"
  | "ventaConImpuesto"
  | "sedesActivas";

const ChartCard = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="mb-2">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
    {children}
  </div>
);

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
  sticky = false,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onClick: () => void;
  sticky?: boolean;
}) => (
  <th
    className={`px-3 py-2 ${sticky ? "sticky top-0 z-20 bg-slate-50" : ""}`}
  >
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
  const [byDay, setByDay] = useState<ProveedorVentasByDay[]>([]);
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
        byDay?: ProveedorVentasByDay[];
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setMetrics(data.metrics ?? null);
      setRows(data.rows ?? []);
      setBySede(data.bySede ?? []);
      setByDay(data.byDay ?? []);
    } catch (err) {
      setMetrics(null);
      setRows([]);
      setBySede([]);
      setByDay([]);
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

  const chartBySede = useMemo(() => {
    return [...bySede]
      .sort((a, b) => b.ventaNeta - a.ventaNeta)
      .slice(0, 12);
  }, [bySede]);

  const chartTopProveedores = useMemo(() => {
    return [...rows]
      .sort((a, b) => b.ventaNeta - a.ventaNeta)
      .slice(0, 10);
  }, [rows]);

  const concentrationPie = useMemo(() => {
    if (!metrics?.ventaNetaTotal || metrics.top10SharePct == null) return [];
    const top1Pct = metrics.top1SharePct ?? 0;
    const top10Pct = metrics.top10SharePct;
    const midPct = Math.max(0, Math.round((top10Pct - top1Pct) * 10) / 10);
    const restoPct = Math.max(0, Math.round((100 - top10Pct) * 10) / 10);
    return [
      { id: 0, value: top1Pct, label: `Top 1 (${top1Pct}%)` },
      { id: 1, value: midPct, label: `Top 2–10 (${midPct}%)` },
      { id: 2, value: restoPct, label: `Resto (${restoPct}%)` },
    ].filter((slice) => slice.value > 0);
  }, [metrics]);

  const dayLabels = useMemo(
    () => byDay.map((d) => shortDay(d.fecha)),
    [byDay],
  );
  const dayVenta = useMemo(
    () => byDay.map((d) => d.ventaNeta / 1_000_000),
    [byDay],
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
        {metrics?.fechaInicio && metrics.fechaFin ? (
          <p className="mt-3 text-[11px] text-slate-500">
            Ventana de datos: {metrics.fechaInicio} → {metrics.fechaFin} (
            {metrics.dias} días, anclada al último día con venta en la tabla).
            Venta neta = <span className="font-mono">venta_base</span>. Montos
            en pantalla ÷ 1.000.000 (CSV sin recorte).
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
            hint="Sin IVA · visual / 1.000.000"
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

      {chartBySede.length > 0 ||
      chartTopProveedores.length > 0 ||
      concentrationPie.length > 0 ||
      byDay.length > 0 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {chartBySede.length > 0 ? (
            <ChartCard
              title="Venta neta por sede"
              hint="Barras ordenadas de mayor a menor (venta_base / 1.000.000)"
            >
              <BarChart
                layout="horizontal"
                height={Math.max(280, chartBySede.length * 28)}
                margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                yAxis={[
                  {
                    data: chartBySede.map((r) => r.sede),
                    scaleType: "band",
                    width: 88,
                  },
                ]}
                series={[
                  {
                    data: chartBySede.map((r) => r.ventaNeta / 1_000_000),
                    label: "Venta neta",
                    color: "#0369a1",
                    valueFormatter: (v) =>
                      v == null
                        ? "—"
                        : `$ ${v.toLocaleString("es-CO", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}`,
                  },
                ]}
                grid={{ vertical: true }}
              />
            </ChartCard>
          ) : null}

          {chartTopProveedores.length > 0 ? (
            <ChartCard
              title="Top 10 proveedores"
              hint="Mayor venta neta en la ventana filtrada"
            >
              <BarChart
                layout="horizontal"
                height={Math.max(280, chartTopProveedores.length * 28)}
                margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                yAxis={[
                  {
                    data: chartTopProveedores.map((r) =>
                      shortLabel(r.proveedor, 22),
                    ),
                    scaleType: "band",
                    width: 120,
                  },
                ]}
                series={[
                  {
                    data: chartTopProveedores.map((r) => r.ventaNeta / 1_000_000),
                    label: "Venta neta",
                    color: "#0f766e",
                    valueFormatter: (v) =>
                      v == null
                        ? "—"
                        : `$ ${v.toLocaleString("es-CO", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}`,
                  },
                ]}
                grid={{ vertical: true }}
              />
            </ChartCard>
          ) : null}

          {byDay.length > 1 ? (
            <ChartCard
              title="Venta neta por día"
              hint="Evolución diaria en la ventana"
            >
              <LineChart
                height={280}
                margin={{ left: 8, right: 12, top: 16, bottom: 8 }}
                xAxis={[
                  {
                    data: dayLabels,
                    scaleType: "point",
                    tickLabelStyle: { fontSize: 10 },
                  },
                ]}
                series={[
                  {
                    data: dayVenta,
                    label: "Venta neta",
                    color: "#1d4ed8",
                    showMark: dayLabels.length <= 14,
                    valueFormatter: (v) =>
                      v == null
                        ? "—"
                        : `$ ${v.toLocaleString("es-CO", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}`,
                  },
                ]}
                grid={{ horizontal: true }}
              />
            </ChartCard>
          ) : null}

          {concentrationPie.length > 0 ? (
            <ChartCard
              title="Concentración de venta"
              hint="Participación Top 1 / Top 10 / resto"
            >
              <PieChart
                height={280}
                margin={{ top: 8, bottom: 8, left: 8, right: 8 }}
                series={[
                  {
                    data: concentrationPie,
                    innerRadius: 48,
                    outerRadius: 90,
                    paddingAngle: 2,
                    cornerRadius: 4,
                    valueFormatter: (item) =>
                      `${Number(item.value).toLocaleString("es-CO")}%`,
                  },
                ]}
                slotProps={{
                  legend: {
                    direction: "horizontal",
                    position: { vertical: "bottom", horizontal: "center" },
                  },
                }}
              />
            </ChartCard>
          ) : null}

          {chartBySede.length > 0 ? (
            <ChartCard
              title="Proveedores activos por sede"
              hint="Cantidad de proveedores con venta en la ventana"
            >
              <BarChart
                height={280}
                margin={{ left: 8, right: 8, top: 16, bottom: 8 }}
                xAxis={[
                  {
                    data: chartBySede.map((r) => r.sede),
                    scaleType: "band",
                    tickLabelStyle: { fontSize: 10, angle: -25 },
                    height: 56,
                  },
                ]}
                series={[
                  {
                    data: chartBySede.map((r) => r.proveedores),
                    label: "Proveedores",
                    color: "#475569",
                    valueFormatter: (v) =>
                      v == null ? "—" : v.toLocaleString("es-CO"),
                  },
                ]}
                grid={{ horizontal: true }}
              />
            </ChartCard>
          ) : null}
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
        <div className="max-h-[min(70vh,52rem)] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr>
                <SortTh
                  sticky
                  label="Proveedor"
                  active={provSort.key === "proveedor"}
                  dir={provSort.dir}
                  onClick={() => toggleProvSort("proveedor")}
                />
                <SortTh
                  sticky
                  label="Código"
                  active={provSort.key === "codigo"}
                  dir={provSort.dir}
                  onClick={() => toggleProvSort("codigo")}
                />
                <SortTh
                  sticky
                  label="Unidades"
                  active={provSort.key === "unidades"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("unidades")}
                />
                <SortTh
                  sticky
                  label="Venta neta"
                  active={provSort.key === "ventaNeta"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("ventaNeta")}
                />
                <SortTh
                  sticky
                  label="Venta + IVA"
                  active={provSort.key === "ventaConImpuesto"}
                  dir={provSort.dir}
                  align="right"
                  onClick={() => toggleProvSort("ventaConImpuesto")}
                />
                <SortTh
                  sticky
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
