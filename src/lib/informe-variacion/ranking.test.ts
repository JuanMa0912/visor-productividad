import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import {
  buildInformeEmpresaSummary,
  buildInformeRankingRows,
} from "@/lib/informe-variacion/ranking";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const samplePayload = (): InformeVariacionPayload => ({
  periods: {
    current: { from: "20260701", to: "20260709", label: "Jul 2026 (1 al 9)" },
    mom: { from: "20260601", to: "20260609", label: "Jun 2026 (1 al 9)" },
    yoy: { from: "20250701", to: "20250709", label: "Jul 2025 (1 al 9)" },
  },
  sedes: [
    { key: "c|001", e: "Comercializadora", s: "1 FLORESTA", yoyOk: true },
    { key: "m|002", e: "Mercamio", s: "2 CALLE 5TA", yoyOk: true },
  ],
  rows: [
    [0, 0, 0, 0, 0, 100, 80, 90, 200, 160, 180, 40, 32, 36],
    [1, 0, 0, 0, 1, 50, 40, 45, 120, 100, 110, 20, 16, 18],
    [0, 0, 1, 1, 2, 10, 20, 30, 40, 80, 90, 8, 16, 18],
  ],
  cats: ["Asaderos"],
  lins: ["Pollo", "Cerdo"],
  subs: ["Entero", "Piezas"],
  items: ["Pollo entero", "Pollo entero premium", "Costilla"],
  ums: ["UND", "UND", "KG"],
  meta: { rowCount: 3, comparisonAvailable: true, generatedAt: "20260710120000" },
});

describe("buildInformeRankingRows", () => {
  it("rankea productos por valor actual y parte por sede", () => {
    const payload = prepareInformeData(samplePayload());
    const rows = buildInformeRankingRows({
      payload,
      metric: "v",
      pass: () => true,
      dimension: "item",
      sort: "cur",
    });
    assert.equal(rows[0]?.label, "Pollo entero");
    assert.equal(rows[0]?.total[0], 200);
    assert.equal(rows[0]?.perSede[0]?.[0], 200);
    assert.equal(rows[1]?.label, "Pollo entero premium");
  });

  it("agrupa por linea", () => {
    const payload = prepareInformeData(samplePayload());
    const rows = buildInformeRankingRows({
      payload,
      metric: "v",
      pass: () => true,
      dimension: "lin",
    });
    assert.equal(rows[0]?.label, "Pollo");
    assert.equal(rows[0]?.total[0], 320);
    assert.equal(rows[1]?.label, "Cerdo");
    assert.equal(rows[1]?.total[0], 40);
  });

  it("agrupa por proveedor", () => {
    const payload = prepareInformeData({
      ...samplePayload(),
      provs: ["(Sin proveedor)", "Avicola"],
      itemProv: [1, 1, 0],
    });
    const rows = buildInformeRankingRows({
      payload,
      metric: "v",
      pass: () => true,
      dimension: "prov",
    });
    assert.equal(rows[0]?.label, "Avicola");
    assert.equal(rows[0]?.total[0], 320);
    assert.equal(rows[1]?.label, "(Sin proveedor)");
    assert.equal(rows[1]?.total[0], 40);
  });
});

describe("buildInformeEmpresaSummary", () => {
  it("resume actual y participacion por empresa", () => {
    const payload = prepareInformeData(samplePayload());
    const summary = buildInformeEmpresaSummary({
      payload,
      perSede: [
        [240, 240, 270],
        [120, 100, 110],
      ],
    });
    assert.equal(summary[0]?.label, "Comercializadora");
    assert.equal(summary[0]?.total[0], 240);
    assert.equal(summary[1]?.label, "Mercamio");
    assert.ok(Math.abs(summary[0]!.share - 240 / 360) < 0.0001);
  });
});
