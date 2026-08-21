import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignPreviousMonthRange,
  alignPreviousYearRange,
  alignRankingPreviousRange,
  compactToIso,
  daysInclusiveInRange,
  defaultInformeYtdRanges,
  formatInformeRangeLabel,
  isoToCompact,
  shiftCompactDateMonths,
  shiftCompactDateYears,
  splitInformeRangeForQuery,
  validateInformeSelectedRanges,
} from "@/lib/informe-variacion/date-range";

describe("splitInformeRangeForQuery", () => {
  it("YTD 1 ene–18 ago usa meses completos + recorte de agosto", () => {
    const plan = splitInformeRangeForQuery("20260101", "20260818");
    assert.deepEqual(plan.months, [
      "202601",
      "202602",
      "202603",
      "202604",
      "202605",
      "202606",
      "202607",
    ]);
    assert.deepEqual(plan.leftovers, [{ from: "20260801", to: "20260818" }]);
  });

  it("mes completo cae solo en months", () => {
    const plan = splitInformeRangeForQuery("20260101", "20260131");
    assert.deepEqual(plan.months, ["202601"]);
    assert.deepEqual(plan.leftovers, []);
  });

  it("recorte intra-mes no usa months", () => {
    const plan = splitInformeRangeForQuery("20260805", "20260818");
    assert.deepEqual(plan.months, []);
    assert.deepEqual(plan.leftovers, [{ from: "20260805", to: "20260818" }]);
  });

  it("cruza anos con cabeza y cola incompletas", () => {
    const plan = splitInformeRangeForQuery("20251115", "20260210");
    assert.deepEqual(plan.months, ["202512", "202601"]);
    assert.deepEqual(plan.leftovers, [
      { from: "20251115", to: "20251130" },
      { from: "20260201", to: "20260210" },
    ]);
  });
});

describe("defaultInformeYtdRanges", () => {
  it("alinea 1 ene–maxDate vs el mismo tramo del ano anterior", () => {
    const ranges = defaultInformeYtdRanges("20260818");
    assert.deepEqual(ranges, {
      currentFrom: "20260101",
      currentTo: "20260818",
      previousFrom: "20250101",
      previousTo: "20250818",
    });
  });
});

describe("shiftCompactDateYears", () => {
  it("29 feb bisiesto cae al 28 del ano no bisiesto", () => {
    assert.equal(shiftCompactDateYears("20240229", -1), "20230228");
  });
});

describe("validateInformeSelectedRanges", () => {
  it("acepta el ejemplo YTD vs ano anterior", () => {
    const result = validateInformeSelectedRanges({
      currentFrom: "20260101",
      currentTo: "20260818",
      previousFrom: "20250101",
      previousTo: "20250818",
    });
    assert.equal(result.ok, true);
  });

  it("rechaza from > to", () => {
    const result = validateInformeSelectedRanges({
      currentFrom: "20260818",
      currentTo: "20260101",
      previousFrom: "20250101",
      previousTo: "20250818",
    });
    assert.equal(result.ok, false);
  });
});

describe("helpers de fecha", () => {
  it("convierte compacto e ISO", () => {
    assert.equal(compactToIso("20260818"), "2026-08-18");
    assert.equal(isoToCompact("2026-08-18"), "20260818");
    assert.equal(daysInclusiveInRange("20260101", "20260101"), 1);
  });

  it("alinea el tramo al ano anterior", () => {
    assert.deepEqual(alignPreviousYearRange("20260101", "20260818"), {
      previousFrom: "20250101",
      previousTo: "20250818",
    });
  });

  it("alinea el tramo al mes anterior y recorta dias que no existen", () => {
    assert.equal(shiftCompactDateMonths("20260331", -1), "20260228");
    assert.equal(shiftCompactDateMonths("20260115", -1), "20251215");
    assert.deepEqual(alignPreviousMonthRange("20260801", "20260819"), {
      previousFrom: "20260701",
      previousTo: "20260719",
    });
    assert.deepEqual(alignPreviousMonthRange("20260301", "20260331"), {
      previousFrom: "20260201",
      previousTo: "20260228",
    });
    assert.deepEqual(
      alignRankingPreviousRange("20260801", "20260819", "yoy"),
      { previousFrom: "20250801", previousTo: "20250819" },
    );
    assert.deepEqual(
      alignRankingPreviousRange("20260801", "20260819", "mom"),
      { previousFrom: "20260701", previousTo: "20260719" },
    );
  });

  it("etiqueta rangos multi-mes", () => {
    assert.equal(
      formatInformeRangeLabel("20260101", "20260818"),
      "01 ene 2026 – 18 ago 2026",
    );
  });
});
