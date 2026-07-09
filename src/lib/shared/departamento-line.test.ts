import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDepartamentoAllowedForLines,
  resolveDepartamentoLineId,
} from "@/lib/shared/departamento-line";

describe("resolveDepartamentoLineId", () => {
  it("mapea POLLO ASADO a asadero", () => {
    assert.equal(resolveDepartamentoLineId("POLLO ASADO"), "asadero");
  });

  it("mapea departamentos de cajas", () => {
    assert.equal(resolveDepartamentoLineId("SUPERVISION Y CAJAS"), "cajas");
  });
});

describe("isDepartamentoAllowedForLines", () => {
  it("sin restriccion permite cualquier departamento mapeado", () => {
    assert.equal(isDepartamentoAllowedForLines("POLLO ASADO", null), true);
    assert.equal(isDepartamentoAllowedForLines("CAJAS", []), true);
  });

  it("solo asadero excluye departamentos sin linea o de otra linea", () => {
    assert.equal(
      isDepartamentoAllowedForLines("POLLO ASADO", ["asadero"]),
      true,
    );
    assert.equal(
      isDepartamentoAllowedForLines("SUPERVISION Y CAJAS", ["asadero"]),
      false,
    );
    assert.equal(
      isDepartamentoAllowedForLines("MERCADEO Y PUBLICIDAD", ["asadero"]),
      false,
    );
  });
});
