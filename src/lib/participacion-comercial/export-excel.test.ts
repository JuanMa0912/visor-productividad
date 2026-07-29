import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareHeatArgb } from "@/lib/participacion-comercial/export-excel";
import { analisisInventarioExcelFilename } from "@/lib/analisis-inventario/export-excel";
import { participacionExcelFilename } from "@/lib/participacion-comercial/export-excel";

describe("export excel helpers", () => {
  it("nombres de archivo incluyen periodo", () => {
    assert.match(
      analisisInventarioExcelFilename("2026-06-29", "2026-07-28"),
      /^dias-inventario_2026-06-29_2026-07-28_.*\.xlsx$/,
    );
    assert.match(
      participacionExcelFilename("2026-06-29", "2026-07-28", "sede"),
      /^participacion-comercial_sede_2026-06-29_2026-07-28_.*\.xlsx$/,
    );
  });

  it("colores de participación van de rojo a verde", () => {
    const low = shareHeatArgb(1);
    const high = shareHeatArgb(30);
    assert.notEqual(low.fill, high.fill);
    assert.equal(low.fill.startsWith("FF"), true);
    assert.equal(high.fill.startsWith("FF"), true);
  });
});
