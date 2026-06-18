import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getRollingMonthBackRange } from "./rolling-month-range";

describe("getRollingMonthBackRange", () => {
  it("cubre 31 dias cuando hoy es junio y maxAvailable es ayer", () => {
    const ref = new Date("2026-06-02T12:00:00");
    const range = getRollingMonthBackRange("2025-01-01", "2026-06-01", ref);
    assert.equal(range.start, "2026-05-02");
    assert.equal(range.end, "2026-06-01");
  });

  it("cubre todo mayo cuando maxAvailable es ultimo dia de mayo", () => {
    const ref = new Date("2026-06-01T12:00:00");
    const range = getRollingMonthBackRange("2025-01-01", "2026-05-31", ref);
    assert.equal(range.start, "2026-05-01");
    assert.equal(range.end, "2026-05-31");
  });

  it("respeta minAvailable cuando el rango se sale por abajo", () => {
    const ref = new Date("2026-06-02T12:00:00");
    const range = getRollingMonthBackRange("2026-05-15", "2026-06-01", ref);
    assert.equal(range.start, "2026-05-15");
    assert.equal(range.end, "2026-06-01");
  });
});
