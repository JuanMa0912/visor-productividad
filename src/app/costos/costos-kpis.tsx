"use client";

import type {
  PreciosProveedorMatrix,
  PreciosProveedorMetric,
} from "@/lib/exp-precios-proveedor/types";

export type CostosPrevTotals = {
  from: string;
  to: string;
  kilos: number;
  venta: number;
  costoVenta: number;
  costoEntrada: number;
};

/**
 * Todo lo de esta cabecera es PONDERADO por kilos, nunca promedio simple de
 * celdas: mezclar el banano de $2.300 con el lomo de $37.000 a peso igual da una
 * cifra que no representa nada, y es justo la que se cita en una reunión.
 */
export const resumenPonderado = (matrix: PreciosProveedorMatrix | null) => {
  let kilos = 0;
  let venta = 0;
  let costoVenta = 0;
  let entradaValor = 0;
  let entradaKilos = 0;
  let celdasConCosto = 0;

  for (const cell of matrix?.cells ?? []) {
    kilos += cell.units;
    venta += cell.sales;
    costoVenta += cell.costoVenta;
    if (cell.units > 0 && cell.pcu > 0) {
      entradaValor += cell.units * cell.pcu;
      entradaKilos += cell.units;
      celdasConCosto += 1;
    }
  }

  return {
    kilos,
    venta,
    costoVenta,
    celdasConCosto,
    costoEntrada: entradaKilos > 0 ? entradaValor / entradaKilos : 0,
    precioVenta: kilos > 0 ? venta / kilos : 0,
    /** Margen contable: venta contra costo de venta. No es el proyectado del drill. */
    margenPct: venta > 0 ? ((venta - costoVenta) / venta) * 100 : 0,
  };
};

const money = (value: number) =>
  value > 0
    ? `$ ${Math.round(value).toLocaleString("es-CO")}`
    : "—";

const kilosFmt = (value: number) =>
  value > 0 ? `${Math.round(value).toLocaleString("es-CO")} kg` : "—";

const pct = (value: number) =>
  Number.isFinite(value) ? `${value.toFixed(1)} %` : "—";

const deltaPct = (actual: number, anterior: number) =>
  anterior > 0 && actual > 0 ? ((actual - anterior) / anterior) * 100 : null;

/**
 * Un delta puede ser bueno o malo según la métrica: que SUBA el costo de entrada
 * es malo, que suba el margen es bueno. Por eso el color no sale del signo.
 */
function DeltaChip({
  valor,
  subirEsBueno,
  etiqueta,
}: {
  valor: number | null;
  subirEsBueno: boolean;
  etiqueta: string;
}) {
  if (valor === null || !Number.isFinite(valor)) {
    return (
      <span className="text-[11px] font-medium text-slate-400">
        sin base {etiqueta}
      </span>
    );
  }
  const sube = valor >= 0;
  const bueno = sube === subirEsBueno;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
          bueno ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
        }`}
      >
        <span aria-hidden>{sube ? "↗" : "↘"}</span>
        {Math.abs(valor).toFixed(1)} %
      </span>
      <span className="text-[11px] font-medium text-slate-500">{etiqueta}</span>
    </span>
  );
}

const METRICAS: Array<{
  key: PreciosProveedorMetric;
  label: string;
  subirEsBueno: boolean;
}> = [
  { key: "pcu", label: "Costo entrada prom.", subirEsBueno: false },
  { key: "pvu", label: "Precio venta prom.", subirEsBueno: true },
  { key: "margenPct", label: "Margen %", subirEsBueno: true },
  { key: "units", label: "Kilos", subirEsBueno: true },
];

/**
 * La fila de indicadores ES el selector de métrica: la tarjeta activa es la que
 * pinta el heatmap. Un control menos y el número queda en contexto.
 */
export function CostosKpis({
  matrix,
  prev,
  metric,
  onMetric,
  isSingleDay,
  loading,
}: {
  matrix: PreciosProveedorMatrix | null;
  prev: CostosPrevTotals | null;
  metric: PreciosProveedorMetric;
  onMetric: (next: PreciosProveedorMetric) => void;
  isSingleDay: boolean;
  loading: boolean;
}) {
  const hoy = resumenPonderado(matrix);
  const etiqueta = isSingleDay ? "vs. día anterior" : "vs. periodo anterior";

  const margenPrev =
    prev && prev.venta > 0
      ? ((prev.venta - prev.costoVenta) / prev.venta) * 100
      : 0;
  const precioPrev = prev && prev.kilos > 0 ? prev.venta / prev.kilos : 0;

  const valorDe = (key: PreciosProveedorMetric) => {
    if (key === "pcu") return money(hoy.costoEntrada);
    if (key === "pvu") return money(hoy.precioVenta);
    if (key === "margenPct") return pct(hoy.margenPct);
    return kilosFmt(hoy.kilos);
  };

  const deltaDe = (key: PreciosProveedorMetric) => {
    if (!prev) return null;
    if (key === "pcu") return deltaPct(hoy.costoEntrada, prev.costoEntrada);
    if (key === "pvu") return deltaPct(hoy.precioVenta, precioPrev);
    if (key === "margenPct") return deltaPct(hoy.margenPct, margenPrev);
    return deltaPct(hoy.kilos, prev.kilos);
  };

  const pieDe = (key: PreciosProveedorMetric) => {
    if (key === "margenPct") {
      return `${hoy.celdasConCosto.toLocaleString("es-CO")} celdas con dato`;
    }
    if (key === "units" && hoy.kilos > 0) {
      return `${(matrix?.rows.length ?? 0).toLocaleString("es-CO")} ítems`;
    }
    return null;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {METRICAS.map(({ key, label, subirEsBueno }) => {
        const activa = metric === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onMetric(key)}
            aria-pressed={activa}
            className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-left transition-shadow ${
              activa
                ? "border-slate-900 bg-slate-900 text-white shadow-md"
                : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:shadow-sm"
            }`}
          >
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.08em] ${
                activa ? "text-white/70" : "text-slate-500"
              }`}
            >
              {label}
            </span>
            <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums">
              {loading && !matrix ? (
                <span
                  className={`inline-block h-7 w-28 animate-pulse rounded-md ${
                    activa ? "bg-white/20" : "bg-slate-200"
                  }`}
                  aria-hidden
                />
              ) : (
                valorDe(key)
              )}
            </span>
            <div className="flex min-h-[20px] items-center gap-2">
              <DeltaChip
                valor={deltaDe(key)}
                subirEsBueno={subirEsBueno}
                etiqueta={etiqueta}
              />
              {pieDe(key) ? (
                <span
                  className={`text-[11px] font-medium ${
                    activa ? "text-white/60" : "text-slate-500"
                  }`}
                >
                  {pieDe(key)}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
