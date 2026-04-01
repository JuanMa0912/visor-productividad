export const INVENTARIO_X_ITEM_SOURCE_TABLE = "rotacion_base_item_dia_sede";
export const INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS = 10;

export const INVENTARIO_X_ITEM_PERECEDEROS_CODES = new Set([
  "01",
  "02",
  "03",
  "04",
  "12",
]);

export type InventarioSubcategoryKey = "perecederos" | "manufacturas";

export const INVENTARIO_SUBCATEGORY_LABELS: Record<
  InventarioSubcategoryKey,
  string
> = {
  perecederos: "Perecederos",
  manufacturas: "Manufacturas",
};

export const normalizeInventoryLineCode = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(2, "0").slice(-2);
};

export const getInventarioSubcategory = (
  lineCode: string | null | undefined,
): InventarioSubcategoryKey => {
  const normalizedCode = normalizeInventoryLineCode(lineCode);
  return normalizedCode &&
    INVENTARIO_X_ITEM_PERECEDEROS_CODES.has(normalizedCode)
    ? "perecederos"
    : "manufacturas";
};

export const buildInventarioLineKey = ({
  linea,
  lineaN1Codigo,
}: {
  linea: string;
  lineaN1Codigo?: string | null;
}) => {
  const normalizedCode =
    normalizeInventoryLineCode(lineaN1Codigo) ?? "sin-codigo";
  return `${normalizedCode}::${linea.trim().toLowerCase()}`;
};

export const getInventarioLineLabel = ({
  linea,
  lineaN1Codigo,
}: {
  linea: string;
  lineaN1Codigo?: string | null;
}) => {
  const normalizedCode = normalizeInventoryLineCode(lineaN1Codigo);
  return normalizedCode ? `${normalizedCode} - ${linea}` : linea;
};

export const parseInventarioLineKey = (value: string) => {
  const [rawCode, ...rawLineParts] = value.split("::");
  const normalizedCode =
    rawCode && rawCode !== "sin-codigo" ? normalizeInventoryLineCode(rawCode) : null;
  const lineName = rawLineParts.join("::").trim();
  return {
    lineaN1Codigo: normalizedCode,
    lineaKeyLabel: value,
    lineaName: lineName,
  };
};
