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

const emptyMetricCtx = {
  cats: [],
  lins: [],
  subs: [],
  items: [],
  ums: [],
  lineDisplayUom: new Map<number, string>(),
  sublineDisplayUom: new Map<string, string>(),
  sublineItems: new Map<string, readonly number[]>(),
  lineItems: new Map<number, readonly number[]>(),
};

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
    lineDisplayUom: new Map<number, string>(),
    sublineDisplayUom: new Map<string, string>(),
    sublineItems: new Map<string, readonly number[]>(),
    lineItems: new Map<number, readonly number[]>(),
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
      lineDisplayUom: new Map<number, string>(),
      sublineDisplayUom: new Map<string, string>(),
      sublineItems: new Map<string, readonly number[]>(),
      lineItems: new Map<number, readonly number[]>(),
    };
    const subAgg = aggregateIndicesByKey(rows, [0, 1], "u", 3, lineCtx);
    const lineAgg = aggregateIndicesByKey(rows, [0, 1], "u", 2, lineCtx);
    assert.equal(subAgg.get(0)?.[0], 100);
    assert.equal(lineAgg.get(0)?.[0], 818);
  });

  it("rollup categoria/sede usa reglas de linea (padre >= hijo)", () => {
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
      lineDisplayUom: new Map<number, string>(),
      sublineDisplayUom: new Map<string, string>(),
      sublineItems: new Map<string, readonly number[]>(),
      lineItems: new Map<number, readonly number[]>(),
    };
    const catAgg = aggregateIndicesByKey(rows, [0, 1], "u", 1, lineCtx);
    const lineAgg = aggregateIndicesByKey(rows, [0, 1], "u", 2, lineCtx);
    const subAgg = aggregateIndicesByKey(rows, [0, 1], "u", 3, lineCtx);
    assert.equal(catAgg.get(0)?.[0], 818);
    assert.equal(lineAgg.get(0)?.[0], 818);
    assert.ok((catAgg.get(0)?.[0] ?? 0) >= (subAgg.get(0)?.[0] ?? 0));
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
    lineDisplayUom: new Map<number, string>(),
    sublineDisplayUom: new Map<string, string>(),
    sublineItems: new Map<string, readonly number[]>(),
    lineItems: new Map<number, readonly number[]>(),
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

describe("kilos y litros en linea/sublinea", () => {
  const ctx = {
    cats: ["4 Mercado"],
    lins: ["01 FRUVER", "08 ACEITES"],
    subs: ["01 FRUVER", "01 ACEITES"],
    items: [
      "010001 MANZANA ROJA*KILO",
      "010002 PERA*KILO",
      "080001 ACEITE MERCAMIO*900ml SOYA",
      "080002 ACEITE MERCAMIO*3000ml SOYA",
    ],
    ums: ["", "", "", ""],
    lineDisplayUom: new Map<number, string>([
      [0, "kilos"],
      [1, "litros"],
    ]),
    sublineDisplayUom: new Map<string, string>([
      ["0|0", "kilos"],
      ["1|0", "litros"],
    ]),
    sublineItems: new Map<string, readonly number[]>(),
    lineItems: new Map<number, readonly number[]>(),
  };

  it("mantiene empaques crudos a nivel item", () => {
    const rows: InformeCompactRow[] = [[0, 0, 1, 0, 2, 10, 0, 0, 0, 0, 0]];
    const itemAgg = aggregateIndicesByKey(rows, [0], "u", 4, ctx);
    assert.equal(itemAgg.get(2)?.[0], 10);
  });

  it("convierte a kilos en total de sublinea fruver", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 50, 0, 0, 0, 0, 0],
    ];
    const subAgg = aggregateIndicesByKey(rows, [0, 1], "u", 3, ctx);
    assert.equal(subAgg.get(0)?.[0], 150);
  });

  it("convierte a litros en total de linea aceites", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 1, 0, 2, 10, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 3, 2, 0, 0, 0, 0, 0],
    ];
    const lineAgg = aggregateIndicesByKey(rows, [0, 1], "u", 2, ctx);
    assert.equal(lineAgg.get(1)?.[0], 15);
  });
});
