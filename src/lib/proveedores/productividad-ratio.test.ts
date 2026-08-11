import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { qtyPerPaidHour } from "@/lib/proveedores/productividad-repo";

describe("qtyPerPaidHour", () => {
  it("divide volumen entre horas pagadas", () => {
    assert.equal(qtyPerPaidHour(100, 10), 10);
    assert.equal(qtyPerPaidHour(7.5, 2.5), 3);
  });

  it("devuelve 0 sin horas o con horas no positivas", () => {
    assert.equal(qtyPerPaidHour(100, 0), 0);
    assert.equal(qtyPerPaidHour(100, -1), 0);
  });
});
