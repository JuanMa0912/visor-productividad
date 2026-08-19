import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeInformePeriods,
  computeInformeDailyFetchBounds,
  formatInformePeriodLabel,
  parseInformeCompareMonthParam,
  parseYearMonthInput,
  previousCalendarMonth,
} from "@/lib/informe-variacion/periods";

describe("computeInformePeriods", () => {
  it("calcula mes actual, MoM y YoY para junio 2026", () => {
    const periods = computeInformePeriods(2026, 6);
    assert.deepEqual(periods.current, {
      from: "20260601",
      to: "20260630",
      label: formatInformePeriodLabel("20260601", "20260630"),
    });
    assert.equal(periods.mom.from, "20260501");
    assert.equal(periods.mom.to, "20260531");
    assert.equal(periods.yoy.from, "20250601");
    assert.equal(periods.yoy.to, "20250630");
  });

  it("cruza ano en enero (MoM = diciembre anterior)", () => {
    const periods = computeInformePeriods(2026, 1);
    assert.equal(periods.current.from, "20260101");
    assert.equal(periods.mom.from, "20251201");
    assert.equal(periods.mom.to, "20251231");
    assert.equal(periods.yoy.from, "20250101");
  });

  it("acepta un periodo anterior arbitrario y conserva YoY del mes actual", () => {
    const periods = computeInformePeriods(2026, 8, null, {
      year: 2025,
      month: 3,
    });
    assert.equal(periods.current.from, "20260801");
    assert.equal(periods.current.to, "20260831");
    assert.equal(periods.mom.from, "20250301");
    assert.equal(periods.mom.to, "20250331");
    assert.equal(periods.yoy.from, "20250801");
    assert.equal(periods.yoy.to, "20250831");
  });

  it("acota el rango de dias al mes comparado, no al calendario MoM", () => {
    const periods = computeInformePeriods(
      2026,
      8,
      { id: "1-14", label: "1 al 14", fromDay: 1, toDay: 14 },
      { year: 2025, month: 3 },
    );
    assert.equal(periods.current.from, "20260801");
    assert.equal(periods.current.to, "20260814");
    assert.equal(periods.mom.from, "20250301");
    assert.equal(periods.mom.to, "20250314");
    assert.equal(periods.yoy.from, "20250801");
    assert.equal(periods.yoy.to, "20250814");
  });
});

describe("parseInformeCompareMonthParam", () => {
  it("sin params usa el mes calendario anterior", () => {
    assert.deepEqual(
      parseInformeCompareMonthParam(2026, 8, null, null),
      previousCalendarMonth(2026, 8),
    );
    assert.deepEqual(previousCalendarMonth(2026, 8), { year: 2026, month: 7 });
  });

  it("rechaza el mismo mes o uno posterior", () => {
    assert.equal(
      "error" in parseInformeCompareMonthParam(2026, 8, "2026", "8"),
      true,
    );
    assert.equal(
      "error" in parseInformeCompareMonthParam(2026, 8, "2026", "9"),
      true,
    );
  });
});

describe("computeInformeDailyFetchBounds", () => {
  it("acota a dias 1-7 cuando solo hay un rango parcial", () => {
    const bounds = computeInformeDailyFetchBounds(2026, 7, [
      { id: "1-7", label: "1 al 7", fromDay: 1, toDay: 7 },
    ]);
    assert.equal(bounds.cur.from, "20260701");
    assert.equal(bounds.cur.to, "20260707");
    assert.equal(bounds.mom.from, "20260601");
    assert.equal(bounds.mom.to, "20260607");
    assert.equal(bounds.yoy.from, "20250701");
    assert.equal(bounds.yoy.to, "20250707");
  });

  it("usa el mes comparado cuando no es el MoM por defecto", () => {
    const bounds = computeInformeDailyFetchBounds(
      2026,
      8,
      [{ id: "1-14", label: "1 al 14", fromDay: 1, toDay: 14 }],
      { year: 2025, month: 3 },
    );
    assert.equal(bounds.cur.from, "20260801");
    assert.equal(bounds.cur.to, "20260814");
    assert.equal(bounds.mom.from, "20250301");
    assert.equal(bounds.mom.to, "20250314");
    assert.equal(bounds.yoy.from, "20250801");
    assert.equal(bounds.yoy.to, "20250814");
  });

  it("usa mes completo cuando hay rango 1 al fin", () => {
    const bounds = computeInformeDailyFetchBounds(2026, 6, [
      { id: "1-7", label: "1 al 7", fromDay: 1, toDay: 7 },
      { id: "1-eom", label: "1 al fin", fromDay: 1, toDay: null },
    ]);
    assert.equal(bounds.cur.from, "20260601");
    assert.equal(bounds.cur.to, "20260630");
  });
});

describe("parseYearMonthInput", () => {
  it("parsea input type=month", () => {
    assert.deepEqual(parseYearMonthInput("2026-06"), { year: 2026, month: 6 });
    assert.equal(parseYearMonthInput("invalid"), null);
  });
});
