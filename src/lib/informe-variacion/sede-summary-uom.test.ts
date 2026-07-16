import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateBySede } from "@/lib/informe-variacion/aggregate";
import { aggregateIndicesByKey } from "@/lib/informe-variacion/row-index";
import { convertQtyToGroupUom } from "@/lib/informe-variacion/line-item-uom";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import type { InformeMetricContext } from "@/lib/informe-variacion/informe-metric-values";

const ACEITE_ITEMS = [
  "042085 ACEITE MERCAMIO*3000ml SOYA",
  "042084 ACEITE MERCAMIO*900ml SOYA",
  "042600 ACEITE MERCAMIO*500ml SOYA",
];
const ACEITE_QTYS = [100, 200, 50];

const row14 = (
  sede: number,
  itemIndex: number,
  qty: number,
): InformeCompactRow => [
  sede,
  0,
  0,
  0,
  itemIndex,
  qty,
  qty,
  qty,
  0,
  0,
  0,
  0,
  0,
  0,
];

describe("resumen sede aplica conversiones UOM de matriz", () => {
  it("aggregateBySede en unidades convierte aceites a litros", () => {
    const ctx: InformeMetricContext = {
      cats: ["4 Mercado"],
      lins: ["08 ACEITES"],
      subs: ["02 ACEITES LIQUIDOS"],
      items: ACEITE_ITEMS,
      ums: ACEITE_ITEMS.map(() => "UND"),
      lineDisplayUom: new Map(),
      sublineDisplayUom: new Map([["0|0", "litros"]]),
      sublineItems: new Map(),
      lineItems: new Map(),
    };
    const rows: InformeCompactRow[] = ACEITE_QTYS.map((qty, itemIndex) =>
      row14(0, itemIndex, qty),
    );
    const perSede = aggregateBySede(rows, "u", 1, () => true, ctx);
    let expectedLiters = 0;
    ACEITE_ITEMS.forEach((item, index) => {
      expectedLiters += convertQtyToGroupUom(
        ACEITE_QTYS[index]!,
        item,
        "UND",
        "litros",
      );
    });
    const raw = ACEITE_QTYS.reduce((a, b) => a + b, 0);
    assert.equal(perSede[0]![0], expectedLiters);
    assert.notEqual(perSede[0]![0], raw);
  });

  it("aggregateIndicesByKey en sede (keyIndex 0) convierte aceites a litros", () => {
    const ctx: InformeMetricContext = {
      cats: ["4 Mercado"],
      lins: ["08 ACEITES"],
      subs: ["02 ACEITES LIQUIDOS"],
      items: ACEITE_ITEMS,
      ums: ACEITE_ITEMS.map(() => "UND"),
      lineDisplayUom: new Map(),
      sublineDisplayUom: new Map([["0|0", "litros"]]),
      sublineItems: new Map(),
      lineItems: new Map(),
    };
    const rows: InformeCompactRow[] = ACEITE_QTYS.map((qty, itemIndex) =>
      row14(0, itemIndex, qty),
    );
    const bySede = aggregateIndicesByKey(
      rows,
      rows.map((_, index) => index),
      "u",
      0,
      ctx,
    );
    let expectedLiters = 0;
    ACEITE_ITEMS.forEach((item, index) => {
      expectedLiters += convertQtyToGroupUom(
        ACEITE_QTYS[index]!,
        item,
        "UND",
        "litros",
      );
    });
    assert.equal(bySede.get(0)?.[0], expectedLiters);
  });

  it("en resumen sede trunca pollos und a enteros y deja el resto intacto", () => {
    // 10 presas = 1.25 pollos → floor 1; 3 und de porcion quedan en crudo.
    const ctx: InformeMetricContext = {
      cats: ["3 Asaderos", "3 Asaderos"],
      lins: ["01 POLLO ASADO", "01 POLLO ASADO"],
      subs: ["01 POLLO", "01 POLLO"],
      items: [
        "063019 PECHUGA APANADA (NVO)",
        "063027 PORCION DE PAPAS AMARILLAS (NVO)",
      ],
      ums: ["UND", "UND"],
      lineDisplayUom: new Map(),
      sublineDisplayUom: new Map(),
      sublineItems: new Map(),
      lineItems: new Map(),
    };
    const rows: InformeCompactRow[] = [
      row14(0, 0, 10),
      row14(0, 1, 3),
    ];
    const withFloor = aggregateBySede(rows, "u", 1, () => true, ctx, {
      floorCompletePollosUnd: true,
    });
    const withoutFloor = aggregateBySede(rows, "u", 1, () => true, ctx);
    assert.equal(withoutFloor[0]![0], 10 / 8 + 3);
    assert.equal(withFloor[0]![0], 1 + 3);
  });
});
