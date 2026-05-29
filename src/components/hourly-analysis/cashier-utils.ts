import {
  computeSlotWorkedMinutes,
  getCashierSlotLaborHours,
  type CashierAttendanceShiftMarks,
} from "@/lib/hourly/cashier-slot-labor";
import { formatDateLabel } from "@/lib/shared/utils";
import type { HourlyPersonContribution } from "@/types";
import { calcVtaHr, decimalHoursToMinutes, minuteOfDayToHHMM } from "./hourly-formatters";

export const totalPersonContributionSales = (person: HourlyPersonContribution) => {
  if (person.periodTotalSales != null) return person.periodTotalSales;
  return person.hourlySales.reduce((sum, slot) => sum + slot.sales, 0);
};

export const getContributionLaborMinutes = (
  person: HourlyPersonContribution,
  bucketMinutes: number,
) => {
  const att = person.attendanceWorkedHours;
  if (typeof att === "number" && Number.isFinite(att) && att > 0) {
    return Math.round(att * 60);
  }
  const slots =
    (typeof person.activeSlotsCount === "number"
      ? person.activeSlotsCount
      : person.hourlySales.length) || 0;
  return slots * bucketMinutes;
};

type CashierRankingRow = {
  personKey: string;
  personName: string;
  personId: string | null;
  sales: number;
  hours: number;
  vtaHr: number;
};

export const rankTopCashiers = (
  people: HourlyPersonContribution[] | undefined,
  limit: number,
  bucketMinutes: number,
): CashierRankingRow[] => {
  if (!people?.length) return [];
  const withMetrics = people.map((p) => {
    const sales = totalPersonContributionSales(p);
    const minutes = getContributionLaborMinutes(p, bucketMinutes);
    const hours = minutes / 60;
    const vtaHr = hours > 0 ? sales / 1_000_000 / hours : 0;
    return {
      personKey: p.personKey,
      personName: p.personName,
      personId: p.personId?.trim() ? p.personId : null,
      sales,
      hours,
      vtaHr,
    };
  });
  withMetrics.sort((a, b) => {
    if (b.vtaHr !== a.vtaHr) return b.vtaHr - a.vtaHr;
    return b.sales - a.sales;
  });
  return withMetrics
    .filter((r) => r.sales > 0 && r.hours > 0)
    .slice(0, limit);
};

export const rankImproveCashiers = (
  people: HourlyPersonContribution[] | undefined,
  limit: number,
  bucketMinutes: number,
): CashierRankingRow[] => {
  if (!people?.length) return [];
  const withMetrics = people.map((p) => {
    const sales = totalPersonContributionSales(p);
    const minutes = getContributionLaborMinutes(p, bucketMinutes);
    const hours = minutes / 60;
    const vtaHr = hours > 0 ? sales / 1_000_000 / hours : 0;
    return {
      personKey: p.personKey,
      personName: p.personName,
      personId: p.personId?.trim() ? p.personId : null,
      sales,
      hours,
      vtaHr,
    };
  });
  withMetrics.sort((a, b) => {
    if (a.vtaHr !== b.vtaHr) return a.vtaHr - b.vtaHr;
    return b.sales - a.sales;
  });
  return withMetrics
    .filter((r) => r.sales > 0 && r.hours > 0)
    .slice(0, limit);
};

