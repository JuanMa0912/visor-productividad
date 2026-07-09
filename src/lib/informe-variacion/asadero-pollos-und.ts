/** Categoría margen id_tipo = 3 (Asaderos). */
export const INFORME_ASADERO_TIPO_PREFIX = "3 ";

export type AsaderoPollosUnitKind = "pollo" | "presa" | "medio" | "other";

const normalizeUnitToken = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "");

export const isInformeAsaderoCategoryLabel = (catLabel: string): boolean =>
  catLabel.trim().toUpperCase().startsWith(INFORME_ASADERO_TIPO_PREFIX);

export const isInformePolloAsaderoLineLabel = (lineLabel: string): boolean => {
  const text = lineLabel.trim().toUpperCase();
  return text.includes("POLLO ASADO") || (text.startsWith("01 ") && text.includes("POLLO"));
};

export const shouldConvertAsaderoToPollosUnd = (
  catLabel: string,
  lineLabel: string,
): boolean =>
  isInformeAsaderoCategoryLabel(catLabel) &&
  isInformePolloAsaderoLineLabel(lineLabel);

export const resolveAsaderoPollosUnitKind = (
  itemLabel: string,
  unitId: string,
  lineLabel = "",
): AsaderoPollosUnitKind => {
  const unit = normalizeUnitToken(unitId);
  const text = `${itemLabel} ${lineLabel}`.toUpperCase();

  if (
    unit.includes("PRESA") ||
    unit === "PR" ||
    unit === "PRES" ||
    /\bPRESA(S)?\b/.test(text)
  ) {
    return "presa";
  }

  if (
    unit.includes("1/2") ||
    unit.includes("MEDIO") ||
    unit === "1-2" ||
    /\b1\s*\/\s*2\b/.test(text) ||
    /\bMEDIO(S)?\s+POLLO\b/.test(text) ||
    /\bMITAD(ES)?\b/.test(text)
  ) {
    return "medio";
  }

  if (
    unit.includes("POLLO") ||
    /\bPOLLO(S)?\s+(ENTERO|UND|UNID)?\b/.test(text) ||
    /\bPOLLO\b/.test(text)
  ) {
    return "pollo";
  }

  return "other";
};

/** 8 presas = 1 pollo; 2 medios (1/2) = 1 pollo; pollo entero = 1. */
export const asaderoQtyToPollosUnd = (
  qty: number,
  kind: AsaderoPollosUnitKind,
): number => {
  if (!Number.isFinite(qty) || qty === 0) return 0;
  switch (kind) {
    case "presa":
      return qty / 8;
    case "medio":
      return qty / 2;
    case "pollo":
      return qty;
    default:
      return qty;
  }
};

export const convertAsaderoQtyToPollosUnd = (
  qty: number,
  itemLabel: string,
  unitId: string,
  lineLabel: string,
): number => {
  const kind = resolveAsaderoPollosUnitKind(itemLabel, unitId, lineLabel);
  return asaderoQtyToPollosUnd(qty, kind);
};
