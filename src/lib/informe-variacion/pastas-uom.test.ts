import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateIndicesByKey, buildInformeRowIndex } from "@/lib/informe-variacion/row-index";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import {
  buildInformeLineUomIndex,
  convertQtyToGroupUom,
  resolveGroupDisplayUom,
  resolveItemUom,
} from "@/lib/informe-variacion/line-item-uom";

const PASTA_ITEMS = [
  "054837 PASTA ZONIA*250g SPAGHETTI",
  "008580 PASTA LA MUNECA*250g SPAGUETI",
  "054842 PASTA ZONIA*250g MACARRONCITO",
  "027878 PASTA LA MUNECA*1000g ESPAGUETTI",
  "054840 PASTA ZONIA*250g CONCHITA",
  "014222 PASTA LA MUNECA*500g ESPAGUETIS",
];

const PASTA_QTYS = [2102, 867, 1076, 539, 487, 416];

describe("pastas en gramos -> kilos en sublinea", () => {
  it("detecta empaques en gramos y normaliza a kilos", () => {
    assert.deepEqual(resolveItemUom("054837 PASTA ZONIA*250g SPAGHETTI", "UND"), {
      kind: "mass_kg",
      factor: 0.25,
    });
    assert.deepEqual(resolveItemUom("027878 PASTA LA MUNECA*1000g ESPAGUETTI", "UND"), {
      kind: "mass_kg",
      factor: 1,
    });
    assert.deepEqual(resolveItemUom("014222 PASTA LA MUNECA*500g ESPAGUETIS", "UND"), {
      kind: "mass_kg",
      factor: 0.5,
    });
  });

  it("clasifica sublinea como kilos aunque items digan gramos", () => {
    const ctx = { items: PASTA_ITEMS, ums: PASTA_ITEMS.map(() => "UND") };
    assert.equal(
      resolveGroupDisplayUom(PASTA_ITEMS.map((_, index) => index), ctx),
      "kilos",
    );
  });

  it("total sublinea en kg difiere de suma cruda de empaques", () => {
    let raw = 0;
    let kilos = 0;
    PASTA_ITEMS.forEach((item, index) => {
      raw += PASTA_QTYS[index]!;
      kilos += convertQtyToGroupUom(PASTA_QTYS[index]!, item, "UND", "kilos");
    });
    assert.equal(raw, 5487);
    assert.ok(Math.abs(kilos - 1880) < 0.01);
    assert.notEqual(raw, kilos);
  });

  it("agrega sublinea en kilos via indice", () => {
    const ctx = {
      items: PASTA_ITEMS,
      ums: PASTA_ITEMS.map(() => "UND"),
      subs: ["01 PASTAS ALIMENTICIAS CORRIENTES"],
      lins: ["18 PASTAS ALIMENTICIAS"],
    };
    const rows: InformeCompactRow[] = PASTA_QTYS.map((qty, itemIndex) => [
      0, 0, 0, 0, itemIndex, qty, 0, 0, 0, 0, 0,
    ]);
    const rowIndex = buildInformeRowIndex(rows, ["E1"]);
    const index = buildInformeLineUomIndex(rowIndex, ctx);
    assert.equal(index.sublineDisplayUom.get("0|0"), "kilos");

    const metricCtx = {
      cats: ["4 Mercado"],
      lins: ctx.lins,
      subs: ctx.subs,
      items: ctx.items,
      ums: ctx.ums,
      lineDisplayUom: index.lineDisplayUom,
      sublineDisplayUom: index.sublineDisplayUom,
      sublineItems: index.sublineItems,
      lineItems: index.lineItems,
    };
    const subAgg = aggregateIndicesByKey(
      rows,
      rows.map((_, rowIndex) => rowIndex),
      "u",
      3,
      metricCtx,
    );
    assert.ok(Math.abs((subAgg.get(0)?.[0] ?? 0) - 1880) < 0.01);
  });
});
