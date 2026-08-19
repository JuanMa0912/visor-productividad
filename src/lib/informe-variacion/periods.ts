import type { InformePeriodRange, InformePeriods } from "@/lib/informe-variacion/types";
import type { InformeDayRangeSpec } from "@/lib/informe-variacion/day-ranges";
import { lastDayOfMonth } from "@/lib/informe-variacion/day-ranges";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

const pad2 = (value: number) => String(value).padStart(2, "0");

export type InformeYearMonth = { year: number; month: number };

export const toCompactDate = (year: number, month: number, day: number): string =>
  `${year}${pad2(month)}${pad2(day)}`;

export const previousCalendarMonth = (
  year: number,
  month: number,
): InformeYearMonth =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

export const isSameInformeYearMonth = (
  a: InformeYearMonth,
  b: InformeYearMonth,
): boolean => a.year === b.year && a.month === b.month;

export const isInformeYearMonthBefore = (
  a: InformeYearMonth,
  b: InformeYearMonth,
): boolean => a.year < b.year || (a.year === b.year && a.month < b.month);

/** Mes de comparacion (slot MoM). Si no hay override, es el calendario anterior. */
export const resolveInformeCompareMonth = (
  year: number,
  month: number,
  compare?: InformeYearMonth | null,
): InformeYearMonth => {
  if (!compare) return previousCalendarMonth(year, month);
  if (
    !Number.isInteger(compare.year) ||
    compare.year < 2000 ||
    compare.year > 2100 ||
    !Number.isInteger(compare.month) ||
    compare.month < 1 ||
    compare.month > 12
  ) {
    throw new Error("Mes de comparacion invalido para el informe.");
  }
  if (compare.year === year && compare.month === month) {
    throw new Error(
      "El periodo anterior no puede ser el mismo mes que el periodo actual.",
    );
  }
  if (!isInformeYearMonthBefore(compare, { year, month })) {
    throw new Error(
      "El periodo anterior debe ser anterior al periodo actual.",
    );
  }
  return compare;
};

export const isDefaultInformeCompareMonth = (
  year: number,
  month: number,
  compare?: InformeYearMonth | null,
): boolean =>
  isSameInformeYearMonth(
    resolveInformeCompareMonth(year, month, compare),
    previousCalendarMonth(year, month),
  );

