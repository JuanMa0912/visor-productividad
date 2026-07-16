import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
  parseInformeDayRangeId,
  payloadMatchesInformeSelection,
} from "@/lib/informe-variacion/day-ranges";
import { computeInformePeriods } from "@/lib/informe-variacion/periods";

describe("getAvailableInformeDayRanges", () => {
  it("en dia 15 solo muestra cortes Excel ya cerrados (sin 1 al 15 inventado)", () => {
    const asOf = new Date(2026, 6, 15);
    const available = getAvailableInformeDayRanges(2026, 7, asOf);
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14"],
    );
  });

  it("en mes cerrado muestra todos los rangos del Excel", () => {
    const asOf = new Date(2026, 6, 1);
    const available = getAvailableInformeDayRanges(2026, 6, asOf);
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14", "1-21", "15-21", "1-28", "22-28", "1-eom"],
    );
  });

  it("respeta maxDate de BD en mes en curso", () => {
    const asOf = new Date(2026, 6, 20);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "20260714");
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14"],
    );
  });

  it("con datos hasta el dia 9 solo deja 1 al 7", () => {
    const asOf = new Date(2026, 6, 10);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "20260709");
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7"],
    );
    assert.equal(defaultInformeDayRangeId(available), "1-7");
  });

  it("normaliza maxDate ISO desde PostgreSQL", () => {
    const asOf = new Date(2026, 6, 10);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "2026-07-09");
    assert.equal(defaultInformeDayRangeId(available), "1-7");
  });

  it("rechaza ids inventados tipo 1-15", () => {
    assert.equal(parseInformeDayRangeId("1-15"), null);
    assert.equal(parseInformeDayRangeId("1-9"), null);
    assert.ok(parseInformeDayRangeId("1-14"));
  });
});

describe("defaultInformeDayRangeId", () => {
  it("elige el acumulado Excel mas amplio disponible", () => {
    const asOf = new Date(2026, 6, 15);
    const available = getAvailableInformeDayRanges(2026, 7, asOf);
    assert.equal(defaultInformeDayRangeId(available), "1-14");
  });
});

describe("computeInformePeriods con rango parcial", () => {
  it("acota MoM y YoY al mismo rango de dias", () => {
    const periods = computeInformePeriods(2026, 6, {
      id: "1-14",
      label: "1 al 14",
      fromDay: 1,
      toDay: 14,
    });
    assert.equal(periods.current.from, "20260601");
    assert.equal(periods.current.to, "20260614");
    assert.equal(periods.mom.from, "20260501");
    assert.equal(periods.mom.to, "20260514");
    assert.equal(periods.yoy.from, "20250601");
    assert.equal(periods.yoy.to, "20250614");
  });
});

describe("payloadMatchesInformeSelection", () => {
  it("detecta mes y rango distintos al payload mostrado", () => {
    const periods = computeInformePeriods(2026, 6, {
      id: "1-14",
      label: "1 al 14",
      fromDay: 1,
      toDay: 14,
    });
    const payload = { periods };
    const ranges = getAvailableInformeDayRanges(2026, 6, new Date(2026, 6, 20));

    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 6, "1-14", ranges),
      true,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 5, "1-14", ranges),
      false,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 6, "15-21", ranges),
      false,
    );
  });
});
