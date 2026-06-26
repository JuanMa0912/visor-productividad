import { compactDateToIso, isoDateToCompact } from "@/lib/margenes/margen-final-query";

/**
 * Rango por defecto = MES EN CURSO: del día 1 del mes de `maxCompact` hasta `maxCompact`.
 * Como el ETL deja la BD hasta "ayer", si hoy es día 1 entonces `maxCompact` cae en el
 * mes anterior y se muestra ese mes completo (sin lógica de reloj ni casos especiales).
 */
export const defaultMargenDateRange = (
  minCompact: string | null | undefined,
  maxCompact: string | null | undefined,
): { start: string; end: string } | null => {
  const endIso = compactDateToIso(maxCompact);
  const minIso = compactDateToIso(minCompact);
  if (!endIso) return null;

  let startIso = `${endIso.slice(0, 7)}-01`; // primer día del mes de maxDate
  if (minIso && startIso < minIso) startIso = minIso;

  return { start: startIso, end: endIso };
};

export const compactRangeSpanDays = (
  fromCompact: string,
  toCompact: string,
): number => {
  const fromIso = compactDateToIso(fromCompact);
  const toIso = compactDateToIso(toCompact);
  if (!fromIso || !toIso) return 0;
  const from = new Date(`${fromIso}T12:00:00`);
  const to = new Date(`${toIso}T12:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return diff >= 0 ? diff + 1 : 0;
};

export const isoDateToCompactOrNull = isoDateToCompact;
