/** Ventana de la primera carga (ayer + MoM ~1 mes, sin bajar todo el histórico). */
export const PRODUCTIVITY_DEFAULT_LOOKBACK_DAYS = 40;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isProductivityIsoDate = (value: string | null | undefined): value is string =>
  typeof value === "string" && ISO_DATE_RE.test(value);

export const toProductivityCompactDate = (isoDate: string): string =>
  isoDate.replace(/-/g, "");

export const resolveProductivityDefaultRange = (
  now: Date = new Date(),
): { start: string; end: string } => {
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (PRODUCTIVITY_DEFAULT_LOOKBACK_DAYS - 1));
  const toKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { start: toKey(start), end: toKey(end) };
};

export const filterProductivityByDateRange = <T extends { date: string }>(
  dailyData: T[],
  fromIso: string | null,
  toIso: string | null,
): T[] => {
  if (!fromIso && !toIso) return dailyData;
  return dailyData.filter((item) => {
    if (fromIso && item.date < fromIso) return false;
    if (toIso && item.date > toIso) return false;
    return true;
  });
};
