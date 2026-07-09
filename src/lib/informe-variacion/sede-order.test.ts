import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import {
  INFORME_SEDE_MATRIX_ORDER,
  sortInformeSedeCatalog,
} from "@/lib/informe-variacion/sede-order";

describe("sortInformeSedeCatalog", () => {
  it("ordena tiendas en el orden fijo de la matriz", () => {
    const shuffled = [...listMargenSedeCatalogOptions()].reverse();
    const sorted = sortInformeSedeCatalog(shuffled);
    const keys = sorted.map((entry) => entry.value);
    const expectedPrefix = [...INFORME_SEDE_MATRIX_ORDER];
    assert.deepEqual(keys.slice(0, expectedPrefix.length), expectedPrefix);
  });
});
