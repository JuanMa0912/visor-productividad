import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isComercializadoraEmpresa,
  ocEntradaInvTipdocSql,
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

  it("inventario ET/EF vs pedido FR: Mercatodo incluye tránsito", () => {
    const inv = ocEntradaInvTipdocSql("empresa", "tipdoc");
    const po = ocEntradaPoTipdocSql("empresa", "tipdoc");
    const all = ocEntradaTipdocSql("empresa", "tipdoc");
    assert.match(inv, /'ET',\s*'EF'/);
    assert.match(po, /tipdoc.*= 'FR'/i);
    assert.match(all, /ET/);
    assert.match(all, /FR/);
  });
});
