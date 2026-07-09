import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asaderoQtyToPollosUnd,
  convertAsaderoQtyToPollosUnd,
  resolveAsaderoPollosUnitKind,
  shouldConvertAsaderoToPollosUnd,
} from "@/lib/informe-variacion/asadero-pollos-und";

describe("asadero pollos und", () => {
  it("convierte presas y medios a pollos equivalentes", () => {
    assert.equal(asaderoQtyToPollosUnd(8, "presa"), 1);
    assert.equal(asaderoQtyToPollosUnd(16, "presa"), 2);
    assert.equal(asaderoQtyToPollosUnd(2, "medio"), 1);
    assert.equal(asaderoQtyToPollosUnd(1, "pollo"), 1);
  });

  it("detecta tipo por descripcion o unidad", () => {
    assert.equal(resolveAsaderoPollosUnitKind("POLLO PRESA", ""), "presa");
    assert.equal(resolveAsaderoPollosUnitKind("POLLO 1/2", ""), "medio");
    assert.equal(resolveAsaderoPollosUnitKind("POLLO ENTERO", ""), "pollo");
    assert.equal(resolveAsaderoPollosUnitKind("", "PRESA"), "presa");
  });

  it("solo aplica en categoria 3 linea pollo asado", () => {
    assert.equal(
      shouldConvertAsaderoToPollosUnd("3 Asaderos", "01 POLLO ASADO"),
      true,
    );
    assert.equal(
      shouldConvertAsaderoToPollosUnd("3 Asaderos", "02 ENSALADAS BEFRU"),
      false,
    );
    assert.equal(
      shouldConvertAsaderoToPollosUnd("4 Mercado", "01 POLLO ASADO"),
      false,
    );
  });

  it("convierte cantidad con contexto de item", () => {
    assert.equal(
      convertAsaderoQtyToPollosUnd(800, "123 POLLO PRESA", "", "01 POLLO ASADO"),
      100,
    );
  });
});
