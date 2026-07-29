import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
