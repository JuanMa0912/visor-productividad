import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCashierEffectivenessRowsFromInvoices,
  buildCashierEffectivenessSummary,
  computeEffectiveMinutesFromInvoiceTimes,
  computeInvoiceGapStats,
  CAJERO_CONTRACT_WEEKLY_HOURS,
} from "@/lib/efectividad-cajero/metrics";

describe("computeEffectiveMinutesFromInvoiceTimes", () => {
  it("hora densa cada 3 min ≈ 57 min efectivos", () => {
    const minutes: number[] = [];
    for (let m = 7 * 60; m <= 7 * 60 + 57; m += 3) minutes.push(m);
    const effective = computeEffectiveMinutesFromInvoiceTimes(minutes, 5);
    assert.equal(effective, 57);
  });

  it("2–3 ventas aisladas en una hora no llenan la hora (brechas > 5)", () => {
    const minutes = [7 * 60, 7 * 60 + 25, 7 * 60 + 50];
    assert.equal(computeEffectiveMinutesFromInvoiceTimes(minutes, 5), 0);
    const stats = computeInvoiceGapStats(minutes, 5);
    assert.equal(stats.idleInSpanMinutes, 50);
  });

  it("ráfaga corta solo suma minutos entre facturas cercanas", () => {
    const minutes = [7 * 60, 7 * 60 + 3, 7 * 60 + 6, 7 * 60 + 40];
    assert.equal(computeEffectiveMinutesFromInvoiceTimes(minutes, 5), 6);
  });

  it("una sola factura no inventa minutos", () => {
    assert.equal(computeEffectiveMinutesFromInvoiceTimes([8 * 60], 5), 0);
  });
});

describe("buildCashierEffectivenessRowsFromInvoices", () => {
  it("arma % contra horas marcadas y ritmo", () => {
    const dense: number[] = [];
    for (let m = 8 * 60; m <= 8 * 60 + 57; m += 3) dense.push(m);
    const rows = buildCashierEffectivenessRowsFromInvoices(
      [
        {
          personKey: "1|Ana",
          personName: "Ana",
          personId: "123",
          markedHours: 1.2,
          invoices: dense.map((minuteOfDay) => ({
            minuteOfDay,
            sales: 100_000,
            date: "2026-08-01",
          })),
        },
      ],
      5,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.productiveHours, 0.95);
    assert.equal(rows[0]!.markedHours, 1.2);
    assert.equal(rows[0]!.contractWeeklyHours, CAJERO_CONTRACT_WEEKLY_HOURS);
    assert.equal(rows[0]!.avgActiveGapMinutes, 3);
    assert.ok((rows[0]!.ticketsPerEffectiveHour ?? 0) > 0);
    assert.equal(rows[0]!.dayBreakdown.length, 1);
    assert.equal(rows[0]!.signal, "ritmo_denso");

    const summary = buildCashierEffectivenessSummary(rows);
    assert.equal(summary.cashierCount, 1);
    assert.equal(summary.denseRhythmCount, 1);
  });

  it("marca sin_marca cuando no hay asistencia", () => {
    const rows = buildCashierEffectivenessRowsFromInvoices(
      [
        {
          personKey: "2|Bob",
          personName: "Bob",
          personId: null,
          markedHours: 0,
          invoices: [
            { minuteOfDay: 600, sales: 10_000, date: "2026-08-01" },
            { minuteOfDay: 603, sales: 10_000, date: "2026-08-01" },
          ],
        },
      ],
      5,
    );
    assert.equal(rows[0]!.signal, "sin_marca");
  });
});
