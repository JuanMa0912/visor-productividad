import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKardexWhereClause,
  calculateMarginPctFromTotals,
} from "../repo";

test("arma where dinamico con parametros en orden", () => {
  const { clause, params } = buildKardexWhereClause({
    empresa: "mtodo",
    sede: "001",
    idItem: "007052",
    fechaDesde: "2026-04-05",
    fechaHasta: "2026-05-04",
  });

  assert.match(clause, /empresa = \$1/);
  assert.match(clause, /sede = \$2/);
  assert.match(clause, /id_item = \$3/);
  assert.match(clause, /fecha_dia BETWEEN \$4::date AND \$5::date/);
  assert.deepEqual(params, ["mtodo", "001", "007052", "2026-04-05", "2026-05-04"]);
});

test("calcula margen agregado por SUM\/SUM y no por promedio", () => {
  // Fixture donde AVG de porcentajes da un valor diferente al ponderado.
  const ventas = [1000, 100];
  const margenes = [50, 20];
  const avgPct = ((50 / 1000) * 100 + (20 / 100) * 100) / 2;
  const weightedPct = calculateMarginPctFromTotals(
    margenes.map((_, i) => ventas[i]).reduce((acc, value) => acc + value, 0),
    margenes.reduce((acc, value) => acc + value, 0),
  );

  assert.notEqual(Number(avgPct.toFixed(2)), weightedPct);
  assert.equal(weightedPct, 6.36); // (70 / 1100) * 100
});
