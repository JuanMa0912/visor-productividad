import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRotacionCriticalDigest,
  type RotacionCriticalDigest,
} from "@/lib/rotacion/critical-digest";
import {
  buildRotacionCriticalDigestHtml,
  buildRotacionCriticalDigestSubject,
  buildRotacionCriticalDigestText,
} from "@/lib/rotacion/critical-digest-email";
import type { RotacionCriticalDigestSource } from "@/lib/rotacion/server/load-critical-digest-source";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { DEFAULT_ABCD_CONFIG } from "@/app/rotacion/rotacion-preamble";

const baseRow = (overrides: Partial<RotationRow> = {}): RotationRow => ({
  empresa: "mtodo",
  sedeId: "001",
  sedeName: "Floresta",
  linea: "01",
  lineaN1Codigo: "01",
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

const sourceForRows = (
  rows: RotationRow[],
  estados: RotacionCriticalDigestSource["ceroEstadoByKey"] = {},
  restock: RotacionCriticalDigestSource["restockEstadoByKey"] = {},
): RotacionCriticalDigestSource => ({
  rows,
  abcdConfig: DEFAULT_ABCD_CONFIG,
  dateRange: { start: "2026-05-01", end: "2026-06-15" },
  ceroEstadoByKey: estados,
  restockEstadoByKey: restock,
  sedeName: "Floresta",
  empresa: "mtodo",
  sedeId: "001",
});

describe("buildRotacionCriticalDigest", () => {
  it("agrega total D+0+S y desglose de estados surtido", () => {
    const ceroRow = baseRow({
      item: "cero-1",
      totalSales: 0,
      totalUnits: 0,
      totalCost: 0,
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

    const digest = buildRotacionCriticalDigest(
      sourceForRows(
        [ceroRow, restockRow, dRow],
        { "mtodo\u001f001\u001fcero-1": "seguimiento" },
        { "mtodo\u001f001\u001frestock-1": "surtido" },
      ),
    );

    assert.equal(digest.perecederos.ceroRotacion.seguimiento + digest.manufactura.ceroRotacion.seguimiento, 1);
    assert.equal(digest.perecederos.restockS.surtido + digest.manufactura.restockS.surtido, 1);
    assert.equal(digest.total.totalInventario, 2500);
    assert.ok(digest.total.itemCount >= 2);
    assert.ok(digest.perecederos.total.itemCount >= 0);
    assert.ok(digest.manufactura.total.itemCount >= 0);
  });

  it("genera asunto y cuerpo con sede y rango", () => {
    const digest: RotacionCriticalDigest = {
      sedeName: "Floresta",
      empresa: "mtodo",
      sedeId: "001",
      dateRange: { start: "2026-05-01", end: "2026-06-15" },
      daysConsulted: 46,
      total: { itemCount: 10, totalInventario: 1_000_000 },
      perecederos: {
        total: { itemCount: 6, totalInventario: 600_000 },
        demandaD: {
          itemCount: 3,
          totalInventario: 300_000,
          diasInventario: 12.5,
        },
        ceroRotacion: {
          itemCount: 2,
          sinVerificar: 1,
          seguimiento: 1,
          surtido: 0,
          surtidoPct: 0,
        },
        restockS: {
          itemCount: 1,
          sinVerificar: 0,
          seguimiento: 0,
          surtido: 1,
          surtidoPct: 100,
        },
      },
      manufactura: {
        total: { itemCount: 4, totalInventario: 400_000 },
        demandaD: {
          itemCount: 2,
          totalInventario: 200_000,
          diasInventario: 8,
        },
        ceroRotacion: {
          itemCount: 1,
          sinVerificar: 0,
          seguimiento: 0,
          surtido: 1,
          surtidoPct: 100,
        },
        restockS: {
          itemCount: 1,
          sinVerificar: 0,
          seguimiento: 1,
          surtido: 0,
          surtidoPct: 0,
        },
      },
    };

    const subject = buildRotacionCriticalDigestSubject(digest);
    assert.match(subject, /Floresta/);
    assert.match(subject, /Críticos/);

    const html = buildRotacionCriticalDigestHtml(digest);
    assert.match(html, /Perecederos/);
    assert.match(html, /Manufactura/);
    assert.match(html, /Total sede D\+0\+S/);

    const text = buildRotacionCriticalDigestText(digest);
    assert.match(text, /PERECEDEROS/);
    assert.match(text, /MANUFACTURA/);
    assert.match(text, /TOTAL SEDE D\+0\+S/);
  });
});
