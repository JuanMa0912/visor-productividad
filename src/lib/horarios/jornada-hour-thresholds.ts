/**
 * Umbrales del bucket "X:YYh con 2 marcaciones" en jornada-extendida / Alex.
 *
 * Desde 2026-07-16 Colombia redujo 20 minutos la jornada base usada en ese
 * bucket: la etiqueta pasa de 7:20h a 7:00h. El bucket de 9:20h NO cambia.
 *
 * Los cortes internos conservan el margen historico respecto a la etiqueta
 * (UI: +10 min; API Alex: +9 min) para no alterar el comportamiento relativo.
 */

export const JORNADA_TWO_MARKS_SHORTENED_FROM = "2026-07-16";

/** Etiqueta operativa antes del cambio. */
export const TWO_MARKS_LABEL_LEGACY = "7:20h";
/** Etiqueta operativa desde el 16/07/2026. */
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

/** Tope superior del bucket 7:xx (inclusivo). No se mueve; 9:20 queda intacto. */
export const TWO_MARKS_UPPER_BOUND_MINUTES = 9 * 60 + 19;
export const TWO_MARKS_UPPER_BOUND_HOURS = 9 + 19.5 / 60;

/** Bucket 9:20h (sin cambios). */
export const NINE_TWENTY_THRESHOLD_MINUTES = 9 * 60 + 20;
export const NINE_TWENTY_THRESHOLD_HOURS = 9 + 20.5 / 60;

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

export const twoMarksLabelForDate = (
  workedDate: string | null | undefined,
): string =>
  usesShortenedTwoMarksThreshold(workedDate)
    ? TWO_MARKS_LABEL_SHORTENED
    : TWO_MARKS_LABEL_LEGACY;

/**
 * Etiqueta para un rango (chips / export). Si cruza el corte, menciona ambos.
 */
export const twoMarksLabelForRange = (
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string => {
  const start = normalizeJornadaDateKey(startDate);
  const end = normalizeJornadaDateKey(endDate);
  if (!start && !end) return TWO_MARKS_LABEL_SHORTENED;
  if (end && end < JORNADA_TWO_MARKS_SHORTENED_FROM) {
    return TWO_MARKS_LABEL_LEGACY;
  }
  if (start && start >= JORNADA_TWO_MARKS_SHORTENED_FROM) {
    return TWO_MARKS_LABEL_SHORTENED;
  }
  if (
    start &&
    end &&
    start < JORNADA_TWO_MARKS_SHORTENED_FROM &&
    end >= JORNADA_TWO_MARKS_SHORTENED_FROM
  ) {
    return `${TWO_MARKS_LABEL_SHORTENED}/${TWO_MARKS_LABEL_LEGACY}`;
  }
  // Solo start o solo end ambiguo: preferir shortened si alguna punta ya paso el corte.
  if (
    (start && start >= JORNADA_TWO_MARKS_SHORTENED_FROM) ||
    (end && end >= JORNADA_TWO_MARKS_SHORTENED_FROM)
  ) {
    return TWO_MARKS_LABEL_SHORTENED;
  }
  return TWO_MARKS_LABEL_LEGACY;
};

export const isInTwoMarksHoursBucket = (
  totalHours: number,
  marksCount: number,
  workedDate: string | null | undefined,
): boolean =>
  totalHours > twoMarksThresholdHoursForDate(workedDate) &&
  totalHours <= TWO_MARKS_UPPER_BOUND_HOURS &&
  marksCount === 2;

export const isInTwoMarksMinutesBucket = (
  totalMinutes: number,
  marksCount: number,
  workedDate: string | null | undefined,
): boolean =>
  totalMinutes > twoMarksThresholdMinutesForDate(workedDate) &&
  totalMinutes <= TWO_MARKS_UPPER_BOUND_MINUTES &&
  marksCount === 2;
