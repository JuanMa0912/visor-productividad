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

/** Acepta YYYYMMDD o YYYY-MM-DD (fecha_dcto::text en PostgreSQL). */
export const normalizeInformeCompactDate = (
  raw: string | null | undefined,
): string | null => {
  if (!raw?.trim()) return null;
  const compact = raw.trim();
  if (/^\d{8}$/.test(compact)) return compact;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(compact);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  return null;
};

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
  const compactMax = normalizeInformeCompactDate(maxCompactDate);
  if (compactMax) {
    const maxYear = Number(compactMax.slice(0, 4));
    const maxMonth = Number(compactMax.slice(4, 6));
    const maxDay = Number(compactMax.slice(6, 8));
    if (maxYear === year && maxMonth === month) {
      ref = Math.min(ref, maxDay);
    }
  }
  return ref;
};

/**
 * Solo los cortes del Excel canonico (semanas 7/14/21/28 + 1 al fin).
 * No inventa acumulados parciales tipo "1 al 15".
 */
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
  return pool.reduce((best, range) =>
    (range.toDay ?? Number.POSITIVE_INFINITY) >
    (best.toDay ?? Number.POSITIVE_INFINITY)
      ? range
      : best,
  ).id;
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

const compactDate = (year: number, month: number, day: number) =>
  `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;

/** El payload mostrado corresponde al mes y rango de dias seleccionados en la UI. */
export const payloadMatchesInformeSelection = (
  payload: { periods: { current: { from: string; to: string } } },
  year: number,
  month: number,
  dayRangeId: InformeDayRangeId | "",
  availableRanges: readonly InformeDayRangeSpec[],
): boolean => {
  const { from, to } = payload.periods.current;
  const payloadYear = Number(from.slice(0, 4));
  const payloadMonth = Number(from.slice(4, 6));
  if (payloadYear !== year || payloadMonth !== month) return false;
  if (!dayRangeId) return true;

  const range = availableRanges.find((entry) => entry.id === dayRangeId);
  if (!range) return true;

  const monthLast = lastDayOfMonth(year, month);
  const expectedFrom = compactDate(year, month, range.fromDay);
  const expectedTo = compactDate(year, month, range.toDay ?? monthLast);
  return from === expectedFrom && to === expectedTo;
};
