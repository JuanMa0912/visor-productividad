import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BODEGA_BLOCKS } from "@/lib/checklists/bodega-gerencial";
import {
  computeChecklist,
  initStates,
  normalizePesos,
} from "@/lib/checklists/scoring";

describe("checklists scoring", () => {
  it("bodega suma 100% de pesos sugeridos", () => {
    const tot = BODEGA_BLOCKS.reduce(
      (a, b) => a + b.q.reduce((x, y) => x + y.p, 0),
      0,
    );
    assert.equal(tot, 100);
  });

  it("todo cumple da 100% y sin críticos", () => {
    const states = initStates(BODEGA_BLOCKS);
    for (const key of Object.keys(states)) {
      states[Number(key)]!.v = "C";
    }
    const r = computeChecklist(BODEGA_BLOCKS, states);
    assert.equal(r.pct, 100);
    assert.equal(r.cr, 0);
    assert.equal(r.ev, 16);
  });

  it("un crítico NC marca no conforme y baja el %", () => {
    const states = initStates(BODEGA_BLOCKS);
    for (const key of Object.keys(states)) states[Number(key)]!.v = "C";
    states[4]!.v = "NC";
    const r = computeChecklist(BODEGA_BLOCKS, states);
    assert.equal(r.cr, 1);
    assert.ok((r.pct ?? 0) < 100);
    assert.equal(Math.round((r.pct ?? 0) * 10) / 10, 90);
  });

  it("normalizar pesos vuelve a 100", () => {
    const skewed = BODEGA_BLOCKS.map((b) => ({
      ...b,
      q: b.q.map((it) => ({ ...it, p: it.p * 2 })),
    }));
    const n = normalizePesos(skewed);
    const tot = n.reduce((a, b) => a + b.q.reduce((x, y) => x + y.p, 0), 0);
    assert.ok(Math.abs(tot - 100) < 0.05);
  });
});
