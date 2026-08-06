import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateLevel0TotalsFromDayRows } from "@/lib/margenes/drill-queries";

describe("aggregateLevel0TotalsFromDayRows", () => {
  it("suma metricas aditivas y cuenta dias/sedes", () => {
    const total = aggregateLevel0TotalsFromDayRows(
      [
        {
          ventasNetas: 100,
          costoTotal: 40,
          margenPesos: 60,
          cantidad: 10,
          ventasConIva: 119,
          facturas: 2,
          categorias: 1,
          lineas: 3,
          sublineas: 4,
          items: 5,
        },
        {
          ventasNetas: 50,
          costoTotal: 20,
          margenPesos: 30,
          cantidad: 5,
          ventasConIva: 59.5,
          facturas: 1,
          categorias: 1,
          lineas: 2,
          sublineas: 2,
          items: 3,
        },
      ],
      11,
    );

    assert.equal(total.ventas_netas, 150);
    assert.equal(total.costo_total, 60);
    assert.equal(total.margen_pesos, 90);
    assert.equal(total.cantidad, 15);
    assert.equal(total.facturas, 3);
    assert.equal(total.items, 8);
    assert.equal(total.dias, 2);
    assert.equal(total.sedes, 11);
  });
});
