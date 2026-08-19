import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUNTO_VENTA_BLOCKS,
  PUNTO_VENTA_ITEM_COUNT,
  scorePuntoVenta,
} from "./punto-venta";

describe("checklist punto de venta", () => {
  it("tiene 25 ítems en 8 bloques", () => {
    assert.equal(PUNTO_VENTA_BLOCKS.length, 8);
    assert.equal(PUNTO_VENTA_ITEM_COUNT, 25);
  });

  it("todo 5 da 100% y NA no entra al denominador", () => {
    const answers: Record<string, 1 | 2 | 3 | 4 | 5 | "na"> = {};
    for (const block of PUNTO_VENTA_BLOCKS) {
      for (const item of block.items) answers[item.id] = 5;
    }
    assert.equal(scorePuntoVenta(answers).pct, 100);
    answers["1.1"] = "na";
    const result = scorePuntoVenta(answers);
    assert.equal(result.pct, 100);
    assert.equal(result.applicable, 24);
  });
});
