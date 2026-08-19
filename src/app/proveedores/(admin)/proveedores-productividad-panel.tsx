"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { LineChart } from "@mui/x-charts/LineChart";
import type { ProveedorLineaFilter } from "@/lib/proveedores/board-filters";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import { PRODUCTIVIDAD_FAMILIA_META } from "@/lib/proveedores/line-family";
import type {
  ProveedorProductividadByDay,
  ProveedorProductividadBySede,
  ProveedorProductividadMetrics,
  ProveedorProductividadProveedorRow,
} from "@/lib/proveedores/productividad-repo";
import { qtyPerPaidHour } from "@/lib/proveedores/productividad-repo";

const toISODate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const defaultRange = () => {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: toISODate(start), end: toISODate(end) };
};

const qty = (value: number, digits = 1) =>
  value.toLocaleString("es-CO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });

const shortDay = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
};

type SortDir = "asc" | "desc";
type SedeSortKey =
  | "sede"
  | "industria"
  | "fruver"
  | "carnes"
  | "cajas"
  | "industriaPorHora"
  | "fruverPorHora"
  | "carnesPorHora"
  | "cajasPorHora";
type ProvSortKey =
  | "proveedor"
  | "codigo"
  | "industria"
  | "fruver"
  | "carnes"
  | "sedesActivas";
type FamiliaFilter = "todas" | "industria" | "fruver" | "carnes";

const sedeRatio = (
  row: ProveedorProductividadBySede,
  key: Exclude<SedeSortKey, "sede">,
): number => {
  switch (key) {
    case "industriaPorHora":
      return qtyPerPaidHour(row.industria, row.industriaHoras ?? 0);
    case "fruverPorHora":
      return qtyPerPaidHour(row.fruver, row.fruverHoras ?? 0);
    case "carnesPorHora":
      return qtyPerPaidHour(row.carnes, row.carnesHoras ?? 0);
    case "cajasPorHora":
      return qtyPerPaidHour(row.cajas, row.cajasHoras ?? 0);
    default:
      return row[key] ?? 0;
  }
};

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

const SkeletonBlock = ({ className }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-slate-200/80 ${className ?? ""}`} />
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

const heatStyle = (
  value: number,
  max: number,
  rgb: [number, number, number],
): { backgroundColor?: string; color?: string } => {
  if (max <= 0 || value <= 0) return {};
  const t = Math.min(1, value / max);
  const alpha = 0.08 + t * 0.55;
  return {
    backgroundColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`,
    color: t > 0.62 ? "#0f172a" : undefined,
  };
};

const FAMILIA_RGB: Record<
  "industria" | "fruver" | "carnes" | "cajas",
  [number, number, number]
> = {
  industria: [14, 116, 144],
  fruver: [5, 150, 105],
  carnes: [190, 24, 93],
  cajas: [180, 83, 9],
};

