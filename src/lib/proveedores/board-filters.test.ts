import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactToIsoDate,
  parseProveedorLineaFilter,
  proveedorLineaFamiliaSql,
  proveedoresVisitasEntradaRangeSql,
} from "@/lib/proveedores/board-filters";

describe("proveedores board-filters", () => {
  it("parsea linea y deja todas si el valor no vale", () => {
    assert.equal(parseProveedorLineaFilter("fruver"), "fruver");
    assert.equal(parseProveedorLineaFilter("INDUSTRIA"), "industria");
    assert.equal(parseProveedorLineaFilter("pollo"), "todas");
    assert.equal(parseProveedorLineaFilter(""), "todas");
  });

  it("SQL de familia es TRUE en todas y compara N1 en el resto", () => {
    assert.equal(proveedorLineaFamiliaSql("r.id_linea1", "todas"), "TRUE");
    assert.match(
      proveedorLineaFamiliaSql("r.id_linea1", "fruver"),
      / = 'fruver'/,
    );
  });

  it("compacto a ISO", () => {
    assert.equal(compactToIsoDate("20260817"), "2026-08-17");
  });

  it("acota entrada_at al día calendario de Bogotá, no a UTC del servidor", () => {
    const sql = proveedoresVisitasEntradaRangeSql(1, 2);
    assert.match(sql, /America\/Bogota/);
    assert.match(sql, /\$1::date/);
    assert.match(sql, /\$2::date \+ 1/);
    assert.doesNotMatch(sql, /T00:00:00/);
  });
});
