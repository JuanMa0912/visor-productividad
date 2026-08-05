/** Referencia de contrato semanal (horas) para el experimento. */
export const CAJERO_CONTRACT_WEEKLY_HOURS = 42;

/**
 * Brecha máxima (minutos) entre facturas para considerar ritmo “continuo”.
 * Ej.: ventas cada 2–5 min → la brecha cuenta; si pasan 20 min sin factura → idle.
 */
export const DEFAULT_MAX_ACTIVE_GAP_MINUTES = 5;

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
  firstSaleMinute: number | null;
  lastSaleMinute: number | null;
  /** Primera / última factura del periodo (mejor esfuerzo multi-día: del día con más venta). */
  firstSaleLabel: string;
  lastSaleLabel: string;
  daysWithSales: number;
  contractWeeklyHours: number;
};

const roundHours = (value: number) => Math.round(value * 100) / 100;

const clampMinute = (minute: number) => {
  if (!Number.isFinite(minute)) return null;
  if (minute < 0) return 0;
  if (minute > 24 * 60 - 1) return 24 * 60 - 1;
  return Math.floor(minute);
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
): number => {
  const maxGap =
    Number.isFinite(maxGapMinutes) && maxGapMinutes > 0 ? maxGapMinutes : 5;
  const sorted = minutesOfDay
    .map(clampMinute)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);

  if (sorted.length < 2) return 0;

  let effective = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap <= 0) continue;
    if (gap <= maxGap) effective += gap;
  }
  return effective;
};

export const formatMinuteOfDay = (minute: number | null): string => {
  if (minute == null || !Number.isFinite(minute)) return "—";
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
    for (const minutes of byDate.values()) {
      productiveMinutes += computeEffectiveMinutesFromInvoiceTimes(
        minutes,
        maxGapMinutes,
      );
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

    const allMinutes = input.invoices
      .map((inv) => clampMinute(inv.minuteOfDay))
      .filter((m): m is number => m != null)
      .sort((a, b) => a - b);
    const firstSaleMinute = allMinutes[0] ?? null;
    const lastSaleMinute = allMinutes[allMinutes.length - 1] ?? null;

    return {
      personKey: input.personKey,
      personName: input.personName,
      personId: input.personId,
      sales,
      invoiceCount: input.invoices.length,
      productiveHours,
      markedHours,
      effectivenessPct,
      firstSaleMinute,
      lastSaleMinute,
      firstSaleLabel: formatMinuteOfDay(firstSaleMinute),
      lastSaleLabel: formatMinuteOfDay(lastSaleMinute),
      daysWithSales: byDate.size,
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
