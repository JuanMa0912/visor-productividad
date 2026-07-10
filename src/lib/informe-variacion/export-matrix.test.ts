import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMatrixExportRows,
  heatmapExcelArgb,
  matrixExportFilename,
} from "@/lib/informe-variacion/export-matrix";
import { prepareInformeData } from "@/lib/informe-variacion/aggregate";
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
    [1, 0, 0, 0, 1, 50, 40, 45, 120, 100, 110],
  ],
  cats: ["Asaderos"],
  lins: ["Pollo"],
  subs: ["Entero"],
  items: ["Pollo entero", "Pollo entero premium"],
  meta: { rowCount: 2, comparisonAvailable: true, generatedAt: "20260710120000" },
});

describe("buildMatrixExportRows", () => {
  it("incluye total y categorias con variacion YoY", () => {
    const prepared = prepareInformeData(samplePayload());
    const rows = buildMatrixExportRows({
      payload: prepared,
      metric: "v",
      pass: () => true,
      matrixMode: "yoy",
      matrixDisplay: "pct",
      matrixOpen: new Set(),
      matrixSort: { col: -1, dir: 1 },
    });

    assert.equal(rows[0]?.label, "TOTAL (segun filtros)");
    assert.match(rows[0]?.cells[0]?.text ?? "", /^\+/);
    assert.equal(rows[1]?.label.trim(), "Asaderos");
  });
});

describe("heatmapExcelArgb", () => {
  it("genera color ARGB para celdas positivas", () => {
    const argb = heatmapExcelArgb({
      text: "+10.0%",
      pct: 10,
      nd: false,
      isValueMode: false,
    });
    assert.match(argb, /^FF[0-9A-F]{6}$/);
  });
});

describe("matrixExportFilename", () => {
  it("incluye periodo y vista", () => {
    assert.match(
      matrixExportFilename("Jul 2026", "v", "yoy", "pct", "xlsx"),
      /informe-variacion-matriz.*\.xlsx$/,
    );
  });
});
