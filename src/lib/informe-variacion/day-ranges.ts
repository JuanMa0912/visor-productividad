export const INFORME_DAY_RANGES = [
  { id: "1-7", label: "1 al 7", fromDay: 1, toDay: 7 },
  { id: "1-14", label: "1 al 14", fromDay: 1, toDay: 14 },
  { id: "8-14", label: "8 al 14", fromDay: 8, toDay: 14 },
  { id: "1-21", label: "1 al 21", fromDay: 1, toDay: 21 },
  { id: "15-21", label: "15 al 21", fromDay: 15, toDay: 21 },
  { id: "1-28", label: "1 al 28", fromDay: 1, toDay: 28 },
  { id: "22-28", label: "22 al 28", fromDay: 22, toDay: 28 },
  { id: "1-eom", label: "1 al fin", fromDay: 1, toDay: null },
] as const;

export type InformeDayRangeId = (typeof INFORME_DAY_RANGES)[number]["id"];

export type InformeDayRangeSpec = {
  id: InformeDayRangeId;
  label: string;
  fromDay: number;
  toDay: number | null;
};

const DAY_RANGE_BY_ID = new Map(
  INFORME_DAY_RANGES.map((range) => [range.id, range] as const),
);

export const lastDayOfMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

/** Dia de referencia: hoy (o maxDate en BD) si es el mes en curso; ultimo dia si el mes ya cerro. */
export const resolveInformeReferenceDay = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): number => {
  const monthLast = lastDayOfMonth(year, month);
  const todayYear = asOf.getFullYear();
  const todayMonth = asOf.getMonth() + 1;
  const todayDay = asOf.getDate();

  if (year > todayYear || (year === todayYear && month > todayMonth)) {
    return 0;
  }
  if (year < todayYear || (year === todayYear && month < todayMonth)) {
    return monthLast;
  }

  let ref = todayDay;
  if (maxCompactDate && /^\d{8}$/.test(maxCompactDate)) {
    const maxYear = Number(maxCompactDate.slice(0, 4));
    const maxMonth = Number(maxCompactDate.slice(4, 6));
    const maxDay = Number(maxCompactDate.slice(6, 8));
    if (maxYear === year && maxMonth === month) {
      ref = Math.min(ref, maxDay);
    }
  }
  return ref;
};

export const getAvailableInformeDayRanges = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec[] => {
  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (refDay <= 0) return [];

  const monthLast = lastDayOfMonth(year, month);
  return INFORME_DAY_RANGES.filter((range) => {
    const endDay = range.toDay ?? monthLast;
    return refDay >= endDay;
  }).map((range) => ({ ...range }));
};

export const defaultInformeDayRangeId = (
  available: readonly InformeDayRangeSpec[],
): InformeDayRangeId | null => {
  if (available.length === 0) return null;
  const cumulative = available.filter((range) => range.fromDay === 1);
  const pool = cumulative.length > 0 ? cumulative : available;
  return pool[pool.length - 1]!.id;
};

export const parseInformeDayRangeId = (
  value: string | null | undefined,
): InformeDayRangeSpec | null => {
  if (!value?.trim()) return null;
  const found = DAY_RANGE_BY_ID.get(value.trim() as InformeDayRangeId);
  return found ? { ...found } : null;
};

export const isInformeDayRangeAvailable = (
  rangeId: InformeDayRangeId,
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): boolean =>
  getAvailableInformeDayRanges(year, month, asOf, maxCompactDate).some(
    (range) => range.id === rangeId,
  );
