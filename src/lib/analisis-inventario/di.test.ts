import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDiFromRates,
  calculateDiMetrics,
  calendarDaysInclusive,
  formatDiDays,
  NO_SALES_DI_VALUE,
  resolveDiBand,
} from "@/lib/analisis-inventario/di";
import {
  nextDrillLevel,
  nextHeatmapRowLevel,
  parseAnalisisInventarioDrillPath,
} from "@/lib/analisis-inventario/drill-path";

describe("calculateDiFromRates", () => {
  it("coincide con la formula vieja cuando todos los items comparten los dias", () => {
    // 100 und en stock, 50 vendidas en 30 dias -> tasa 50/30 = 1,667 und/dia.
    const porTasas = calculateDiFromRates({
      inventoryUnits: 100,
      inventoryValue: 1_000_000,
      unitsPerDay: 50 / 30,
      costPerDay: 500_000 / 30,
    });
    const porDias = calculateDiMetrics({
      inventoryUnits: 100,
      inventoryValue: 1_000_000,
      soldUnits: 50,
      costOfSales: 500_000,
      trackedDays: 30,
    });
    assert.ok(Math.abs(porTasas.diUnits - porDias.diUnits) < 1e-9);
    assert.ok(Math.abs(porTasas.diValue - porDias.diValue) < 1e-9);
  });

  it("005184 MORA COMUN: item que llego el 28-jul no recibe el divisor del mes", () => {
    // Caso real (bogota/001, julio 2026): 14 und vendidas en 3 dias de
    // exposicion, 6 und de inventario de cierre. La formula vieja daba
    // 6 x 30 / 14 = 12,86 d; el item se agota en dia y medio.
    const { diUnits } = calculateDiFromRates({
      inventoryUnits: 6,
      inventoryValue: 90_000,
      unitsPerDay: 14 / 3,
      costPerDay: 210_000 / 3,
    });
    assert.ok(Math.abs(diUnits - 1.2857) < 0.001);
  });

  it("suma de tasas: dos items con ventanas distintas no promedian mal", () => {
    // A: 30 und en 30 dias = 1/dia. B: 30 und en 3 dias = 10/dia.
    // Inventario total 110 -> 110 / 11 = 10 dias.
    // La formula vieja daria 110 x 30 / 60 = 55 dias, 5,5x mas.
    const { diUnits } = calculateDiFromRates({
      inventoryUnits: 110,
      inventoryValue: 0,
      unitsPerDay: 30 / 30 + 30 / 3,
      costPerDay: 0,
    });
    assert.equal(diUnits, 10);
  });

  it("sin tasa de salida marca sin venta; sin inventario da 0", () => {
    assert.equal(
      calculateDiFromRates({
        inventoryUnits: 5,
        inventoryValue: 5,
        unitsPerDay: 0,
        costPerDay: 0,
      }).diUnits,
      NO_SALES_DI_VALUE,
    );
    assert.equal(
      calculateDiFromRates({
        inventoryUnits: 0,
        inventoryValue: 0,
        unitsPerDay: 3,
        costPerDay: 3,
      }).diUnits,
      0,
    );
  });
});

describe("calculateDiMetrics", () => {
  it("calcula DI unidades y valor", () => {
    const metrics = calculateDiMetrics({
      inventoryUnits: 100,
      inventoryValue: 1_000_000,
      soldUnits: 50,
      costOfSales: 500_000,
      trackedDays: 30,
    });
    assert.equal(metrics.diUnits, 60);
    assert.equal(metrics.diValue, 60);
  });

  it("marca sin venta cuando no hay salida", () => {
    const metrics = calculateDiMetrics({
      inventoryUnits: 10,
      inventoryValue: 100,
      soldUnits: 0,
      costOfSales: 0,
      trackedDays: 30,
    });
    assert.equal(metrics.diUnits, NO_SALES_DI_VALUE);
    assert.equal(metrics.diValue, NO_SALES_DI_VALUE);
    assert.equal(formatDiDays(metrics.diUnits), "Sin venta");
    assert.equal(resolveDiBand(metrics.diUnits), "sin-venta");
  });

  it("devuelve 0 sin inventario", () => {
    const metrics = calculateDiMetrics({
      inventoryUnits: 0,
      inventoryValue: 0,
      soldUnits: 20,
      costOfSales: 100,
      trackedDays: 30,
    });
    assert.equal(metrics.diUnits, 0);
    assert.equal(metrics.diValue, 0);
  });
});

describe("drill path", () => {
  it("avanza nivel por nivel", () => {
    assert.equal(nextDrillLevel([]), "sede");
    assert.equal(
      nextDrillLevel([
        {
          type: "sede",
          id: "mercamio|001",
          label: "Calle 5",
          empresa: "mercamio",
          sedeId: "001",
        },
      ]),
      "categoria",
    );
    assert.equal(nextHeatmapRowLevel([]), "categoria");
  });

  it("parsea JSON válido", () => {
    const path = parseAnalisisInventarioDrillPath(
      JSON.stringify([
        {
          type: "categoria",
          id: "1",
          label: "Mercado",
        },
      ]),
    );
    assert.equal(path.length, 1);
    assert.equal(path[0]?.type, "categoria");
  });
});

describe("calendarDaysInclusive", () => {
  it("cuenta inclusive", () => {
    assert.equal(calendarDaysInclusive("2026-07-01", "2026-07-01"), 1);
    assert.equal(calendarDaysInclusive("2026-07-01", "2026-07-31"), 31);
  });
});
