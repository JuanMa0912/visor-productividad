/**
 * Familias de línea N1 (misma regla que Rotación / Inventario x ítem):
 * Perecederos = 01, 02, 03, 04, 12 · Manufactura = resto.
 */

export type AnalisisInventarioLineFamily =
  | "all"
  | "perecederos"
  | "manufactura";

export const ANALISIS_INVENTARIO_LINE_FAMILY_LABELS: Record<
  AnalisisInventarioLineFamily,
  string
> = {
  all: "Todas",
  perecederos: "Perecederos",
  manufactura: "Manufactura",
};

/** Códigos N1 de perecederos (padded). */
export const ANALISIS_INVENTARIO_PERECEDEROS_CODES = [
  "01",
  "02",
  "03",
  "04",
  "12",
] as const;

export const parseAnalisisInventarioLineFamily = (
  raw: string | null | undefined,
): AnalisisInventarioLineFamily => {
  if (raw === "perecederos" || raw === "manufactura") return raw;
  return "all";
};

/**
 * Fragmento SQL `AND …` sobre `linea_n1_codigo`.
 * Vacío si family = all.
 */
export const lineFamilySqlFilter = (
  family: AnalisisInventarioLineFamily,
  lineaIdExpr: string,
): string => {
  if (family === "all") return "";
  const list = ANALISIS_INVENTARIO_PERECEDEROS_CODES.map(
    (code) => `'${code}'`,
  ).join(", ");
  if (family === "perecederos") {
    return `AND ${lineaIdExpr} IN (${list})`;
  }
  return `AND ${lineaIdExpr} NOT IN (${list})`;
};
