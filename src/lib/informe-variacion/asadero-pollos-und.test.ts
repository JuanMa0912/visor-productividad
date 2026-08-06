import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asaderoQtyToPollosUnd,
  convertAsaderoQtyToPollosUnd,
  resolveAsaderoPollosConversion,
  shouldConvertAsaderoToPollosUnd,
} from "@/lib/informe-variacion/asadero-pollos-und";

const LINE = "01 POLLO ASADO";
const SUB = "01 POLLO";

describe("asadero pollos und", () => {
  it("convierte presas, medios, cuartos y enteros", () => {
    assert.equal(asaderoQtyToPollosUnd(8, "presa"), 1);
    assert.equal(asaderoQtyToPollosUnd(16, "presa"), 2);
    assert.equal(asaderoQtyToPollosUnd(2, "medio"), 1);
    assert.equal(asaderoQtyToPollosUnd(4, "cuarto"), 1);
    assert.equal(asaderoQtyToPollosUnd(1, "pollo"), 1);
    assert.equal(asaderoQtyToPollosUnd(100, "exclude"), 0);
  });

  it("excluye porciones y acompañamientos", () => {
    assert.equal(
      convertAsaderoQtyToPollosUnd(718, "063027 PORCION DE PAPAS AMARILLAS (NVO)", "", LINE, SUB),
      0,
    );
    assert.equal(
      convertAsaderoQtyToPollosUnd(517, "063026 PORCION DE YUCAS (NVO)", "", LINE, SUB),
      0,
    );
    assert.equal(
      convertAsaderoQtyToPollosUnd(150, "063028 PORCION DE AREPAS*3und", "", LINE, SUB),
      0,
    );
  });

  it("clasifica items reales de sublinea 01 POLLO", () => {
    const cases: Array<[string, number, number]> = [
      ["063019 PECHUGA APANADA (NVO)", 982, 982 / 8],
      ["063024 POLLO ASADO ENTERO (NVO)", 995, 995],
      ["063016 ALA APANADA (NVO)", 863, 863 / 8],
      ["063020 POLLO APANADO ENTERO (NVO)", 810, 810],
      ["063017 CONTRAMUSLO APANADO (NVO)", 787, 787 / 8],
      ["063018 MUSLO APANADO (NVO)", 677, 677 / 8],
      ["063021 POLLO APANADO MEDIO (NVO)", 367, 367 / 2],
      ["074690 OFERTA POLLO APANADO MUSLO+ALA+CONTRA...", 76, (76 * 3) / 8],
      ["063025 POLLO ASADO MEDIO (1/2) (NVO)", 159.5, 159.5 / 2],
      ["063023 POLLO ASADO CUARTO PERNIL (NVO)", 125, 125 / 4],
      ["063022 POLLO ASADO CUARTO PECHUGA (NVO)", 148, 148 / 4],
      ["070633 MUSLO APANADO PROMOCION", 4, 4 / 8],
    ];

    for (const [label, qty, expected] of cases) {
      const converted = convertAsaderoQtyToPollosUnd(qty, label, "", LINE, SUB);
      assert.ok(
        Math.abs(converted - expected) < 0.001,
        `${label}: esperado ${expected}, obtuvo ${converted}`,
      );
    }
  });

  it("total de sublinea sin porciones coincide con pollos equivalentes", () => {
    const rows: Array<[string, number]> = [
      ["063019 PECHUGA APANADA (NVO)", 982],
      ["063024 POLLO ASADO ENTERO (NVO)", 995],
      ["063016 ALA APANADA (NVO)", 863],
      ["063020 POLLO APANADO ENTERO (NVO)", 810],
      ["063027 PORCION DE PAPAS AMARILLAS (NVO)", 718],
      ["063017 CONTRAMUSLO APANADO (NVO)", 787],
      ["063018 MUSLO APANADO (NVO)", 677],
      ["063026 PORCION DE YUCAS (NVO)", 517],
      ["063021 POLLO APANADO MEDIO (NVO)", 367],
      ["074690 OFERTA POLLO APANADO MUSLO+ALA+CONTRA...", 76],
      ["063028 PORCION DE AREPAS*3und", 150],
      ["063025 POLLO ASADO MEDIO (1/2) (NVO)", 159.5],
      ["063023 POLLO ASADO CUARTO PERNIL (NVO)", 125],
      ["063022 POLLO ASADO CUARTO PECHUGA (NVO)", 148],
      ["063030 PORCION DE PAPA COCIDA NVO", 68],
      ["070633 MUSLO APANADO PROMOCION", 4],
    ];

    const total = rows.reduce(
      (sum, [label, qty]) =>
        sum + convertAsaderoQtyToPollosUnd(qty, label, "", LINE, SUB),
      0,
    );

    assert.ok(Math.abs(total - 2579.125) < 0.01, `total=${total}`);
  });

  it("solo aplica en categoria 3, linea pollo asado y sublinea pollo", () => {
    assert.equal(shouldConvertAsaderoToPollosUnd("3 Asaderos", LINE, SUB), true);
    assert.equal(
      shouldConvertAsaderoToPollosUnd("3 Asaderos", LINE, "02 ENSALADAS"),
      false,
    );
    assert.equal(
      shouldConvertAsaderoToPollosUnd("3 Asaderos", "02 ENSALADAS BEFRU", SUB),
      false,
    );
    assert.equal(
      shouldConvertAsaderoToPollosUnd("4 Mercado", LINE, SUB),
      false,
    );
  });

  it("detecta combo por descripcion", () => {
    const combo = resolveAsaderoPollosConversion(
      "074690 OFERTA POLLO APANADO MUSLO+ALA+CONTRA...",
      "",
      LINE,
      SUB,
    );
    assert.equal(combo.kind, "presa");
    assert.equal(combo.presaUnits, 3);
  });
});

