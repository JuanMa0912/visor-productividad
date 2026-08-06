import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDayMetricsHybridSql,
  buildDayMetricsSql,
  buildGroupedMetricsSql,
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

test("buildMargenOrderBy sin columna respeta orderDir si fallback no trae ASC/DESC", () => {
  assert.equal(
    buildMargenOrderBy(undefined, "asc", "ventas_netas"),
    "ORDER BY ventas_netas ASC",
  );
  assert.equal(
    buildMargenOrderBy(undefined, "desc", "ventas_netas"),
    "ORDER BY ventas_netas DESC",
  );
});

test("buildMargenOrderBy board factura rechaza categorias/lineas/items", () => {
  const boardAllowed = [
    "ventasNetas",
    "costoTotal",
    "margenPesos",
    "margenPct",
    "cantidad",
    "facturas",
    "pvuIva",
    "pcu",
  ];
  for (const key of ["categorias", "lineas", "sublineas", "items"] as const) {
    assert.equal(
      buildMargenOrderBy(key, "desc", "ventas_netas DESC", boardAllowed),
      "ORDER BY ventas_netas DESC",
    );
  }
  assert.equal(
    buildMargenOrderBy("facturas", "asc", "ventas_netas DESC", boardAllowed),
    "ORDER BY facturas ASC NULLS LAST",
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

test("buildGroupedMetricsSql agrupa por dimension sin colision de alias", () => {
  const sql = buildGroupedMetricsSql(
    "margen_final_roll",
    "fecha_dcto = $1",
    { keySql: "id_tipo", keyAlias: "id_tipo" },
  );
  assert.match(sql, /AS id_tipo/);
  assert.match(sql, /AS dim_tipo/);
  assert.match(sql, /WITH base AS/);
  assert.doesNotMatch(sql, /COUNT\(DISTINCT NULLIF/);
});

test("buildDayMetricsSql delega en buildGroupedMetricsSql", () => {
  const sql = buildDayMetricsSql("margen_final_roll", "TRUE");
  assert.match(sql, /fecha_dcto/);
  assert.match(sql, /AS dim_item/);
});

test("buildDayMetricsHybridSql combina roll + item_dia", () => {
  const sql = buildDayMetricsHybridSql(
    "margen_final_roll",
    "roll_where",
    "item_where",
    "ORDER BY m.fecha_dcto DESC",
  );
  assert.match(sql, /WITH money AS/);
  assert.match(sql, /FROM margen_item_dia_roll/);
  assert.match(sql, /item_where/);
  assert.match(sql, /roll_where/);
  assert.match(sql, /COALESCE\(dimc\.categorias/);
  assert.match(sql, /ORDER BY m\.fecha_dcto DESC/);
});
