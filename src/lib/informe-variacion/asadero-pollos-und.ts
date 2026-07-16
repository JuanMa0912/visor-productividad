/** Categoría margen id_tipo = 3 (Asaderos). */
export const INFORME_ASADERO_TIPO_PREFIX = "3 ";

export type AsaderoPollosUnitKind =
  | "pollo"
  | "presa"
  | "medio"
  | "cuarto"
  | "exclude";

export type AsaderoPollosConversion = {
  kind: AsaderoPollosUnitKind;
  /** Presas equivalentes por unidad vendida (combos). */
  presaUnits?: number;
};

const normalizeUnitToken = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "");

const extractItemCode = (itemLabel: string): string => {
  const match = /^(\d{5,6})\b/.exec(itemLabel.trim());
  return match?.[1] ?? "";
};

/** Porciones / acompañamientos: no suman pollos. */
const EXCLUDE_ITEM_CODES = new Set([
  "063027", // porcion papas amarillas
  "063026", // porcion yucas
  "063028", // porcion arepas
  "063030", // porcion papa cocida
]);

const POLLO_ENTERO_CODES = new Set([
  "063024", // pollo asado entero
  "063020", // pollo apanado entero
]);

const MEDIO_CODES = new Set([
  "063021", // pollo apanado medio
  "063025", // pollo asado medio (1/2)
]);

const CUARTO_CODES = new Set([
  "063022", // cuarto pechuga
  "063023", // cuarto pernil
]);

const PRESA_CODES = new Set([
  "063019", // pechuga apanada
  "063016", // ala apanada
  "063017", // contramuslo apanado
  "063018", // muslo apanado
  "070633", // muslo apanado promocion
]);

/** Combos: presas incluidas por unidad vendida. */
const COMBO_PRESA_UNITS: Record<string, number> = {
  "074690": 3, // muslo + ala + contramuslo
};

export const isInformeAsaderoCategoryLabel = (catLabel: string): boolean =>
  catLabel.trim().toUpperCase().startsWith(INFORME_ASADERO_TIPO_PREFIX);

export const isInformePolloAsaderoLineLabel = (lineLabel: string): boolean => {
  const text = lineLabel.trim().toUpperCase();
  return text.includes("POLLO ASADO") || (text.startsWith("01 ") && text.includes("POLLO"));
};

export const isInformePolloSublineLabel = (subLabel: string): boolean => {
  const text = subLabel.trim().toUpperCase();
  return text.startsWith("01 ") && /\bPOLLO\b/.test(text);
};

export const shouldConvertAsaderoToPollosUnd = (
  catLabel: string,
  lineLabel: string,
  subLabel: string,
): boolean =>
  isInformeAsaderoCategoryLabel(catLabel) &&
  isInformePolloAsaderoLineLabel(lineLabel) &&
  isInformePolloSublineLabel(subLabel);

const isSideDishText = (text: string): boolean =>
  /\bPORCION\s+DE\b/.test(text) ||
  /\b(PAPAS?\s+AMARILL|PAPAS?\s+COCID|PAPAS?\b|YUCAS?\b|AREPAS?\b)\b/.test(text) ||
  /\b(ENSALADA|BEBIDA|GASEOSA|JUGO|SALSA|POSTRE|PAN\b)\b/.test(text);

const isPresaCutText = (text: string): boolean =>
  /\b(PRESA(S)?|PECHUGA|ALA(S)?|MUSLO(S)?|CONTRAMUSLO|CONTRA[\s-]?MUSLO|PERNIL|PIERNA(S)?|COSTILLA(S)?)\b/.test(
    text,
  ) &&
  !/\b(CUARTO|ENTERO|MEDIO|1\s*\/\s*2|MITAD)\b/.test(text);

const countComboPresas = (text: string): number => {
  const tokens = [
    "CONTRAMUSLO",
    "CONTRA",
    "PECHUGA",
    "MUSLO",
    "ALA",
    "PERNIL",
    "PIERNA",
    "PRESA",
    "COSTILLA",
  ];
  let count = 0;
  for (const token of tokens) {
    if (text.includes(token)) count += 1;
  }
  return count;
};

