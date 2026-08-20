import {
  countInclusiveDays,
  NO_SALES_DI_VALUE,
  parseDateKey,
  resolveRotationDemandaUnits,
  toDateKey,
  type DateRange,
} from "@/app/rotacion/rotacion-preamble";
import type {
  RotacionCriticalBucket,
  RotacionCriticalTaggedRow,
} from "@/lib/rotacion/critical-digest";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";

export type RotacionGestionKpis = {
  itemCount: number;
  inventoryValue: number;
  inventoryUnits: number;
  /** Cobertura de demanda D; 999999 = sin venta. */
  diasInventario: number;
  daysConsulted: number;
};

export type RotacionGestionKpiDiff = {
  before: RotacionGestionKpis;
  after: RotacionGestionKpis;
  /** before $ − after $; positivo = capital liberado. */
  liberatedValue: number;
  liberatedItems: number;
  deltaDiasInventario: number;
};

export type RotacionGestionTrendPoint = {
  semanaFin: string;
  itemCount: number;
  inventoryValue: number;
  diasInventario: number;
};

const coverageDays = (
  rows: Array<{ inventoryUnits: number } & { demanda?: number }>,
  daysConsulted: number,
  demandaOf: (row: { inventoryUnits: number }) => number,
): number => {
  const totalInvUnits = rows.reduce((acc, row) => acc + row.inventoryUnits, 0);
  const demandaUnits = rows.reduce((acc, row) => acc + demandaOf(row), 0);
  if (demandaUnits > 0 && daysConsulted > 0) {
    return (totalInvUnits * daysConsulted) / demandaUnits;
  }
  if (totalInvUnits > 0) return NO_SALES_DI_VALUE;
  return 0;
};

export const buildRotacionGestionKpis = (
  tagged: readonly RotacionCriticalTaggedRow[],
  dateRange: DateRange,
): RotacionGestionKpis => {
  const daysConsulted = countInclusiveDays(dateRange);
  const inventoryValue = tagged.reduce(
    (acc, entry) => acc + entry.row.inventoryValue,
    0,
  );
  const inventoryUnits = tagged.reduce(
    (acc, entry) => acc + entry.row.inventoryUnits,
    0,
  );
  const demandaRows = tagged
    .filter((entry) => entry.bucket === "demandaD")
    .map((entry) => entry.row);
  const coverageSource =
    demandaRows.length > 0 ? demandaRows : tagged.map((entry) => entry.row);
  return {
    itemCount: tagged.length,
    inventoryValue,
    inventoryUnits,
    diasInventario: coverageDays(
      coverageSource,
      daysConsulted,
      (row) => resolveRotationDemandaUnits(row as (typeof coverageSource)[number]),
    ),
    daysConsulted,
  };
};

export const diffRotacionGestionKpis = (
  before: RotacionGestionKpis,
  after: RotacionGestionKpis,
): RotacionGestionKpiDiff => ({
  before,
  after,
  liberatedValue: before.inventoryValue - after.inventoryValue,
  liberatedItems: before.itemCount - after.itemCount,
  deltaDiasInventario: before.diasInventario - after.diasInventario,
});

/** Mes calendario anterior al inicio del rango actual (1 → último día). */
export const previousCalendarMonthRange = (currentStart: string): DateRange => {
  const start = parseDateKey(currentStart);
  const firstPrev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const lastPrev = new Date(start.getFullYear(), start.getMonth(), 0);
  return { start: toDateKey(firstPrev), end: toDateKey(lastPrev) };
};

export type RotacionGestionRollRow = {
  semanaFin: string;
  empresa: string;
  sedeId: string;
  familia: "manufactura" | "perecederos";
  bucket: RotacionCriticalBucket;
  itemCount: number;
  inventoryValue: number;
  inventoryUnits: number;
  demandaUnits: number;
  trackedDays: number;
};

export type RotacionGestionMonthlySedeSeries = {
  months: string[];
  monthLabels: string[];
  series: Array<{
    sedeKey: string;
    label: string;
    inventoryValue: number[];
    inventoryUnits: number[];
  }>;
};

const monthKeyFromIso = (iso: string) => iso.slice(0, 7);

export const formatGestionMonthLabel = (yearMonth: string) => {
  const [year, month] = yearMonth.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return yearMonth;
  const short = date
    .toLocaleDateString("es-CO", { month: "short" })
    .replace(".", "")
    .trim();
  return `${short} ${year}`;
};

/**
 * Totales mes a mes por sede. No mezcla sedes: cada serie es una sede.
 * Dentro del mes usa el ultimo corte semanal (inventario es foto, no se suma).
 */
