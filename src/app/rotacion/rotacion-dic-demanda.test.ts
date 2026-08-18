import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_SALES_DI_VALUE,
  buildConsolidatedRowsBySelection,
  normalizeRotationRows,
  resolveRotationDemandaUnits,
  type RotationRow,
} from "./rotacion-preamble";

/**
 * El DIC no es aditivo: al consolidar sedes el front vuelve a dividir. El
 * denominador tiene que ser la DEMANDA (venta PDV + consumo por ensamble de kit),
 * el mismo que usan el SQL en vivo y
 * `db/migrations/20260814_rotacion_periodo_std_demanda.sql`.
 */
const baseRow = (overrides: Partial<RotationRow> = {}): RotationRow => ({
  empresa: "mercamio",
  sedeId: "001",
  sedeName: "Centro",
  linea: "Huevos",
  lineaN1Codigo: "05",
  lineaN2Codigo: "0501",
  sublinea: "Huevo granel",
  item: "1001",
  descripcion: "HUEVO ROSADO AA und GRANEL",
  unidad: "UND",
  bodega: null,
  nombreBodega: null,
  categoria: "1",
  nombreCategoria: "Cat",
  linea01: "05",
  nombreLinea01: "Huevos",
  totalSales: 100,
  totalCost: 60,
  totalMargin: 40,
  marginDailyAvgPct: 40,
  totalUnits: 10,
  udsEquivalentes: 0,
  demandaUnits: 10,
  openingInventoryUnits: 0,
  minInventoryUnits: 0,
  inventoryUnits: 100,
  inventoryValue: 1000,
  rotation: 300,
  trackedDays: 30,
  salesEffectiveDays: 10,
  lastMovementDate: null,
  lastPurchaseDate: null,
  effectiveDays: 30,
  status: "En seguimiento",
  ...overrides,
});

test("consolidar dos sedes usa la demanda cuando solo una vende por kit", () => {
  // Sede 001: casi todo el movimiento entra por kits (el POS cobra en el padre).
  const conKits = baseRow({
    sedeId: "001",
    totalUnits: 10,
    udsEquivalentes: 90,
    demandaUnits: 100,
    inventoryUnits: 100,
    inventoryValue: 1000,
    trackedDays: 30,
  });
  // Sede 002: mismo item, sin kits.
  const sinKits = baseRow({
    sedeId: "002",
    sedeName: "Norte",
    totalUnits: 50,
    udsEquivalentes: 0,
    demandaUnits: 50,
    inventoryUnits: 50,
    inventoryValue: 500,
    trackedDays: 30,
  });

  const [group] = buildConsolidatedRowsBySelection([conKits, sinKits], 2);
  assert.equal(group.rows.length, 1);
  const [row] = group.rows;

  assert.equal(row.totalUnits, 60);
  assert.equal(row.udsEquivalentes, 90);
  assert.equal(row.demandaUnits, 150);
  // (100 + 50) * 30 / 150 = 30. Con el denominador viejo (totalUnits = 60)
  // habrian salido 75 dias, mas del doble.
  assert.equal(row.rotation, 30);
});

test("consolidar una sede que solo mueve por kit no la deja en 'Sin venta'", () => {
  const soloKit = baseRow({
    sedeId: "001",
    totalSales: 0,
    totalUnits: 0,
    udsEquivalentes: 20,
    demandaUnits: 20,
    inventoryUnits: 40,
    inventoryValue: 400,
    trackedDays: 20,
  });
  const sinMovimiento = baseRow({
    sedeId: "002",
    sedeName: "Norte",
    totalSales: 0,
    totalUnits: 0,
    udsEquivalentes: 0,
    demandaUnits: 0,
    inventoryUnits: 10,
    inventoryValue: 100,
    trackedDays: 20,
  });

  const [group] = buildConsolidatedRowsBySelection([soloKit, sinMovimiento], 2);
  const [row] = group.rows;

  assert.equal(row.demandaUnits, 20);
  // (40 + 10) * 20 / 20 = 50
  assert.equal(row.rotation, 50);
  assert.notEqual(row.rotation, NO_SALES_DI_VALUE);
});

test("sin demandaUnits (BD sin migrar o cache viejo) el DIC no cambia", () => {
  const legacy = (sedeId: string, sedeName: string, totalUnits: number) => {
    const row = baseRow({ sedeId, sedeName, totalUnits, trackedDays: 30 });
    delete row.demandaUnits;
    delete row.udsEquivalentes;
    return row;
  };

  const [group] = buildConsolidatedRowsBySelection(
    [
      legacy("001", "Centro", 10),
      { ...legacy("002", "Norte", 50), inventoryUnits: 50, inventoryValue: 500 },
    ],
    2,
  );
  const [row] = group.rows;

  assert.equal(row.demandaUnits, 60);
  // (100 + 50) * 30 / 60 = 75, identico al comportamiento previo al cambio.
  assert.equal(row.rotation, 75);
});

test("consolidar sin inventario sigue dando DIC 0", () => {
  const [group] = buildConsolidatedRowsBySelection(
    [
      baseRow({ sedeId: "001", inventoryUnits: 0, inventoryValue: 0 }),
      baseRow({
        sedeId: "002",
        sedeName: "Norte",
        inventoryUnits: 0,
        inventoryValue: 0,
      }),
    ],
    2,
  );
  assert.equal(group.rows[0].rotation, 0);
});

test("resolveRotationDemandaUnits cae a la venta PDV solo si falta el campo", () => {
  assert.equal(
    resolveRotationDemandaUnits(baseRow({ totalUnits: 7, demandaUnits: 9 })),
    9,
  );
  // demanda 0 con venta 0 es legitimo (item sin movimiento), no un campo faltante.
  assert.equal(
    resolveRotationDemandaUnits(baseRow({ totalUnits: 0, demandaUnits: 0 })),
    0,
  );
  const sinCampo = baseRow({ totalUnits: 7 });
  delete sinCampo.demandaUnits;
  assert.equal(resolveRotationDemandaUnits(sinCampo), 7);
});

test("normalizeRotationRows rellena demandaUnits para filas sin el campo", () => {
  const sinCampo = baseRow({ totalUnits: 12 });
  delete sinCampo.demandaUnits;
  delete sinCampo.udsEquivalentes;

  const [row] = normalizeRotationRows([sinCampo]);
  assert.equal(row.demandaUnits, 12);
  assert.equal(row.udsEquivalentes, 0);
});
