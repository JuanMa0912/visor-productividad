import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeProveedoresQrSede,
  decodeProveedorPosKey,
  encodeProveedorPosKey,
  isAcceptedDatosAutorizacion,
  isValidProveedorToken,
  isValidVisitanteCedula,
  normalizeVisitanteCedula,
  normalizeVisitanteNombre,
} from "@/lib/proveedores/types";

describe("proveedores types", () => {
  it("normaliza sede QR sin importar mayúsculas ni espacios", () => {
    assert.equal(canonicalizeProveedoresQrSede(" floresta "), "Floresta");
    assert.equal(canonicalizeProveedoresQrSede("BOGOTA"), "Bogota");
    assert.equal(canonicalizeProveedoresQrSede("Dinastia"), null);
  });
  it("normaliza cédula a dígitos", () => {
    assert.equal(normalizeVisitanteCedula("1.234.567"), "1234567");
    assert.equal(isValidVisitanteCedula("123456"), true);
    assert.equal(isValidVisitanteCedula("123"), false);
  });

  it("valida token de QR", () => {
    assert.equal(
      isValidProveedorToken("prv_f090df27e2d6e7931987d86ba37055fb7bda"),
      true,
    );
    assert.equal(isValidProveedorToken("floresta"), false);
  });

  it("normaliza nombre", () => {
    assert.equal(normalizeVisitanteNombre("  Ana   Pérez  "), "Ana Pérez");
  });

  it("solo acepta autorización explícita", () => {
    assert.equal(isAcceptedDatosAutorizacion(true), true);
    assert.equal(isAcceptedDatosAutorizacion("true"), true);
    assert.equal(isAcceptedDatosAutorizacion(false), false);
    assert.equal(isAcceptedDatosAutorizacion("on"), false);
    assert.equal(isAcceptedDatosAutorizacion(undefined), false);
  });

  it("encode/decode clave POS", () => {
    const id = encodeProveedorPosKey("mercamio", "0011", "02");
    assert.equal(id, "mercamio|0011|02");
    assert.deepEqual(decodeProveedorPosKey(id), {
      empresa: "mercamio",
      codigo: "0011",
      sucursal: "02",
    });
  });
});
