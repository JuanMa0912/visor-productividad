import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProductividadFamilia,
  findTiendaSedeByName,
  normalizeEmpresaBd,
  productividadFamiliaSqlFast,
  resolveTiendaSedeFromAsistencia,
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

  it("familia SQL rápida usa códigos N1 sin LIKE", () => {
    const sql = productividadFamiliaSqlFast("id_linea1");
    assert.match(sql, /'01'/);
    assert.match(sql, /'02'/);
    assert.match(sql, /IN \('03', '12'\)/);
    assert.match(sql, /ELSE 'industria'/);
    assert.doesNotMatch(sql, /LIKE/);
  });

  it("resuelve sedes del tablero e aliases de empresa", () => {
    assert.equal(findTiendaSedeByName("Ciudad Jardín")?.idCo, "004");
    assert.equal(findTiendaSedeByName("Bogotá")?.empresa, "bogota");
    assert.equal(normalizeEmpresaBd("Mercatodo"), "mtodo");
    assert.equal(normalizeEmpresaBd("merkmios"), "bogota");
  });

  it("mapea sedes libres de asistencia a tiendas del tablero", () => {
    assert.equal(resolveTiendaSedeFromAsistencia("LA 5A")?.name, "Calle 5ta");
    assert.equal(resolveTiendaSedeFromAsistencia("mio plaza norte")?.idCo, "003");
    assert.equal(resolveTiendaSedeFromAsistencia("merkmios chia")?.name, "Chia");
    assert.equal(resolveTiendaSedeFromAsistencia("ADM"), null);
  });
});
