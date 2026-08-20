import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addInformePayloadMetrics,
  sumInformePayloadCurrentValue,
} from "@/lib/informe-variacion/payload-merge";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const basePayload = (): InformeVariacionPayload => ({
  periods: {
    current: { from: "20260801", to: "20260814", label: "1-14" },
    mom: { from: "20260701", to: "20260714", label: "jul 1-14" },
    yoy: { from: "20260701", to: "20260714", label: "jul 1-14" },
  },
  sedes: [
    { key: "mtodo|001", e: "Comercializadora", s: "Floresta", yoyOk: true },
  ],
  cats: ["Asaderos"],
  lins: ["Pollo"],
  subs: ["Entero"],
  items: ["Pollo entero"],
  itemIds: ["100"],
  ums: ["UND"],
  rows: [[0, 0, 0, 0, 0, 10, 8, 8, 43000, 42000, 42000, 1000, 900, 900]],
  meta: { rowCount: 1, generatedAt: "t" },
});

const leftoverPayload = (): InformeVariacionPayload => ({
  periods: {
    current: { from: "20260815", to: "20260819", label: "15-19" },
    mom: { from: "20260715", to: "20260719", label: "jul 15-19" },
    yoy: { from: "20260715", to: "20260719", label: "jul 15-19" },
  },
  sedes: [
    { key: "mtodo|001", e: "Comercializadora", s: "Floresta", yoyOk: true },
  ],
  cats: ["Asaderos"],
  lins: ["Pollo"],
  subs: ["Entero"],
  items: ["Pollo entero"],
  itemIds: ["100"],
  ums: ["UND"],
  rows: [[0, 0, 0, 0, 0, 2, 3, 3, 8800, 15000, 15000, 200, 400, 400]],
  meta: { rowCount: 1, generatedAt: "t" },
});

describe("addInformePayloadMetrics", () => {
  it("suma el corte cerrado con los días posteriores", () => {
    const merged = addInformePayloadMetrics(basePayload(), leftoverPayload());
    assert.equal(sumInformePayloadCurrentValue(merged), 51800);
    assert.equal(merged.rows[0]?.[8], 51800);
    assert.equal(merged.rows[0]?.[9], 57000);
    assert.equal(merged.rows[0]?.[5], 12);
  });
});
