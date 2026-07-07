import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyInformeMockComparisonBases,
  informePayloadHasComparisonData,
  mockInformeComparisonMultiplier,
} from "@/lib/informe-variacion/mock-bases";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const basePayload = (): InformeVariacionPayload => ({
  periods: {
    current: { from: "20260601", to: "20260630", label: "Jun 2026" },
    mom: { from: "20260501", to: "20260531", label: "May 2026" },
    yoy: { from: "20250601", to: "20250630", label: "Jun 2025" },
  },
  sedes: [{ e: "Mercamio", s: "01 La 5", yoyOk: false, key: "mercamio|001" }],
  cats: ["4 Mercado"],
  lins: ["01 FRUVER"],
  subs: ["01 FRUVER"],
  items: ["1001 Manzana"],
  ums: ["KG"],
  rows: [[0, 0, 0, 0, 0, 100, 0, 0, 500_000, 0, 0]],
  meta: { rowCount: 1, generatedAt: "2026-07-07T00:00:00.000Z" },
});

describe("mockInformeComparisonMultiplier", () => {
  it("es estable para la misma fila", () => {
    const a = mockInformeComparisonMultiplier([0, 1, 2, 3, 4], "mom", 0.1);
    const b = mockInformeComparisonMultiplier([0, 1, 2, 3, 4], "mom", 0.1);
    assert.equal(a, b);
    assert.ok(a >= 0.9 && a <= 1.1);
  });
});

describe("applyInformeMockComparisonBases", () => {
  it("rellena mom/yoy cuando solo hay periodo actual", () => {
    assert.equal(informePayloadHasComparisonData(basePayload().rows), false);
    const mocked = applyInformeMockComparisonBases(basePayload());
    assert.equal(mocked.meta.mockBases, true);
    assert.equal(mocked.sedes[0]?.yoyOk, true);
    assert.ok(mocked.rows[0]![6] > 0);
    assert.ok(mocked.rows[0]![7] > 0);
    assert.ok(mocked.rows[0]![9] > 0);
    assert.ok(mocked.rows[0]![10] > 0);
  });
});
