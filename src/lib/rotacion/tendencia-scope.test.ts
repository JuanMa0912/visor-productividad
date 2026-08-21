import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { selectRotacionTendenciaRows, clampTendenciaDateRange } from "@/lib/rotacion/tendencia-scope";
import {
  enumerateIsoDays,
  fillDailySalesTrend,
} from "@/lib/rotacion/server/load-sede-sales-trend";

const range = { start: "2026-08-14", end: "2026-08-16" };

const baseRow = (overrides: Partial<RotationRow> = {}): RotationRow => ({
  empresa: "mtodo",
  sedeId: "001",
  sedeName: "Floresta",
  linea: "01",
  lineaN1Codigo: "01",
  lineaN2Codigo: null,
  sublinea: null,
  item: "1001",
  descripcion: "Item prueba",
  unidad: "UND",
  bodega: "01",
  nombreBodega: "Principal",
  categoria: "1",
  nombreCategoria: "Cat",
  linea01: "01",
  nombreLinea01: "Linea",
  totalSales: 1000,
  totalCost: 700,
  totalMargin: 300,
  marginDailyAvgPct: 30,
  totalUnits: 10,
  openingInventoryUnits: 5,
  minInventoryUnits: 2,
  inventoryUnits: 8,
  inventoryValue: 800,
  rotation: 5,
  trackedDays: 30,
  salesEffectiveDays: 28,
  lastMovementDate: "2026-06-01",
  lastPurchaseDate: "2026-06-10",
  effectiveDays: 30,
  status: "En seguimiento",
  ...overrides,
});

describe("selectRotacionTendenciaRows", () => {
  const rows = [
    baseRow({ item: "A1", totalSales: 500 }),
    baseRow({ item: "B1", totalSales: 200 }),
    baseRow({
      item: "Z0",
      totalSales: 0,
      totalUnits: 0,
      salesEffectiveDays: 0,
      inventoryUnits: 4,
      openingInventoryUnits: 3,
    }),
  ];
  const categoryByItem = new Map([
    ["A1", "A"],
    ["B1", "B"],
    ["Z0", "D"],
  ]);

  it("sin filtros usa toda la sede", () => {
    const next = selectRotacionTendenciaRows({
      rows,
      categoryFilter: "all",
      rowFilter: "none",
      dateRange: range,
      categoryByItem,
      isAbcdFilterableRow: () => true,
      isNuevoItemInSelectedRange: () => false,
    });
    assert.equal(next.scoped, false);
    assert.equal(next.label, "Toda la sede");
    assert.deepEqual(next.itemIds.sort(), ["A1", "B1", "Z0"]);
  });

  it("ignora dias de inventario / sobrestock", () => {
    const next = selectRotacionTendenciaRows({
      rows,
      categoryFilter: "O50",
      rowFilter: "none",
      dateRange: range,
      categoryByItem,
      isAbcdFilterableRow: () => true,
      isNuevoItemInSelectedRange: () => false,
    });
    assert.equal(next.scoped, false);
    assert.equal(next.itemIds.length, 3);
  });

  it("recorta a la clase ABCD seleccionada", () => {
    const next = selectRotacionTendenciaRows({
      rows,
      categoryFilter: ["A"],
      rowFilter: "none",
      dateRange: range,
      categoryByItem,
      isAbcdFilterableRow: () => true,
      isNuevoItemInSelectedRange: () => false,
    });
    assert.equal(next.scoped, true);
    assert.equal(next.label, "Clase A");
    assert.deepEqual(next.itemIds, ["A1"]);
  });

  it("recorta a cero rotacion", () => {
    const next = selectRotacionTendenciaRows({
      rows,
      categoryFilter: "all",
      rowFilter: "cero_rotacion",
      dateRange: range,
      categoryByItem,
      isAbcdFilterableRow: () => true,
      isNuevoItemInSelectedRange: () => false,
    });
    assert.equal(next.label, "Cero rotación");
    assert.deepEqual(next.itemIds, ["Z0"]);
  });
});

describe("clampTendenciaDateRange", () => {
  it("no deja ir antes del 1 de junio del año", () => {
    const next = clampTendenciaDateRange({
      start: "2026-05-01",
      end: "2026-08-20",
      availableMin: "2026-01-01",
      availableMax: "2026-08-20",
    });
    assert.equal(next.min, "2026-06-01");
    assert.equal(next.start, "2026-06-01");
    assert.equal(next.end, "2026-08-20");
  });
});

describe("fillDailySalesTrend", () => {
  it("rellena dias sin venta en cero", () => {
    assert.deepEqual(enumerateIsoDays("2026-08-14", "2026-08-16"), [
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    assert.deepEqual(
      fillDailySalesTrend("2026-08-14", "2026-08-16", [
        { day: "2026-08-15", sales: 1200 },
      ]),
      [
        { day: "2026-08-14", sales: 0 },
        { day: "2026-08-15", sales: 1200 },
        { day: "2026-08-16", sales: 0 },
      ],
    );
  });
});
