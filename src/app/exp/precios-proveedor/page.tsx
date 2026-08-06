"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import type {
  PreciosProveedorMatrix,
  PreciosProveedorMeta,
  PreciosProveedorMetric,
} from "@/lib/exp-precios-proveedor/types";

const heatStyle = (pct: number) => {
  if (!Number.isFinite(pct) || pct <= 0) {
    return { background: "#f1f5f9", color: "#94a3b8" };
  }
  const t = Math.max(0, Math.min(1, pct / 30));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(198 + (234 - 198) * u);
    g = Math.round(40 + (179 - 40) * u);
    b = Math.round(56 + (8 - 56) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(234 + (14 - 234) * u);
    g = Math.round(179 + (138 - 179) * u);
    b = Math.round(8 + (77 - 8) * u);
  }
  const alpha = Math.min(0.88, 0.22 + Math.max(t, 1 - t) * 0.35);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const blended = luminance * alpha + (1 - alpha);
  return {
    background: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    color: blended < 0.62 ? "#fff" : "#1e293b",
  };
};

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const unitsFmt = (value: number) =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

const pctFmt = (value: number) =>
  `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

const unitMoney = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

export default function ExpPreciosProveedorPage() {
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();

  const [meta, setMeta] = useState<PreciosProveedorMeta | null>(null);
  const [matrix, setMatrix] = useState<PreciosProveedorMatrix | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [linea, setLinea] = useState("");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [metric, setMetric] = useState<PreciosProveedorMetric>("margenPct");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cellByKey = useMemo(() => {
    const map = new Map<
      string,
      PreciosProveedorMatrix["cells"][number]
    >();
    for (const cell of matrix?.cells ?? []) {
      map.set(`${cell.rowId}::${cell.sedeKey}`, cell);
    }
    return map;
  }, [matrix]);

  const heatScale = useMemo(() => {
    if (!matrix) return { min: 0, max: 1 };
    const values: number[] = [];
    for (const cell of matrix.cells) {
      if (metric === "pvu") values.push(cell.pvu);
      else if (metric === "pcu") values.push(cell.pcu);
      else if (metric === "units") values.push(cell.units);
      else values.push(cell.margenPct);
    }
    const positive = values.filter((v) => Number.isFinite(v) && v > 0);
    if (positive.length === 0) return { min: 0, max: 1 };
    return {
      min: Math.min(...positive),
      max: Math.max(...positive),
    };
  }, [matrix, metric]);

  const loadMeta = useCallback(async () => {
    const res = await fetch("/api/exp/precios-proveedor?mode=meta", {
      cache: "no-store",
    });
    const data = (await res.json()) as {
      meta?: PreciosProveedorMeta;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Error meta");
    if (!data.meta) throw new Error("Meta vacía");
    setMeta(data.meta);
    setDateStart((prev) => prev || data.meta!.defaultStart);
    setDateEnd((prev) => prev || data.meta!.defaultEnd);
  }, []);

  const loadMatrix = useCallback(async () => {
    if (!dateStart || !dateEnd) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        mode: "matrix",
        from: dateStart,
        to: dateEnd,
        limit: "40",
      });
      if (linea) params.set("linea", linea);
      if (searchApplied.trim()) params.set("search", searchApplied.trim());
      const res = await fetch(`/api/exp/precios-proveedor?${params}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        matrix?: PreciosProveedorMatrix;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Error matriz");
      setMatrix(data.matrix ?? null);
    } catch (err) {
      setMatrix(null);
      setError(err instanceof Error ? err.message : "Error cargando");
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, linea, searchApplied]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    void loadMeta().catch((err) =>
      setError(err instanceof Error ? err.message : "Error meta"),
    );
  }, [status, isAdmin, loadMeta]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    if (!dateStart || !dateEnd) return;
    void loadMatrix();
  }, [status, isAdmin, dateStart, dateEnd, linea, searchApplied, loadMatrix]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setSearchApplied("");
      return;
    }
    const timer = window.setTimeout(() => setSearchApplied(trimmed), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando…</p>
      </div>
    );
  }

  const formatCell = (
    cell: PreciosProveedorMatrix["cells"][number] | undefined,
  ) => {
    if (!cell) return "—";
    if (metric === "pvu") return unitMoney(cell.pvu);
    if (metric === "pcu") return unitMoney(cell.pcu);
    if (metric === "units") return unitsFmt(cell.units);
    return pctFmt(cell.margenPct);
  };

  const cellHeatPct = (
    cell: PreciosProveedorMatrix["cells"][number] | undefined,
  ) => {
    if (!cell) return 0;
    const raw =
      metric === "pvu"
        ? cell.pvu
        : metric === "pcu"
          ? cell.pcu
          : metric === "units"
            ? cell.units
            : cell.margenPct;
    if (!(raw > 0)) return 0;
    if (metric === "margenPct") return Math.max(0, Math.min(40, raw));
    const span = heatScale.max - heatScale.min || 1;
    return ((raw - heatScale.min) / span) * 30;
  };

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-900">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Experimental · solo admin · no está en el menú
          </span>
          <Link
            href="/secciones"
            className="text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
          >
            Volver a secciones
          </Link>
        </div>

        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Precios / costos × sede (con proveedor)
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Heatmap de ítems Mercado con PVU, PCU y margen % por sede. El
          proveedor viene del maestro POS (`proveedor_item`), no de la
          factura de compra.
        </p>
        {meta?.note ? (
          <p className="mt-2 max-w-3xl text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {meta.note}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-xs font-semibold text-slate-600">
            Desde
            <input
              type="date"
              value={dateStart}
              min={meta?.minDate ?? undefined}
              max={meta?.maxDate ?? undefined}
              onChange={(e) => setDateStart(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Hasta
            <input
              type="date"
              value={dateEnd}
              min={meta?.minDate ?? undefined}
              max={meta?.maxDate ?? undefined}
              onChange={(e) => setDateEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Línea
            <select
              value={linea}
              onChange={(e) => setLinea(e.target.value)}
              className="mt-1 block min-w-[12rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">Todas (Mercado)</option>
              {(meta?.lineas ?? []).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[14rem] flex-1 text-xs font-semibold text-slate-600">
            Buscar ítem
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Código o descripción…"
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1">
            {(
              [
                ["margenPct", "Margen %"],
                ["pvu", "PVU"],
                ["pcu", "PCU"],
                ["units", "Unidades"],
              ] as Array<[PreciosProveedorMetric, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMetric(key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${
                  metric === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Matriz · ítem × sede
              </h2>
              <p className="text-xs text-slate-500">
                Top {matrix?.itemLimit ?? 40} ítems por venta neta ·{" "}
                {matrix
                  ? `${matrix.elapsedMs} ms servidor · ${matrix.rows.length} filas`
                  : loading
                    ? "cargando…"
                    : "—"}
              </p>
            </div>
          </div>
          <div className="max-h-[min(70vh,820px)] overflow-auto">
            {!matrix || matrix.rows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-500">
                {loading
                  ? "Consultando margen_item_dia_roll…"
                  : "Sin datos para el filtro."}
              </p>
            ) : (
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-50 text-slate-600 shadow-sm">
                    <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-semibold">
                      Ítem · proveedor
                    </th>
                    {matrix.columns.map((col) => (
                      <th
                        key={col.key}
                        className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <th className="sticky left-0 z-10 max-w-[18rem] bg-white px-3 py-2 text-left font-semibold">
                        <div className="truncate text-slate-900" title={row.label}>
                          <span className="tabular-nums text-slate-500">
                            {row.id}
                          </span>
                          <span className="text-slate-400"> · </span>
                          {row.label}
                        </div>
                        <div
                          className="mt-0.5 truncate text-[10px] font-medium text-indigo-700"
                          title={`${row.proveedorId} · ${row.proveedorLabel}`}
                        >
                          {row.proveedorLabel}
                        </div>
                      </th>
                      {matrix.columns.map((col) => {
                        const cell = cellByKey.get(`${row.id}::${col.key}`);
                        const style = heatStyle(cellHeatPct(cell));
                        const title = cell
                          ? `${row.label} · ${col.label}
PVU ${unitMoney(cell.pvu)} · PCU ${unitMoney(cell.pcu)}
Margen ${pctFmt(cell.margenPct)} · ${unitsFmt(cell.units)} und
Venta ${money(cell.sales)} · Costo ${money(cell.cost)}`
                          : "";
                        return (
                          <td key={col.key} className="p-1">
                            <div
                              className="rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                              style={style}
                              title={title}
                            >
                              {formatCell(cell)}
                            </div>
                          </td>
                        );
                      })}
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
