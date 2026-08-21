import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCriterioDepartamentoProveedorLabel,
  pickInformeProveedorCandidate,
} from "@/lib/informe-variacion/proveedores";

describe("pickInformeProveedorCandidate", () => {
  it("prefiere el tercero individual y no el criterio MERCAMIO FRUVER", () => {
    const picked = pickInformeProveedorCandidate([
      { label: "MERCAMIO FRUVER", hits: 40, source: "criterio" },
      { label: "COSECHA NUESTRA SAS OC", hits: 6, source: "oc" },
      { label: "MERCAMIO CARNES ROJAS", hits: 12, source: "criterio" },
    ]);
    assert.equal(picked?.label, "COSECHA NUESTRA SAS OC");
  });

  it("entre terceros gana el más frecuente", () => {
    const picked = pickInformeProveedorCandidate([
      { label: "ALPINA", hits: 4, source: "tercero" },
      { label: "GOMEZ VIDAL JOSE MARINO OC", hits: 9, source: "tercero" },
    ]);
    assert.equal(picked?.label, "GOMEZ VIDAL JOSE MARINO OC");
  });

  it("detecta criterios de departamento POS", () => {
    assert.equal(isCriterioDepartamentoProveedorLabel("MERCAMIO FRUVER"), true);
    assert.equal(
      isCriterioDepartamentoProveedorLabel("MERCAMIO CARNES ROJAS"),
      true,
    );
    assert.equal(isCriterioDepartamentoProveedorLabel("ALPINA"), false);
  });
});
