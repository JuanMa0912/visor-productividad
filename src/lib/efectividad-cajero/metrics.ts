import {
  computeShiftLaborMinutes,
  getCashierDayLaborMinutes,
} from "@/components/hourly-analysis/cashier-utils";
import type { HourlyPersonContribution } from "@/types";

/** Referencia de contrato semanal (horas) para el experimento. */
export const CAJERO_CONTRACT_WEEKLY_HOURS = 42;

export type CashierEffectivenessRow = {
  personKey: string;
  personName: string;
  personId: string | null;
  sales: number;
  /** Horas con al menos una factura en la franja (bucket). */
  productiveHours: number;
  /** Horas según marcas de asistencia (entrada/salida − almuerzo). */
  markedHours: number;
  /** productive / marked · 100; null si no hay marcas. */
  effectivenessPct: number | null;
  /** Primera / última factura del periodo (minutos del día), si aplica. */
  firstSaleMinute: number | null;
  lastSaleMinute: number | null;
  daysWithSales: number;
  /** Referencia 42h semanales (solo informativa). */
  contractWeeklyHours: number;
};

const roundHours = (value: number) => Math.round(value * 100) / 100;

const resolveMarkedHours = (
  person: HourlyPersonContribution,
  bucketMinutes: number,
): number => {
  const days = person.dailySales;
  if (days && days.length > 0) {
    let minutes = 0;
    for (const day of days) {
      minutes += getCashierDayLaborMinutes(day, bucketMinutes);
    }
    if (minutes > 0) return roundHours(minutes / 60);
  }

  if (
    typeof person.attendanceWorkedHours === "number" &&
    Number.isFinite(person.attendanceWorkedHours) &&
    person.attendanceWorkedHours > 0
  ) {
    return roundHours(person.attendanceWorkedHours);
  }

  const fromShift = computeShiftLaborMinutes(person.attendanceShift);
  if (fromShift != null && fromShift > 0) {
    return roundHours(fromShift / 60);
  }

  return 0;
};

const resolveProductiveHours = (
  person: HourlyPersonContribution,
  bucketMinutes: number,
): { hours: number; daysWithSales: number } => {
  const days = person.dailySales;
  if (days && days.length > 0) {
    let slots = 0;
    let daysWithSales = 0;
    for (const day of days) {
      const daySlots =
        typeof day.activeSlotsCount === "number"
          ? day.activeSlotsCount
          : day.sales > 0
            ? 1
            : 0;
      if (daySlots > 0 || day.sales > 0) daysWithSales += 1;
      slots += daySlots;
    }
    return {
      hours: roundHours((slots * bucketMinutes) / 60),
      daysWithSales,
    };
  }

  const slots =
    typeof person.activeSlotsCount === "number"
      ? person.activeSlotsCount
      : person.hourlySales.length;
  return {
    hours: roundHours((slots * bucketMinutes) / 60),
    daysWithSales: slots > 0 || (person.periodTotalSales ?? 0) > 0 ? 1 : 0,
  };
};

const resolveSales = (person: HourlyPersonContribution): number => {
  if (
    typeof person.periodTotalSales === "number" &&
    Number.isFinite(person.periodTotalSales)
  ) {
    return person.periodTotalSales;
  }
  return person.hourlySales.reduce((sum, slot) => sum + slot.sales, 0);
};

/**
 * Arma filas de efectividad: horas con venta real vs horas marcadas en asistencia.
 */
export const buildCashierEffectivenessRows = (
  people: HourlyPersonContribution[] | undefined,
  bucketMinutes: number,
): CashierEffectivenessRow[] => {
  if (!people?.length) return [];
  const bucket =
    Number.isFinite(bucketMinutes) && bucketMinutes > 0 ? bucketMinutes : 60;

  const rows: CashierEffectivenessRow[] = people.map((person) => {
    const sales = resolveSales(person);
    const { hours: productiveHours, daysWithSales } = resolveProductiveHours(
      person,
      bucket,
    );
    const markedHours = resolveMarkedHours(person, bucket);
    const effectivenessPct =
      markedHours > 0
        ? roundHours((productiveHours / markedHours) * 100)
        : null;

    return {
      personKey: person.personKey,
      personName: person.personName,
      personId: person.personId?.trim() ? person.personId : null,
      sales,
      productiveHours,
      markedHours,
      effectivenessPct,
      firstSaleMinute: person.firstMinuteOfDay ?? null,
      lastSaleMinute: person.lastMinuteOfDay ?? null,
      daysWithSales,
      contractWeeklyHours: CAJERO_CONTRACT_WEEKLY_HOURS,
    };
  });

  return rows
    .filter((row) => row.sales > 0 || row.markedHours > 0)
    .sort((a, b) => {
      const ae = a.effectivenessPct ?? -1;
      const be = b.effectivenessPct ?? -1;
      if (be !== ae) return be - ae;
      return b.sales - a.sales;
    });
};

export const formatMinuteOfDay = (minute: number | null): string => {
  if (minute == null || !Number.isFinite(minute)) return "—";
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
