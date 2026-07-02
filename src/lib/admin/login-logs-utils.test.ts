import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLoginLogsCsv,
  getLoginLogDateRangeForShortcut,
} from "./login-logs-utils";

describe("getLoginLogDateRangeForShortcut", () => {
  it("calcula hoy y ayer en rango cerrado", () => {
    const ref = new Date("2026-06-16T15:00:00.000Z");
    assert.deepEqual(getLoginLogDateRangeForShortcut("today", ref), {
      from: "2026-06-16",
      to: "2026-06-16",
    });
    assert.deepEqual(getLoginLogDateRangeForShortcut("yesterday", ref), {
      from: "2026-06-15",
      to: "2026-06-15",
    });
  });

  it("cubre 7 y 30 días inclusive hasta hoy", () => {
    const ref = new Date("2026-06-16T15:00:00.000Z");
    assert.deepEqual(getLoginLogDateRangeForShortcut("last7", ref), {
      from: "2026-06-10",
      to: "2026-06-16",
    });
    assert.deepEqual(getLoginLogDateRangeForShortcut("last30", ref), {
      from: "2026-05-18",
      to: "2026-06-16",
    });
  });
});

describe("buildLoginLogsCsv", () => {
  it("escapa comillas y agrega BOM", () => {
    const csv = buildLoginLogsCsv([
      {
        id: 1,
        logged_at: "2026-06-16T12:00:00.000Z",
        ip: "10.0.0.1",
        user_agent: 'Mozilla "Test"',
        user_id: "u1",
        username: "pipe",
      },
    ]);
    assert.ok(csv.startsWith("\uFEFF"));
    assert.match(csv, /"Mozilla ""Test"""/);
  });
});
