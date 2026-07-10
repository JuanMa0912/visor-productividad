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

const emptyMetricCtx = { cats: [], lins: [], subs: [], items: [], ums: [] };

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

describe("pollos und en sublinea", () => {
  const polloRows: InformeCompactRow[] = [
    [0, 0, 0, 0, 0, 800, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0],
  ];
  const ctx = {
    cats: ["3 Asaderos"],
    lins: ["01 POLLO ASADO"],
    subs: ["01 POLLO"],
    items: ["063018 MUSLO APANADO (NVO)", "063021 POLLO APANADO MEDIO (NVO)"],
    ums: ["", ""],
  };

  it("mantiene unidades crudas a nivel item", () => {
    const itemAgg = aggregateIndicesByKey(polloRows, [0, 1], "u", 4, ctx);
    assert.equal(itemAgg.get(0)?.[0], 800);
    assert.equal(itemAgg.get(1)?.[0], 2);
  });

  it("convierte a pollos und solo en total de sublinea", () => {
    const subAgg = aggregateIndicesByKey(polloRows, [0, 1], "u", 3, ctx);
    assert.equal(subAgg.get(0)?.[0], 101);
  });

  it("en linea suma pollos und y porciones excluidas en crudo", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 800, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 718, 0, 0, 0, 0, 0],
    ];
    const lineCtx = {
      cats: ["3 Asaderos"],
      lins: ["01 POLLO ASADO"],
      subs: ["01 POLLO"],
      items: ["063018 MUSLO APANADO (NVO)", "063027 PORCION DE PAPAS AMARILLAS (NVO)"],
      ums: ["", ""],
    };
    const subAgg = aggregateIndicesByKey(rows, [0, 1], "u", 3, lineCtx);
    const lineAgg = aggregateIndicesByKey(rows, [0, 1], "u", 2, lineCtx);
    assert.equal(subAgg.get(0)?.[0], 100);
    assert.equal(lineAgg.get(0)?.[0], 818);
  });
});

describe("huevos und en sublinea", () => {
  const LINE = "12 HUEVOS";
  const SUB = "02 HUEVOS ROSADOS";
  const ctx = {
    cats: ["4 Mercado"],
    lins: [LINE],
    subs: [SUB],
    items: [
      "028992 HUEVO MERCAMIO ROSADO AA*30und",
      "013070 HUEVO MERCAMIO ROSADO A*und GRANEL",
    ],
    ums: ["", ""],
  };

  it("mantiene empaques crudos a nivel item", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0],
    ];
    const itemAgg = aggregateIndicesByKey(rows, [0], "u", 4, ctx);
    assert.equal(itemAgg.get(0)?.[0], 100);
  });

  it("convierte a huevos individuales en total de sublinea", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 10, 0, 0, 0, 0, 0],
    ];
    const subAgg = aggregateIndicesByKey(rows, [0, 1], "u", 3, ctx);
    assert.equal(subAgg.get(0)?.[0], 3_010);
  });
});
