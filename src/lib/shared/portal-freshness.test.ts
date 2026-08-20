import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPortalUpdatedAt,
  PORTAL_FRESHNESS_META_TABLES,
} from "./portal-freshness";

describe("formatPortalUpdatedAt", () => {
  it("formatea ISO en hora de Bogotá", () => {
    const label = formatPortalUpdatedAt("2026-08-20T18:43:00.000Z");
    assert.match(label, /20\/08\/2026/);
    assert.match(label, /1:43|13:43/);
  });

  it("ignora fechas inválidas", () => {
    assert.equal(formatPortalUpdatedAt("no-es-fecha"), "");
  });
});

describe("PORTAL_FRESHNESS_META_TABLES", () => {
  it("solo usa identificadores SQL seguros", () => {
    for (const table of PORTAL_FRESHNESS_META_TABLES) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
    }
  });
});
