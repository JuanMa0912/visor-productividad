import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDateNotFoundError,
  buildDateRangeRequiredError,
  compactDateToIsoDate,
  isoDateToCompactDate,
  resolveMissingBoundary,
  validateVentasXItemDateRange,
} from "./ventas-x-item-date-range.ts";

test("convierte fechas ISO y compactas", () => {
  assert.equal(isoDateToCompactDate("2026-04-06"), "20260406");
  assert.equal(compactDateToIsoDate("20260406"), "2026-04-06");
  assert.equal(compactDateToIsoDate("2026-04-06"), null);
});

test("valida que start y end sean obligatorios", () => {
  assert.deepEqual(validateVentasXItemDateRange(null, "2026-04-06"), {
    ok: false,
    error: buildDateRangeRequiredError(),
  });

  assert.deepEqual(validateVentasXItemDateRange("2026-04-01", null), {
    ok: false,
    error: buildDateRangeRequiredError(),
  });
});

test("determina correctamente el borde faltante", () => {
  assert.equal(resolveMissingBoundary(false, true), "start");
  assert.equal(resolveMissingBoundary(true, false), "end");
  assert.equal(resolveMissingBoundary(false, false), "both");
  assert.equal(resolveMissingBoundary(true, true), null);
});

test("arma el payload estructurado para DATE_NOT_FOUND", () => {
  assert.deepEqual(
    buildDateNotFoundError(
      {
        minDate: "2025-11-01",
        maxDate: "2026-04-06",
        hasStart: false,
        hasEnd: true,
      },
      "2026-01-01",
      "2026-01-31",
    ),
    {
      code: "DATE_NOT_FOUND",
      error: "La fecha inicial 2026-01-01 no se encontro en la base de datos.",
      requestedStart: "2026-01-01",
      requestedEnd: "2026-01-31",
      availableStart: "2025-11-01",
      availableEnd: "2026-04-06",
      missingBoundary: "start",
    },
  );
});
