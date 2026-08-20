import type { PreciosProveedorCell } from "@/lib/exp-precios-proveedor/types";

const unitPrice = (money: number, units: number) =>
  units > 0 ? money / units : 0;

/** Margen al que saldria vendido: precio de venta/kg contra costo de entrada/kg. */
const projectedMarginPct = (pvu: number, pcu: number) =>
  pvu > 0 && pcu > 0 ? ((pvu - pcu) / pvu) * 100 : 0;

export const mergeProveedorNits = (
  a: string | null | undefined,
  b: string | null | undefined,
): string | null => {
  const parts = [a, b]
    .flatMap((value) => String(value ?? "").split(" · "))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" · ") || null;
};

/**
 * Une celdas del mismo sede: kilos y costo se suman.
 * La venta del ítem no se duplica (cada fuente ya trae el total de la sede).
 */
export const mergeExpandCellInto = (
  cells: PreciosProveedorCell[],
  incoming: PreciosProveedorCell,
): void => {
  const current = cells.find((cell) => cell.sedeKey === incoming.sedeKey);
  if (!current) {
    cells.push({ ...incoming });
    return;
  }
  current.units += incoming.units;
  current.cost += incoming.cost;
  current.costoVenta += incoming.costoVenta;
  // El transito se suma entre fuentes igual que los kilos, pero sigue viviendo
  // en su propio campo: nunca se mezcla con lo recibido.
  current.transito += incoming.transito;
  current.sales = Math.max(current.sales, incoming.sales);
  // El pvu es el precio de venta del item en la sede: NO se recalcula como
  // ventas/kilos_comprados, que mezclaba las dos magnitudes y ensuciaba el
  // margen. Se conserva el que ya venia resuelto.
  current.pvu = current.pvu > 0 ? current.pvu : incoming.pvu;
  // El pcu si es un promedio ponderado legitimo: ambos lados son de compra.
  current.pcu = unitPrice(current.cost, current.units);
  current.margenPct = projectedMarginPct(current.pvu, current.pcu);
};
