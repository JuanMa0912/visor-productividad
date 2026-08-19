import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatChecklistPeriod, getChecklistPeriod } from "./period";

describe("periodo mensual de checklist", () => {
  it("usa calendario America/Bogota", () => {
    const period = getChecklistPeriod(new Date("2026-08-19T12:00:00.000-05:00"));
    assert.deepEqual(period, { year: 2026, month: 8 });
    assert.equal(formatChecklistPeriod(period), "2026-08");
  });
});
