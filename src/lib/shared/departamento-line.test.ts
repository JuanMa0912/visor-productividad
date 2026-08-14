import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDepartamentoAllowedForLines,
  resolveAsaderoHoursBucket,
  resolveDepartamentoLineId,
} from "@/lib/shared/departamento-line";

describe("resolveDepartamentoLineId", () => {
  it("mapea POLLO ASADO a asadero", () => {
    assert.equal(resolveDepartamentoLineId("POLLO ASADO"), "asadero");
  });

  it("mapea departamentos de cajas", () => {
    assert.equal(resolveDepartamentoLineId("SUPERVISION Y CAJAS"), "cajas");
  });
  it("reparte horas de asadero entre UND.Pollo y Unidades", () => {
    assert.equal(resolveAsaderoHoursBucket("POLLO ASADO"), "pollos");
    assert.equal(resolveAsaderoHoursBucket("pollo asado"), "pollos");
    assert.equal(resolveAsaderoHoursBucket("ASADERO"), "other");
    assert.equal(resolveAsaderoHoursBucket("asadero"), "other");
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
