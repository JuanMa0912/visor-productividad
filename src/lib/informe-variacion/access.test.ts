import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";

describe("canAccessInformeVariacion", () => {
  it("permite admin", () => {
    assert.equal(canAccessInformeVariacion("admin", [], []), true);
  });

  it("no hereda de margenes ni rotacion", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["margenes"]),
      false,
    );
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["rotacion"]),
      false,
    );
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["margenes", "rotacion"]),
      false,
    );
  });

  it("no hereda del rol especial rotacion", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["mix-y-linea"], [
        "rotacion",
      ]),
      false,
    );
  });

  it("permite subseccion informe-variacion", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["informe-variacion"]),
      true,
    );
  });

  it("permite solo informe sin margenes ni rotacion en lista explicita", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], [
        "mix-y-linea",
        "informe-variacion",
      ]),
      true,
    );
  });

  it("lista vacia de subtableros = todos (incluye informe)", () => {
    assert.equal(canAccessInformeVariacion("user", ["producto"], []), true);
  });

  it("niega sin producto o sin subseccion informe", () => {
    assert.equal(canAccessInformeVariacion("user", ["rrhh"], ["margenes"]), false);
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["mix-y-linea"]),
      false,
    );
  });
});
