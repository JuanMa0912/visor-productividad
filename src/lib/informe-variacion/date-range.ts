import { lastDayOfMonth } from "@/lib/informe-variacion/day-ranges";
import type { InformePeriodRange, InformePeriods } from "@/lib/informe-variacion/types";

const MONTH_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const pad2 = (value: number) => String(value).padStart(2, "0");

export const INFORME_MAX_RANGE_DAYS = 366;

export const toCompactDate = (
  year: number,
  month: number,
  day: number,
): string => `${year}${pad2(month)}${pad2(day)}`;

export const compactToIso = (compact: string): string => {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

export const isoToCompact = (iso: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidInformeCalendarDate(year, month, day)) return null;
  return toCompactDate(year, month, day);
};

export const parseInformeCompactDateParam = (
  raw: string | null | undefined,
): string | { error: string } => {
  if (raw == null || raw.trim() === "") {
    return { error: "Fecha requerida." };
  }
  const trimmed = raw.trim();
  const compact =
    /^\d{8}$/.test(trimmed) ? trimmed : isoToCompact(trimmed);
  if (!compact) return { error: "Fecha invalida." };
  const parsed = parseCompactDateParts(compact);
  if (!parsed) return { error: "Fecha invalida." };
  return compact;
};

export const isInformeCompactDateError = (
  value: string | { error: string },
): value is { error: string } => typeof value !== "string";

export const parseCompactDateParts = (
  compact: string,
): { year: number; month: number; day: number } | null => {
  if (!/^\d{8}$/.test(compact)) return null;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  if (!isValidInformeCalendarDate(year, month, day)) return null;
  return { year, month, day };
};

export const isValidInformeCalendarDate = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= lastDayOfMonth(year, month);
};

const utcDay = (compact: string): number => {
  const parts = parseCompactDateParts(compact);
  if (!parts) return NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
};

