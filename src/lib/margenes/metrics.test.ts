import assert from "node:assert/strict";
import test from "node:test";
import { buildMargenOrderBy } from "@/lib/margenes/metrics";

test("buildMargenOrderBy aplica ASC al fallback de codigo", () => {
  assert.equal(
    buildMargenOrderBy(undefined, "asc", "1"),
    "ORDER BY 1 ASC",
  );
  assert.equal(
    buildMargenOrderBy(undefined, "desc", "1"),
    "ORDER BY 1 DESC",
  );
});

test("buildMargenOrderBy respeta fallback con direccion explicita", () => {
  assert.equal(
    buildMargenOrderBy(undefined, "asc", "ventas_netas DESC"),
    "ORDER BY ventas_netas DESC",
  );
});

test("buildMargenOrderBy usa whitelist de metricas", () => {
  assert.equal(
    buildMargenOrderBy("margenPct", "asc", "1"),
    "ORDER BY margen_pct ASC NULLS LAST",
  );
});
