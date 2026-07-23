import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateIndicesByKey } from "@/lib/informe-variacion/row-index";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import {
  buildInformeLineUomIndex,
  convertQtyToGroupUom,
  resolveGroupDisplayUom,
  resolveItemUom,
} from "@/lib/informe-variacion/line-item-uom";
import { buildInformeRowIndex } from "@/lib/informe-variacion/row-index";

const ACEITE_ITEMS = [
  "042085 ACEITE MERCAMIO*3000ml SOYA",
  "030388 ACEITE CADADIA*3000ml GIRASOL",
  "042084 ACEITE MERCAMIO*900ml SOYA",
  "050114 ACEITE MERCAMIO*1800ml SOYA",
  "073242 ACEITE SAN MIGUEL*2700ml VEGETAL",
  "030461 ACEITE CADADIA*900ml GIRASOL",
  "042600 ACEITE MERCAMIO*500ml SOYA",
  "042094 ACEITE MERCAMIO*5000ml SOYA",
  "076745 ACEITE S/FELIPE*500ml OLIVA EXT/VIR NV",
  "077038 ACEITE SELETTI*3000ml CANOLA",
];

const ACEITE_QTYS = [2258, 839, 952, 628, 479, 382, 283, 272, 221, 229];

describe("aceites liquidos captura de pantalla", () => {
  it("todos los items visibles son volumen en ml", () => {
    for (const item of ACEITE_ITEMS) {
      assert.equal(resolveItemUom(item, "UND").kind, "volume_l");
    }
    assert.equal(
      resolveGroupDisplayUom(
        ACEITE_ITEMS.map((_, index) => index),
        { items: ACEITE_ITEMS, ums: ACEITE_ITEMS.map(() => "UND") },
      ),
      "litros",
    );
  });

  it("el total en litros no coincide con la suma cruda de empaques", () => {
    let raw = 0;
    let liters = 0;
    ACEITE_ITEMS.forEach((item, index) => {
      raw += ACEITE_QTYS[index]!;
      liters += convertQtyToGroupUom(ACEITE_QTYS[index]!, item, "UND", "litros");
    });
    assert.equal(raw, 6543);
    assert.ok(liters > 15_000);
    assert.notEqual(raw, liters);
  });

  it("agrega sublinea en litros cuando el indice lo marca", () => {
    const ctx = {
      cats: ["4 Mercado"],
      lins: ["08 ACEITES"],
      subs: ["02 ACEITES LIQUIDOS"],
      items: ACEITE_ITEMS,
      ums: ACEITE_ITEMS.map(() => "UND"),
      lineDisplayUom: new Map<number, string>(),
      sublineDisplayUom: new Map<string, string>([["0|0", "litros"]]),
      sublineItems: new Map<string, readonly number[]>(),
      lineItems: new Map<number, readonly number[]>(),
    };
    const rows: InformeCompactRow[] = ACEITE_QTYS.map((qty, itemIndex) => [
      0, 0, 0, 0, itemIndex, qty, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const subAgg = aggregateIndicesByKey(rows, rows.map((_, index) => index), "u", 3, ctx);
    let expected = 0;
    ACEITE_ITEMS.forEach((item, index) => {
      expected += convertQtyToGroupUom(ACEITE_QTYS[index]!, item, "UND", "litros");
    });
    assert.equal(subAgg.get(0)?.[0], expected);
    assert.notEqual(subAgg.get(0)?.[0], 6543);
  });

  it("construye indice litros para sublinea aceites liquidos", () => {
    const ctx = {
      items: ACEITE_ITEMS,
      ums: ACEITE_ITEMS.map(() => "UND"),
      subs: ["02 ACEITES LIQUIDOS"],
      lins: ["08 ACEITES"],
    };
    const rows: InformeCompactRow[] = ACEITE_QTYS.map((qty, itemIndex) => [
      0, 0, 0, 0, itemIndex, qty, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const rowIndex = buildInformeRowIndex(rows, ["E1"]);
    const index = buildInformeLineUomIndex(rowIndex, ctx);
    assert.equal(index.sublineDisplayUom.get("0|0"), "litros");
  });
});
