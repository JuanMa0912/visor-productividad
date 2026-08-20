import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isComercializadoraEmpresa,
  ocEntradaInvTipdocSql,
  transitoTipdocSql,
  ocEntradaPoTipdocSql,
  ocEntradaQtySql,
  ocEntradaTipdocSql,
  proveedorExpandGroupKey,
  stripEmpresaProveedorLabel,
  stripMercamioProveedorLabel,
} from "@/lib/exp-precios-proveedor/labels";

describe("precios-proveedor labels", () => {
  it("quita MERCAMIO del nombre de proveedor y deja el resto", () => {
    assert.equal(stripMercamioProveedorLabel("MERCAMIO FRUVER"), "FRUVER");
    assert.equal(
      stripMercamioProveedorLabel("MERCAMIO CARNES ROJAS"),
      "CARNES ROJAS",
    );
    assert.equal(stripMercamioProveedorLabel("ALPINA"), "ALPINA");
    assert.equal(stripMercamioProveedorLabel("  Mercamio   Granos"), "Granos");
  });

  it("quita Bogotá / Mercatodo / Merkmios del nombre de proveedor", () => {
    assert.equal(
      stripEmpresaProveedorLabel("BOGOTA - COSECHA NUESTRA SAS OC"),
      "COSECHA NUESTRA SAS OC",
    );
    assert.equal(
      stripEmpresaProveedorLabel("MERCATODO EL REY DEL TOMATE"),
      "EL REY DEL TOMATE",
    );
    assert.equal(
      stripEmpresaProveedorLabel("MERKMIOS - GOMEZ VIDAL JOSE MARINO OC"),
      "GOMEZ VIDAL JOSE MARINO OC",
    );
  });

  it("agrupa el mismo proveedor aunque venga de empresas distintas", () => {
    const item = "005598";
    assert.equal(
      proveedorExpandGroupKey(item, "BOGOTA - COSECHA NUESTRA SAS OC"),
      proveedorExpandGroupKey(item, "MERCAMIO - COSECHA NUESTRA SAS OC"),
    );
    assert.notEqual(
      proveedorExpandGroupKey(item, "COSECHA NUESTRA SAS OC"),
      proveedorExpandGroupKey(item, "TERRA NUESTRA SAS OC"),
    );
  });

  it("detecta comercializadora Mercatodo", () => {
    assert.equal(isComercializadoraEmpresa("mtodo"), true);
    assert.equal(isComercializadoraEmpresa("Mercatodo"), true);
    assert.equal(isComercializadoraEmpresa("mercamio"), false);
  });

  it("entrada efectiva usa cantidad_ent; ET usa cantidad", () => {
    const sql = ocEntradaQtySql("tipdoc");
    assert.match(sql, /cantidad_ent/);
    assert.match(sql, /tipdoc.*= 'ET'/i);
  });

  it("la entrada real es solo EF: el transito NUNCA cuenta como recibido", () => {
    const inv = ocEntradaInvTipdocSql("empresa", "tipdoc");
    // Invariante del tablero: ET es mercancia en camino y se informa aparte.
    // Si alguien vuelve a meter 'ET' aqui, kilos, costo y margen se inflan, y
    // ademas el transito taparia el pedido FR que si trajo mercancia (invCos).
    assert.match(inv, /= 'EF'/);
    assert.doesNotMatch(inv, /'ET'/);
    // Y no depende de la empresa: mercamio, mtodo y bogota por igual.
    assert.equal(
      ocEntradaInvTipdocSql("mercamio", "tipdoc"),
      ocEntradaInvTipdocSql("mtodo", "tipdoc"),
    );
  });

  it("el transito se identifica aparte y viaja en el conjunto consultado", () => {
    const transito = transitoTipdocSql("tipdoc");
    assert.match(transito, /= 'ET'/);
    assert.doesNotMatch(transito, /'EF'/);

    const po = ocEntradaPoTipdocSql("empresa", "tipdoc");
    assert.match(po, /tipdoc.*= 'FR'/i);

    // El SELECT trae las tres familias; el bucketing decide cual suma.
    const all = ocEntradaTipdocSql("empresa", "tipdoc");
    assert.match(all, /'ET'/);
    assert.match(all, /'EF'/);
    assert.match(all, /'FR'/);
  });
});
