import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHECKLIST_DURATION_MS,
  CHECKLIST_DURATION_MINUTES,
  formatCountdown,
  hasDeadlinePassed,
  isChecklistSessionId,
  remainingMs,
} from "./session";

describe("checklist session window", () => {
  it("dura 20 minutos exactos", () => {
    assert.equal(CHECKLIST_DURATION_MINUTES, 20);
    assert.equal(CHECKLIST_DURATION_MS, 20 * 60 * 1000);
  });

  it("cuenta regresiva y vencimiento", () => {
    const start = new Date("2026-08-19T12:00:00.000Z");
    const deadline = new Date(start.getTime() + CHECKLIST_DURATION_MS);
    assert.equal(remainingMs(deadline, start), CHECKLIST_DURATION_MS);
    assert.equal(formatCountdown(CHECKLIST_DURATION_MS), "20:00");
    assert.equal(formatCountdown(65_000), "01:05");
    assert.equal(hasDeadlinePassed(deadline, start), false);
    assert.equal(
      hasDeadlinePassed(deadline, new Date(deadline.getTime())),
      true,
    );
  });

  it("acepta ids de checklist con sesion", () => {
    assert.equal(isChecklistSessionId("bodega-gerencial"), true);
    assert.equal(isChecklistSessionId("punto-venta"), true);
    assert.equal(isChecklistSessionId("otro"), false);
  });
});
