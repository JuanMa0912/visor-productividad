import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGenericEmpresaProveedorLabel,
  pickPreferredProveedorCandidate,
} from "@/lib/analisis-inventario/item-proveedor";

describe("pickPreferredProveedorCandidate", () => {
  it("no agrupa Fruver/Carnes Rojas dentro de MERCAMIO genérico", () => {
    const picked = pickPreferredProveedorCandidate([
      { label: "MERCAMIO", hits: 40 },
      { label: "MERCAMIO FRUVER", hits: 8 },
      { label: "MERCAMIO CARNES ROJAS", hits: 3 },
    ]);
    assert.equal(picked?.label, "MERCAMIO FRUVER");
  });

  it("entre criterios específicos gana el más frecuente si empatan en largo", () => {
    const picked = pickPreferredProveedorCandidate([
      { label: "MERCAMIO FRUVER", hits: 12 },
      { label: "MERCAMIO GRANOS", hits: 4 },
    ]);
    assert.equal(picked?.label, "MERCAMIO FRUVER");
  });

  it("detecta el nombre corto de empresa", () => {
    assert.equal(isGenericEmpresaProveedorLabel("MERCAMIO"), true);
    assert.equal(isGenericEmpresaProveedorLabel("MERCAMIO FRUVER"), false);
  });
});
