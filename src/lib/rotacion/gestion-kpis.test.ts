import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { DEFAULT_ABCD_CONFIG } from "@/app/rotacion/rotacion-preamble";
import { tagRotacionCriticalRows } from "@/lib/rotacion/critical-digest";
import {
  aggregateGestionTrendPoints,
  buildRotacionGestionKpis,
  diffRotacionGestionKpis,
  previousCalendarMonthRange,
} from "@/lib/rotacion/gestion-kpis";

const dateRange = { start: "2026-06-01", end: "2026-06-30" };

const baseRow = (overrides: Partial<RotationRow> = {}): RotationRow => ({
  empresa: "mtodo",
  sedeId: "001",
  sedeName: "Floresta",
  linea: "10",
  lineaN1Codigo: "10",
  lineaN2Codigo: "01",
  sublinea: "Galletas",
  item: "1001",
  descripcion: "Item prueba",
  unidad: "UND",
  bodega: "01",
  nombreBodega: "Principal",
  categoria: "1",
  nombreCategoria: "Cat",
  linea01: "10",
  nombreLinea01: "Abarrotes",
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

describe("gestion KPIs", () => {
  it("el mes calendario anterior cae en 1–último día", () => {
    assert.deepEqual(previousCalendarMonthRange("2026-08-01"), {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    assert.deepEqual(previousCalendarMonthRange("2026-03-10"), {
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("capital liberado es before $ menos after $", () => {
    const tagged = tagRotacionCriticalRows(
      [
        baseRow({
          item: "cero-1",
          totalSales: 0,
          totalUnits: 0,
          salesEffectiveDays: 0,
          inventoryUnits: 3,
          inventoryValue: 250_000_000,
          openingInventoryUnits: 5,
          rotation: 999999,
          lastPurchaseDate: null,
          lastMovementDate: "2026-04-01",
        }),
      ],
      dateRange,
      DEFAULT_ABCD_CONFIG,
      ["manufactura"],
    );
    const before = buildRotacionGestionKpis(tagged, dateRange);
    const after = buildRotacionGestionKpis(
      tagged.map((entry) => ({
        ...entry,
        row: { ...entry.row, inventoryValue: 36_000_000, inventoryUnits: 1 },
      })),
      dateRange,
    );
    const diff = diffRotacionGestionKpis(before, after);
    assert.equal(before.inventoryValue, 250_000_000);
    assert.equal(after.inventoryValue, 36_000_000);
    assert.equal(diff.liberatedValue, 214_000_000);
    assert.equal(diff.liberatedItems, 0);
  });

  it("la tendencia semanal suma sedes y respeta cortes", () => {
    const points = aggregateGestionTrendPoints(
      [
        {
          semanaFin: "2026-06-07",
          empresa: "mtodo",
          sedeId: "001",
          familia: "manufactura",
          bucket: "cero",
          itemCount: 10,
          inventoryValue: 100,
          inventoryUnits: 4,
          demandaUnits: 0,
          trackedDays: 30,
        },
        {
          semanaFin: "2026-06-07",
          empresa: "mtodo",
          sedeId: "002",
          familia: "manufactura",
          bucket: "cero",
          itemCount: 5,
          inventoryValue: 50,
          inventoryUnits: 2,
          demandaUnits: 0,
          trackedDays: 30,
        },
        {
          semanaFin: "2026-06-14",
          empresa: "mtodo",
          sedeId: "001",
          familia: "manufactura",
          bucket: "demandaD",
          itemCount: 2,
          inventoryValue: 20,
          inventoryUnits: 8,
          demandaUnits: 4,
          trackedDays: 30,
        },
      ],
      { buckets: ["cero"] },
    );
    assert.equal(points.length, 1);
    assert.equal(points[0]?.itemCount, 15);
    assert.equal(points[0]?.inventoryValue, 150);
  });
});
