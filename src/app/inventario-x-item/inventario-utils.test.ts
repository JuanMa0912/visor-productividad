import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_SALES_DI_VALUE,
  calculateMatrixItemTotalDiDays,
  defaultRollingMonthBackRange,
  isStaleMonthToDatePartialDefault,
  isStalePreviousMonthDefaultRange,
} from "./inventario-utils";

const julyRef = new Date("2026-07-06T12:00:00");

test("defaultRollingMonthBackRange usa ~30 dias como rotacion", () => {
  assert.deepEqual(
    defaultRollingMonthBackRange("2026-01-01", "2026-07-02", julyRef),
    { start: "2026-06-03", end: "2026-07-02" },
  );
});

test("defaultRollingMonthBackRange acota al minimo disponible", () => {
  assert.deepEqual(
    defaultRollingMonthBackRange("2026-07-15", "2026-07-20", julyRef),
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
    isStalePreviousMonthDefaultRange("2026-06-03", "2026-07-02", ref),
    false,
  );
});

test("isStaleMonthToDatePartialDefault detecta dia 1 del mes en curso", () => {
  assert.equal(
    isStaleMonthToDatePartialDefault("2026-07-01", "2026-07-05", "2026-07-05"),
    true,
  );
  assert.equal(
    isStaleMonthToDatePartialDefault("2026-06-03", "2026-07-02", "2026-07-02"),
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