describe("asadero: items fuera de las listas de codigos fijos", () => {
  const LINE_REAL = "POLLO ASADO";
  const SUB_REAL = "POLLO";

  it("respeta las presas declaradas en la descripcion (*11 PRESAS)", () => {
    // Item real 078446. Antes daba presaUnits=1 -> 0,125 pollos/und en vez de
    // 1,375: sobre 90 dias faltaban 1.635 pollos (1,24% del total de asaderos).
    const conv = resolveAsaderoPollosConversion(
      "078446 POLLO APANADO*11 PRESAS",
      "",
      LINE_REAL,
      SUB_REAL,
    );
    assert.equal(conv.kind, "presa");
    assert.equal(conv.presaUnits, 11);
    assert.equal(
      convertAsaderoQtyToPollosUnd(8, "078446 POLLO APANADO*11 PRESAS", "", LINE_REAL, SUB_REAL),
      11,
    );
  });

  it("no cuenta CONTRAMUSLO tres veces por solapamiento de subcadenas", () => {
    // CONTRAMUSLO contiene CONTRA y MUSLO: el conteo por includes() daba 3.
    const conv = resolveAsaderoPollosConversion(
      "099001 OFERTA CONTRAMUSLO APANADO",
      "",
      LINE_REAL,
      SUB_REAL,
    );
    assert.equal(conv.kind, "presa");
    assert.equal(conv.presaUnits, 1);
  });

  it("un combo con pollo entero no se pierde por nombrar un acompanamiento", () => {
    // Antes `isSideDishText` excluia la fila entera al ver ENSALADA o PAPAS.
    for (const label of [
      "099010 COMBO POLLO ASADO ENTERO + ENSALADA",
      "099011 POLLO ASADO ENTERO CON PAPAS",
    ]) {
      assert.equal(
        convertAsaderoQtyToPollosUnd(1, label, "", LINE_REAL, SUB_REAL),
        1,
        label,
      );
    }
  });

  it("las porciones puras siguen excluidas", () => {
    for (const label of [
      "099030 PORCION DE PAPAS AMARILLAS",
      "099031 PORCION DE YUCAS",
      "099032 ENSALADA DE FRUTAS",
    ]) {
      assert.equal(
        convertAsaderoQtyToPollosUnd(100, label, "", LINE_REAL, SUB_REAL),
        0,
        label,
      );
    }
  });

  it("los items reales ya cubiertos por codigo no cambian", () => {
    const cases: Array<[string, number]> = [
      ["063019 PECHUGA APANADA (NVO)", 1 / 8],
      ["063024 POLLO ASADO ENTERO (NVO)", 1],
      ["063021 POLLO APANADO MEDIO (NVO)", 1 / 2],
      ["063022 POLLO ASADO CUARTO PECHUGA (NVO)", 1 / 4],
      ["074690 OFERTA POLLO APANADO MUSLO+ALA+CONTRAMUS", 3 / 8],
      ["063029 POLLO ASADO ENTERO+CONTENEDOR", 1],
    ];
    for (const [label, expected] of cases) {
      const got = convertAsaderoQtyToPollosUnd(1, label, "", LINE_REAL, SUB_REAL);
      assert.ok(Math.abs(got - expected) < 1e-9, `${label}: ${got} != ${expected}`);
    }
  });
});
