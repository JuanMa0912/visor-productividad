import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProductividadFamilia,
  findTiendaSedeByName,
  normalizeEmpresaBd,
  productividadFamiliaSql,
} from "@/lib/proveedores/line-family";

describe("proveedores line-family", () => {
  it("clasifica fruver / carnes / industria y excluye pollo-asadero", () => {
    assert.equal(classifyProductividadFamilia("01", "FRUVER"), "fruver");
    assert.equal(classifyProductividadFamilia("1", "Frutas"), "fruver");
    assert.equal(classifyProductividadFamilia("02", "CARNES ROJAS"), "carnes");
    assert.equal(classifyProductividadFamilia("05", "ABARROTES"), "industria");
    assert.equal(classifyProductividadFamilia("03", "POLLO Y PESCADO"), null);
    assert.equal(classifyProductividadFamilia("12", "ASADERO"), null);
    assert.equal(classifyProductividadFamilia("", ""), null);
    assert.equal(classifyProductividadFamilia("99", "Pollo asado"), null);
  });

  it("el CASE SQL usa los mismos códigos N1", () => {
    const sql = productividadFamiliaSql("id_linea1", "nombre_linea1");
    assert.match(sql, /'01'/);
    assert.match(sql, /'02'/);
    assert.match(sql, /IN \('03', '12'\)/);
    assert.match(sql, /ELSE 'industria'/);
  });

  it("resuelve sedes del tablero e aliases de empresa", () => {
    assert.equal(findTiendaSedeByName("Ciudad Jardín")?.idCo, "004");
    assert.equal(findTiendaSedeByName("Bogotá")?.empresa, "bogota");
    assert.equal(normalizeEmpresaBd("Mercatodo"), "mtodo");
    assert.equal(normalizeEmpresaBd("merkmios"), "bogota");
  });
});
