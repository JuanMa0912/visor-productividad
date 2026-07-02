import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { isSamePlanillaSede } from "@/lib/horarios/planilla-sede";
import { normalizeScheduleTime } from "@/lib/horarios/schedule-time";
import { normalizePersonNameKey } from "@/lib/shared/normalize";
import type { DayKey, DaySchedule, RowSchedule } from "./types";

export const DAY_ORDER: DayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

/** Primer dia de la fila: ahi no se pinta separador; el resto llevan borde izquierdo mas marcado entre dias. */
export const FIRST_DAY_KEY = DAY_ORDER[0];

export function dayStartDividerClass(day: DayKey): string {
  return day === FIRST_DAY_KEY ? "" : "day-group-start";
}

export const EMPTY_DAY: DaySchedule = {
  he1: "",
  hs1: "",
  he2: "",
  hs2: "",
  conDescanso: false,
};

export const createEmptyRow = (): RowSchedule => ({
  nombre: "",
  firma: "",
  days: {
    domingo: { ...EMPTY_DAY },
    lunes: { ...EMPTY_DAY },
    martes: { ...EMPTY_DAY },
    miercoles: { ...EMPTY_DAY },
    jueves: { ...EMPTY_DAY },
    viernes: { ...EMPTY_DAY },
    sabado: { ...EMPTY_DAY },
  },
});

/**
 * Pantalla: <colgroup> en rem para que HE/HS no se compriman al 100% del viewport.
 * La tabla es mas ancha que la ventana → scroll horizontal (overflow-x-auto).
 * En PDF, @media print anula estos anchos y reparte al 100% del folio.
 */
export const COL_W_NUM = "2.75rem";
export const COL_W_NAME = "17rem";
export const COL_W_TIME = "7rem";
export const COL_W_SIGN = "18rem";

export const SCHEDULE_TIME_INPUT_BASE =
  "schedule-time-input box-border w-full min-w-0 max-w-none rounded border border-slate-200 py-1.5 text-[12px] tabular-nums leading-none tracking-tight focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden";

export const SCHEDULE_OUTER_BORDER_CLASS =
  "border border-slate-300 print:border-slate-900";
export const SCHEDULE_CELL_BORDER_CLASS =
  "border border-slate-300 print:border-slate-900";

/** Widths come from <colgroup>; cells only need border/padding */
/** En print NO usar ancho fijo (p. ej. w-6): las horas desbordan y se ven sobre el borde de la celda siguiente. */
export const TIME_SLOT_TD_CLASS = `${SCHEDULE_CELL_BORDER_CLASS} px-1.5 py-1 align-middle whitespace-nowrap print:whitespace-normal print:px-0.5 print:text-center print:align-middle`;
export const TIME_SLOT_TH_CLASS = `${SCHEDULE_CELL_BORDER_CLASS} px-1 py-2 text-center align-middle uppercase print:px-0.5`;

export const MONTH_OPTIONS = [
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
];

export const LOCAL_DRAFT_VERSION = 1;
export const INITIAL_ROW_COUNT = 16;

export const cloneDaySchedule = (d: DaySchedule): DaySchedule => ({
  he1: d.he1,
  hs1: d.hs1,
  he2: d.he2,
  hs2: d.hs2,
  conDescanso: d.conDescanso,
});

export const parseLunesIndependence = (
  raw: unknown,
): Map<number, Set<DayKey>> => {
  const m = new Map<number, Set<DayKey>>();
  if (!raw || typeof raw !== "object") return m;
  for (const [k, days] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (!Array.isArray(days)) continue;
    const set = new Set<DayKey>();
    for (const d of days) {
      if (typeof d === "string" && DAY_ORDER.includes(d as DayKey)) {
        set.add(d as DayKey);
      }
    }
    if (set.size) m.set(idx, set);
  }
  return m;
};

export const serializeLunesIndependence = (
  map: Map<number, Set<DayKey>>,
): Record<string, DayKey[]> => {
  const o: Record<string, DayKey[]> = {};
  map.forEach((set, row) => {
    if (set.size) o[String(row)] = Array.from(set);
  });
  return o;
};

export const normalizeText = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const matchesSede = (
  employeeSede: string | undefined,
  selectedSede: string,
) => {
  if (!selectedSede.trim()) return false;
  return isSamePlanillaSede(employeeSede ?? "", selectedSede);
};

/** Nombres unicos de empleados asociados a la sede seleccionada (orden alfabético). */
export const listEmployeeNamesForSede = (
  employees: Array<{ name: string; sede?: string }>,
  selectedSede: string,
): string[] => {
  if (!selectedSede.trim()) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const employee of employees) {
    if (!matchesSede(employee.sede, selectedSede)) continue;
    const name = employee.name.trim();
    if (!name) continue;
    const key = normalizePersonNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, "es"));
};