/** Mes calendario anterior (completo) vs mes que contiene `anchorISO`, desde el dia 1 hasta `anchorISO` (o fin de mes si es menor). */
export const getCashierMonthComparisonRanges = (anchorISO: string) => {
  const [y, m, d] = anchorISO.split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  const yi = anchor.getFullYear();
  const mi = anchor.getMonth();

  const prevMonthLast = new Date(yi, mi, 0);
  const prevMonthFirst = new Date(yi, mi - 1, 1);
  const currMonthFirst = new Date(yi, mi, 1);
  const currMonthLast = new Date(yi, mi + 1, 0);

  const toKey = (dt: Date) => {
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${dt.getFullYear()}-${mm}-${dd}`;
  };

  const currentEnd = new Date(
    Math.min(anchor.getTime(), currMonthLast.getTime()),
  );

  const labelPrevious = `${formatDateLabel(toKey(prevMonthFirst), { day: "2-digit", month: "short" })} – ${formatDateLabel(
    toKey(prevMonthLast),
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  )}`;
  const labelCurrent = `${formatDateLabel(toKey(currMonthFirst), { day: "2-digit", month: "short" })} – ${formatDateLabel(
    toKey(currentEnd),
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    },
  )}`;

  return {
    previous: { start: toKey(prevMonthFirst), end: toKey(prevMonthLast) },
    current: { start: toKey(currMonthFirst), end: toKey(currentEnd) },
    labelPrevious,
    labelCurrent,
  };
};

/** Minutos laborales: prioriza `asistencia_horas` si el API cruzó cedula/nombre; si no, franjas con venta. */
export const getCashierLaborMinutes = (
  person: HourlyPersonContribution,
  activeSlotsCount: number,
  bucketMinutes: number,
) => {
  const att = person.attendanceWorkedHours;
  if (typeof att === "number" && Number.isFinite(att) && att > 0) {
    return decimalHoursToMinutes(att);
  }
  return activeSlotsCount * bucketMinutes;
};

/** Minutos efectivos del turno a partir de marcas (entrada/salida menos descansos). */
export const computeShiftLaborMinutes = (
  shift: CashierAttendanceShiftMarks | null | undefined,
): number | null => {
  if (!shift) return null;
  const entry = shift.markInMinute;
  const exit = shift.markOutMinute;
  if (entry === null || exit === null) return null;
  if (entry > exit) return null;
  let total = exit - entry;
  const { break1Minute: b1, break2Minute: b2 } = shift;
  if (b1 !== null && b2 !== null && b1 < b2) {
    const start = Math.max(entry, b1);
    const end = Math.min(exit, b2);
    if (end > start) total -= end - start;
  }
  return total > 0 ? total : 0;
};

/**
 * Minutos de un dia en desglose: si hay marcas usamos entrada-salida-descansos
 * (consistente con el calculo por franja). En su defecto, `total_horas_calculadas`
 * de asistencia o, como ultimo recurso, las franjas con venta.
 */
export const getCashierDayLaborMinutes = (
  day: NonNullable<HourlyPersonContribution["dailySales"]>[number],
  bucketMinutes: number,
) => {
  const fromMarks = computeShiftLaborMinutes(day.attendanceShift);
  if (fromMarks !== null && fromMarks > 0) return fromMarks;
  const att = day.attendanceWorkedHours;
  if (typeof att === "number" && Number.isFinite(att) && att > 0) {
    return decimalHoursToMinutes(att);
  }
  return (day.activeSlotsCount ?? 0) * bucketMinutes;
};

export const slotVtaHrFromAttendance = (
  sales: number,
  slotStartMinute: number,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
) => {
  const laborHours = getCashierSlotLaborHours(
    slotStartMinute,
    bucketMinutes,
    shift,
  );
  return calcVtaHr(sales, laborHours);
};

export const formatSlotWorkedMinutesLabel = (
  slotStartMinute: number,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
): string => {
  if (!shift || shift.markInMinute === null || shift.markOutMinute === null) {
    return "--";
  }
  const minutes = computeSlotWorkedMinutes(slotStartMinute, bucketMinutes, shift);
  return `${minutes} min`;
};

export const sumWorkedMinutesAcrossSlots = (
  slots: ReadonlyArray<{ slotStartMinute: number }>,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
): number => {
  if (!shift || shift.markInMinute === null || shift.markOutMinute === null) {
    return 0;
  }
  return slots.reduce(
    (total, slot) =>
      total +
      computeSlotWorkedMinutes(slot.slotStartMinute, bucketMinutes, shift),
    0,
  );
};

export const buildSlotLaborTooltip = (
  slotStartMinute: number,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
): string => {
  if (!shift) {
    return "Sin marcas de asistencia: se asume franja completa.";
  }
  const minutes = computeSlotWorkedMinutes(slotStartMinute, bucketMinutes, shift);
  const entry = minuteOfDayToHHMM(shift.markInMinute);
  const exit = minuteOfDayToHHMM(shift.markOutMinute);
  const break1 = minuteOfDayToHHMM(shift.break1Minute);
  const break2 = minuteOfDayToHHMM(shift.break2Minute);
  const partes: string[] = [];
  if (entry && exit) partes.push(`Turno ${entry}-${exit}`);
  if (break1 && break2) partes.push(`descanso ${break1}-${break2}`);
  if (minutes <= 0) {
    partes.push(
      `Franja fuera del turno: se asume ${bucketMinutes} min como respaldo`,
    );
  } else {
    partes.push(`${minutes} min trabajados en la franja`);
  }
  return partes.join(" | ");
};

export const formatShiftMarksLabel = (
  shift: CashierAttendanceShiftMarks | null | undefined,
): string | null => {
  if (!shift) return null;
  const entry = minuteOfDayToHHMM(shift.markInMinute);
  const exit = minuteOfDayToHHMM(shift.markOutMinute);
  if (!entry || !exit) return null;
  const break1 = minuteOfDayToHHMM(shift.break1Minute);
  const break2 = minuteOfDayToHHMM(shift.break2Minute);
  if (break1 && break2) {
    return `Marcas ${entry}-${break1} / ${break2}-${exit}`;
  }
  return `Marcas ${entry}-${exit}`;
};

export const cashierLaborHoursSourceTitle = (person: HourlyPersonContribution) => {
  const m = person.attendanceMatchMode;
  if (m === "cedula") {
    return "Horas desde asistencia (total_laborado_horas), cruce por cedula.";
  }
  if (m === "id_texto") {
    return "Horas desde asistencia, cruce por identificador (no numerico o corto).";
  }
  if (m === "nombre") {
    return "Horas desde asistencia, cruce por nombre unico en ventas y en asistencia con una sola cedula.";
  }
  return "Horas estimadas por franjas con venta; sin match fiable en asistencia.";
};
