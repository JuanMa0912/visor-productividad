export function parseLocalYmd(ymd: string): Date {
  const parts = ymd.split("-").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return new Date(NaN);
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** YYYY-MM-DD en calendario local (evita desfaces UTC vs Colombia). */
export function dateToLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstDayOfMonth(year: number, month1to12: number): string {
  return dateToLocalYmd(new Date(year, month1to12 - 1, 1));
}

function lastDayOfMonth(year: number, month1to12: number): string {
  return dateToLocalYmd(new Date(year, month1to12, 0));
}

/** Mes/año calendario como número comparable (año * 12 + mes). */
function monthIndex(year: number, month1to12: number): number {
  return year * 12 + (month1to12 - 1);
}

export type ExcelDianPeriodRange = {
  start: string;
  end: string;
  /** El fin se acotó al día de hoy (periodo aún en curso o que llega a hoy). */
  cappedAtToday: boolean;
};

/**
 * Lapso inclusivo de meses (desde el día 1 del mes inicial hasta el último día
 * del mes final). Si el intervalo calendario llega más allá de hoy, el fin
 * queda en hoy. Si todo el lapso es futuro, se devuelve el rango calendario
 * completo (sin acotar el inicio).
 */
export function buildExcelDianMonthSpanRange(
  startMonth: string,
  startYear: string,
  endMonth: string,
  endYear: string,
  today: Date = new Date(),
): ExcelDianPeriodRange {
  const ys = Number.parseInt(startYear, 10);
  const ms = Number.parseInt(startMonth, 10);
  const ye = Number.parseInt(endYear, 10);
  const me = Number.parseInt(endMonth, 10);
  if (
    ![ys, ms, ye, me].every((n) => Number.isFinite(n)) ||
    ms < 1 ||
    ms > 12 ||
    me < 1 ||
    me > 12
  ) {
    return { start: "", end: "", cappedAtToday: false };
  }

  let yStart = ys;
  let mStart = ms;
  let yEnd = ye;
  let mEnd = me;
  if (monthIndex(yEnd, mEnd) < monthIndex(yStart, mStart)) {
    yStart = ye;
    mStart = me;
    yEnd = ys;
    mEnd = ms;
  }

  const naturalStart = firstDayOfMonth(yStart, mStart);
  const naturalEnd = lastDayOfMonth(yEnd, mEnd);
  const todayStr = dateToLocalYmd(today);

  const ns = parseLocalYmd(naturalStart);
  const ne = parseLocalYmd(naturalEnd);
  const t0 = parseLocalYmd(todayStr);
  if (Number.isNaN(ns.getTime()) || Number.isNaN(ne.getTime()) || Number.isNaN(t0.getTime())) {
    return { start: "", end: "", cappedAtToday: false };
  }

  if (ns > t0) {
    return {
      start: naturalStart,
      end: naturalEnd,
      cappedAtToday: false,
    };
  }
  if (ne <= t0) {
    return {
      start: naturalStart,
      end: naturalEnd,
      cappedAtToday: false,
    };
  }

  return {
    start: naturalStart,
    end: todayStr,
    cappedAtToday: true,
  };
}

/** Un solo mes (equivale a lapso mismo mes / mismo año). */
export function buildExcelDianInclusiveRange(
  month: string,
  year: string,
  today: Date = new Date(),
): ExcelDianPeriodRange {
  return buildExcelDianMonthSpanRange(month, year, month, year, today);
}

/** Año calendario completo (enero–diciembre del año elegido). */
export function buildExcelDianFullYearRange(
  year: string,
  today: Date = new Date(),
): ExcelDianPeriodRange {
  return buildExcelDianMonthSpanRange("01", year, "12", year, today);
}

export type ExcelDianPeriodMode = "single_month" | "month_span" | "full_year";

export const EXCEL_DIAN_PERIOD_MODE_OPTIONS: {
  value: ExcelDianPeriodMode;
  label: string;
  description: string;
}[] = [
  {
    value: "single_month",
    label: "Un mes",
    description: "Un mes y año concretos",
  },
  {
    value: "month_span",
    label: "Varios meses",
    description: "Desde un mes hasta otro (inclusive)",
  },
  {
    value: "full_year",
    label: "Año entero",
    description: "Enero a diciembre del año elegido",
  },
];
