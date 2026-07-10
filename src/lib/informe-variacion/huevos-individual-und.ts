/** Línea de huevos en Mercado (p. ej. 12 HUEVOS). */

export const isInformeHuevosLineLabel = (lineLabel: string): boolean =>
  /\bHUEVOS?\b/.test(lineLabel.trim().toUpperCase());

export const isInformeHuevosSublineLabel = (subLabel: string): boolean =>
  /\bHUEVOS?\b/.test(subLabel.trim().toUpperCase());

export const shouldConvertHuevosToUndIndividuales = (
  lineLabel: string,
  subLabel: string,
): boolean =>
  isInformeHuevosLineLabel(lineLabel) && isInformeHuevosSublineLabel(subLabel);

export const shouldConvertHuevosLineTotals = (lineLabel: string): boolean =>
  isInformeHuevosLineLabel(lineLabel);

/**
 * Unidades por empaque desde la descripción del ítem (*30und, *15und, granel = 1).
 */
export const resolveHuevosPackSize = (
  itemLabel: string,
  unitId = "",
): number => {
  const text = `${itemLabel} ${unitId}`.toUpperCase();

  if (/\bGRANEL\b/.test(text)) return 1;

  const starPack = /\*(\d{1,3})\s*UND/.exec(text);
  if (starPack) return Number(starPack[1]);

  const xPack = /X(\d{1,3})\s*UND/.exec(text);
  if (xPack) return Number(xPack[1]);

  if (/\*UND\b/.test(text)) return 1;

  return 1;
};

export const convertHuevosQtyToUndIndividuales = (
  qty: number,
  itemLabel: string,
  unitId = "",
): number => {
  if (!Number.isFinite(qty) || qty === 0) return 0;
  return qty * resolveHuevosPackSize(itemLabel, unitId);
};
