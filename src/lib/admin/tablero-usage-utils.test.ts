import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTableroUsageCsv } from "./tablero-usage-utils";

describe("buildTableroUsageCsv", () => {
  it("incluye BOM y columnas esperadas", () => {
    const csv = buildTableroUsageCsv([
      {
        path: "/rotacion",
        uniqueUsers: 3,
        observations: 12,
        activeMinutes: 45,
        sharePercent: 62.5,
      },
    ]);
    assert.ok(csv.startsWith("\uFEFF"));
    assert.match(csv, /tablero,ruta,usuarios_unicos/);
    assert.match(csv, /Rotacion/);
    assert.match(csv, /\/rotacion/);
    assert.match(csv, /62\.5/);
  });
});
