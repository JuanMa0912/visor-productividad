import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { selectRotacionTendenciaRows, clampTendenciaDateRange, tendenciaUsesStockDefault } from "@/lib/rotacion/tendencia-scope";
import {
  enumerateIsoDays,
  fillDailySalesTrend,
  isoWeekOf,
  bucketTrendByIsoWeek,
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

describe("tendenciaUsesStockDefault", () => {
  it("usa inventario en cero rotacion, restock y 0", () => {
    assert.equal(tendenciaUsesStockDefault("all", "cero_rotacion"), true);
    assert.equal(tendenciaUsesStockDefault("all", "both"), true);
    assert.equal(tendenciaUsesStockDefault("S", "none"), true);
    assert.equal(tendenciaUsesStockDefault("0", "none"), true);
    assert.equal(tendenciaUsesStockDefault("D0S", "none"), true);
    assert.equal(tendenciaUsesStockDefault(["A"], "none"), false);
    assert.equal(tendenciaUsesStockDefault("all", "none"), false);
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

describe("isoWeekOf", () => {
  it("el 1 de junio 2026 es la semana 23", () => {
    assert.deepEqual(isoWeekOf("2026-06-01"), {
      year: 2026,
      week: 23,
      monday: "2026-06-01",
    });
    assert.equal(isoWeekOf("2026-06-07")?.week, 23);
    assert.equal(isoWeekOf("2026-06-08")?.week, 24);
    assert.equal(isoWeekOf("2026-08-20")?.week, 34);
  });
});

describe("bucketTrendByIsoWeek", () => {
  it("agrupa ventas en suma y deja inventario al cierre de la semana", () => {
    const points = bucketTrendByIsoWeek("2026-06-01", "2026-06-14", [
      { day: "2026-06-02", sales: 100, units: 5, inventoryValue: 50 },
      { day: "2026-06-08", sales: 40, units: 8, inventoryValue: 80 },
      { day: "2026-06-10", sales: 10, units: 7, inventoryValue: 70 },
    ]);
    assert.deepEqual(
      points.map((point) => ({
        week: point.week,
        sales: point.sales,
        units: point.units,
        inventoryValue: point.inventoryValue,
      })),
      [
        { week: 23, sales: 100, units: 5, inventoryValue: 50 },
        { week: 24, sales: 50, units: 7, inventoryValue: 70 },
      ],
    );
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
        { day: "2026-08-15", sales: 1200, units: 40, inventoryValue: 800 },
      ]),
      [
        { day: "2026-08-14", sales: 0, units: 0, inventoryValue: 0 },
        { day: "2026-08-15", sales: 1200, units: 40, inventoryValue: 800 },
        { day: "2026-08-16", sales: 0, units: 0, inventoryValue: 0 },
      ],
    );
  });
});