export const daysInclusiveInRange = (from: string, to: string): number => {
  const start = utcDay(from);
  const end = utcDay(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
};

export const addDaysCompact = (compact: string, days: number): string | null => {
  const parts = parseCompactDateParts(compact);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return toCompactDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
};

/** Mismo mes/dia un año atras; 29-feb cae al 28 si el destino no es bisiesto. */
export const shiftCompactDateYears = (
  compact: string,
  yearDelta: number,
): string | null => {
  const parts = parseCompactDateParts(compact);
  if (!parts) return null;
  const year = parts.year + yearDelta;
  if (year < 2000 || year > 2100) return null;
  const day = Math.min(parts.day, lastDayOfMonth(year, parts.month));
  return toCompactDate(year, parts.month, day);
};

export const formatInformeRangeLabel = (
  fromCompact: string,
  toCompact: string,
): string => {
  const from = parseCompactDateParts(fromCompact);
  const to = parseCompactDateParts(toCompact);
  if (!from || !to) return `${fromCompact} – ${toCompact}`;
  const fromText = `${pad2(from.day)} ${MONTH_SHORT[from.month - 1]} ${from.year}`;
  const toText = `${pad2(to.day)} ${MONTH_SHORT[to.month - 1]} ${to.year}`;
  if (fromCompact === toCompact) return fromText;
  return `${fromText} – ${toText}`;
};

export const buildInformePeriodRange = (
  from: string,
  to: string,
): InformePeriodRange => ({
  from,
  to,
  label: formatInformeRangeLabel(from, to),
});

export type InformeSelectedRanges = {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
};

export const computeInformeRangePeriods = (
  ranges: InformeSelectedRanges,
): InformePeriods => {
  const current = buildInformePeriodRange(ranges.currentFrom, ranges.currentTo);
  const previous = buildInformePeriodRange(
    ranges.previousFrom,
    ranges.previousTo,
  );
  return {
    current,
    mom: previous,
    yoy: previous,
  };
};

export const validateInformeSelectedRanges = (
  ranges: InformeSelectedRanges,
  options?: { maxDate?: string | null; minDate?: string | null },
): { ok: true } | { ok: false; error: string } => {
  const fields: Array<[string, string]> = [
    ["periodo actual (desde)", ranges.currentFrom],
    ["periodo actual (hasta)", ranges.currentTo],
    ["periodo anterior (desde)", ranges.previousFrom],
    ["periodo anterior (hasta)", ranges.previousTo],
  ];
  for (const [label, value] of fields) {
    if (!parseCompactDateParts(value)) {
      return { ok: false, error: `Fecha invalida en ${label}.` };
    }
  }
  if (ranges.currentFrom > ranges.currentTo) {
    return {
      ok: false,
      error: "El inicio del periodo actual no puede ser posterior al fin.",
    };
  }
  if (ranges.previousFrom > ranges.previousTo) {
    return {
      ok: false,
      error: "El inicio del periodo anterior no puede ser posterior al fin.",
    };
  }
  if (
    daysInclusiveInRange(ranges.currentFrom, ranges.currentTo) >
    INFORME_MAX_RANGE_DAYS
  ) {
    return {
      ok: false,
      error: `El periodo actual no puede superar ${INFORME_MAX_RANGE_DAYS} dias.`,
    };
  }
  if (
    daysInclusiveInRange(ranges.previousFrom, ranges.previousTo) >
    INFORME_MAX_RANGE_DAYS
  ) {
    return {
      ok: false,
      error: `El periodo anterior no puede superar ${INFORME_MAX_RANGE_DAYS} dias.`,
    };
  }
  const maxDate = options?.maxDate ?? null;
  if (maxDate && ranges.currentTo > maxDate) {
    return {
      ok: false,
      error: "El periodo actual supera el ultimo dia cargado en margen.",
    };
  }
  return { ok: true };
};

export const defaultInformeYtdRanges = (
  maxCompact: string | null | undefined,
  asOf: Date = new Date(),
): InformeSelectedRanges => {
  const maxParts = maxCompact ? parseCompactDateParts(maxCompact) : null;
  const to = maxParts
    ? toCompactDate(maxParts.year, maxParts.month, maxParts.day)
    : toCompactDate(asOf.getFullYear(), asOf.getMonth() + 1, asOf.getDate());
  const year = Number(to.slice(0, 4));
  const currentFrom = toCompactDate(year, 1, 1);
  const previousFrom = toCompactDate(year - 1, 1, 1);
  const previousTo = shiftCompactDateYears(to, -1) ?? toCompactDate(year - 1, 12, 31);
  return {
    currentFrom,
    currentTo: to,
    previousFrom,
    previousTo,
  };
};

export const alignPreviousYearRange = (
  currentFrom: string,
  currentTo: string,
): { previousFrom: string; previousTo: string } | null => {
  const previousFrom = shiftCompactDateYears(currentFrom, -1);
  const previousTo = shiftCompactDateYears(currentTo, -1);
  if (!previousFrom || !previousTo) return null;
  return { previousFrom, previousTo };
};

export const informeRangeCacheKey = (ranges: InformeSelectedRanges): string =>
  `r:${ranges.currentFrom}:${ranges.currentTo}:${ranges.previousFrom}:${ranges.previousTo}`;

export type InformeMonthChunk = {
  anioMes: string;
};

export type InformeDaySpan = {
  from: string;
  to: string;
};

export type InformeRangeQueryPlan = {
  months: string[];
  leftovers: InformeDaySpan[];
};

/**
 * Parte un rango en meses calendario completos + dias sueltos.
 * Eso permite leer `margen_item_mes_roll` y solo escanear el recorte diario.
 */
export const splitInformeRangeForQuery = (
  from: string,
  to: string,
): InformeRangeQueryPlan => {
  const start = parseCompactDateParts(from);
  const end = parseCompactDateParts(to);
  if (!start || !end || from > to) {
    return { months: [], leftovers: from && to && from <= to ? [{ from, to }] : [] };
  }

  const months: string[] = [];
  const leftovers: InformeDaySpan[] = [];

  if (start.year === end.year && start.month === end.month) {
    const monthLast = lastDayOfMonth(start.year, start.month);
    if (start.day === 1 && end.day === monthLast) {
      months.push(`${start.year}${pad2(start.month)}`);
    } else {
      leftovers.push({ from, to });
    }
    return { months, leftovers };
  }

  let year = start.year;
  let month = start.month;
  let first = true;

  while (year < end.year || (year === end.year && month <= end.month)) {
    const monthLast = lastDayOfMonth(year, month);
    const isStartMonth = first;
    const isEndMonth = year === end.year && month === end.month;
    const spanFromDay = isStartMonth ? start.day : 1;
    const spanToDay = isEndMonth ? end.day : monthLast;
    const complete = spanFromDay === 1 && spanToDay === monthLast;

    if (complete) {
      months.push(`${year}${pad2(month)}`);
    } else {
      leftovers.push({
        from: toCompactDate(year, month, spanFromDay),
        to: toCompactDate(year, month, spanToDay),
      });
    }

    first = false;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }

  return { months, leftovers };
};

export const mergeInformeRangePlans = (
  current: InformeRangeQueryPlan,
  previous: InformeRangeQueryPlan,
): {
  currentMonths: string[];
  previousMonths: string[];
  leftovers: Array<InformeDaySpan & { bucket: "cur" | "prev" }>;
} => ({
  currentMonths: current.months,
  previousMonths: previous.months,
  leftovers: [
    ...current.leftovers.map((span) => ({ ...span, bucket: "cur" as const })),
    ...previous.leftovers.map((span) => ({ ...span, bucket: "prev" as const })),
  ],
});
