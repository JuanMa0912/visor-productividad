import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInformeRowIndex } from "@/lib/informe-variacion/row-index";
import type { InformeCompactRow } from "@/lib/informe-variacion/types";
import {
  buildInformeLineUomIndex,
  convertQtyToGroupUom,
  resolveGroupDisplayUom,
  resolveItemUom,
} from "@/lib/informe-variacion/line-item-uom";

describe("resolveItemUom", () => {
  it("detecta venta a kilo", () => {
    assert.deepEqual(resolveItemUom("010001 MANZANA ROJA*KILO"), {
      kind: "mass_kg",
      factor: 1,
    });
  });

  it("convierte empaques de masa", () => {
    assert.deepEqual(resolveItemUom("020001 ARROZ*500GR"), {
      kind: "mass_kg",
      factor: 0.5,
    });
    assert.deepEqual(resolveItemUom("020002 CARNE*250G"), {
      kind: "mass_kg",
      factor: 0.25,
    });
    assert.deepEqual(resolveItemUom("020003 HARINA*2KG"), {
      kind: "mass_kg",
      factor: 2,
    });
  });

  it("convierte empaques de volumen", () => {
    assert.deepEqual(resolveItemUom("030001 ACEITE MERCAMIO*900ml SOYA"), {
      kind: "volume_l",
      factor: 0.9,
    });
    assert.deepEqual(resolveItemUom("030002 LECHE*750CC"), {
      kind: "volume_l",
      factor: 0.75,
    });
    assert.deepEqual(resolveItemUom("030003 BEBIDA*25CL"), {
      kind: "volume_l",
      factor: 0.25,
    });
    assert.deepEqual(resolveItemUom("030004 JUGO*1.5LT"), {
      kind: "volume_l",
      factor: 1.5,
    });
  });

  it("trata empaques und como conteo", () => {
    assert.deepEqual(resolveItemUom("040001 GALLETAS*12und"), {
      kind: "count",
      factor: 1,
    });
  });

  it("detecta unidades en descripcion sin asterisco e id_unidad", () => {
    assert.deepEqual(resolveItemUom("042085 ACEITE MERCAMIO 3000ML SOYA"), {
      kind: "volume_l",
      factor: 3,
    });
    assert.deepEqual(resolveItemUom("042084 ACEITE MERCAMIO SOYA", "900 ML"), {
      kind: "volume_l",
      factor: 0.9,
    });
    assert.deepEqual(resolveItemUom("050001 PULPA", "KILO"), {
      kind: "mass_kg",
      factor: 1,
    });
    assert.deepEqual(resolveItemUom("070001 SAL*500MG"), {
      kind: "mass_kg",
      factor: 0.0005,
    });
  });
});

describe("resolveGroupDisplayUom por items de sublinea", () => {
  const ctx = {
    items: [
      "010001 MANZANA ROJA*KILO",
      "010002 PERA*KILO",
      "020001 ACEITE*900ml",
      "020002 ACEITE*3000ml",
      "030001 GALLETAS*12und",
      "040001 LECHE*900ml",
      "040002 CREMA*250GR",
    ],
    ums: ["", "", "", "", "", "", ""],
  };

  it("devuelve kilos si todos los items medibles son a kilo", () => {
    assert.equal(resolveGroupDisplayUom([0, 1], ctx), "kilos");
  });

  it("devuelve litros si todos los items medibles son empaque liquido", () => {
    assert.equal(resolveGroupDisplayUom([2, 3], ctx), "litros");
  });

  it("devuelve null si hay mezcla kilos y litros", () => {
    assert.equal(resolveGroupDisplayUom([0, 2], ctx), null);
  });

  it("devuelve null si hay item *und", () => {
    assert.equal(resolveGroupDisplayUom([2, 4], ctx), null);
  });

  it("ignora items sin marca y convierte si el resto es homogeneo", () => {
    assert.equal(
      resolveGroupDisplayUom([0, 1, 2], {
        items: [
          "020001 ACEITE*900ml",
          "020002 ACEITE*3000ml",
          "999999 ACCESORIO SIN MARCA",
        ],
        ums: ["UND", "UND", "UND"],
      }),
      "litros",
    );
  });

  it("devuelve null si mezcla gr y ml en la misma sublinea", () => {
    assert.equal(resolveGroupDisplayUom([5, 6], ctx), null);
  });
});

describe("convertQtyToGroupUom", () => {
  it("suma litros y kilos desde empaques", () => {
    assert.equal(
      convertQtyToGroupUom(10, "ACEITE MERCAMIO*900ml SOYA", "", "litros"),
      9,
    );
    assert.equal(
      convertQtyToGroupUom(4, "ARROZ*500GR", "", "kilos"),
      2,
    );
  });
});

describe("buildInformeLineUomIndex", () => {
  it("indexa cada sublinea revisando todos sus items", () => {
    const ctx = {
      items: [
        "010001 MANZANA*KILO",
        "010002 PERA*KILO",
        "020001 ACEITE*900ml",
        "020002 ACEITE*1800ml",
      ],
      ums: ["", "", "", ""],
      subs: ["01 FRUVER", "02 ACEITES LIQUIDOS"],
      lins: ["01 FRUVER", "08 ACEITES"],
    };
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 20, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 2, 5, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 3, 8, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const rowIndex = buildInformeRowIndex(rows, ["E1"]);
    const index = buildInformeLineUomIndex(rowIndex, ctx);

    assert.equal(index.sublineDisplayUom.get("0|0"), "kilos");
    assert.equal(index.sublineDisplayUom.get("1|1"), "litros");
    assert.equal(index.lineDisplayUom.get(0), "kilos");
    assert.equal(index.lineDisplayUom.get(1), "litros");
  });
});
