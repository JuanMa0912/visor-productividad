import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickInformeMarcaLabel } from "@/lib/informe-variacion/marcas";

describe("pickInformeMarcaLabel", () => {
  it("ignora MERCAMIO FRUVER / Carnes Rojas y deja la marca comercial", () => {
    assert.equal(
      pickInformeMarcaLabel([
        { label: "MERCAMIO FRUVER", hits: 40 },
        { label: "ALPINA", hits: 3 },
        { label: "MERCAMIO CARNES ROJAS", hits: 12 },
      ]),
      "ALPINA",
    );
  });

  it("sin marca comercial queda vacio", () => {
    assert.equal(
      pickInformeMarcaLabel([
        { label: "MERCAMIO FRUVER", hits: 8 },
        { label: "MERCAMIO GRANOS", hits: 2 },
        { label: "MERCAMIO POLLOS-PESCADOS-CONEJO", hits: 1 },
      ]),
      null,
    );
  });
});
