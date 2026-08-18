/** DI a partir del cual el ítem entra a sobrestock (32 en adelante). */
export const OVERSTOCK_FROM_DAYS = 32;
/** DI alto: más de 50 días. */
export const OVERSTOCK_HIGH_DAYS = 50;

/** Misma centinela que rotación: sin venta en el periodo. */
const NO_SALES_DI_CEILING = 999_999;

export type OverstockBand = "32" | "50";
export type OverstockFilter = "O" | "O32" | "O50";

export const isOverstockFilter = (
  value: unknown,
): value is OverstockFilter =>
  value === "O" || value === "O32" || value === "O50";

export const getOverstockBand = (row: {
  rotation: number;
  inventoryUnits: number;
}): OverstockBand | null => {
  if (!(row.inventoryUnits > 0)) return null;
  const di = Number(row.rotation);
  if (!Number.isFinite(di) || di < OVERSTOCK_FROM_DAYS || di >= NO_SALES_DI_CEILING) {
    return null;
  }
  return di >= OVERSTOCK_HIGH_DAYS ? "50" : "32";
};

export const isOverstockRow = (row: {
  rotation: number;
  inventoryUnits: number;
}): boolean => getOverstockBand(row) != null;

export const matchesOverstockFilter = (
  row: { rotation: number; inventoryUnits: number },
  filter: OverstockFilter,
): boolean => {
  const band = getOverstockBand(row);
  if (!band) return false;
  if (filter === "O") return true;
  if (filter === "O32") return band === "32";
  return band === "50";
};
