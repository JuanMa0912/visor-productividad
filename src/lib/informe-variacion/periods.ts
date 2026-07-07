import type { InformePeriodRange, InformePeriods } from "@/lib/informe-variacion/types";

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

export const toCompactDate = (year: number, month: number, day: number): string =>
  `${year}${pad2(month)}${pad2(day)}`;

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

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

export const computeInformePeriods = (
  year: number,
  month: number,
): InformePeriods => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Año inválido para el informe.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Mes inválido para el informe.");
  }

  const curFrom = toCompactDate(year, month, 1);
  const curTo = toCompactDate(year, month, lastDayOfMonth(year, month));

  const momMonth = month === 1 ? 12 : month - 1;
  const momYear = month === 1 ? year - 1 : year;
  const momFrom = toCompactDate(momYear, momMonth, 1);
  const momTo = toCompactDate(momYear, momMonth, lastDayOfMonth(momYear, momMonth));

  const yoyFrom = toCompactDate(year - 1, month, 1);
  const yoyTo = toCompactDate(
    year - 1,
    month,
    lastDayOfMonth(year - 1, month),
  );

  const build = (from: string, to: string): InformePeriodRange => ({
    from,
    to,
    label: formatInformePeriodLabel(from, to),
  });

  return {
    current: build(curFrom, curTo),
    mom: build(momFrom, momTo),
    yoy: build(yoyFrom, yoyTo),
  };
};

export const defaultInformeYearMonth = (
  maxCompact: string | null | undefined,
): { year: number; month: number } => {
  if (maxCompact && /^\d{8}$/.test(maxCompact)) {
    return {
      year: Number(maxCompact.slice(0, 4)),
      month: Number(maxCompact.slice(4, 6)),
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