export function ProveedoresProductividadPanel({
  linea = "todas",
  lastDataDate = null,
}: {
  linea?: ProveedorLineaFilter;
  lastDataDate?: string | null;
}) {
  const initial = useMemo(() => defaultRange(), []);
  const [dateStart, setDateStart] = useState(initial.start);
  const [dateEnd, setDateEnd] = useState(initial.end);
  const [sede, setSede] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [familia, setFamilia] = useState<FamiliaFilter>("todas");
  const [boardLoading, setBoardLoading] = useState(true);
  const [provLoading, setProvLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ProveedorProductividadMetrics | null>(
    null,
  );
  const [bySede, setBySede] = useState<ProveedorProductividadBySede[]>([]);
  const [byDay, setByDay] = useState<ProveedorProductividadByDay[]>([]);
  const [proveedores, setProveedores] = useState<
    ProveedorProductividadProveedorRow[]
  >([]);
  const [sedeSort, setSedeSort] = useState<{ key: SedeSortKey; dir: SortDir }>({
    key: "sede",
    dir: "asc",
  });
  const [provSort, setProvSort] = useState<{ key: ProvSortKey; dir: SortDir }>({
    key: "industria",
    dir: "desc",
  });
  const boardReqId = useRef(0);
  const provReqId = useRef(0);

  const loadBoard = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      setBoardLoading(false);
      return;
    }
    const reqId = ++boardReqId.current;
    setBoardLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        mode: "board",
        dateStart,
        dateEnd,
      });
      if (sede) params.set("sede", sede);
      const response = await fetch(
        `/api/proveedores/productividad?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        metrics?: ProveedorProductividadMetrics;
        bySede?: ProveedorProductividadBySede[];
        byDay?: ProveedorProductividadByDay[];
      };
      if (reqId !== boardReqId.current) return;
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setMetrics((prev) => ({
        ...(data.metrics ?? emptyMetricsFallback(dateStart, dateEnd)),
        proveedores: prev?.proveedores ?? data.metrics?.proveedores ?? 0,
      }));
      setBySede(data.bySede ?? []);
      setByDay(data.byDay ?? []);
    } catch (err) {
      if (reqId !== boardReqId.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      if (reqId === boardReqId.current) setBoardLoading(false);
    }
  }, [dateEnd, dateStart, sede]);

  const loadProveedores = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setProvLoading(false);
      return;
    }
    const reqId = ++provReqId.current;
    setProvLoading(true);
    try {
      const params = new URLSearchParams({
        mode: "proveedores",
        dateStart,
        dateEnd,
      });
      if (sede) params.set("sede", sede);
      if (qApplied.trim()) params.set("q", qApplied.trim());
      const response = await fetch(
        `/api/proveedores/productividad?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        proveedores?: ProveedorProductividadProveedorRow[];
        metrics?: { proveedores?: number };
      };
      if (reqId !== provReqId.current) return;
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      const rows = data.proveedores ?? [];
      setProveedores(rows);
      setMetrics((prev) =>
        prev
          ? { ...prev, proveedores: data.metrics?.proveedores ?? rows.length }
          : prev,
      );
    } catch {
      if (reqId !== provReqId.current) return;
      // El tablero ya puede estar visible; no tapar KPIs por fallo del ranking.
    } finally {
      if (reqId === provReqId.current) setProvLoading(false);
    }
  }, [dateEnd, dateStart, qApplied, sede]);

  useEffect(() => {
    if (!lastDataDate) return;
    setDateStart(lastDataDate);
    setDateEnd(lastDataDate);
  }, [lastDataDate]);

  useEffect(() => {
    setFamilia(linea);
  }, [linea]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    void loadProveedores();
  }, [loadProveedores]);

  const refreshAll = () => {
    const nextQ = q.trim();
    setQApplied(nextQ);
    void loadBoard();
    // Si qApplied no cambia, el effect de proveedores no corre: forzar.
    if (nextQ === qApplied) void loadProveedores();
  };

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      dateStart,
      dateEnd,
    });
    if (sede) params.set("sede", sede);
    if (qApplied.trim()) params.set("q", qApplied.trim());
    window.open(`/api/proveedores/productividad?${params.toString()}`, "_blank");
  };

  const sedeMax = useMemo(() => {
    const maxOf = (key: Exclude<SedeSortKey, "sede">) =>
      Math.max(0, ...bySede.map((row) => sedeRatio(row, key)));
    return {
      industria: maxOf("industria"),
      fruver: maxOf("fruver"),
      carnes: maxOf("carnes"),
      cajas: maxOf("cajas"),
      industriaPorHora: maxOf("industriaPorHora"),
      fruverPorHora: maxOf("fruverPorHora"),
      carnesPorHora: maxOf("carnesPorHora"),
      cajasPorHora: maxOf("cajasPorHora"),
    };
  }, [bySede]);

  const sortedSedes = useMemo(() => {
    const rows = [...bySede];
    const { key, dir } = sedeSort;
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "sede") return sign * a.sede.localeCompare(b.sede, "es");
      return sign * (sedeRatio(a, key) - sedeRatio(b, key));
    });
    return rows;
  }, [bySede, sedeSort]);

  const filteredProveedores = useMemo(() => {
    if (familia === "todas") return proveedores;
    return proveedores.filter((row) => row[familia] > 0);
  }, [familia, proveedores]);

  const sortedProveedores = useMemo(() => {
    const rows = [...filteredProveedores];
    const { key, dir } = provSort;
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (key === "proveedor") {
        return sign * a.proveedor.localeCompare(b.proveedor, "es");
      }
      if (key === "codigo") {
        return (
          sign *
          String(a.codigo ?? "").localeCompare(String(b.codigo ?? ""), "es")
        );
      }
      return sign * (a[key] - b[key]);
    });
    return rows;
  }, [filteredProveedores, provSort]);

  const toggleSedeSort = (key: SedeSortKey) => {
    setSedeSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "sede" ? "asc" : "desc" },
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

  const dayLabels = byDay.map((row) => shortDay(row.fecha));
  const showBoardEmpty = !boardLoading && bySede.every(
    (row) =>
      row.industria === 0 &&
      row.fruver === 0 &&
      row.carnes === 0 &&
      row.cajas === 0,
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <option value="">Todas</option>
              {PROVEEDORES_QR_SEDES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar proveedor
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setQApplied(q.trim());
                }
              }}
              placeholder="Nombre o código"
              className="mt-1 block h-9 min-w-48 rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={refreshAll}
            className="h-9 rounded-lg bg-sky-700 px-4 text-sm font-bold text-white hover:bg-sky-800"
          >
            Actualizar
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            CSV
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Industria en unidades, Fruver y Carnes en kilos, Cajas en
          transacciones. Productividad = volumen ÷ horas pagadas de asistencia.
          Máximo 31 días. El tablero carga primero; el ranking por proveedor
          sigue en segundo plano.
        </p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {boardLoading && !metrics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-[76px]" />
          ))}
        </div>
      ) : metrics ? (
        <div className={`space-y-3 ${boardLoading ? "opacity-70" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label={`${PRODUCTIVIDAD_FAMILIA_META.industria.label} (${PRODUCTIVIDAD_FAMILIA_META.industria.short})`}
              value={qty(metrics.industria)}
              hint="Unidades vendidas"
            />
            <MetricCard
              label={`${PRODUCTIVIDAD_FAMILIA_META.fruver.label} (${PRODUCTIVIDAD_FAMILIA_META.fruver.short})`}
              value={qty(metrics.fruver)}
              hint="Kilos vendidos"
            />
            <MetricCard
              label={`${PRODUCTIVIDAD_FAMILIA_META.carnes.label} (${PRODUCTIVIDAD_FAMILIA_META.carnes.short})`}
              value={qty(metrics.carnes)}
              hint="Kilos vendidos"
            />
            <MetricCard
              label={`${PRODUCTIVIDAD_FAMILIA_META.cajas.label} (${PRODUCTIVIDAD_FAMILIA_META.cajas.short})`}
              value={qty(metrics.cajas, 0)}
              hint="Transacciones"
            />
            <MetricCard
              label="Proveedores"
              value={
                provLoading && metrics.proveedores === 0
                  ? "…"
                  : qty(metrics.proveedores, 0)
              }
              hint="Con volumen en el recorte"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Industria / h"
              value={qty(
                qtyPerPaidHour(
                  metrics.industria,
                  metrics.industriaHoras ?? 0,
                ),
              )}
              hint={`${qty(metrics.industriaHoras ?? 0)} h pagadas`}
            />
            <MetricCard
              label="Fruver / h"
              value={qty(
                qtyPerPaidHour(metrics.fruver, metrics.fruverHoras ?? 0),
              )}
              hint={`${qty(metrics.fruverHoras ?? 0)} h pagadas`}
            />
            <MetricCard
              label="Carnes / h"
              value={qty(
                qtyPerPaidHour(metrics.carnes, metrics.carnesHoras ?? 0),
              )}
              hint={`${qty(metrics.carnesHoras ?? 0)} h pagadas`}
            />
            <MetricCard
              label="Cajas / h"
              value={qty(
                qtyPerPaidHour(metrics.cajas, metrics.cajasHoras ?? 0),
              )}
              hint={`${qty(metrics.cajasHoras ?? 0)} h pagadas`}
            />
          </div>
        </div>
      ) : null}

      <ChartCard
        title="Por sede"
        hint="Volumen y productividad (volumen ÷ horas pagadas). Heatmap por columna."
      >
        <div className={`overflow-x-auto ${boardLoading ? "opacity-70" : ""}`}>
          {boardLoading && bySede.length === 0 ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px]">
                <tr>
                  <SortTh
                    label="Sede"
                    active={sedeSort.key === "sede"}
                    dir={sedeSort.dir}
                    onClick={() => toggleSedeSort("sede")}
                  />
                  <SortTh
                    label="Industria und"
                    active={sedeSort.key === "industria"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("industria")}
                  />
                  <SortTh
                    label="Ind / h"
                    active={sedeSort.key === "industriaPorHora"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("industriaPorHora")}
                  />
                  <SortTh
                    label="Fruver kg"
                    active={sedeSort.key === "fruver"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("fruver")}
                  />
                  <SortTh
                    label="Fru / h"
                    active={sedeSort.key === "fruverPorHora"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("fruverPorHora")}
                  />
                  <SortTh
                    label="Carnes kg"
                    active={sedeSort.key === "carnes"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("carnes")}
                  />
                  <SortTh
                    label="Car / h"
                    active={sedeSort.key === "carnesPorHora"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("carnesPorHora")}
                  />
                  <SortTh
                    label="Cajas tx"
                    active={sedeSort.key === "cajas"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("cajas")}
                  />
                  <SortTh
                    label="Tx / h"
                    active={sedeSort.key === "cajasPorHora"}
                    dir={sedeSort.dir}
                    align="right"
                    onClick={() => toggleSedeSort("cajasPorHora")}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedSedes.map((row) => {
                  const indH = sedeRatio(row, "industriaPorHora");
                  const fruH = sedeRatio(row, "fruverPorHora");
                  const carH = sedeRatio(row, "carnesPorHora");
                  const cajH = sedeRatio(row, "cajasPorHora");
                  return (
                    <tr key={row.sede} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-800">
                        {row.sede}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          row.industria,
                          sedeMax.industria,
                          FAMILIA_RGB.industria,
                        )}
                      >
                        {qty(row.industria)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          indH,
                          sedeMax.industriaPorHora,
                          FAMILIA_RGB.industria,
                        )}
                      >
                        {qty(indH)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          row.fruver,
                          sedeMax.fruver,
                          FAMILIA_RGB.fruver,
                        )}
                      >
                        {qty(row.fruver)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          fruH,
                          sedeMax.fruverPorHora,
                          FAMILIA_RGB.fruver,
                        )}
                      >
                        {qty(fruH)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          row.carnes,
                          sedeMax.carnes,
                          FAMILIA_RGB.carnes,
                        )}
                      >
                        {qty(row.carnes)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          carH,
                          sedeMax.carnesPorHora,
                          FAMILIA_RGB.carnes,
                        )}
                      >
                        {qty(carH)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          row.cajas,
                          sedeMax.cajas,
                          FAMILIA_RGB.cajas,
                        )}
                      >
                        {qty(row.cajas, 0)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        style={heatStyle(
                          cajH,
                          sedeMax.cajasPorHora,
                          FAMILIA_RGB.cajas,
                        )}
                      >
                        {qty(cajH)}
                      </td>
                    </tr>
                  );
                })}
                {showBoardEmpty ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      Sin datos en el rango.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </ChartCard>

      <ChartCard
        title="Evolución diaria"
        hint="Misma unidad por serie: und / kg / tx."
      >
        {boardLoading && byDay.length === 0 ? (
          <SkeletonBlock className="h-[280px] w-full" />
        ) : byDay.length > 0 ? (
          <div className={boardLoading ? "opacity-70" : ""}>
            <LineChart
              height={280}
              xAxis={[{ scaleType: "point", data: dayLabels }]}
              series={[
                {
                  id: "industria",
                  label: "Industria und",
                  data: byDay.map((r) => r.industria),
                  color: "#0e7490",
                },
                {
                  id: "fruver",
                  label: "Fruver kg",
                  data: byDay.map((r) => r.fruver),
                  color: "#059669",
                },
                {
                  id: "carnes",
                  label: "Carnes kg",
                  data: byDay.map((r) => r.carnes),
                  color: "#be185d",
                },
                {
                  id: "cajas",
                  label: "Cajas tx",
                  data: byDay.map((r) => r.cajas),
                  color: "#b45309",
                },
              ]}
              margin={{ left: 60, right: 16, top: 24, bottom: 32 }}
            />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">
            Sin serie diaria.
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="Productividad diaria (volumen / h)"
        hint="Unidades, kilos o transacciones por hora pagada."
      >
        {boardLoading && byDay.length === 0 ? (
          <SkeletonBlock className="h-[280px] w-full" />
        ) : byDay.length > 0 ? (
          <div className={boardLoading ? "opacity-70" : ""}>
            <LineChart
              height={280}
              xAxis={[{ scaleType: "point", data: dayLabels }]}
              series={[
                {
                  id: "industria_h",
                  label: "Industria / h",
                  data: byDay.map((r) =>
                    qtyPerPaidHour(r.industria, r.industriaHoras ?? 0),
                  ),
                  color: "#0e7490",
                },
                {
                  id: "fruver_h",
                  label: "Fruver / h",
                  data: byDay.map((r) =>
                    qtyPerPaidHour(r.fruver, r.fruverHoras ?? 0),
                  ),
                  color: "#059669",
                },
                {
                  id: "carnes_h",
                  label: "Carnes / h",
                  data: byDay.map((r) =>
                    qtyPerPaidHour(r.carnes, r.carnesHoras ?? 0),
                  ),
                  color: "#be185d",
                },
                {
                  id: "cajas_h",
                  label: "Cajas / h",
                  data: byDay.map((r) =>
                    qtyPerPaidHour(r.cajas, r.cajasHoras ?? 0),
                  ),
                  color: "#b45309",
                },
              ]}
              margin={{ left: 60, right: 16, top: 24, bottom: 32 }}
            />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">
            Sin serie diaria.
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="Por proveedor"
        hint="Volumen del ítem atribuido vía puente proveedor_item. Cajas no aplica."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {(["todas", "industria", "fruver", "carnes"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFamilia(id)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                familia === id
                  ? "bg-sky-700 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {id === "todas" ? "Todas" : PRODUCTIVIDAD_FAMILIA_META[id].label}
            </button>
          ))}
        </div>
        <div
          className={`max-h-[min(70vh,52rem)] overflow-auto ${
            provLoading ? "opacity-70" : ""
          }`}
        >
          {provLoading && proveedores.length === 0 ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 text-[10px] shadow-[0_1px_0_0_rgb(226,232,240)]">
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
                    label="Industria und"
                    active={provSort.key === "industria"}
                    dir={provSort.dir}
                    align="right"
                    onClick={() => toggleProvSort("industria")}
                  />
                  <SortTh
                    sticky
                    label="Fruver kg"
                    active={provSort.key === "fruver"}
                    dir={provSort.dir}
                    align="right"
                    onClick={() => toggleProvSort("fruver")}
                  />
                  <SortTh
                    sticky
                    label="Carnes kg"
                    active={provSort.key === "carnes"}
                    dir={provSort.dir}
                    align="right"
                    onClick={() => toggleProvSort("carnes")}
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
                {sortedProveedores.map((row) => (
                  <tr
                    key={`${row.codigo ?? ""}|${row.proveedor}`}
                    className="border-b border-slate-100"
                  >
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {row.proveedor}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {row.codigo ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qty(row.industria)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qty(row.fruver)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qty(row.carnes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.sedesActivas}
                    </td>
                  </tr>
                ))}
                {!provLoading && sortedProveedores.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      Sin proveedores con volumen en el filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </ChartCard>
    </div>
  );
}

const emptyMetricsFallback = (
  fechaInicio: string,
  fechaFin: string,
): ProveedorProductividadMetrics => ({
  fechaInicio,
  fechaFin,
  dias: 0,
  industria: 0,
  fruver: 0,
  carnes: 0,
  cajas: 0,
  industriaHoras: 0,
  fruverHoras: 0,
  carnesHoras: 0,
  cajasHoras: 0,
  proveedores: 0,
});
