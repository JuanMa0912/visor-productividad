import type { PreciosProveedorCell } from "@/lib/exp-precios-proveedor/types";

const unitPrice = (money: number, units: number) =>
  units > 0 ? money / units : 0;

const marginPct = (sales: number, cost: number) =>
  sales > 0 ? ((sales - cost) / sales) * 100 : 0;

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
  current.sales = Math.max(current.sales, incoming.sales);
  current.pvu = unitPrice(current.sales, current.units);
  current.pcu = unitPrice(current.cost, current.units);
  current.margenPct = marginPct(
    current.sales > 0 ? current.sales : current.pvu * current.units,
    current.cost,
  );
};
