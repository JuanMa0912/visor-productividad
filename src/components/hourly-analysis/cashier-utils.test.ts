import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCashierDayLaborMinutes,
  getCashierLaborMinutes,
} from "./cashier-utils";
import type { HourlyPersonContribution } from "@/types";

const shift = {
  markInMinute: 8 * 60 + 20,
  markOutMinute: 14 * 60 + 21,
  break1Minute: null,
  break2Minute: null,
};

describe("getCashierDayLaborMinutes", () => {
  it("usa marcas de entrada y salida cuando existen", () => {
    const minutes = getCashierDayLaborMinutes(
      {
        date: "2026-06-29",
        sales: 1_000_000,
        activeSlotsCount: 6,
        attendanceShift: shift,
      },
      60,
    );
    assert.equal(minutes, 361);
  });

  it("no estima horas por franjas con venta si faltan marcas", () => {
    const minutes = getCashierDayLaborMinutes(
      {
        date: "2026-07-01",
        sales: 15_653_000,
        activeSlotsCount: 9,
        attendanceWorkedHours: 9,
      },
      60,
    );
    assert.equal(minutes, 0);
  });
});

describe("getCashierLaborMinutes", () => {
  it("suma solo dias con marcas en rangos multi-dia", () => {
    const person: HourlyPersonContribution = {
      personKey: "1|ana",
      personName: "Ana",
      hourlySales: [],
      periodTotalSales: 20_000_000,
      activeSlotsCount: 15,
      attendanceWorkedHours: 58,
      dailySales: [
        {
          date: "2026-06-29",
          sales: 10_000_000,
          activeSlotsCount: 6,
          attendanceShift: shift,
        },
        {
          date: "2026-07-01",
          sales: 10_000_000,
          activeSlotsCount: 9,
        },
      ],
    };

    const total = getCashierLaborMinutes(person, 15, 60);
    assert.equal(total, 361);
  });
});
