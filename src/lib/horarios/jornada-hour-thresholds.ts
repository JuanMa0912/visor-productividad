/**
 * Umbrales de buckets "X:YYh" en jornada-extendida / Alex.
 *
 * Desde 2026-07-16 Colombia redujo 20 minutos la jornada base:
 * - 7:20h → 7:00h (bucket 2 marcaciones)
 * - 9:20h → 9:00h
 *
 * Los cortes internos del bucket 7:xx conservan el margen historico respecto
 * a la etiqueta (UI: +10 min; API Alex: +9 min). El tope superior del bucket
 * 7:xx baja junto con el umbral de 9:xx para no solaparse.
 */

export const JORNADA_TWO_MARKS_SHORTENED_FROM = "2026-07-16";

/** Etiqueta operativa 7:xx antes del cambio. */
export const TWO_MARKS_LABEL_LEGACY = "7:20h";
/** Etiqueta operativa 7:xx desde el 16/07/2026. */
export const TWO_MARKS_LABEL_SHORTENED = "7:00h";

/**
 * UI (`>` estricto): ultimo minuto excluido.
 * Legacy etiqueta 7:20 → interno >7:30. Shortened 7:00 → interno >7:10.
 */
export const TWO_MARKS_THRESHOLD_MINUTES_LEGACY = 7 * 60 + 30;
export const TWO_MARKS_THRESHOLD_MINUTES_SHORTENED =
  TWO_MARKS_THRESHOLD_MINUTES_LEGACY - 20;

/**
 * API Alex (horas decimales, `>` estricto).
 * Legacy etiqueta 7:20 → 7:29h. Shortened → 7:09h.
 */
export const TWO_MARKS_THRESHOLD_HOURS_LEGACY = 7 + 29 / 60;
export const TWO_MARKS_THRESHOLD_HOURS_SHORTENED =
  TWO_MARKS_THRESHOLD_HOURS_LEGACY - 20 / 60;

/** Etiqueta operativa 9:xx antes del cambio. */
export const NINE_TWENTY_LABEL_LEGACY = "9:20h";
/** Etiqueta operativa 9:xx desde el 16/07/2026. */
export const NINE_TWENTY_LABEL_SHORTENED = "9:00h";

/** UI (`>` estricto). Legacy >9:20. Shortened >9:00. */
export const NINE_TWENTY_THRESHOLD_MINUTES_LEGACY = 9 * 60 + 20;
export const NINE_TWENTY_THRESHOLD_MINUTES_SHORTENED =
  NINE_TWENTY_THRESHOLD_MINUTES_LEGACY - 20;

/**
 * API Alex (horas decimales, `>` estricto).
 * Legacy 9:20.5 → Shortened 9:00.5.
 */
export const NINE_TWENTY_THRESHOLD_HOURS_LEGACY = 9 + 20.5 / 60;
export const NINE_TWENTY_THRESHOLD_HOURS_SHORTENED =
  NINE_TWENTY_THRESHOLD_HOURS_LEGACY - 20 / 60;

/** @deprecated Preferir NINE_TWENTY_THRESHOLD_MINUTES_LEGACY / ForDate. */
export const NINE_TWENTY_THRESHOLD_MINUTES = NINE_TWENTY_THRESHOLD_MINUTES_LEGACY;
/** @deprecated Preferir NINE_TWENTY_THRESHOLD_HOURS_LEGACY / ForDate. */
export const NINE_TWENTY_THRESHOLD_HOURS = NINE_TWENTY_THRESHOLD_HOURS_LEGACY;

/**
 * Tope superior del bucket 7:xx (inclusivo). Baja 20 min junto con 9:xx
 * para que no se solape con el alert de 9:00h.
 */
export const TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY = 9 * 60 + 19;
export const TWO_MARKS_UPPER_BOUND_MINUTES_SHORTENED =
  TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY - 20;
export const TWO_MARKS_UPPER_BOUND_HOURS_LEGACY = 9 + 19.5 / 60;
export const TWO_MARKS_UPPER_BOUND_HOURS_SHORTENED =
  TWO_MARKS_UPPER_BOUND_HOURS_LEGACY - 20 / 60;

/** @deprecated Preferir twoMarksUpperBoundMinutesForDate. */
export const TWO_MARKS_UPPER_BOUND_MINUTES = TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY;
/** @deprecated Preferir twoMarksUpperBoundHoursForDate. */
export const TWO_MARKS_UPPER_BOUND_HOURS = TWO_MARKS_UPPER_BOUND_HOURS_LEGACY;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeJornadaDateKey = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") return null;
  const key = value.trim().slice(0, 10);
  return DATE_KEY_RE.test(key) ? key : null;
};

