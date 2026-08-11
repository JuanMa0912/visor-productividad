import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultOipvWeekRange,
  isoDowToWeekdayKey,
  oipvRowKey,
} from "@/lib/proveedores/oipv-repo";

describe("oipv-repo helpers", () => {
  it("mapea ISODOW a columnas L–D", () => {
    assert.equal(isoDowToWeekdayKey(1), "L");
    assert.equal(isoDowToWeekdayKey(2), "Ma");
    assert.equal(isoDowToWeekdayKey(3), "Mi");
    assert.equal(isoDowToWeekdayKey(7), "D");
    assert.equal(isoDowToWeekdayKey(0), null);
  });

  it("arma clave estable por código o nombre", () => {
    assert.equal(oipvRowKey({ codigo: "abc123" }), "c:ABC123");
    assert.equal(oipvRowKey({ codigo: "@SP", nombre: "Sin Prov" }), "n:sin prov");
    assert.equal(
      oipvRowKey({ codigo: null, nombre: "  Alpina  SAS " }),
      "n:alpina sas",
    );
  });

  it("defaultOipvWeekRange es lun–dom inclusivo", () => {
    // Miércoles 2026-08-12 15:00 UTC ≈ 10:00 Bogotá
    const { dateStart, dateEnd } = defaultOipvWeekRange(
      new Date("2026-08-12T15:00:00.000Z"),
    );
    assert.equal(dateStart, "2026-08-10");
    assert.equal(dateEnd, "2026-08-16");
  });
});
