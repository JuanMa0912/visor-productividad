import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeExpandCellInto,
  mergeProveedorNits,
} from "@/lib/exp-precios-proveedor/expand-merge";
import type { PreciosProveedorCell } from "@/lib/exp-precios-proveedor/types";

const cell = (
  sedeKey: string,
  overrides: Partial<PreciosProveedorCell> = {},
): PreciosProveedorCell => ({
  rowId: "row",
  sedeKey,
  units: 0,
  sales: 0,
  cost: 0,
  pvu: 0,
  pcu: 0,
  margenPct: 0,
  transito: 0,
  ...overrides,
});

describe("costos expand merge", () => {
  it("junta NITs distintos y no duplica el mismo", () => {
    assert.equal(mergeProveedorNits("9001", "9002"), "9001 · 9002");
    assert.equal(mergeProveedorNits("9001", "9001"), "9001");
    assert.equal(mergeProveedorNits(null, "9001"), "9001");
  });

  it("sedes distintas quedan en celdas separadas", () => {
    const cells: PreciosProveedorCell[] = [];
    mergeExpandCellInto(cells, cell("bogota|001", { units: 10, cost: 4000 }));
    mergeExpandCellInto(cells, cell("mercamio|002", { units: 5, cost: 2000 }));
    assert.equal(cells.length, 2);
    assert.equal(cells[0]?.cost, 4000);
    assert.equal(cells[1]?.cost, 2000);
  });

  it("misma sede suma kilos y costo y recalcula PCU", () => {
    const cells: PreciosProveedorCell[] = [];
    mergeExpandCellInto(
      cells,
      cell("bogota|001", { units: 10, cost: 40000, sales: 50000 }),
    );
    mergeExpandCellInto(
      cells,
      cell("bogota|001", { units: 5, cost: 15000, sales: 50000 }),
    );
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.units, 15);
    assert.equal(cells[0]?.cost, 55000);
    assert.equal(cells[0]?.sales, 50000);
    assert.equal(cells[0]?.pcu, 55000 / 15);
  });
});
