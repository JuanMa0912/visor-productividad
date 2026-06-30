import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scorePasswordStrength } from "@/lib/auth/password-strength";

describe("scorePasswordStrength", () => {
  it("marca 12345678 como débil", () => {
    const result = scorePasswordStrength("12345678");
    assert.equal(result.level, "weak");
    assert.equal(result.passesPolicy, false);
  });

  it("marca contraseña parcial como media", () => {
    const result = scorePasswordStrength("Abcdef12");
    assert.equal(result.level, "medium");
    assert.equal(result.passesPolicy, false);
  });

  it("marca contraseña de política como segura", () => {
    const result = scorePasswordStrength("Segura1!");
    assert.equal(result.level, "strong");
    assert.equal(result.passesPolicy, true);
  });
});
