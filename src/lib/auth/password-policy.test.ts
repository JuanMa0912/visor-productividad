import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePasswordChangeRequirement,
  isKnownWeakPassword,
  isPasswordExpired,
  validatePasswordPolicy,
} from "@/lib/auth/password-policy";

describe("password-policy", () => {
  it("rechaza 12345678 y contraseñas sin complejidad", () => {
    assert.equal(isKnownWeakPassword("12345678"), true);
    assert.equal(validatePasswordPolicy("12345678") !== null, true);
    assert.equal(validatePasswordPolicy("Segura1!"), null);
  });

  it("exige cambio con contraseña débil al iniciar sesión", () => {
    const result = evaluatePasswordChangeRequirement({
      loginPassword: "12345678",
      passwordChangedAt: new Date().toISOString(),
    });
    assert.equal(result.required, true);
    assert.equal(result.reason, "weak");
  });

  it("exige cambio cuando vencieron 30 días", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    assert.equal(isPasswordExpired(old.toISOString()), true);
    const result = evaluatePasswordChangeRequirement({
      loginPassword: "Segura1!",
      passwordChangedAt: old.toISOString(),
    });
    assert.equal(result.required, true);
    assert.equal(result.reason, "expired");
  });

  it("permite sesión con contraseña fuerte dentro de la ventana", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const result = evaluatePasswordChangeRequirement({
      loginPassword: "Segura1!",
      passwordChangedAt: recent.toISOString(),
    });
    assert.equal(result.required, false);
    assert.ok((result.daysUntilExpiry ?? 0) > 0);
  });
});
