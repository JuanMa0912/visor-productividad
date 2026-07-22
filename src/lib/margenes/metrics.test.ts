import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMargenOrderBy,
  shouldApplyMercadoTipoDefault,
} from "@/lib/margenes/metrics";

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

test("buildMargenOrderBy respeta allowed del SELECT reducido", () => {
  assert.equal(
    buildMargenOrderBy("facturas", "desc", "ventas_netas DESC", [
      "ventasNetas",
      "margenPct",
    ]),
    "ORDER BY ventas_netas DESC",
  );
  assert.equal(
    buildMargenOrderBy("margenPct", "asc", "ventas_netas DESC", [
      "ventasNetas",
      "margenPct",
    ]),
    "ORDER BY margen_pct ASC NULLS LAST",
  );
});

test("shouldApplyMercadoTipoDefault solo sin categorias", () => {
  assert.equal(shouldApplyMercadoTipoDefault([]), true);
  assert.equal(shouldApplyMercadoTipoDefault(null), true);
  assert.equal(shouldApplyMercadoTipoDefault(undefined), true);
  assert.equal(shouldApplyMercadoTipoDefault(["3"]), false);
  assert.equal(shouldApplyMercadoTipoDefault(["4"]), false);
  assert.equal(shouldApplyMercadoTipoDefault(["3", "4"]), false);
});
