import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lineFamilySqlFilter,
  parseAnalisisInventarioLineFamily,
} from "@/lib/analisis-inventario/line-family";

describe("analisis inventario line family", () => {
  it("parsea valores válidos", () => {
    assert.equal(parseAnalisisInventarioLineFamily("perecederos"), "perecederos");
    assert.equal(parseAnalisisInventarioLineFamily("manufactura"), "manufactura");
    assert.equal(parseAnalisisInventarioLineFamily("all"), "all");
    assert.equal(parseAnalisisInventarioLineFamily(null), "all");
    assert.equal(parseAnalisisInventarioLineFamily("otro"), "all");
  });

  it("arma SQL de filtro", () => {
    assert.equal(lineFamilySqlFilter("all", "linea_id"), "");
    assert.match(
      lineFamilySqlFilter("perecederos", "linea_id"),
      /linea_id IN \('01', '02', '03', '04', '12'\)/,
    );
    assert.match(
      lineFamilySqlFilter("manufactura", "linea_id"),
      /linea_id NOT IN \('01', '02', '03', '04', '12'\)/,
    );
  });
});
