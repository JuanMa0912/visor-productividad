import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasProveedorFilter,
  keepSelected,
  parseProveedorFilterIds,
  splitCostosCsv,
} from "@/lib/exp-precios-proveedor/filters";

describe("costos filter params", () => {
  it("parte CSV y descarta vacíos", () => {
    assert.deepEqual(splitCostosCsv("a, b,,c"), ["a", "b", "c"]);
    assert.deepEqual(splitCostosCsv(""), []);
    assert.deepEqual(splitCostosCsv(null), []);
  });

  it("conserva solo ids que siguen en el catálogo", () => {
    assert.deepEqual(keepSelected(["01", "99", "02"], ["01", "02", "03"]), [
      "01",
      "02",
    ]);
  });

  it("separa proveedores OC, comercial y criterio", () => {
    const parsed = parseProveedorFilterIds([
      "oc:123",
      "t:456",
      "07",
      "oc:",
      "",
    ]);
    assert.deepEqual(parsed.oc, ["123"]);
    assert.deepEqual(parsed.tercero, ["456"]);
    assert.deepEqual(parsed.criterio, ["07"]);
    assert.equal(hasProveedorFilter(parsed), true);
    assert.equal(hasProveedorFilter(parseProveedorFilterIds([])), false);
  });
});
