import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLineasN2QueryValues,
  filterRotationRowsByLineaAndCategoria,
  resolveRowLineaN2FilterCode,
  type RotationRow,
} from "./rotacion-preamble";

const baseRow = (overrides: Partial<RotationRow> = {}): RotationRow => ({
  empresa: "mercamio",
  sedeId: "003",
  sedeName: "Floresta",
  linea: "Granos",
  lineaN1Codigo: "05",
  lineaN2Codigo: "0501",
  sublinea: "Granos a granel",
  item: "1001",
  descripcion: "Arroz prueba",
  unidad: "UND",
  bodega: null,
  nombreBodega: null,
  categoria: "1",
  nombreCategoria: "Cat",
  linea01: "05",
  nombreLinea01: "Granos",
  totalSales: 10,
  totalCost: 5,
  totalMargin: 5,
  marginDailyAvgPct: 50,
  totalUnits: 1,
  openingInventoryUnits: 0,
  minInventoryUnits: 0,
  inventoryUnits: 1,
  inventoryValue: 100,
  rotation: 1,
  trackedDays: 30,
  salesEffectiveDays: 10,
  lastMovementDate: null,
  lastPurchaseDate: null,
  effectiveDays: 30,
  status: "En seguimiento",
  ...overrides,
});

test("buildLineasN2QueryValues normaliza codigos y filtra parcialmente", () => {
  assert.deepEqual(
    buildLineasN2QueryValues(["0501", "0502", "0503"], ["501", "502"]),
    ["0501", "0502"],
  );
  assert.equal(
    buildLineasN2QueryValues(["0501", "0502"], ["0501", "0502"]),
    null,
  );
});

test("resolveRowLineaN2FilterCode infiere codigo desde sublinea", () => {
  const code = resolveRowLineaN2FilterCode(
    baseRow({ lineaN2Codigo: null, sublinea: "Granos a granel" }),
    { "0501": "Granos a granel", "0502": "Granos empacados" },
  );
  assert.equal(code, "0501");
});

test("filterRotationRowsByLineaAndCategoria respeta sublineas N2 parciales", () => {
  const rows = [
    baseRow({ item: "a", lineaN2Codigo: "0501" }),
    baseRow({ item: "b", lineaN2Codigo: "0502" }),
    baseRow({ item: "c", lineaN2Codigo: "0503" }),
  ];
  const filtered = filterRotationRowsByLineaAndCategoria(
    rows,
    ["05"],
    ["05"],
    [],
    [],
    ["0501", "0502", "0503"],
    ["0501", "0502"],
    {},
  );
  assert.deepEqual(
    filtered.map((row) => row.item),
    ["a", "b"],
  );
});
