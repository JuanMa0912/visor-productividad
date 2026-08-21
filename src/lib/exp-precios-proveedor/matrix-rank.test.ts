import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickCostosMatrixItemIds } from "@/lib/exp-precios-proveedor/matrix-rank";

describe("pickCostosMatrixItemIds", () => {
  it("se queda con el top-N por venta y no pide costo del resto", () => {
    assert.deepEqual(
      pickCostosMatrixItemIds(
        [
          { id: "a", sales: 10 },
          { id: "b", sales: 40 },
          { id: "c", sales: 25 },
        ],
        2,
      ),
      ["b", "c"],
    );
  });

  it("no pide nada si el cupo es 0", () => {
    assert.deepEqual(
      pickCostosMatrixItemIds([{ id: "a", sales: 1 }], 0),
      [],
    );
  });
});
