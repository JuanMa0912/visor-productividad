import assert from "node:assert/strict";
import test from "node:test";
import {
  labelOcEmpresa,
  ocSedeMatchesEmpresas,
  sortOcEmpresas,
  sortOcSedes,
} from "./filters";

test("empresas OC se etiquetan y ordenan Mercamio → Mercatodo → Merkmios", () => {
  assert.equal(labelOcEmpresa("mtodo"), "Mercatodo");
  assert.equal(labelOcEmpresa("bogota"), "Merkmios");
  assert.deepEqual(sortOcEmpresas(["bogota", "mercamio", "mtodo"]), [
    "mercamio",
    "mtodo",
    "bogota",
  ]);
});

test("sedes OC siguen el orden del portal", () => {
  const sorted = sortOcSedes(["Chia", "Calle 5ta", "Floresta", "Palmira"]);
  assert.deepEqual(sorted, ["Calle 5ta", "Palmira", "Floresta", "Chia"]);
});

test("sede se filtra por empresa seleccionada", () => {
  assert.equal(ocSedeMatchesEmpresas("Calle 5ta", ["mercamio"]), true);
  assert.equal(ocSedeMatchesEmpresas("Floresta", ["mercamio"]), false);
  assert.equal(ocSedeMatchesEmpresas("Bogota", ["bogota"]), true);
  assert.equal(ocSedeMatchesEmpresas("Calle 5ta", ["mercamio", "mtodo"]), true);
  assert.equal(ocSedeMatchesEmpresas("Floresta", ["mercamio", "mtodo"]), true);
});
