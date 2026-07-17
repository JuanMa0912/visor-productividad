import type { PersonBreakdownView } from "./types";
import {
  NINE_TWENTY_THRESHOLD_MINUTES,
  TWO_MARKS_THRESHOLD_MINUTES_LEGACY,
  TWO_MARKS_UPPER_BOUND_MINUTES,
} from "@/lib/horarios/jornada-hour-thresholds";

export const hourlyDateLabelOptions: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
};

export const CASHIER_MONTH_TOP_N = 5;

/** Valor interno del `<select>` para filtrar cajeros sin cargo (no usar como cargo real). */
export const CASHIER_CARGO_SELECT_EMPTY = "__sin_cargo__";

/**
 * Cargos estandar del area de cajas que SIEMPRE deben aparecer en el filtro
 * "Cargo" del bloque "Por cajeros", aunque para el usuario actual no haya
 * personas visibles de ese cargo (p. ej. cedulas ocultas). Se unifican con
 * cualquier cargo extra que llegue dinamicamente desde la data.
 */
export const CASHIER_FIXED_CARGOS: readonly string[] = [
  "CAJERO 36 HORAS",
  "CAJERO MEDIO TIEMPO",
  "CAJEROS",
  "SUPERVISOR (A) DE CAJA",
];

export const PERSON_BREAKDOWN_VIEW_OPTIONS: Array<{
  value: PersonBreakdownView;
  label: string;
  hint: string;
}> = [
  {
    value: "individual",
    label: "Aporte individual",
    hint: "Cajeros, aporte y picos",
  },
  {
    value: "franjas",
    label: "Desglose por franjas",
    hint: "Horas, ventas y variaciones",
  },
];

export const OVERTIME_PAGE_SIZE = 150;
export const OVERTIME_PAGE_TAB_WINDOW = 8;
export const CASHIER_PAGE_SIZE_OPTIONS = [10, 30, 50, 100, 200] as const;
export const CASHIER_PAGE_SIZE_DEFAULT = 30;
export const CASHIER_PAGE_TAB_WINDOW = 8;

// Umbrales para los botones "Ver personas >X:YYh".
// El bucket de 2 marcaciones es date-aware desde 2026-07-16 (-20 min);
// ver `src/lib/horarios/jornada-hour-thresholds.ts`. 9:20h no cambia.
export const ALERT_THRESHOLD_MINUTES = NINE_TWENTY_THRESHOLD_MINUTES;
/** @deprecated Preferir twoMarksThresholdMinutesForDate(workedDate). */
export const TWO_MARKS_ALERT_THRESHOLD_MINUTES =
  TWO_MARKS_THRESHOLD_MINUTES_LEGACY;
export const TWO_MARKS_ALERT_UPPER_BOUND_MINUTES = TWO_MARKS_UPPER_BOUND_MINUTES;

export const OVERTIME_TABLE_OUTER_BORDER_CLASS = "border border-slate-200/90";
export const OVERTIME_TABLE_INNER_BORDER_CLASS = "border-slate-200";

export const PPT_SEDE_KEYS = new Set([
  "panificadora",
  "planta desposte mixto",
  "planta desprese pollo",
]);
