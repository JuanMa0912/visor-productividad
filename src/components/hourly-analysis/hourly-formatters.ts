export const getHeatColor = (ratioPercent: number) => {
  if (ratioPercent >= 110) return "#16a34a";
  if (ratioPercent >= 100) return "#facc15";
  if (ratioPercent >= 90) return "#f97316";
  return "#dc2626";
};

export const formatProductivity = (value: number) => value.toFixed(3);

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

export const formatCurrencyWithoutSixZeros = (value: number) =>
  `$ ${(value / 1_000_000).toLocaleString("es-CO", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })}`;

export const formatCurrencyMillionsOneDecimal = (value: number) =>
  `$ ${(value / 1_000_000).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;

export const normalizeDateKeyForDisplay = (raw: string) => {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value;
};

export const cashierHourDetailCacheKey = (personKey: string, isoDate: string) =>
  `${personKey}|||${isoDate}`;

export const loadExcelJs = () => import("exceljs");

export const formatHoursBase60 = (value: number) => {
  if (!Number.isFinite(value)) return "0.00";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  let hours = Math.floor(abs);
  let minutes = Math.round((abs - hours) * 60);
  if (minutes >= 60) {
    hours += 1;
    minutes = 0;
  }
  return `${sign}${hours}.${String(minutes).padStart(2, "0")}`;
};

/** Horas desde minutos totales; maximo 2 decimales (tabla cajeros). */
export const formatTotalLaborMinutesLabel = (totalMinutes: number) => {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0,00h";
  const hoursVal = totalMinutes / 60;
  const rounded = Math.round(hoursVal * 100) / 100;
  const str = rounded.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  return `${str}h`;
};

export const decimalHoursToMinutes = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 60);
};

export const parseBase60HoursInputToMinutes = (
  value: string,
): number | null => {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace(",", ".");
  const [hoursPartRaw, minutesPartRaw] = normalized.split(".");
  const hours = Number(hoursPartRaw);
  if (!Number.isFinite(hours) || hours < 0) return null;

  if (minutesPartRaw === undefined) {
    return Math.round(hours * 60);
  }

  const onlyDigits = minutesPartRaw.replace(/\D/g, "");
  if (!onlyDigits) return Math.round(hours * 60);

  // 9.2 -> 9:20, 9.12 -> 9:12
  const paddedMinutes =
    onlyDigits.length === 1 ? `${onlyDigits}0` : onlyDigits.slice(0, 2);
  const minutes = Number(paddedMinutes);
  if (!Number.isFinite(minutes)) return null;

  return Math.round(hours) * 60 + Math.min(59, Math.max(0, minutes));
};

export const calcVtaHr = (sales: number, laborHours: number) =>
  laborHours > 0 ? sales / 1_000_000 / laborHours : 0;

export const minuteOfDayToHHMM = (
  minute: number | null | undefined,
): string | null => {
  if (typeof minute !== "number" || !Number.isFinite(minute) || minute < 0) {
    return null;
  }
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export const minuteToTime = (value: number) => {
  const safe = Math.max(0, Math.min(1439, value));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const parseTimeToMinute = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return 0;
  }
  return hours * 60 + minutes;
};
