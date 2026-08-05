/** Referencia de contrato semanal (horas) para el experimento. */
export const CAJERO_CONTRACT_WEEKLY_HOURS = 42;

/**
 * Brecha máxima (minutos) entre facturas para considerar ritmo “continuo”.
 * Ej.: ventas cada 2–5 min → la brecha cuenta; si pasan 20 min sin factura → idle.
 */
export const DEFAULT_MAX_ACTIVE_GAP_MINUTES = 5;

/** Umbral de % efectividad para marcar señal de atención. */
export const LOW_EFFECTIVENESS_PCT = 35;

export type CashierInvoicePoint = {
  /** Minuto del día 0–1439 (o más si cruza, se clampa en cálculo). */
  minuteOfDay: number;
  sales: number;
  /** YYYY-MM-DD */
  date: string;
};

export type CashierEffectivenessInput = {
  personKey: string;
  personName: string;
  personId: string | null;
  invoices: CashierInvoicePoint[];
  /** Horas laboradas según marcas (entrada/salida − almuerzo). */
  markedHours: number;
};

export type CashierDayBreakdown = {
  date: string;
  invoiceCount: number;
  productiveHours: number;
  /** Promedio de brechas que sí contaron (≤ maxGap). */
  avgActiveGapMinutes: number | null;
  /** Minutos entre 1ª y última factura − minutos efectivos (huecos en la ventana). */
  idleInSpanHours: number;
};

export type CashierSignal =
  | "sin_marca"
  | "baja_efectividad"
  | "ritmo_denso"
  | null;

export type CashierEffectivenessRow = {
  personKey: string;
  personName: string;
  personId: string | null;
  sales: number;
  invoiceCount: number;
  /** Horas efectivas por densidad de facturas (ver computeEffectiveMinutesFromInvoiceTimes). */
  productiveHours: number;
  markedHours: number;
  effectivenessPct: number | null;
  /** Promedio de brechas ≤ maxGap (minutos entre facturas en ritmo). */
  avgActiveGapMinutes: number | null;
  /** Facturas por hora efectiva; null si no hay horas efectivas. */
  ticketsPerEffectiveHour: number | null;
  /** Suma diaria de (ventana 1ª–última − efectivos). */
  idleInSpanHours: number;
  firstSaleMinute: number | null;
  lastSaleMinute: number | null;
  firstSaleLabel: string;
  lastSaleLabel: string;
  daysWithSales: number;
  contractWeeklyHours: number;
  signal: CashierSignal;
  dayBreakdown: CashierDayBreakdown[];
};

export type CashierEffectivenessSummary = {
  cashierCount: number;
  totalSales: number;
  totalInvoices: number;
  totalMarkedHours: number;
  totalProductiveHours: number;
  sedeEffectivenessPct: number | null;
  withMarkCount: number;
  noMarkCount: number;
  lowEffectivenessCount: number;
  denseRhythmCount: number;
};

const roundHours = (value: number) => Math.round(value * 100) / 100;
const round1 = (value: number) => Math.round(value * 10) / 10;

const clampMinute = (minute: number) => {
  if (!Number.isFinite(minute)) return null;
  if (minute < 0) return 0;
  if (minute > 24 * 60 - 1) return 24 * 60 - 1;
  return Math.floor(minute);
};

export type InvoiceGapStats = {
  effectiveMinutes: number;
  /** Brechas que entraron en el conteo efectivo. */
  activeGaps: number[];
  spanMinutes: number;
  idleInSpanMinutes: number;
};

/**
 * Minutos efectivos a partir de los horarios de factura.
 *
 * Regla:
 * - Ordena facturas del día.
 * - Entre dos facturas consecutivas, si la brecha ≤ `maxGapMinutes` (ritmo continuo
 *   tipo cada 2–5 min), esos minutos cuentan como trabajo efectivo.
 * - Si la brecha es mayor (poca actividad / huecos largos), ese tramo NO cuenta
 *   (no se rellena la hora completa).
 * - Una sola factura en el día no genera minutos “entre” facturas → 0
 *   (no inventamos una hora llena por un ticket aislado).
 *
 * Ejemplo 07:00–08:00 con venta cada 3 min → ~57 min ≈ 1 h efectiva.
 * Ejemplo 3 ventas a las :00, :25, :50 con maxGap=5 → 0 min (brechas > 5).
 */
export const computeEffectiveMinutesFromInvoiceTimes = (
  minutesOfDay: readonly number[],
  maxGapMinutes: number = DEFAULT_MAX_ACTIVE_GAP_MINUTES,
): number => computeInvoiceGapStats(minutesOfDay, maxGapMinutes).effectiveMinutes;

export const computeInvoiceGapStats = (
  minutesOfDay: readonly number[],
  maxGapMinutes: number = DEFAULT_MAX_ACTIVE_GAP_MINUTES,
): InvoiceGapStats => {
  const maxGap =
    Number.isFinite(maxGapMinutes) && maxGapMinutes > 0 ? maxGapMinutes : 5;
  const sorted = minutesOfDay
    .map(clampMinute)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);

  if (sorted.length < 2) {
    return {
      effectiveMinutes: 0,
      activeGaps: [],
      spanMinutes: 0,
      idleInSpanMinutes: 0,
    };
  }

  let effective = 0;
  const activeGaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap <= 0) continue;
    if (gap <= maxGap) {
      effective += gap;
      activeGaps.push(gap);
    }
  }

  const spanMinutes = sorted[sorted.length - 1]! - sorted[0]!;
  const idleInSpanMinutes = Math.max(0, spanMinutes - effective);

  return {
    effectiveMinutes: effective,
    activeGaps,
    spanMinutes,
    idleInSpanMinutes,
  };
};

