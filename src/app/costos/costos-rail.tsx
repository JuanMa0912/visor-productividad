"use client";

import { useMemo } from "react";
import type { PreciosProveedorMatrix } from "@/lib/exp-precios-proveedor/types";

const money = (value: number) =>
  value > 0 ? `$ ${Math.round(value).toLocaleString("es-CO")}` : "—";

/**
 * Lectura gerencial: lo que el heatmap insinúa pero no dice.
 *
 * El color te muestra que una celda es más roja que otra; esto te dice cuál sede
 * paga mejor en conjunto y en qué ítems la diferencia entre sedes es más ancha.
 * Sin esto el color es textura, no criterio.
 */
export function CostosRail({
  matrix,
  onItem,
}: {
  matrix: PreciosProveedorMatrix | null;
  onItem?: (itemId: string) => void;
}) {
  const lectura = useMemo(() => {
    if (!matrix) return null;

    // Costo de entrada PONDERADO por sede: plata sobre kilos, no promedio de celdas.
    const porSede = new Map<string, { valor: number; kilos: number }>();
    // Brecha entre la sede más cara y la más barata de cada ítem.
    const porItem = new Map<string, { min: number; max: number }>();

    for (const cell of matrix.cells) {
      if (!(cell.pcu > 0)) continue;
      if (cell.units > 0) {
        const acc = porSede.get(cell.sedeKey) ?? { valor: 0, kilos: 0 };
        acc.valor += cell.units * cell.pcu;
        acc.kilos += cell.units;
        porSede.set(cell.sedeKey, acc);
      }
      const rango = porItem.get(cell.rowId);
      if (!rango) porItem.set(cell.rowId, { min: cell.pcu, max: cell.pcu });
      else {
        rango.min = Math.min(rango.min, cell.pcu);
        rango.max = Math.max(rango.max, cell.pcu);
      }
    }

    const sedes = [...porSede.entries()]
      .filter(([, v]) => v.kilos > 0)
      .map(([key, v]) => ({
        key,
        label: matrix.columns.find((col) => col.key === key)?.label ?? key,
        costo: v.valor / v.kilos,
      }))
      .sort((a, b) => a.costo - b.costo);

    const brechas = [...porItem.entries()]
      .map(([rowId, r]) => ({
        rowId,
        label: matrix.rows.find((row) => row.id === rowId)?.label ?? rowId,
        min: r.min,
        pct: r.min > 0 ? ((r.max - r.min) / r.min) * 100 : 0,
      }))
      .filter((b) => b.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);

    return {
      mejor: sedes[0] ?? null,
      peor: sedes.length > 1 ? sedes[sedes.length - 1]! : null,
      brechas,
    };
  }, [matrix]);

  return (
    <aside className="flex w-[260px] shrink-0 flex-col gap-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
          Escala del heatmap
        </h3>
        <div
          className="mt-2.5 h-2 w-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, #34d399 0%, #fde68a 50%, #fb7185 100%)",
          }}
          aria-hidden
        />
        <div className="mt-1.5 flex justify-between text-[11px] font-medium text-slate-500">
          <span>Más favorable</span>
          <span>Menos favorable</span>
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
          El color compara sedes del <strong className="font-semibold text-slate-700">mismo ítem</strong>,
          nunca ítem contra ítem. Celda gris = sin dato ese día.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold tracking-tight text-slate-900">
          Lectura gerencial
        </h3>

        {lectura?.mejor || lectura?.peor ? (
          <div className="grid grid-cols-2 gap-2">
            {lectura.mejor ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                <span className="block text-[9px] font-bold uppercase tracking-[0.06em] text-emerald-700">
                  Sede más favorable
                </span>
                <span className="mt-0.5 block truncate text-[13px] font-bold text-slate-900">
                  {lectura.mejor.label}
                </span>
                <span className="block text-[11px] font-medium tabular-nums text-slate-600">
                  {money(lectura.mejor.costo)}
                </span>
              </div>
            ) : null}
            {lectura.peor ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-2">
                <span className="block text-[9px] font-bold uppercase tracking-[0.06em] text-rose-700">
                  Sede más cara
                </span>
                <span className="mt-0.5 block truncate text-[13px] font-bold text-slate-900">
                  {lectura.peor.label}
                </span>
                <span className="block text-[11px] font-medium tabular-nums text-slate-600">
                  {money(lectura.peor.costo)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
            Mayor brecha de costo entre sedes
          </span>
          {lectura && lectura.brechas.length > 0 ? (
            lectura.brechas.map((b) => (
              <button
                key={b.rowId}
                type="button"
                onClick={() => onItem?.(b.rowId)}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left hover:border-slate-300 hover:bg-slate-50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[11px] font-semibold text-slate-800">
                    {b.label}
                  </span>
                  <span className="text-[10px] font-medium tabular-nums text-slate-500">
                    Mínimo {money(b.min)}
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-800">
                  {b.pct.toFixed(1)} %
                </span>
              </button>
            ))
          ) : (
            <p className="text-[11px] text-slate-500">
              Sin costo de entrada en el rango para comparar sedes.
            </p>
          )}
        </div>
      </section>
    </aside>
  );
}
