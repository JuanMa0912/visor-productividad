import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";

describe("canAccessInformeVariacion", () => {
  it("permite admin", () => {
    assert.equal(canAccessInformeVariacion("admin", [], []), true);
  });

  it("permite subseccion margenes", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["margenes"]),
      true,
    );
  });

  it("permite subseccion rotacion", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["rotacion"]),
      true,
    );
  });

  it("permite rol especial rotacion legacy", () => {
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], [], ["rotacion"]),
      true,
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
      canAccessInformeVariacion("user", ["producto"], ["mix-y-linea", "informe-variacion"]),
      true,
    );
  });

  it("niega sin producto ni rol especial", () => {
    assert.equal(canAccessInformeVariacion("user", ["rrhh"], ["margenes"]), false);
    assert.equal(
      canAccessInformeVariacion("user", ["producto"], ["mix-y-linea"]),
      false,
    );
  });
});
