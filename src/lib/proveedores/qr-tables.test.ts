import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listQrVisitasTablePairs,
  PROVEEDORES_QR_VISITAS_TABLE_BY_SEDE,
  resolveQrVisitasTable,
} from "@/lib/proveedores/qr-tables";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";

describe("proveedores qr-tables", () => {
  it("mapea las 11 sedes QR a qr_* estables", () => {
    assert.equal(PROVEEDORES_QR_SEDES.length, 11);
    assert.equal(Object.keys(PROVEEDORES_QR_VISITAS_TABLE_BY_SEDE).length, 11);
    assert.equal(resolveQrVisitasTable("Bogota"), "qr_bogota");
    assert.equal(resolveQrVisitasTable("Calle 5ta"), "qr_calle_5ta");
    assert.equal(resolveQrVisitasTable("Ciudad Jardin"), "qr_ciudad_jardin");
    assert.equal(resolveQrVisitasTable("La 39"), "qr_la_39");
  });

  it("rechaza sedes desconocidas y no interpolables", () => {
    assert.equal(resolveQrVisitasTable("Dinastia"), null);
    assert.equal(resolveQrVisitasTable("qr_bogota; DROP TABLE"), null);
    assert.equal(resolveQrVisitasTable(""), null);
  });

  it("lista pares sede/tabla sin duplicados de tabla", () => {
    const pairs = listQrVisitasTablePairs();
    assert.equal(pairs.length, 11);
    const tables = pairs.map((p) => p.table);
    assert.equal(new Set(tables).size, 11);
    for (const table of tables) {
      assert.match(table, /^qr_[a-z0-9_]+$/);
    }
  });
});
