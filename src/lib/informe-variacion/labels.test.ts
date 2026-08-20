import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatInformeSedeLabel,
  stripInformeSedeDisplayName,
} from "@/lib/informe-variacion/labels";

describe("stripInformeSedeDisplayName", () => {
  it("quita el código de centro al inicio", () => {
    assert.equal(stripInformeSedeDisplayName("01 Floresta"), "Floresta");
    assert.equal(stripInformeSedeDisplayName("1 FLORESTA"), "FLORESTA");
    assert.equal(stripInformeSedeDisplayName("Floresta"), "Floresta");
  });
});

describe("formatInformeSedeLabel", () => {
  it("usa el nombre canónico sin número de centro", () => {
    assert.equal(formatInformeSedeLabel("mtodo", "001"), "Floresta");
    assert.equal(formatInformeSedeLabel("mercamio", "001"), "Calle 5ta");
    assert.equal(formatInformeSedeLabel("bogota", "002"), "Chía");
  });
});
