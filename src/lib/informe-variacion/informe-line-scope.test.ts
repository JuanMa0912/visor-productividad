import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterInformePayloadForLineScope } from "@/lib/informe-variacion/informe-line-scope";
import { resolveUserLineCategoryScope } from "@/lib/shared/line-category-scope";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const basePayload = (): InformeVariacionPayload => ({
  periods: {
    current: { from: "20260701", to: "20260714", label: "Jul-26" },
    mom: { from: "20260601", to: "20260614", label: "Jun-26" },
    yoy: { from: "20250701", to: "20250714", label: "Jul-25" },
  },
  sedes: [{ e: "Comercializadora", s: "01 Floresta", yoyOk: true, key: "mercamio|001" }],
  cats: ["3 Asaderos", "4 Mercado"],
  lins: ["01 POLLO ASADO", "01 FRUVER", "08 ACEITES"],
  subs: ["01 POLLO", "01 FRUVER", "01 ACEITES"],
  items: ["A", "B", "C"],
  ums: ["UND", "KG", "L"],
  rows: [
    // sede, cat, lin, sub, item, u*, v*, m*
    [0, 0, 0, 0, 0, 1, 0, 0, 100, 0, 0, 10, 0, 0],
    [0, 1, 1, 1, 1, 2, 0, 0, 200, 0, 0, 20, 0, 0],
    [0, 1, 2, 2, 2, 3, 0, 0, 300, 0, 0, 30, 0, 0],
  ],
  meta: { rowCount: 3, generatedAt: "2026-07-16T00:00:00.000Z", comparisonAvailable: true },
});

describe("filterInformePayloadForLineScope", () => {
  it("fruver deja solo linea 01 FRUVER y excluye Asaderos", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    const next = filterInformePayloadForLineScope(basePayload(), scope);
    assert.deepEqual(next.cats, ["4 Mercado"]);
    assert.deepEqual(next.lins, ["01 FRUVER"]);
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0]![8], 200);
    assert.equal(next.meta.rowCount, 1);
  });

  it("asadero deja solo categoria 3", () => {
    const scope = resolveUserLineCategoryScope(["asadero"]);
    const next = filterInformePayloadForLineScope(basePayload(), scope);
    assert.deepEqual(next.cats, ["3 Asaderos"]);
    assert.deepEqual(next.lins, ["01 POLLO ASADO"]);
    assert.equal(next.rows.length, 1);
  });

  it("sin alcance no modifica", () => {
    const scope = resolveUserLineCategoryScope(null);
    const payload = basePayload();
    const next = filterInformePayloadForLineScope(payload, scope);
    assert.equal(next, payload);
  });
});