export const parseInformeCompareMonthParam = (
  year: number,
  month: number,
  compareYearRaw: string | null,
  compareMonthRaw: string | null,
): InformeYearMonth | { error: string } => {
  const missingYear = compareYearRaw == null || compareYearRaw.trim() === "";
  const missingMonth = compareMonthRaw == null || compareMonthRaw.trim() === "";
  if (missingYear && missingMonth) return previousCalendarMonth(year, month);
  if (missingYear || missingMonth) {
    return { error: "Parametros compareYear y compareMonth invalidos." };
  }
  try {
    return resolveInformeCompareMonth(year, month, {
      year: Number(compareYearRaw),
      month: Number(compareMonthRaw),
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Parametros compareYear y compareMonth invalidos.",
    };
  }
};

export const isInformeCompareMonthError = (
  value: InformeYearMonth | { error: string },
): value is { error: string } => "error" in value;

/** Vacio cuando el compare es el MoM por defecto, para reutilizar cache/std. */
export const informeCompareCacheSuffix = (
  year: number,
  month: number,
  compare?: InformeYearMonth | null,
): string => {
  const resolved = resolveInformeCompareMonth(year, month, compare);
  if (isSameInformeYearMonth(resolved, previousCalendarMonth(year, month))) {
    return "";
  }
  return `:cmp=${resolved.year}-${pad2(resolved.month)}`;
};

export const formatInformePeriodLabel = (
  fromCompact: string,
  toCompact: string,
): string => {
  if (!/^\d{8}$/.test(fromCompact) || !/^\d{8}$/.test(toCompact)) {
    return `${fromCompact} – ${toCompact}`;
  }
  const fromYear = Number(fromCompact.slice(0, 4));
  const fromMonth = Number(fromCompact.slice(4, 6));
  const fromDay = Number(fromCompact.slice(6, 8));
  const toYear = Number(toCompact.slice(0, 4));
  const toMonth = Number(toCompact.slice(4, 6));
  const toDay = Number(toCompact.slice(6, 8));
  const monthName = MONTH_NAMES[fromMonth - 1] ?? `Mes ${fromMonth}`;
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${monthName} ${pad2(fromDay)}–${pad2(toDay)}, ${fromYear}`;
  }
  return `${fromCompact} – ${toCompact}`;
};

export const formatInformeMonthChip = (year: number, month: number): string => {
  const monthName = MONTH_NAMES[month - 1] ?? `Mes ${month}`;
  const last = lastDayOfMonth(year, month);
  return `${monthName} ${pad2(1)}–${pad2(last)}, ${year}`;
};

const monthRangeBounds = (
  year: number,
  month: number,
  fromDay: number,
  toDay: number | null,
): { from: string; to: string } | null => {
  const last = lastDayOfMonth(year, month);
  const to = toDay === null ? last : Math.min(toDay, last);
  const from = Math.min(fromDay, last);
  if (from > to) return null;
  return {
    from: toCompactDate(year, month, from),
    to: toCompactDate(year, month, to),
  };
};

/** Ventanas compactas cur/mom/yoy acotadas a los dias que cubren los rangos del mes. */
export const computeInformeDailyFetchBounds = (
  year: number,
  month: number,
  ranges: InformeDayRangeSpec[],
  compare?: InformeYearMonth | null,
): {
  cur: { from: string; to: string };
  mom: { from: string; to: string };
  yoy: { from: string; to: string };
} => {
  const monthLast = lastDayOfMonth(year, month);
  const resolvedCompare = resolveInformeCompareMonth(year, month, compare);
  const momYear = resolvedCompare.year;
  const momMonth = resolvedCompare.month;
  const momLast = lastDayOfMonth(momYear, momMonth);
  const yoyLast = lastDayOfMonth(year - 1, month);

  const minFromDay =
    ranges.length > 0 ? Math.min(...ranges.map((range) => range.fromDay)) : 1;
  const maxToDay =
    ranges.length > 0
      ? Math.max(
          ...ranges.map((range) => {
            if (range.projection) {
              // Fetch cur hasta actual; mom/yoy hasta target (cubierto por max global).
              return Math.max(
                range.projection.actualToDay,
                range.projection.targetToDay,
              );
            }
            return range.toDay ?? monthLast;
          }),
        )
      : monthLast;

  const cur =
    monthRangeBounds(year, month, minFromDay, maxToDay) ??
    monthRangeBounds(year, month, 1, monthLast)!;
  const mom =
    monthRangeBounds(
      momYear,
      momMonth,
      minFromDay,
      Math.min(maxToDay, momLast),
    ) ?? monthRangeBounds(momYear, momMonth, 1, momLast)!;
  const yoy =
    monthRangeBounds(
      year - 1,
      month,
      minFromDay,
      Math.min(maxToDay, yoyLast),
    ) ?? monthRangeBounds(year - 1, month, 1, yoyLast)!;

  return { cur, mom, yoy };
};

export const computeInformePeriods = (
  year: number,
  month: number,
  dayRange?: InformeDayRangeSpec | null,
  compare?: InformeYearMonth | null,
): InformePeriods => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Año inválido para el informe.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Mes inválido para el informe.");
  }

  const resolvedCompare = resolveInformeCompareMonth(year, month, compare);
  const fromDay = dayRange?.fromDay ?? 1;
  const targetToDay = dayRange?.toDay ?? null;
  // SQL del periodo actual: solo dias reales cargados cuando hay proyeccion.
  const currentToDay =
    dayRange?.projection?.actualToDay ?? targetToDay;
  const compareToDay =
    dayRange?.projection?.targetToDay ?? targetToDay;

  const curBounds = monthRangeBounds(year, month, fromDay, currentToDay);
  if (!curBounds) {
    throw new Error("Rango de dias invalido para el mes seleccionado.");
  }

  const momYear = resolvedCompare.year;
  const momMonth = resolvedCompare.month;
  const momBounds = monthRangeBounds(momYear, momMonth, fromDay, compareToDay);
  const yoyBounds = monthRangeBounds(year - 1, month, fromDay, compareToDay);

  const build = (from: string, to: string): InformePeriodRange => ({
    from,
    to,
    label: formatInformePeriodLabel(from, to),
  });

  return {
    current: build(curBounds.from, curBounds.to),
    mom: build(
      momBounds?.from ?? toCompactDate(momYear, momMonth, 1),
      momBounds?.to ??
        toCompactDate(momYear, momMonth, lastDayOfMonth(momYear, momMonth)),
    ),
    yoy: build(
      yoyBounds?.from ?? toCompactDate(year - 1, month, 1),
      yoyBounds?.to ??
        toCompactDate(year - 1, month, lastDayOfMonth(year - 1, month)),
    ),
  };
};

import { normalizeInformeCompactDate } from "@/lib/informe-variacion/day-ranges";

export const defaultInformeYearMonth = (
  maxCompact: string | null | undefined,
): { year: number; month: number } => {
  const compact = normalizeInformeCompactDate(maxCompact);
  if (compact) {
    return {
      year: Number(compact.slice(0, 4)),
      month: Number(compact.slice(4, 6)),
    };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

export const yearMonthToInputValue = (year: number, month: number): string =>
  `${year}-${pad2(month)}`;

export const parseYearMonthInput = (
  value: string,
): { year: number; month: number } | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
};
