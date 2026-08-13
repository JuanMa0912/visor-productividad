import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultOipvWeekRange,
  filterOipvRows,
  isoDowToWeekdayKey,
  oipvRowKey,
  type ProveedorOipvRow,
} from "@/lib/proveedores/oipv-repo";

const sampleRow = (
  overrides: Partial<ProveedorOipvRow> & { key: string },
): ProveedorOipvRow => ({
  codigo: "0001",
  empresa: "mercamio",
  rsProveedor: "Demo",
  visitante: null,
  asistencia: false,
  weekdays: {
    L: false,
    Ma: false,
    Mi: false,
    J: false,
    V: false,
    S: false,
    D: false,
  },
  visitas: 0,
  unidades: 0,
  ventaNeta: 0,
  costoMercancia: 0,
  ...overrides,
});

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

  it("filtra visita vs venta", () => {
    const rows = [
      sampleRow({
        key: "visita-venta",
        asistencia: true,
        unidades: 2,
        ventaNeta: 100,
      }),
      sampleRow({ key: "visita-sin-venta", asistencia: true }),
      sampleRow({ key: "venta-sin-visita", unidades: 1, ventaNeta: 50 }),
      sampleRow({ key: "nada" }),
    ];
    assert.deepEqual(
      filterOipvRows(rows, "con_visita").map((r) => r.key),
      ["visita-venta", "visita-sin-venta"],
    );
    assert.deepEqual(
      filterOipvRows(rows, "visita_sin_venta").map((r) => r.key),
      ["visita-sin-venta"],
    );
    assert.deepEqual(
      filterOipvRows(rows, "venta_sin_visita").map((r) => r.key),
      ["venta-sin-visita"],
    );
    assert.equal(filterOipvRows(rows, "all").length, 4);
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
