import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactToIsoDate,
  parseProveedorLineaFilter,
  proveedorLineaFamiliaSql,
  buildProveedoresVisitasFilter,
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
    assert.match(sql, /\(entrada_at AT TIME ZONE/);
    assert.match(sql, /::date >= \$1::date/);
    assert.match(sql, /::date <= \$2::date/);
    assert.doesNotMatch(sql, /T00:00:00/);
  });

  it("con sede exige sede_name además del día de entrada", () => {
    const filter = buildProveedoresVisitasFilter({
      dateStart: "2026-08-20",
      dateEnd: "2026-08-20",
      sedeName: "Floresta",
    });
    assert.deepEqual(filter.params, ["2026-08-20", "2026-08-20", "Floresta"]);
    assert.match(filter.whereSql, /sede_name = \$3/);
    assert.match(filter.whereSql, /America\/Bogota/);
  });

  it("sin sede no filtra sede_name: el FROM ya elige tabla o UNION", () => {
    const filter = buildProveedoresVisitasFilter({
      dateStart: "2026-08-20",
      dateEnd: "2026-08-20",
    });
    assert.deepEqual(filter.params, ["2026-08-20", "2026-08-20"]);
    assert.doesNotMatch(filter.whereSql, /sede_name/);
  });
});
