import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { DEFAULT_ABCD_CONFIG } from "@/app/rotacion/rotacion-preamble";
import {
  buildRotacionCriticalDigest,
  tagRotacionCriticalRows,
} from "@/lib/rotacion/critical-digest";
import type { RotacionCriticalDigestSource } from "@/lib/rotacion/server/load-critical-digest-source";
import {
  buildRotacionChartStacks,
  filterTaggedRowsForChart,
  sumRotacionChartStacks,
} from "@/lib/rotacion/chart-series";

const dateRange = { start: "2026-05-01", end: "2026-06-15" };

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

const sourceForRows = (
  rows: RotationRow[],
  sedeName = "Floresta",
  sedeId = "001",
): RotacionCriticalDigestSource => ({
  rows,
  abcdConfig: DEFAULT_ABCD_CONFIG,
  dateRange,
  ceroEstadoByKey: {},
  restockEstadoByKey: {},
  restockEffectiveness: {
    score: 0,
    markedSurtidoCount: 0,
    soldAfterCount: 0,
    unavailable: false,
  },
  sedeName,
  empresa: "mtodo",
  sedeId,
});

describe("tagRotacionCriticalRows + chart stacks", () => {
  it("el consolidado por sede cuadra con el digest manufactura del correo", () => {
    const ceroRow = baseRow({
      item: "cero-1",
      totalSales: 0,
      totalUnits: 0,
      salesEffectiveDays: 0,
      inventoryUnits: 3,
      inventoryValue: 300,
      openingInventoryUnits: 5,
      rotation: 999999,
      lastPurchaseDate: null,
      lastMovementDate: "2026-04-01",
    });
    const restockRow = baseRow({
      item: "restock-1",
      totalSales: 0,
      totalUnits: 0,
      salesEffectiveDays: 0,
      inventoryUnits: 2,
      inventoryValue: 200,
      openingInventoryUnits: 0,
      lastPurchaseDate: null,
      lastMovementDate: "2026-06-01",
    });
    const dRow = baseRow({
      item: "d-1",
      totalSales: 50,
      totalUnits: 1,
      inventoryUnits: 20,
      inventoryValue: 2000,
    });
    const otherSedeCero = baseRow({
      sedeId: "002",
      sedeName: "Floralia",
      item: "cero-2",
      totalSales: 0,
      totalUnits: 0,
      salesEffectiveDays: 0,
      inventoryUnits: 4,
      inventoryValue: 400,
      openingInventoryUnits: 6,
      rotation: 999999,
      lastPurchaseDate: null,
      lastMovementDate: "2026-04-01",
    });

    const florestaRows = [ceroRow, restockRow, dRow];
    const allRows = [...florestaRows, otherSedeCero];
    const tagged = tagRotacionCriticalRows(
      allRows,
      dateRange,
      DEFAULT_ABCD_CONFIG,
      ["manufactura"],
    );
    const stacks = buildRotacionChartStacks(tagged, "sede", "items");
    const floresta = stacks.find((row) => row.key === "mtodo::001");
    const floralia = stacks.find((row) => row.key === "mtodo::002");
    const digest = buildRotacionCriticalDigest(sourceForRows(florestaRows));

    assert.ok(floresta);
    assert.equal(floresta.demandaD, digest.manufactura.demandaD.itemCount);
    assert.equal(floresta.cero, digest.manufactura.ceroRotacion.itemCount);
    assert.equal(floresta.restock, digest.manufactura.restockS.itemCount);
    assert.equal(floralia?.cero, 1);
    assert.equal(sumRotacionChartStacks(stacks).cero, 2);
  });

  it("el foco de sede deja solo esa sede al agrupar por linea", () => {
    const tagged = tagRotacionCriticalRows(
      [
        baseRow({
          item: "cero-1",
          totalSales: 0,
          totalUnits: 0,
          salesEffectiveDays: 0,
          inventoryUnits: 3,
          inventoryValue: 300,
          openingInventoryUnits: 5,
          rotation: 999999,
          lastPurchaseDate: null,
          lastMovementDate: "2026-04-01",
        }),
        baseRow({
          sedeId: "002",
          sedeName: "Floralia",
          item: "cero-2",
          lineaN1Codigo: "11",
          linea: "11",
          totalSales: 0,
          totalUnits: 0,
          salesEffectiveDays: 0,
          inventoryUnits: 4,
          inventoryValue: 400,
          openingInventoryUnits: 6,
          rotation: 999999,
          lastPurchaseDate: null,
          lastMovementDate: "2026-04-01",
        }),
      ],
      dateRange,
      DEFAULT_ABCD_CONFIG,
      ["manufactura"],
    );
    const focused = filterTaggedRowsForChart(tagged, ["manufactura"], [
      { groupBy: "sede", key: "mtodo::001", label: "Floresta" },
    ]);
    const stacks = buildRotacionChartStacks(focused, "linea", "items");
    assert.equal(stacks.length, 1);
    assert.equal(stacks[0]?.cero, 1);
  });
});
