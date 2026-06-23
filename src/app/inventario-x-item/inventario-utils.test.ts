import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_SALES_DI_VALUE,
  calculateMatrixItemTotalDiDays,
} from "./inventario-utils";

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