/** true si la jornada cae en el regimen de -20 min (desde 16/07/2026). */
export const usesShortenedTwoMarksThreshold = (
  workedDate: string | null | undefined,
): boolean => {
  const key = normalizeJornadaDateKey(workedDate);
  if (!key) return false;
  return key >= JORNADA_TWO_MARKS_SHORTENED_FROM;
};

export const twoMarksThresholdMinutesForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_THRESHOLD_MINUTES_SHORTENED
    : TWO_MARKS_THRESHOLD_MINUTES_LEGACY;

export const twoMarksThresholdHoursForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_THRESHOLD_HOURS_SHORTENED
    : TWO_MARKS_THRESHOLD_HOURS_LEGACY;

export const twoMarksUpperBoundMinutesForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_UPPER_BOUND_MINUTES_SHORTENED
    : TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY;

export const twoMarksUpperBoundHoursForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_UPPER_BOUND_HOURS_SHORTENED
    : TWO_MARKS_UPPER_BOUND_HOURS_LEGACY;

export const twoMarksLabelForDate = (
  workedDate: string | null | undefined,
): string =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_LABEL_SHORTENED
    : TWO_MARKS_LABEL_LEGACY;

export const nineTwentyThresholdMinutesForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? NINE_TWENTY_THRESHOLD_MINUTES_SHORTENED
    : NINE_TWENTY_THRESHOLD_MINUTES_LEGACY;

export const nineTwentyThresholdHoursForDate = (
  workedDate: string | null | undefined,
): number =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? NINE_TWENTY_THRESHOLD_HOURS_SHORTENED
    : NINE_TWENTY_THRESHOLD_HOURS_LEGACY;

export const nineTwentyLabelForDate = (
  workedDate: string | null | undefined,
): string =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? NINE_TWENTY_LABEL_SHORTENED
    : NINE_TWENTY_LABEL_LEGACY;

const labelForRange = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  legacy: string,
  shortened: string,
): string => {
  const start = normalizeJornadaDateKey(startDate);
  const end = normalizeJornadaDateKey(endDate);
  if (!start && !end) return shortened;
  if (end && end < JORNADA_TWO_MARKS_SHORTENED_FROM) {
    return legacy;
  }
  if (start && start >= JORNADA_TWO_MARKS_SHORTENED_FROM) {
    return shortened;
  }
  if (
    start &&
    end &&
    start < JORNADA_TWO_MARKS_SHORTENED_FROM &&
    end >= JORNADA_TWO_MARKS_SHORTENED_FROM
  ) {
    return `${shortened}/${legacy}`;
  }
  if (
    (start && start >= JORNADA_TWO_MARKS_SHORTENED_FROM) ||
    (end && end >= JORNADA_TWO_MARKS_SHORTENED_FROM)
  ) {
    return shortened;
  }
  return legacy;
};

/**
 * Etiqueta 7:xx para un rango (chips / export). Si cruza el corte, menciona ambos.
 */
export const twoMarksLabelForRange = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string =>
  labelForRange(
    startDate,
    endDate,
    TWO_MARKS_LABEL_LEGACY,
    TWO_MARKS_LABEL_SHORTENED,
  );

/**
 * Etiqueta 9:xx para un rango (chips / export). Si cruza el corte, menciona ambos.
 */
export const nineTwentyLabelForRange = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string =>
  labelForRange(
    startDate,
    endDate,
    NINE_TWENTY_LABEL_LEGACY,
    NINE_TWENTY_LABEL_SHORTENED,
  );

export const isInTwoMarksHoursBucket = (
  totalHours: number,
  marksCount: number,
  workedDate: string | null | undefined,
): boolean =>
  totalHours > twoMarksThresholdHoursForDate(workedDate) &&
  totalHours <= twoMarksUpperBoundHoursForDate(workedDate) &&
  marksCount === 2;

export const isInTwoMarksMinutesBucket = (
  totalMinutes: number,
  marksCount: number,
  workedDate: string | null | undefined,
): boolean =>
  totalMinutes > twoMarksThresholdMinutesForDate(workedDate) &&
  totalMinutes <= twoMarksUpperBoundMinutesForDate(workedDate) &&
  marksCount === 2;

export const isInNineTwentyMinutesBucket = (
  totalMinutes: number,
  workedDate: string | null | undefined,
): boolean => totalMinutes > nineTwentyThresholdMinutesForDate(workedDate);

export const isInNineTwentyHoursBucket = (
  totalHours: number,
  workedDate: string | null | undefined,
): boolean => totalHours > nineTwentyThresholdHoursForDate(workedDate);
