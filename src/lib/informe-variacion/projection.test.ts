import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyInformeDayRangeProjection } from "@/lib/informe-variacion/projection";
import { r } from "@/lib/informe-variacion/test-row";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

describe("applyInformeDayRangeProjection", () => {
  it("escala u/v/m del periodo actual y reescribe el label a la meta", () => {
    const payload: InformeVariacionPayload = {
      periods: {
        current: {
          from: "20260801",
          to: "20260805",
          label: "Agosto 01–05, 2026",
        },
        mom: {
          from: "20260701",
          to: "20260707",
          label: "Julio 01–07, 2026",
        },
        yoy: {
          from: "20250801",
          to: "20250807",
          label: "Agosto 01–07, 2025",
        },
      },
      sedes: [
        {
          key: "mercamio|floresta",
          e: "Mercamio",
          s: "Floresta",
          yoyOk: true,
        },
      ],
      cats: ["A"],
      lins: ["L"],
      subs: ["S"],
      items: ["I"],
      ums: ["UND"],
      rows: [r(0, 0, 0, 0, 0, 10, 20, 30, 100, 200, 300, 5, 6, 7)],
      meta: { rowCount: 1, generatedAt: "2026-08-06T00:00:00.000Z" },
    };

    const next = applyInformeDayRangeProjection(payload, 2026, 8, {
      id: "proj-1-7",
      label: "1 al 7 (proyección)",
      fromDay: 1,
      toDay: 7,
      projection: {
        actualToDay: 5,
        targetToDay: 7,
        factor: 7 / 5,
        baseId: "1-7",
      },
    });

    assert.equal(next.rows[0]?.[5], 14);
    assert.equal(next.rows[0]?.[8], 140);
    assert.equal(next.rows[0]?.[11], 7);
    assert.equal(next.rows[0]?.[6], 20);
    assert.equal(next.periods.current.to, "20260807");
    assert.match(next.periods.current.label, /proyección/i);
  });
});
