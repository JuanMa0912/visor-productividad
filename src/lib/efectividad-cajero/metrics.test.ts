import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCashierEffectivenessRows,
  CAJERO_CONTRACT_WEEKLY_HOURS,
} from "@/lib/efectividad-cajero/metrics";
import type { HourlyPersonContribution } from "@/types";

const person = (
  overrides: Partial<HourlyPersonContribution>,
): HourlyPersonContribution => ({
  personKey: "1|Ana",
  personId: "1234567890",
  personName: "Ana",
  hourlySales: [],
  ...overrides,
});

describe("efectividad-cajero metrics", () => {
  it("calcula % como horas con venta / horas marcadas", () => {
    const rows = buildCashierEffectivenessRows(
      [
        person({
          periodTotalSales: 5_000_000,
          activeSlotsCount: 6, // 6h si bucket=60
          attendanceWorkedHours: 8,
          dailySales: [
            {
              date: "2026-08-01",
              sales: 5_000_000,
              activeSlotsCount: 6,
              attendanceShift: {
                markInMinute: 8 * 60,
                markOutMinute: 17 * 60,
                break1Minute: 12 * 60,
                break2Minute: 13 * 60,
              },
            },
          ],
        }),
      ],
      60,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.productiveHours, 6);
    // 8:00–17:00 − 1h almuerzo = 8h
    assert.equal(rows[0]!.markedHours, 8);
    assert.equal(rows[0]!.effectivenessPct, 75);
    assert.equal(rows[0]!.contractWeeklyHours, CAJERO_CONTRACT_WEEKLY_HOURS);
  });

  it("deja % null si no hay marcas", () => {
    const rows = buildCashierEffectivenessRows(
      [
        person({
          periodTotalSales: 1_000_000,
          activeSlotsCount: 4,
          hourlySales: [
            {
              slotStartMinute: 600,
              slotEndMinute: 660,
              label: "10-11",
              sales: 1_000_000,
            },
          ],
        }),
      ],
      60,
    );
    assert.equal(rows[0]!.productiveHours, 4);
    assert.equal(rows[0]!.markedHours, 0);
    assert.equal(rows[0]!.effectivenessPct, null);
  });
});
