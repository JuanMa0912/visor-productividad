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

/**
 * Cuenta las piezas nombradas en un combo.
 *
 * Antes hacia `text.includes(token)` sobre una lista que contenia CONTRAMUSLO,
 * CONTRA y MUSLO a la vez: como los tres son subcadenas de "CONTRAMUSLO", una
 * sola presa contaba TRES. Medido: "OFERTA CONTRAMUSLO APANADO" daba 0,375
 * pollos en vez de 0,125, un 3x. Ademas "ALA" es subcadena de "ENSALADA".
 *
 * Ahora se usa limite de palabra y se consume el texto ya emparejado, con las
 * piezas ordenadas de mas larga a mas corta para que CONTRAMUSLO se lleve su
 * coincidencia antes de que MUSLO pueda verla.
 */
const countComboPresas = (text: string): number => {
  const PIECES: RegExp[] = [
    /\bCONTRA[\s-]?MUSLOS?\b/g,
    /\bPECHUGAS?\b/g,
    /\bMUSLOS?\b/g,
    /\bALAS?\b/g,
    /\bPERNILES?\b/g,
    /\bPIERNAS?\b/g,
    /\bPRESAS?\b/g,
    /\bCOSTILLAS?\b/g,
  ];
  let rest = text;
  let count = 0;
  for (const piece of PIECES) {
    const found = rest.match(piece);
    if (!found) continue;
    count += found.length;
    rest = rest.replace(piece, " ");
  }
  return count;
};

/** Piezas declaradas en la descripcion: "*11 PRESAS", "* 4 PRESAS". */
const declaredPieceCount = (text: string): number | null => {
  const match = /(\d{1,2})\s*PRESAS?\b/.exec(text);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count >= 1 && count <= 24 ? count : null;
};

/**
 * "POLLO APANADO*11 PRESAS" es un pollo ENTERO despresado en 11 piezas, NO once
 * presas sueltas. Vale 1 pollo.
 *
 * Verificado por precio sobre 90 dias: $26.893 la unidad, frente a $22.927 del
 * pollo apanado entero (1,17x, la prima por despresar). Once presas sueltas
 * costarian ~$37.000 sumando pechuga ($5.426), muslo ($3.389), contramuslo
 * ($3.378) y ala ($3.214). Ademas la familia de nombres lo confirma:
 * POLLO APANADO ENTERO / POLLO APANADO MEDIO / POLLO APANADO*11 PRESAS.
 *
 * Solo aplica cuando la descripcion nombra POLLO. Un "OFERTA 4 PRESAS" sin
 * pollo se sigue tratando como presas sueltas; no hay hoy ningun item asi, asi
 * que esa rama no esta respaldada por datos reales.
 */
const resolveChickenInPieces = (
  itemText: string,
): AsaderoPollosUnitKind | null => {
  if (!/\bPOLLOS?\b/.test(itemText)) return null;
  if (declaredPieceCount(itemText) === null) return null;
  if (/\b(MEDIO(S)?|MITAD(ES)?)\b/.test(itemText)) return "medio";
  if (/\bCUARTO(S)?\b/.test(itemText)) return "cuarto";
  return "pollo";
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

  // Contenido de pollo detectable, mirando SOLO la descripcion del item.
  // Ojo: `text` concatena linea y sublinea, que en esta ruta siempre dicen
  // "POLLO ASADO" / "POLLO". Si se evaluara sobre `text`, cualquier fila daria
  // positivo y hasta una ensalada contaria como pollo.
  const itemText = itemLabel.toUpperCase();
  const hasChickenContent =
    /\bPOLLOS?\b/.test(itemText) ||
    /\bENTERO(S)?\b/.test(itemText) ||
    /\bMEDIO(S)?\b/.test(itemText) ||
    /\bCUARTO(S)?\b/.test(itemText) ||
    isPresaCutText(itemText);

  // Solo se descarta como acompañamiento si NO hay pollo en la descripcion.
  // Antes bastaba con nombrar un acompañamiento para excluir la fila entera:
  // "COMBO POLLO ASADO ENTERO + ENSALADA" contaba 0 pollos pese a llevar uno.
  if (isSideDishText(text) && !hasChickenContent) return { kind: "exclude" };

  // "POLLO ...*N PRESAS" es una presentacion de pollo despresado, no N presas
  // sueltas. Se resuelve aqui, ANTES del chequeo generico de PRESA de mas abajo,
  // que si no se llevaria "MEDIO POLLO APANADO*5 PRESAS" como presa suelta.
  const chickenInPieces = resolveChickenInPieces(itemText);
  if (chickenInPieces) return { kind: chickenInPieces };

  // Piezas declaradas SIN mencionar pollo: se toman como presas sueltas.
  const declaredPresas = declaredPieceCount(itemText);
  if (declaredPresas !== null) {
    return { kind: "presa", presaUnits: declaredPresas };
  }

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
