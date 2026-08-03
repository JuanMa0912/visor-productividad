import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRestockEffectivenessScore } from "@/lib/rotacion/restock-effectiveness";

describe("computeRestockEffectivenessScore", () => {
  it("null si no hay marcas a surtido", () => {
    const score = computeRestockEffectivenessScore(0, 0);
    assert.equal(score.score, null);
    assert.equal(score.markedSurtidoCount, 0);
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
