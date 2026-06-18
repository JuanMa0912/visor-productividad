import type { PersonBreakdownView } from "./types";

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
// Se usa `>` (estricto), asi que las constantes apuntan al ultimo minuto
// excluido.
// >9:20 -> arranca en 9:21: NO se cuentan las jornadas de exactamente 9:20,
// solo desde 9:21h en adelante.
export const ALERT_THRESHOLD_MINUTES = 9 * 60 + 20;
export const TWO_MARKS_ALERT_THRESHOLD_MINUTES = 7 * 60 + 30; // >7:30 -> arranca en 7:31
// Limite superior del rango ">7:20H con 2 marcaciones" (inclusivo). Se queda
// en 9:19 (sin cambios): una jornada de exactamente 9:20 no entra aqui ni en
// ">9:20H", queda fuera de ambos buckets a proposito.
export const TWO_MARKS_ALERT_UPPER_BOUND_MINUTES = 9 * 60 + 19;

export const OVERTIME_TABLE_OUTER_BORDER_CLASS = "border border-slate-200/90";
export const OVERTIME_TABLE_INNER_BORDER_CLASS = "border-slate-200";

export const PPT_SEDE_KEYS = new Set([
  "panificadora",
  "planta desposte mixto",
  "planta desprese pollo",
]);