export const formatMinuteOfDay = (minute: number | null): string => {
  if (minute == null || !Number.isFinite(minute)) return "—";
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const resolveSignal = (args: {
  markedHours: number;
  effectivenessPct: number | null;
  avgActiveGapMinutes: number | null;
  productiveHours: number;
  maxGapMinutes: number;
}): CashierSignal => {
  if (args.markedHours <= 0) return "sin_marca";
  if (
    args.effectivenessPct != null &&
    args.effectivenessPct < LOW_EFFECTIVENESS_PCT &&
    args.markedHours >= 4
  ) {
    return "baja_efectividad";
  }
  if (
    args.productiveHours >= 0.5 &&
    args.avgActiveGapMinutes != null &&
    args.avgActiveGapMinutes <= Math.min(4, args.maxGapMinutes)
  ) {
    return "ritmo_denso";
  }
  return null;
};

export const buildCashierEffectivenessRowsFromInvoices = (
  inputs: readonly CashierEffectivenessInput[],
  maxGapMinutes: number = DEFAULT_MAX_ACTIVE_GAP_MINUTES,
): CashierEffectivenessRow[] => {
  const rows: CashierEffectivenessRow[] = inputs.map((input) => {
    const byDate = new Map<string, number[]>();
    let sales = 0;
    for (const inv of input.invoices) {
      sales += inv.sales;
      const list = byDate.get(inv.date) ?? [];
      list.push(inv.minuteOfDay);
      byDate.set(inv.date, list);
    }

    let productiveMinutes = 0;
    let idleInSpanMinutes = 0;
    const allActiveGaps: number[] = [];
    const dayBreakdown: CashierDayBreakdown[] = [];

    for (const [date, minutes] of [...byDate.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const stats = computeInvoiceGapStats(minutes, maxGapMinutes);
      productiveMinutes += stats.effectiveMinutes;
      idleInSpanMinutes += stats.idleInSpanMinutes;
      allActiveGaps.push(...stats.activeGaps);
      const dayAvg =
        stats.activeGaps.length > 0
          ? round1(
              stats.activeGaps.reduce((a, b) => a + b, 0) /
                stats.activeGaps.length,
            )
          : null;
      dayBreakdown.push({
        date,
        invoiceCount: minutes.length,
        productiveHours: roundHours(stats.effectiveMinutes / 60),
        avgActiveGapMinutes: dayAvg,
        idleInSpanHours: roundHours(stats.idleInSpanMinutes / 60),
      });
    }

    const productiveHours = roundHours(productiveMinutes / 60);
    const markedHours =
      Number.isFinite(input.markedHours) && input.markedHours > 0
        ? roundHours(input.markedHours)
        : 0;
    const effectivenessPct =
      markedHours > 0
        ? roundHours((productiveHours / markedHours) * 100)
        : null;
    const avgActiveGapMinutes =
      allActiveGaps.length > 0
        ? round1(
            allActiveGaps.reduce((a, b) => a + b, 0) / allActiveGaps.length,
          )
        : null;
    const ticketsPerEffectiveHour =
      productiveHours > 0
        ? round1(input.invoices.length / productiveHours)
        : null;

    const allMinutes = input.invoices
      .map((inv) => clampMinute(inv.minuteOfDay))
      .filter((m): m is number => m != null)
      .sort((a, b) => a - b);
    const firstSaleMinute = allMinutes[0] ?? null;
    const lastSaleMinute = allMinutes[allMinutes.length - 1] ?? null;

    const signal = resolveSignal({
      markedHours,
      effectivenessPct,
      avgActiveGapMinutes,
      productiveHours,
      maxGapMinutes,
    });

    return {
      personKey: input.personKey,
      personName: input.personName,
      personId: input.personId,
      sales,
      invoiceCount: input.invoices.length,
      productiveHours,
      markedHours,
      effectivenessPct,
      avgActiveGapMinutes,
      ticketsPerEffectiveHour,
      idleInSpanHours: roundHours(idleInSpanMinutes / 60),
      firstSaleMinute,
      lastSaleMinute,
      firstSaleLabel: formatMinuteOfDay(firstSaleMinute),
      lastSaleLabel: formatMinuteOfDay(lastSaleMinute),
      daysWithSales: byDate.size,
      contractWeeklyHours: CAJERO_CONTRACT_WEEKLY_HOURS,
      signal,
      dayBreakdown,
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

export const buildCashierEffectivenessSummary = (
  rows: readonly CashierEffectivenessRow[],
): CashierEffectivenessSummary => {
  let totalSales = 0;
  let totalInvoices = 0;
  let totalMarkedHours = 0;
  let totalProductiveHours = 0;
  let withMarkCount = 0;
  let noMarkCount = 0;
  let lowEffectivenessCount = 0;
  let denseRhythmCount = 0;

  for (const row of rows) {
    totalSales += row.sales;
    totalInvoices += row.invoiceCount;
    totalMarkedHours += row.markedHours;
    totalProductiveHours += row.productiveHours;
    if (row.markedHours > 0) withMarkCount += 1;
    else noMarkCount += 1;
    if (row.signal === "baja_efectividad") lowEffectivenessCount += 1;
    if (row.signal === "ritmo_denso") denseRhythmCount += 1;
  }

  return {
    cashierCount: rows.length,
    totalSales,
    totalInvoices,
    totalMarkedHours: roundHours(totalMarkedHours),
    totalProductiveHours: roundHours(totalProductiveHours),
    sedeEffectivenessPct:
      totalMarkedHours > 0
        ? roundHours((totalProductiveHours / totalMarkedHours) * 100)
        : null,
    withMarkCount,
    noMarkCount,
    lowEffectivenessCount,
    denseRhythmCount,
  };
};
