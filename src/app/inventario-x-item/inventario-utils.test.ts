import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_SALES_DI_VALUE,
  calculateMatrixItemTotalDiDays,
  defaultRollingMonthBackRange,
  isStalePreviousMonthDefaultRange,
} from "./inventario-utils";

test("defaultRollingMonthBackRange usa mes en curso hasta el ultimo dato", () => {
  assert.deepEqual(
    defaultRollingMonthBackRange("2026-01-01", "2026-07-02"),
    { start: "2026-07-01", end: "2026-07-02" },
  );
});

test("defaultRollingMonthBackRange acota al minimo disponible", () => {
  assert.deepEqual(
    defaultRollingMonthBackRange("2026-07-15", "2026-07-20"),
    { start: "2026-07-15", end: "2026-07-20" },
  );
});

test("isStalePreviousMonthDefaultRange detecta el default legado de junio", () => {
  const ref = new Date("2026-07-03T12:00:00");
  assert.equal(
    isStalePreviousMonthDefaultRange("2026-06-01", "2026-06-30", ref),
    true,
  );
  assert.equal(
    isStalePreviousMonthDefaultRange("2026-07-01", "2026-07-02", ref),
    false,
  );
});

test("calculateMatrixItemTotalDiDays usa inventario y vendido agregados", () => {
  const di = calculateMatrixItemTotalDiDays({
    inventoryUnits: 10_690.74,
    inventoryValue: 293_528_745,
    soldUnits: 34_799.42,
    trackedDays: 31,
  });
  assert.ok(Math.abs(di - 9.52) < 0.05);
});

test("calculateMatrixItemTotalDiDays sin ventas devuelve NO_SALES", () => {
  assert.equal(
    calculateMatrixItemTotalDiDays({
      inventoryUnits: 100,
      inventoryValue: 1_000,
      soldUnits: 0,
      trackedDays: 30,
    }),
    NO_SALES_DI_VALUE,
  );
});
