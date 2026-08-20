"use client";

import { useEffect } from "react";
import type {
  PreciosProveedorCell,
  PreciosProveedorExpandRow,
  PreciosProveedorRow,
} from "@/lib/exp-precios-proveedor/types";

const money = (value: number) =>
  value > 0 ? `$ ${Math.round(value).toLocaleString("es-CO")}` : "—";

const kilosFmt = (value: number) =>
  value > 0 ? `${Math.round(value).toLocaleString("es-CO")} kg` : "—";

const pct = (value: number) =>
  Number.isFinite(value) && value !== 0 ? `${value.toFixed(1)} %` : "—";

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <span className="block text-[9px] font-bold uppercase tracking-[0.07em] text-slate-500">
        {label}
      </span>
      <span className="mt-1 block text-[17px] font-bold tabular-nums tracking-tight text-slate-900">
        {value}
      </span>
    </div>
  );
}

/**
 * Panel de proveedores de un ítem en UNA sede.
 *
 * Reemplaza la fila que se expandía dentro de la tabla: así la matriz no salta
 * cuando abres un ítem, y hay sitio para decir de dónde sale cada número.
 */
export function CostosDrawer({
  open,
  row,
  cell: dato,
  sedeKey,
  sedeLabel,
  rows,
  loading,
  error,
  onClose,
}: {
  open: boolean;
  row: PreciosProveedorRow | null;
  /** Celda del item en la sede abierta. Es la fuente de los 4 indicadores. */
  cell: PreciosProveedorCell | null;
  sedeKey: string | null;
  sedeLabel: string;
  rows: PreciosProveedorExpandRow[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !row || !sedeKey) return null;

  const celdaDe = (entry: PreciosProveedorExpandRow) =>
    entry.cells.find((cell) => cell.sedeKey === sedeKey);

  const proveedores = rows
    .map((entry) => ({ entry, cell: celdaDe(entry) }))
    .filter((x) => x.cell && (x.cell.units > 0 || x.cell.transito > 0))
    .sort((a, b) => (b.cell?.units ?? 0) - (a.cell?.units ?? 0));

  // La participación se calcula sobre kilos RECIBIDOS del rango. El tránsito no
  // entra: es mercancía que todavía no llegó y contarla desviaría el porcentaje.
  const kilosRecibidos = proveedores.reduce(
    (acc, x) => acc + (x.cell?.units ?? 0),
    0,
  );

  // Margen vendido de ESTA sede, no del item entero: el panel esta acotado a una
  // sede y mezclarlo con las demas daria un numero que no corresponde a lo que
  // se esta mirando.
  const margenVendido =
    dato && dato.sales > 0
      ? ((dato.sales - dato.costoVenta) / dato.sales) * 100
      : 0;

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar panel"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-slate-900/30"
      />
      <aside
        role="dialog"
        aria-label={`Proveedores de ${row.label} en ${sedeLabel}`}
        className="fixed right-0 top-0 z-50 flex h-full w-[380px] max-w-[92vw] flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-slate-50 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {sedeLabel} · Proveedores
            </span>
            <h2 className="text-[19px] font-bold leading-tight tracking-tight text-slate-900">
              {row.label}
            </h2>
            <span className="text-[11px] text-slate-500">
              {row.id}
              {row.lineaLabel ? ` · ${row.lineaLabel}` : ""}
              {row.sublineaLabel ? ` / ${row.sublineaLabel}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MiniKpi label="Costo entrada" value={money(dato?.pcu ?? 0)} />
          <MiniKpi label="Precio venta" value={money(dato?.pvu ?? 0)} />
          <MiniKpi label="Margen vendido" value={pct(margenVendido)} />
          <MiniKpi label="Kilos vendidos" value={kilosFmt(dato?.units ?? 0)} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-slate-500">
            Proveedores con costo de entrada
          </span>

          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg border border-slate-200 bg-white"
                  aria-hidden
                />
              ))}
            </div>
          ) : error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
              {error}
            </p>
          ) : proveedores.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-[12px] text-slate-500">
              Ningún proveedor registra entradas de este ítem en {sedeLabel}{" "}
              dentro del rango de fechas seleccionado.
            </p>
          ) : (
            proveedores.map(({ entry, cell }) => {
              const recibido = cell?.units ?? 0;
              const transito = cell?.transito ?? 0;
              const participacion =
                kilosRecibidos > 0 ? (recibido / kilosRecibidos) * 100 : 0;
              return (
                <div
                  key={entry.rowId}
                  className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-semibold text-slate-900">
                        {entry.proveedorLabel}
                      </span>
                      <span className="text-[10.5px] text-slate-500">
                        {recibido > 0
                          ? `Participación ${participacion.toFixed(0)} % · ${kilosFmt(recibido)}`
                          : "Sin entrada recibida en el rango"}
                      </span>
                    </div>
                    <span className="shrink-0 text-[14px] font-bold tabular-nums text-slate-900">
                      {money(cell?.pcu ?? 0)}
                    </span>
                  </div>

                  {recibido > 0 ? (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-800"
                        style={{ width: `${Math.max(2, Math.min(100, participacion))}%` }}
                      />
                    </div>
                  ) : null}

                  {transito > 0 ? (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10.5px] font-semibold text-sky-800">
                      <span aria-hidden>→</span> {kilosFmt(transito)} en camino
                    </span>
                  ) : null}
                </div>
              );
            })
          )}

          {kilosRecibidos > 0 ? (
            <p className="text-[10.5px] leading-relaxed text-slate-500">
              La participación se reparte sobre {kilosFmt(kilosRecibidos)} recibidos
              en el rango. El tránsito se muestra aparte y no entra en el cálculo.
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
