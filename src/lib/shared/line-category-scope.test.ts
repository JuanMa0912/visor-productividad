import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMargenCategoriaScope,
  applyMargenLineaScope,
  applyRotacionCategoriaKeysScope,
  applyRotacionLineaN1Scope,
  ASADERO_MARGEN_TIPO_ID,
  ASADERO_ROTACION_CATEGORIA_KEY,
  FRUVER_MARGEN_LINEA_ID,
  FRUVER_ROTACION_LINEA_N1,
  resolveRotacionCategoriaPresenceSql,
  resolveUserLineCategoryScope,
} from "@/lib/shared/line-category-scope";

describe("resolveUserLineCategoryScope", () => {
  it("sin allowed_lines no restringe", () => {
    const scope = resolveUserLineCategoryScope(null);
    assert.equal(scope.locked, false);
    assert.equal(scope.forcedMargenTipos, null);
    assert.equal(scope.forcedMargenLineas, null);
  });

  it("solo asadero fuerza categoria 3 en margen y rotacion", () => {
    const scope = resolveUserLineCategoryScope(["asadero"]);
    assert.equal(scope.locked, true);
    assert.deepEqual(scope.forcedMargenTipos, [ASADERO_MARGEN_TIPO_ID]);
    assert.deepEqual(scope.forcedRotacionCategoriaKeys, [
      ASADERO_ROTACION_CATEGORIA_KEY,
    ]);
    assert.equal(scope.forcedMargenLineas, null);
  });

  it("solo fruver fuerza linea 01 y excluye categoria 3", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    assert.equal(scope.locked, true);
    assert.deepEqual(scope.forcedMargenLineas, [FRUVER_MARGEN_LINEA_ID]);
    assert.deepEqual(scope.forcedRotacionLineaN1, [FRUVER_ROTACION_LINEA_N1]);
    assert.deepEqual(scope.excludedMargenTipos, [ASADERO_MARGEN_TIPO_ID]);
    assert.equal(scope.forcedMargenTipos, null);
    assert.equal(scope.forcedRotacionCategoriaKeys, null);
  });

  it("varias lineas no activa bloqueo de categoria", () => {
    const scope = resolveUserLineCategoryScope(["asadero", "cajas"]);
    assert.equal(scope.locked, false);
    assert.equal(scope.forcedMargenTipos, null);
  });
});

describe("applyMargenCategoriaScope", () => {
  it("inyecta tipo forzado cuando el filtro viene vacio", () => {
    const scope = resolveUserLineCategoryScope(["asadero"]);
    assert.deepEqual(applyMargenCategoriaScope([], scope), ["3"]);
  });

  it("descarta tipos fuera del alcance", () => {
    const scope = resolveUserLineCategoryScope(["asadero"]);
    assert.deepEqual(applyMargenCategoriaScope(["4", "3"], scope), ["3"]);
  });

  it("fruver elimina categoria 3 de la seleccion", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    assert.deepEqual(applyMargenCategoriaScope(["3", "4"], scope), ["4"]);
  });
});

describe("applyMargenLineaScope", () => {
  it("inyecta linea 01 para fruver", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    assert.deepEqual(applyMargenLineaScope([], scope), ["01"]);
  });

  it("normaliza 1 a 01 al intersectar", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    assert.deepEqual(applyMargenLineaScope(["1", "08"], scope), ["01"]);
  });
});

describe("applyRotacionCategoriaKeysScope", () => {
  it("fuerza clave 3 cuando no hay seleccion", () => {
    const scope = resolveUserLineCategoryScope(["asadero"]);
    assert.deepEqual(applyRotacionCategoriaKeysScope(null, scope), ["3"]);
  });
});

describe("applyRotacionLineaN1Scope", () => {
  it("fuerza linea 01 para fruver", () => {
    const scope = resolveUserLineCategoryScope(["fruver"]);
    assert.deepEqual(applyRotacionLineaN1Scope(null, scope), ["01"]);
  });
});

describe("resolveRotacionCategoriaPresenceSql", () => {
  const fields = {
    categoriaKeyExpr: "categoria_key",
    allowedCategoriaExpr:
      "categoria_key IS NOT NULL AND categoria_key NOT IN ('3', 'V')",
  };

  it("sin claves forzadas usa el predicado que excluye 3/V", () => {
    assert.equal(
      resolveRotacionCategoriaPresenceSql(fields, null),
      fields.allowedCategoriaExpr,
    );
  });

  it("con asaderos exige categoria 3", () => {
    const sql = resolveRotacionCategoriaPresenceSql(fields, ["3"]);
    assert.match(sql, /categoria_key = ANY\(ARRAY\['3'\]::text\[\]\)/);
  });

  it("descarta claves con caracteres peligrosos y conserva las validas", () => {
    const sql = resolveRotacionCategoriaPresenceSql(fields, [
      "3",
      "'; DROP TABLE x",
    ]);
    assert.match(sql, /categoria_key = ANY\(ARRAY\['3'\]::text\[\]\)/);
    assert.doesNotMatch(sql, /DROP TABLE/i);
  });

  it("FALSE si todas las claves son invalidas", () => {
    assert.equal(
      resolveRotacionCategoriaPresenceSql(fields, ["'; DROP"]),
      "FALSE",
    );
  });
});