export const resolveAsaderoPollosConversion = (
  itemLabel: string,
  unitId: string,
  lineLabel = "",
  subLabel = "",
): AsaderoPollosConversion => {
  const code = extractItemCode(itemLabel);
  if (EXCLUDE_ITEM_CODES.has(code)) return { kind: "exclude" };
  if (POLLO_ENTERO_CODES.has(code)) return { kind: "pollo" };
  if (MEDIO_CODES.has(code)) return { kind: "medio" };
  if (CUARTO_CODES.has(code)) return { kind: "cuarto" };
  if (PRESA_CODES.has(code)) return { kind: "presa" };
  if (code in COMBO_PRESA_UNITS) {
    return { kind: "presa", presaUnits: COMBO_PRESA_UNITS[code] };
  }

  const unit = normalizeUnitToken(unitId);
  const text = `${itemLabel} ${lineLabel} ${subLabel}`.toUpperCase();

  if (isSideDishText(text)) return { kind: "exclude" };

  if (/\bOFERTA\b/.test(text)) {
    const presaUnits = countComboPresas(text);
    return presaUnits > 0 ? { kind: "presa", presaUnits } : { kind: "exclude" };
  }

  if (
    unit.includes("PRESA") ||
    unit === "PR" ||
    unit === "PRES" ||
    /\bPRESA(S)?\b/.test(text)
  ) {
    return { kind: "presa" };
  }

  if (
    /\bCUARTO\b/.test(text) ||
    unit.includes("1/4") ||
    unit === "1-4" ||
    /\b1\s*\/\s*4\b/.test(text)
  ) {
    return { kind: "cuarto" };
  }

  if (
    unit.includes("1/2") ||
    unit.includes("MEDIO") ||
    unit === "1-2" ||
    /\b1\s*\/\s*2\b/.test(text) ||
    /\bMEDIO(S)?\b/.test(text) ||
    /\bMITAD(ES)?\b/.test(text)
  ) {
    return { kind: "medio" };
  }

  if (/\bENTERO\b/.test(text)) return { kind: "pollo" };

  if (isPresaCutText(text) || /\bAPANAD[AO]\b/.test(text)) {
    return { kind: "presa" };
  }

  if (
    unit.includes("POLLO") ||
    /\bPOLLO(S)?\s+(ENTERO|UND|UNID)?\b/.test(text) ||
    /\bPOLLO\b/.test(text)
  ) {
    return { kind: "pollo" };
  }

  return { kind: "exclude" };
};

/** @deprecated Usar resolveAsaderoPollosConversion. */
export const resolveAsaderoPollosUnitKind = (
  itemLabel: string,
  unitId: string,
  lineLabel = "",
): AsaderoPollosUnitKind => resolveAsaderoPollosConversion(itemLabel, unitId, lineLabel).kind;

/** 1 unidad vendida de pechuga/ala/muslo/contramuslo = 1 presa.
 *  Un pollo despresado aporta ~8 piezas (no 8 pechugas): por eso
 *  pollos und = (suma de presas) / 8. Medios /2, cuartos /4, entero = 1. */
export const asaderoQtyToPollosUnd = (
  qty: number,
  kind: AsaderoPollosUnitKind,
  presaUnits = 1,
): number => {
  if (!Number.isFinite(qty) || qty === 0 || kind === "exclude") return 0;
  switch (kind) {
    case "presa":
      return (qty * presaUnits) / 8;
    case "medio":
      return qty / 2;
    case "cuarto":
      return qty / 4;
    case "pollo":
      return qty;
    default:
      return 0;
  }
};

export const convertAsaderoQtyToPollosUnd = (
  qty: number,
  itemLabel: string,
  unitId: string,
  lineLabel: string,
  subLabel = "",
): number => {
  const { kind, presaUnits } = resolveAsaderoPollosConversion(
    itemLabel,
    unitId,
    lineLabel,
    subLabel,
  );
  return asaderoQtyToPollosUnd(qty, kind, presaUnits ?? 1);
};

/**
 * True si la fila aporta equivalentes de pollo (no porciones/exclude).
 * Usado para truncar a pollos completos en el resumen por sede.
 */
export const isAsaderoPollosUndContribution = (
  catLabel: string,
  lineLabel: string,
  subLabel: string,
  itemLabel: string,
  unitId: string,
): boolean => {
  if (!shouldConvertAsaderoToPollosUnd(catLabel, lineLabel, subLabel)) {
    return false;
  }
  return (
    resolveAsaderoPollosConversion(itemLabel, unitId, lineLabel, subLabel)
      .kind !== "exclude"
  );
};

/** Descarta fracciones: solo pollos enteros (cantidades >= 0). */
export const floorCompletePollosUnd = (qty: number): number => {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.floor(qty);
};
