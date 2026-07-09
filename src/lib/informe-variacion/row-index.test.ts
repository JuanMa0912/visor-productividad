import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import {
  aggregateIndicesByKey,
  aggregateIndicesBySede,
  buildInformeRowIndex,
  filterIndexedRowIndices,
  sumRowIndices,
} from "@/lib/informe-variacion/row-index";

const sampleRows: InformeCompactRow[] = [
  [0, 1, 10, 100, 1000, 5, 4, 3, 100, 90, 80],
  [0, 1, 10, 100, 1001, 2, 2, 2, 50, 45, 40],
  [1, 2, 20, 200, 2000, 1, 1, 1, 20, 18, 15],
];

describe("buildInformeRowIndex", () => {
  it("agrupa indices por categoria y linea", () => {
    const index = buildInformeRowIndex(sampleRows, ["EmpA", "EmpB"]);
    assert.deepEqual(index.indicesByCat.get(1), [0, 1]);
    assert.deepEqual(index.indicesByCatLin.get("1|10"), [0, 1]);
    assert.deepEqual(index.indicesByCat.get(2), [2]);
    assert.deepEqual(index.byEmpresa.get("EmpA"), [0, 1]);
    assert.deepEqual(index.bySede.get(1), [2]);
  });
});

describe("filterIndexedRowIndices", () => {
  it("conserva solo indices permitidos", () => {
    const allowed = new Set([0, 2]);
    assert.deepEqual(filterIndexedRowIndices([0, 1, 2], allowed), [0, 2]);
  });
});

const emptyMetricCtx = { cats: [], lins: [], items: [], ums: [] };

describe("aggregateIndicesBySede", () => {
  it("suma por sede dentro de un bucket de categoria", () => {
    const index = buildInformeRowIndex(sampleRows, ["EmpA", "EmpB"]);
    const catIndices = index.indicesByCat.get(1) ?? [];
    const agg = aggregateIndicesBySede(
      sampleRows,
      catIndices,
      "v",
      2,
      1,
      emptyMetricCtx,
    );
    const catTotals = agg.get(1)?.[0];
    assert.equal(catTotals?.[0], 150);
    assert.equal(catTotals?.[1], 135);
    assert.equal(catTotals?.[2], 120);
  });
});

describe("aggregateIndicesByKey", () => {
  it("suma por linea dentro de sede", () => {
    const agg = aggregateIndicesByKey(sampleRows, [0, 1], "u", 2, emptyMetricCtx);
    assert.equal(agg.get(10)?.[0], 7);
    assert.equal(agg.get(10)?.[1], 6);
  });
});

describe("sumRowIndices", () => {
  it("totaliza periodos de filas seleccionadas", () => {
    const totals = sumRowIndices(sampleRows, [0, 2], "v", emptyMetricCtx);
    assert.deepEqual(totals, [120, 108, 95]);
  });
});
