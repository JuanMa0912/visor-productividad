import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getOverstockBand,
  isOverstockFilter,
  isOverstockRow,
  matchesOverstockFilter,
} from "@/lib/rotacion/overstock";

describe("rotacion overstock", () => {
  it("clasifica 32–49.9 y >=50, y excluye sin venta o sin inventario", () => {
    assert.equal(getOverstockBand({ rotation: 32, inventoryUnits: 4 }), "32");
    assert.equal(getOverstockBand({ rotation: 49.9, inventoryUnits: 4 }), "32");
    assert.equal(getOverstockBand({ rotation: 50, inventoryUnits: 4 }), "50");
    assert.equal(getOverstockBand({ rotation: 80, inventoryUnits: 4 }), "50");
    assert.equal(getOverstockBand({ rotation: 31.9, inventoryUnits: 4 }), null);
    assert.equal(getOverstockBand({ rotation: 60, inventoryUnits: 0 }), null);
    assert.equal(getOverstockBand({ rotation: 999999, inventoryUnits: 10 }), null);
    assert.equal(isOverstockRow({ rotation: 40, inventoryUnits: 1 }), true);
  });

  it("filtra O / O32 / O50", () => {
    const mid = { rotation: 40, inventoryUnits: 2 };
    const high = { rotation: 70, inventoryUnits: 2 };
    assert.equal(matchesOverstockFilter(mid, "O"), true);
    assert.equal(matchesOverstockFilter(high, "O"), true);
    assert.equal(matchesOverstockFilter(mid, "O32"), true);
    assert.equal(matchesOverstockFilter(high, "O32"), false);
    assert.equal(matchesOverstockFilter(mid, "O50"), false);
    assert.equal(matchesOverstockFilter(high, "O50"), true);
    assert.equal(isOverstockFilter("O50"), true);
    assert.equal(isOverstockFilter("S"), false);
  });
});