/** Indica si la fila ya tiene nombre, firma u horarios capturados. */
export const rowScheduleHasContent = (row: RowSchedule): boolean => {
  if (row.nombre.trim() || row.firma.trim()) return true;
  return DAY_ORDER.some((day) => {
    const slot = row.days[day];
    return (
      slot.conDescanso ||
      Boolean(slot.he1.trim()) ||
      Boolean(slot.hs1.trim()) ||
      Boolean(slot.he2.trim()) ||
      Boolean(slot.hs2.trim())
    );
  });
};

/** Reindexa mapas keyed por indice de fila tras eliminar una fila intermedia. */
export const reindexRowMapAfterRemoval = <T>(
  source: Map<number, T>,
  removedIndex: number,
): Map<number, T> => {
  const next = new Map<number, T>();
  for (const [idx, value] of source.entries()) {
    if (idx === removedIndex) continue;
    next.set(idx > removedIndex ? idx - 1 : idx, value);
  }
  return next;
};

export const reindexRowRecordAfterRemoval = <T>(
  source: Record<number, T>,
  removedIndex: number,
): Record<number, T> => {
  const next: Record<number, T> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const idx = Number(rawKey);
    if (!Number.isFinite(idx) || idx === removedIndex) continue;
    next[idx > removedIndex ? idx - 1 : idx] = value;
  }
  return next;
};

/**
 * Crea una fila por empleado de la sede. Si no hay empleados, conserva las
 * filas vacias iniciales para captura manual.
 */
export const buildRowsFromEmployeeNames = (names: string[]): RowSchedule[] => {
  if (names.length === 0) {
    return Array.from({ length: INITIAL_ROW_COUNT }, () => createEmptyRow());
  }
  return names.map((name) => ({
    ...createEmptyRow(),
    nombre: name,
  }));
};

/**
 * Mientras se escribe: solo digitos y ":"; horas 00-23, minutos 00-59.
 * No sustituye por 23/59: si un dígito deja el valor inválido, no se aplica (se queda el anterior).
 */
export const sanitizeTimeTyping = (raw: string) => {
  const s = raw.replace(/[^\d:]/g, "");
  if (!s.includes(":")) {
    let d = s.replace(/\D/g, "").slice(0, 4);
    if (d.length >= 2) {
      const hh = Number(d.slice(0, 2));
      if (hh > 23) d = d.slice(0, 1);
    }
    if (d.length >= 4) {
      const mm = Number(d.slice(2, 4));
      if (mm > 59) d = d.slice(0, 3);
    }
    return d;
  }
  const idx = s.indexOf(":");
  if (idx === 0) {
    let right = s
      .slice(idx + 1)
      .replace(/:/g, "")
      .slice(0, 2);
    if (right.length >= 1 && Number(right[0] ?? 9) > 5) right = "";
    if (right.length === 2 && Number(right) > 59) right = right.slice(0, 1);
    return right ? `:${right}`.slice(0, 5) : ":";
  }

  let left = s.slice(0, idx).replace(/:/g, "").slice(0, 2);
  let right = s
    .slice(idx + 1)
    .replace(/:/g, "")
    .slice(0, 2);

  if (left.length === 2 && Number(left) > 23) {
    left = left.slice(0, 1);
  }

  if (right.length >= 1) {
    const d0 = right[0];
    if (d0 !== undefined && Number(d0) > 5) right = "";
  }
  if (right.length === 2 && Number(right) > 59) {
    right = right.slice(0, 1);
  }

  return `${left}:${right}`.slice(0, 5);
};

export const handleScheduleEnterAdvance = (
  event: ReactKeyboardEvent<HTMLInputElement>,
) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const row = event.currentTarget.closest("tr");
  if (!row) return;
  const inputs = Array.from(
    row.querySelectorAll<HTMLInputElement>('input[data-schedule-time="1"]'),
  );
  const currentIdx = inputs.indexOf(event.currentTarget);
  const afterCurrent = inputs.slice(currentIdx + 1);
  const nextEmpty =
    afterCurrent.find((i) => !i.value.trim()) ??
    inputs.find((i) => !i.value.trim() && i !== event.currentTarget);
  if (nextEmpty) nextEmpty.focus();
};

export const formatTimeForDisplay = (value?: string) => {
  const t = (value ?? "").trim();
  if (!t) return "";
  const normalized = normalizeScheduleTime(t);
  if (normalized) return normalized;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return t.length <= 5 ? t : t.slice(0, 5);
};
