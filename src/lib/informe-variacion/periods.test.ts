import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeInformePeriods,
  formatInformePeriodLabel,
  parseYearMonthInput,
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
});

describe("parseYearMonthInput", () => {
  it("parsea input type=month", () => {
    assert.deepEqual(parseYearMonthInput("2026-06"), { year: 2026, month: 6 });
    assert.equal(parseYearMonthInput("invalid"), null);
  });
});
