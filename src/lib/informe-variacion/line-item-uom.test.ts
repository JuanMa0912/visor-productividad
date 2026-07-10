import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInformeRowIndex,
} from "@/lib/informe-variacion/row-index";
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

  it("convierte empaque en gramos a kilos", () => {
    assert.deepEqual(resolveItemUom("020001 ARROZ*500GR"), {
      kind: "mass_kg",
      factor: 0.5,
    });
  });

  it("convierte empaque en ml a litros", () => {
    assert.deepEqual(resolveItemUom("030001 ACEITE MERCAMIO*900ml SOYA"), {
      kind: "volume_l",
      factor: 0.9,
    });
  });

  it("trata empaques und como conteo", () => {
    assert.deepEqual(resolveItemUom("040001 GALLETAS*12und"), {
      kind: "count",
      factor: 1,
    });
  });

  it("usa id_unidad cuando la descripcion no tiene marca", () => {
    assert.deepEqual(resolveItemUom("050001 LECHE ENTERA", "KILO"), {
      kind: "mass_kg",
      factor: 1,
    });
  });
});

describe("resolveGroupDisplayUom", () => {
  const ctx = {
    items: [
      "010001 MANZANA ROJA*KILO",
      "010002 PERA*KILO",
      "020001 ACEITE*900ml",
      "020002 ACEITE*3000ml",
      "030001 GALLETAS*12und",
    ],
    ums: ["", "", "", "", ""],
  };

  it("devuelve kilos si todos los items son a kilo", () => {
    assert.equal(resolveGroupDisplayUom([0, 1], ctx), "kilos");
  });

  it("devuelve litros si todos los items son empaque liquido", () => {
    assert.equal(resolveGroupDisplayUom([2, 3], ctx), "litros");
  });

  it("devuelve null si hay mezcla con unidades", () => {
    assert.equal(resolveGroupDisplayUom([0, 4], ctx), null);
  });
});

describe("convertQtyToGroupUom", () => {
  it("suma litros desde empaques", () => {
    assert.equal(
      convertQtyToGroupUom(10, "ACEITE MERCAMIO*900ml SOYA", "", "litros"),
      9,
    );
    assert.equal(
      convertQtyToGroupUom(2, "ACEITE MERCAMIO*3000ml SOYA", "", "litros"),
      6,
    );
  });
});

describe("buildInformeLineUomIndex", () => {
  const ctx = {
    items: [
      "010001 MANZANA ROJA*KILO",
      "010002 PERA*KILO",
      "020001 ACEITE*900ml",
    ],
    ums: ["", "", ""],
  };

  it("indexa linea y sublinea homogeneas", () => {
    const rows: InformeCompactRow[] = [
      [0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 20, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 2, 5, 0, 0, 0, 0, 0],
    ];
    const rowIndex = buildInformeRowIndex(rows, ["E1"]);
    const index = buildInformeLineUomIndex(rowIndex, ctx);

    assert.equal(index.lineDisplayUom.get(0), "kilos");
    assert.equal(index.sublineDisplayUom.get("0|0"), "kilos");
    assert.equal(index.lineDisplayUom.get(1), "litros");
    assert.equal(index.sublineDisplayUom.get("1|0"), "litros");
  });
});
