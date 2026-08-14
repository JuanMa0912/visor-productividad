import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRestockEffectivenessScore } from "@/lib/rotacion/restock-effectiveness";

describe("computeRestockEffectivenessScore", () => {
  it("0 si no hay marcas a surtido (no es inexistente)", () => {
    const score = computeRestockEffectivenessScore(0, 0);
    assert.equal(score.score, 0);
    assert.equal(score.markedSurtidoCount, 0);
    assert.equal(score.unavailable, false);
  });

  it("calcula porcentaje redondeado 0–100", () => {
    const score = computeRestockEffectivenessScore(3, 2);
    assert.equal(score.score, 67);
    assert.equal(score.soldAfterCount, 2);
  });

  it("cap soldAfter al denominador", () => {
    const score = computeRestockEffectivenessScore(2, 5);
    assert.equal(score.soldAfterCount, 2);
    assert.equal(score.score, 100);
  });
});
