"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import {
  defaultOipvWeekRange,
  OIPV_WEEKDAY_KEYS,
  type ProveedorOipvBoard,
  type ProveedorOipvRow,
} from "@/lib/proveedores/oipv-repo";

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const qty = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 1 });

const WEEKDAY_LABEL: Record<(typeof OIPV_WEEKDAY_KEYS)[number], string> = {
  L: "L",
  Ma: "M",
  Mi: "M",
  J: "J",
  V: "V",
  S: "S",
  D: "D",
};

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
    <div className="mt-1 text-xl font-black tabular-nums text-slate-900">
      {value}
    </div>
    {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
  </div>
);

export function ProveedoresOipvPanel() {
  const initial = useMemo(() => defaultOipvWeekRange(), []);
  const [dateStart, setDateStart] = useState(initial.dateStart);
  const [dateEnd, setDateEnd] = useState(initial.dateEnd);
  const [sede, setSede] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<ProveedorOipvBoard | null>(null);
  const [onlyNoShow, setOnlyNoShow] = useState(false);

  const load = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateStart, dateEnd });
      if (sede) params.set("sede", sede);
      if (qApplied.trim()) params.set("q", qApplied.trim());
      const response = await fetch(`/api/proveedores/oipv?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as ProveedorOipvBoard & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setBoard(data);
    } catch (err) {
      setBoard(null);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, qApplied, sede]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: ProveedorOipvRow[] = useMemo(() => {
    const all = board?.rows ?? [];
    if (!onlyNoShow) return all;
    return all.filter((r) => !r.asistencia && (r.ventaNeta > 0 || r.unidades > 0));
  }, [board?.rows, onlyNoShow]);

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      dateStart,
      dateEnd,
    });
    if (sede) params.set("sede", sede);
    if (qApplied.trim()) params.set("q", qApplied.trim());
    window.open(`/api/proveedores/oipv?${params.toString()}`, "_blank");
  };

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
            Buscar
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
              placeholder="RS, código o visitante"
              className="mt-1 block h-9 min-w-48 rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 pb-1 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={onlyNoShow}
              onChange={(e) => setOnlyNoShow(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo venta sin visita
          </label>
          <button
            type="button"
            onClick={() => {
              setQApplied(q.trim());
              void load();
            }}
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
          Cruce de marcaciones QR con ventas por código de proveedor. Días L–D
          en hora Bogotá. FT / WS / sugerido / costo OIPV aún no tienen fuente
          en BD.
        </p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {board?.metrics ? (
        <div
          className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${
            loading ? "opacity-70" : ""
          }`}
        >
          <MetricCard
            label="Proveedores"
            value={qty(board.metrics.proveedores)}
            hint="Con visita o venta en el rango"
          />
          <MetricCard
            label="Sin visita"
            value={qty(board.metrics.sinAsistencia)}
            hint="Candidatos OIPV"
          />
          <MetricCard
            label="Con visita"
            value={qty(board.metrics.conAsistencia)}
          />
          <MetricCard
            label="Venta neta"
            value={money(board.metrics.ventaNetaTotal)}
          />
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">RS proveedor</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Proveedor (visitante)</th>
                <th className="px-3 py-2 text-center">Asist.</th>
                {OIPV_WEEKDAY_KEYS.map((k) => (
                  <th key={k} className="px-2 py-2 text-center" title={k}>
                    {WEEKDAY_LABEL[k]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="px-3 py-2 text-right">Venta $$</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                    Cargando…
                  </td>
                </tr>
              ) : null}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-slate-500">
                    Sin filas en el rango.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-slate-100 ${
                    !row.asistencia && row.ventaNeta > 0 ? "bg-amber-50/60" : ""
                  }`}
                >
                  <td className="max-w-[220px] truncate px-3 py-2 font-semibold text-slate-800">
                    {row.rsProveedor}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                    {row.codigo ?? "—"}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-slate-700">
                    {row.visitante ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-slate-800">
                    {row.asistencia ? "X" : ""}
                  </td>
                  {OIPV_WEEKDAY_KEYS.map((k) => (
                    <td
                      key={k}
                      className="px-2 py-2 text-center font-semibold text-slate-700"
                    >
                      {row.weekdays[k] ? "X" : ""}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {qty(row.unidades)}
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
    </div>
  );
}
