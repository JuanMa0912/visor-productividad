import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checklistItemLabel } from "./catalog";

describe("checklistItemLabel", () => {
  it("resuelve ítems de bodega y punto de venta", () => {
    assert.equal(
      checklistItemLabel("bodega-gerencial", "1"),
      "La bodega está marcada y rotulada.",
    );
    assert.equal(
      checklistItemLabel("punto-venta", "1.1").startsWith(
        "El punto de venta se encuentra surtido",
      ),
      true,
    );
    assert.equal(checklistItemLabel("punto-venta", "no-existe"), "no-existe");
  });
});
