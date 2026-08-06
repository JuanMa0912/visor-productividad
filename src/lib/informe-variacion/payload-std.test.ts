import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptInformePayloadStdForRequest,
  canUseInformePayloadStd,
} from "@/lib/informe-variacion/payload-std-server";
import { r } from "@/lib/informe-variacion/test-row";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import type { UserLineCategoryScope } from "@/lib/shared/line-category-scope";

const openScope = (): UserLineCategoryScope => ({
  allowedLineIds: [],
  forcedMargenTipos: null,
  forcedMargenLineas: null,
  excludedMargenTipos: null,
  forcedRotacionCategoriaKeys: null,
  forcedRotacionLineaN1: null,
  locked: false,
});

const samplePayload = (): InformeVariacionPayload => ({
  periods: {
    current: { label: "cur", from: "2026-07-01", to: "2026-07-31" },
    mom: { label: "mom", from: "2026-06-01", to: "2026-06-30" },
    yoy: { label: "yoy", from: "2025-07-01", to: "2025-07-31" },
  },
  sedes: [
    {
      key: "mercamio|floresta",
      e: "Comercializadora",
      s: "Floresta",
      yoyOk: true,
    },
    {
      key: "mercamio|palmira",
      e: "Comercializadora",
      s: "Palmira",
      yoyOk: true,
    },
    {
      key: "dinastia|d1",
      e: "Dinastia",
      s: "Dinastia 1",
      yoyOk: true,
    },
  ],
  cats: ["3 Asadero"],
  lins: ["301 Pollos"],
  subs: ["30101 Entero"],
  items: ["ITEM A"],
  ums: ["UND"],
  rows: [
    r(0, 0, 0, 0, 0, 10, 9, 8, 100, 90, 80),
    r(1, 0, 0, 0, 0, 5, 4, 3, 50, 40, 30),
    r(2, 0, 0, 0, 0, 1, 1, 1, 10, 10, 10),
  ],
  meta: {
    rowCount: 3,
    generatedAt: "2026-08-06T00:00:00.000Z",
  },
});

describe("canUseInformePayloadStd", () => {
  it("solo scope completo sin tipos forzados (sin adaptar)", () => {
    assert.equal(canUseInformePayloadStd(null, null), true);
    assert.equal(canUseInformePayloadStd(null, []), true);
    assert.equal(canUseInformePayloadStd(["FLORESTA"], null), false);
    assert.equal(canUseInformePayloadStd(null, ["3"]), false);
  });
});

describe("adaptInformePayloadStdForRequest", () => {
  it("quita Dinastia y recorta sedes permitidas", () => {
    const next = adaptInformePayloadStdForRequest(
      samplePayload(),
      ["mercamio|floresta"],
      openScope(),
    );
    assert.equal(next.sedes.length, 1);
    assert.equal(next.sedes[0]?.key, "mercamio|floresta");
    assert.equal(next.rows.length, 1);
    assert.equal(next.rows[0]?.[0], 0);
    assert.equal(next.meta.rowCount, 1);
  });

  it("sin restriccion de sede solo elimina Dinastia", () => {
    const next = adaptInformePayloadStdForRequest(
      samplePayload(),
      null,
      openScope(),
    );
    assert.equal(next.sedes.length, 2);
    assert.ok(next.sedes.every((s) => !s.key.startsWith("dinastia|")));
    assert.equal(next.rows.length, 2);
  });
});
