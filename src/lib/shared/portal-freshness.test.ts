import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPortalFreshnessTooltip,
  formatPortalUpdatedAt,
  pickLatestIso,
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

describe("pickLatestIso", () => {
  it("elige el ISO más reciente y omite nulos", () => {
    assert.equal(
      pickLatestIso([
        "2026-08-20T14:16:00.000Z",
        null,
        "2026-08-20T19:40:00.000Z",
      ]),
      "2026-08-20T19:40:00.000Z",
    );
    assert.equal(pickLatestIso([null, null]), null);
  });
});

describe("formatPortalFreshnessTooltip", () => {
  it("lista cada fuente con hora de Bogotá", () => {
    const tip = formatPortalFreshnessTooltip([
      {
        id: "rotacion",
        label: "Rotación",
        at: "2026-08-20T14:16:00.000Z",
      },
      { id: "horas", label: "Horas (asistencia)", at: null },
    ]);
    assert.match(tip, /Rotación:/);
    assert.match(tip, /Horas \(asistencia\): sin dato/);
  });
});

describe("PORTAL_FRESHNESS_META_TABLES", () => {
  it("solo usa identificadores SQL seguros", () => {
    for (const table of PORTAL_FRESHNESS_META_TABLES) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
    }
  });
});
