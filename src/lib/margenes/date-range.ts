import { compactDateToIso, isoDateToCompact } from "@/lib/margenes/margen-final-query";

const DEFAULT_RANGE_DAYS = 7;

/** Rango corto por defecto (últimos N días) para primera carga más rápida. */
export const defaultMargenDateRange = (
  minCompact: string | null | undefined,
  maxCompact: string | null | undefined,
  days = DEFAULT_RANGE_DAYS,
): { start: string; end: string } | null => {
  const endIso = compactDateToIso(maxCompact);
  const minIso = compactDateToIso(minCompact);
  if (!endIso) return null;

  const end = new Date(`${endIso}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  let startIso = start.toISOString().slice(0, 10);
  if (minIso && startIso < minIso) startIso = minIso;

  return { start: startIso, end: endIso };
};

export const margenDefaultRangeDays = DEFAULT_RANGE_DAYS;

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