export const buildGestionMonthlySedeSeries = (
  rows: readonly RotacionGestionRollRow[],
  options?: {
    sedeKeys?: readonly string[];
    sedeLabels?: Record<string, string>;
    families?: readonly string[];
    buckets?: readonly RotacionCriticalBucket[];
  },
): RotacionGestionMonthlySedeSeries => {
  const sedeSet =
    options?.sedeKeys && options.sedeKeys.length > 0
      ? new Set(options.sedeKeys)
      : null;
  const familySet =
    options?.families && options.families.length > 0
      ? new Set(options.families)
      : null;
  const bucketSet =
    options?.buckets && options.buckets.length > 0
      ? new Set(options.buckets)
      : null;

  const weekBySede = new Map<
    string,
    Map<string, { inventoryValue: number; inventoryUnits: number }>
  >();

  for (const row of rows) {
    const sedeKey = `${row.empresa}::${row.sedeId}`;
    if (sedeSet && !sedeSet.has(sedeKey)) continue;
    if (familySet && !familySet.has(row.familia)) continue;
    if (bucketSet && !bucketSet.has(row.bucket)) continue;
    const byWeek = weekBySede.get(sedeKey) ?? new Map();
    const current = byWeek.get(row.semanaFin) ?? {
      inventoryValue: 0,
      inventoryUnits: 0,
    };
    current.inventoryValue += row.inventoryValue;
    current.inventoryUnits += row.inventoryUnits;
    byWeek.set(row.semanaFin, current);
    weekBySede.set(sedeKey, byWeek);
  }

  const monthBySede = new Map<
    string,
    Map<string, { week: string; inventoryValue: number; inventoryUnits: number }>
  >();
  const monthSet = new Set<string>();

  for (const [sedeKey, byWeek] of weekBySede) {
    const byMonth = new Map<
      string,
      { week: string; inventoryValue: number; inventoryUnits: number }
    >();
    for (const [week, totals] of byWeek) {
      const month = monthKeyFromIso(week);
      monthSet.add(month);
      const prev = byMonth.get(month);
      if (!prev || week > prev.week) {
        byMonth.set(month, { week, ...totals });
      }
    }
    monthBySede.set(sedeKey, byMonth);
  }

  const months = [...monthSet].sort((a, b) => a.localeCompare(b));
  const series = [...monthBySede.entries()]
    .map(([sedeKey, byMonth]) => {
      const label = options?.sedeLabels?.[sedeKey] ?? sedeKey.split("::")[1] ?? sedeKey;
      return {
        sedeKey,
        label,
        inventoryValue: months.map(
          (month) => byMonth.get(month)?.inventoryValue ?? 0,
        ),
        inventoryUnits: months.map(
          (month) => byMonth.get(month)?.inventoryUnits ?? 0,
        ),
      };
    })
    .sort((a, b) => {
      const order =
        getSedeOrderIndexForRawName(a.label) -
        getSedeOrderIndexForRawName(b.label);
      if (order !== 0) return order;
      return a.label.localeCompare(b.label, "es");
    });

  return {
    months,
    monthLabels: months.map(formatGestionMonthLabel),
    series,
  };
};

export const sliceGestionMonthlySedeSeries = (
  monthly: RotacionGestionMonthlySedeSeries,
  monthKeys?: readonly string[],
): RotacionGestionMonthlySedeSeries => {
  if (!monthKeys || monthKeys.length === 0) return monthly;
  const keep = new Set(monthKeys);
  const indexes = monthly.months
    .map((month, index) => ({ month, index }))
    .filter((entry) => keep.has(entry.month));
  if (indexes.length === 0) {
    return {
      months: [],
      monthLabels: [],
      series: monthly.series.map((serie) => ({
        ...serie,
        inventoryValue: [],
        inventoryUnits: [],
      })),
    };
  }
  return {
    months: indexes.map((entry) => entry.month),
    monthLabels: indexes.map(
      (entry) => monthly.monthLabels[entry.index] ?? entry.month,
    ),
    series: monthly.series.map((serie) => ({
      ...serie,
      inventoryValue: indexes.map(
        (entry) => serie.inventoryValue[entry.index] ?? 0,
      ),
      inventoryUnits: indexes.map(
        (entry) => serie.inventoryUnits[entry.index] ?? 0,
      ),
    })),
  };
};

export const aggregateGestionTrendPoints = (
  rows: readonly RotacionGestionRollRow[],
  options?: {
    sedeKeys?: readonly string[];
    families?: readonly string[];
    buckets?: readonly RotacionCriticalBucket[];
  },
): RotacionGestionTrendPoint[] => {
  const sedeSet =
    options?.sedeKeys && options.sedeKeys.length > 0
      ? new Set(options.sedeKeys)
      : null;
  const familySet =
    options?.families && options.families.length > 0
      ? new Set(options.families)
      : null;
  const bucketSet =
    options?.buckets && options.buckets.length > 0
      ? new Set(options.buckets)
      : null;

  const byWeek = new Map<
    string,
    {
      itemCount: number;
      inventoryValue: number;
      inventoryUnits: number;
      demandaUnits: number;
      trackedDays: number;
    }
  >();

  for (const row of rows) {
    const sedeKey = `${row.empresa}::${row.sedeId}`;
    if (sedeSet && !sedeSet.has(sedeKey)) continue;
    if (familySet && !familySet.has(row.familia)) continue;
    if (bucketSet && !bucketSet.has(row.bucket)) continue;
    const current = byWeek.get(row.semanaFin) ?? {
      itemCount: 0,
      inventoryValue: 0,
      inventoryUnits: 0,
      demandaUnits: 0,
      trackedDays: row.trackedDays,
    };
    current.itemCount += row.itemCount;
    current.inventoryValue += row.inventoryValue;
    current.inventoryUnits += row.inventoryUnits;
    current.demandaUnits += row.demandaUnits;
    current.trackedDays = Math.max(current.trackedDays, row.trackedDays);
    byWeek.set(row.semanaFin, current);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([semanaFin, acc]) => ({
      semanaFin,
      itemCount: acc.itemCount,
      inventoryValue: acc.inventoryValue,
      diasInventario:
        acc.demandaUnits > 0 && acc.trackedDays > 0
          ? (acc.inventoryUnits * acc.trackedDays) / acc.demandaUnits
          : acc.inventoryUnits > 0
            ? NO_SALES_DI_VALUE
            : 0,
    }));
};
