import { normalizeScheduleTime } from "@/lib/horarios/schedule-time";
import {
  DAY_ORDER,
  INITIAL_ROW_COUNT,
  LOCAL_DRAFT_VERSION,
  createEmptyRow,
} from "./schedule-utils";
import type { DayKey, DaySchedule, RowSchedule, ScheduleDraft } from "./types";

export const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

export const getDraftStorageKey = (username: string) =>
  `vp:ingresar-horarios:draft:${username}`;

export const createSafeDraftRows = (rows: unknown) => {
  if (!Array.isArray(rows)) {
    return Array.from({ length: INITIAL_ROW_COUNT }, () => createEmptyRow());
  }

  return Array.from({ length: INITIAL_ROW_COUNT }, (_, index) => {
    const sourceRow = rows[index] as
      | {
          nombre?: string;
          firma?: string;
          days?: Partial<Record<DayKey, Partial<DaySchedule>>>;
        }
      | undefined;

    if (!sourceRow) return createEmptyRow();

    const nextRow = createEmptyRow();
    nextRow.nombre =
      typeof sourceRow.nombre === "string" ? sourceRow.nombre : "";
    nextRow.firma = typeof sourceRow.firma === "string" ? sourceRow.firma : "";

    for (const dayKey of DAY_ORDER) {
      const sourceDay = sourceRow.days?.[dayKey];
      nextRow.days[dayKey] = {
        he1:
          typeof sourceDay?.he1 === "string"
            ? normalizeScheduleTime(sourceDay.he1)
            : "",
        hs1:
          typeof sourceDay?.hs1 === "string"
            ? normalizeScheduleTime(sourceDay.hs1)
            : "",
        he2:
          typeof sourceDay?.he2 === "string"
            ? normalizeScheduleTime(sourceDay.he2)
            : "",
        hs2:
          typeof sourceDay?.hs2 === "string"
            ? normalizeScheduleTime(sourceDay.hs2)
            : "",
        conDescanso: Boolean(sourceDay?.conDescanso),
      };
    }

    return nextRow;
  });
};

export const readScheduleDraft = (username: string) => {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.localStorage.getItem(getDraftStorageKey(username));
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<ScheduleDraft> | null;
    if (!parsed || parsed.version !== LOCAL_DRAFT_VERSION) return null;

    return {
      sede: typeof parsed.sede === "string" ? parsed.sede : "",
      seccion: typeof parsed.seccion === "string" ? parsed.seccion : "Cajas",
      fechaInicial:
        typeof parsed.fechaInicial === "string" ? parsed.fechaInicial : "",
      fechaFinal:
        typeof parsed.fechaFinal === "string" ? parsed.fechaFinal : "",
      mes: typeof parsed.mes === "string" ? parsed.mes : "",
      rows: createSafeDraftRows(parsed.rows),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      syncLunesToRest:
        typeof parsed.syncLunesToRest === "boolean"
          ? parsed.syncLunesToRest
          : false,
      lunesIndependentByRow: parsed.lunesIndependentByRow,
    };
  } catch {
    return null;
  }
};

export const writeScheduleDraft = (username: string, draft: ScheduleDraft) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getDraftStorageKey(username),
    JSON.stringify(draft),
  );
};

export const clearScheduleDraft = (username: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getDraftStorageKey(username));
};

export function mergeLoadedPlanillaRows(
  apiRows: Array<{
    rowIndex?: number;
    nombre?: string;
    firma?: string;
    days?: RowSchedule["days"];
  }>,
): RowSchedule[] {
  // Calcular cuantas filas necesitamos para incluir todas las que vienen del API.
  // Antes se truncaba a INITIAL_ROW_COUNT (16) y se perdian los registros extra
  // al editar una planilla con mas de 16 empleados.
  const maxRowIndex = apiRows.reduce<number>((acc, r, i) => {
    const idx =
      typeof r.rowIndex === "number" && r.rowIndex >= 0 ? r.rowIndex : i;
    return Math.max(acc, idx);
  }, -1);
  const totalRows = Math.max(INITIAL_ROW_COUNT, maxRowIndex + 1);
  const base = Array.from({ length: totalRows }, () => createEmptyRow());
  apiRows.forEach((r, i) => {
    const candidateIdx =
      typeof r.rowIndex === "number" && r.rowIndex >= 0 ? r.rowIndex : i;
    if (candidateIdx < 0 || candidateIdx >= totalRows) return;
    const empty = createEmptyRow();
    base[candidateIdx] = {
      nombre: typeof r.nombre === "string" ? r.nombre : "",
      firma: typeof r.firma === "string" ? r.firma : "",
      days: { ...empty.days },
    };
    for (const dk of DAY_ORDER) {
      const src = r.days?.[dk];
      base[candidateIdx].days[dk] = {
        he1: typeof src?.he1 === "string" ? normalizeScheduleTime(src.he1) : "",
        hs1: typeof src?.hs1 === "string" ? normalizeScheduleTime(src.hs1) : "",
        he2: typeof src?.he2 === "string" ? normalizeScheduleTime(src.he2) : "",
        hs2: typeof src?.hs2 === "string" ? normalizeScheduleTime(src.hs2) : "",
        conDescanso: Boolean(src?.conDescanso),
      };
    }
  });
  return base;
}
