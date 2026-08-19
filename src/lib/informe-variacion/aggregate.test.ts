import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasActiveInformeFilters,
  passInformeRowFilter,
} from "@/lib/informe-variacion/aggregate";
import { EMPTY_INFORME_FILTERS } from "@/lib/informe-variacion/types";
import { r } from "@/lib/informe-variacion/test-row";

describe("passInformeRowFilter", () => {
  const sedeEmpresas = ["Comercializadora", "Mercamio"];
  const itemsLow = ["leche", "pan"];
  const itemProv = [1, 2];
  const row = r(0, 3, 8, 1, 0, 1, 1, 1, 10, 10, 10);

  it("deja pasar sin filtros", () => {
    assert.equal(
      passInformeRowFilter(row, EMPTY_INFORME_FILTERS, sedeEmpresas, itemsLow, itemProv),
      true,
    );
  });

  it("acepta varias empresas y sedes", () => {
    assert.equal(
      passInformeRowFilter(
        row,
        { ...EMPTY_INFORME_FILTERS, emp: ["Comercializadora", "Mercamio"] },
        sedeEmpresas,
        itemsLow,
        itemProv,
      ),
      true,
    );
    assert.equal(
      passInformeRowFilter(
        row,
        { ...EMPTY_INFORME_FILTERS, emp: ["Mercamio"] },
        sedeEmpresas,
        itemsLow,
        itemProv,
      ),
      false,
    );
    assert.equal(
      passInformeRowFilter(
        row,
        { ...EMPTY_INFORME_FILTERS, sede: ["0", "1"] },
        sedeEmpresas,
        itemsLow,
        itemProv,
      ),
      true,
    );
  });

  it("acepta varias categorias", () => {
    assert.equal(
      passInformeRowFilter(
        row,
        { ...EMPTY_INFORME_FILTERS, cat: ["3", "9"] },
        sedeEmpresas,
        itemsLow,
        itemProv,
      ),
      true,
    );
    assert.equal(
      passInformeRowFilter(
        row,
        { ...EMPTY_INFORME_FILTERS, cat: ["9"] },
        sedeEmpresas,
        itemsLow,
        itemProv,
      ),
      false,
    );
  });
});

describe("hasActiveInformeFilters", () => {
  it("detecta listas vacias vs con valores", () => {
    assert.equal(hasActiveInformeFilters(EMPTY_INFORME_FILTERS), false);
    assert.equal(
      hasActiveInformeFilters({ ...EMPTY_INFORME_FILTERS, emp: ["Mercamio"] }),
      true,
    );
  });
});
