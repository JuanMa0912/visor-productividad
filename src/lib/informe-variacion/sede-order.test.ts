import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import {
  INFORME_SEDE_MATRIX_ORDER,
  reorderInformeVariacionSedes,
  sortInformeSedeCatalog,
  stripDinastiaFromInformePayload,
} from "@/lib/informe-variacion/sede-order";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

describe("sortInformeSedeCatalog", () => {
  it("ordena tiendas en el orden fijo de la matriz", () => {
    const shuffled = [...listMargenSedeCatalogOptions()].reverse();
    const sorted = sortInformeSedeCatalog(shuffled);
    const keys = sorted.map((entry) => entry.value);
    const expectedPrefix = [...INFORME_SEDE_MATRIX_ORDER];
    assert.deepEqual(keys.slice(0, expectedPrefix.length), expectedPrefix);
  });

  it("reordena sedes en payload cacheado y remapea filas", () => {
    const payload: InformeVariacionPayload = {
      periods: {
        current: { from: "20260601", to: "20260607", label: "Jun" },
        mom: { from: "20260501", to: "20260507", label: "May" },
        yoy: { from: "20250601", to: "20250607", label: "Jun YoY" },
      },
      sedes: [
        { e: "Merkmios", s: "01 Bogotá", yoyOk: true, key: "bogota|001" },
        { e: "Mercamio", s: "01 Calle 5ta", yoyOk: true, key: "mercamio|001" },
        { e: "Comercializadora", s: "01 Floresta", yoyOk: true, key: "mtodo|001" },
      ],
      cats: ["3 Asaderos"],
      lins: ["01 POLLO ASADO"],
      subs: ["00 Sub"],
      items: ["item"],
      ums: [""],
      rows: [[0, 0, 0, 0, 0, 1, 1, 1, 10, 10, 10, 0, 0, 0]],
      meta: { rowCount: 1, generatedAt: "2026-01-01T00:00:00.000Z" },
    };

    const reordered = reorderInformeVariacionSedes(payload);
    assert.deepEqual(
      reordered.sedes.map((sede) => sede.key),
      ["mtodo|001", "mercamio|001", "bogota|001"],
    );
    assert.equal(reordered.rows[0]![0], 2);
  });

  it("quita sedes Dinastia y remapea filas del informe historico", () => {
    const payload: InformeVariacionPayload = {
      periods: {
        current: { from: "20260701", to: "20260707", label: "Jul" },
        mom: { from: "20260601", to: "20260607", label: "Jun" },
        yoy: { from: "20250701", to: "20250707", label: "Jul YoY" },
      },
      sedes: [
        { e: "Mercamio", s: "01 Calle 5ta", yoyOk: true, key: "mercamio|001" },
        { e: "Dinastía", s: "01 Santa Elena", yoyOk: false, key: "dinastia|001" },
        { e: "Comercializadora", s: "01 Floresta", yoyOk: true, key: "mtodo|001" },
      ],
      cats: ["1"],
      lins: ["L"],
      subs: ["S"],
      items: ["i"],
      ums: [""],
      rows: [
        [0, 0, 0, 0, 0, 1, 0, 0, 100, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 1, 0, 0, 50, 0, 0, 0, 0, 0],
        [2, 0, 0, 0, 0, 1, 0, 0, 200, 0, 0, 0, 0, 0],
      ],
      meta: { rowCount: 3, generatedAt: "2026-01-01T00:00:00.000Z" },
    };

    const stripped = stripDinastiaFromInformePayload(payload);
    assert.deepEqual(
      stripped.sedes.map((sede) => sede.key),
      ["mercamio|001", "mtodo|001"],
    );
    assert.equal(stripped.rows.length, 2);
    assert.equal(stripped.rows[0]![0], 0);
    assert.equal(stripped.rows[0]![8], 100);
    assert.equal(stripped.rows[1]![0], 1);
    assert.equal(stripped.rows[1]![8], 200);
    assert.equal(stripped.meta.rowCount, 2);
  });
});
