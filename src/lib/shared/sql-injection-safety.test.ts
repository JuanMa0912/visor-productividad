import assert from "node:assert/strict";
import test from "node:test";
import { resolveRotacionMatviewSqlStrategy } from "@/app/api/rotacion/route";
import { parseKardexFilters } from "@/features/kardex/schema";
import { buildKardexWhereClause } from "@/features/kardex/repo";
import {
  buildMargenWhereClause,
  parseMargenFilters,
  type MargenQueryFilters,
} from "@/lib/margenes/margen-final-query";
import { buildMargenOrderBy, MARGEN_SORT_COLUMNS } from "@/lib/margenes/metrics";
import { validateVentasXItemDateRange } from "@/lib/ventas/x-item-date-range";

/** Payloads clásicos de prueba; ninguno debe interpolarse en el SQL generado. */
const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE app_users;--",
  "1' OR '1'='1",
  "ventas_netas; DELETE FROM margen_final",
  "Robert'); DROP TABLE students;--",
  "admin'--",
  "1; SELECT pg_sleep(10)",
  "mercamio|001'; DROP TABLE margen_final;--",
] as const;

const assertSqlDoesNotEmbedPayloads = (sql: string, payloads: readonly string[]) => {
  assert.doesNotMatch(sql, /;\s*DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /;\s*DELETE\s+FROM/i);
  for (const payload of payloads) {
    assert.equal(
      sql.includes(payload),
      false,
      `SQL no debe contener el payload literal: ${JSON.stringify(payload)}`,
    );
  }
};

const baseMargenFilters = (): MargenQueryFilters => ({
  fromCompact: "20260601",
  toCompact: "20260630",
  fechas: [],
  empresas: [],
  sedes: [],
  categorias: [],
  lineas: [],
  sublineas: [],
  items: [],
});

test("buildMargenOrderBy ignora orderBy malicioso y usa whitelist", () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    const sql = buildMargenOrderBy(payload, "desc", "ventas_netas DESC");
    assertSqlDoesNotEmbedPayloads(sql, [payload]);
    assert.match(sql, /^ORDER BY ventas_netas DESC$/);
  }

  for (const key of Object.keys(MARGEN_SORT_COLUMNS)) {
    const sql = buildMargenOrderBy(key, "asc", "1");
    assert.equal(sql, `ORDER BY ${MARGEN_SORT_COLUMNS[key]} ASC NULLS LAST`);
  }
});

test("buildMargenWhereClause parametriza filtros con payloads maliciosos", () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    const params: unknown[] = [];
    const where = buildMargenWhereClause(
      {
        ...baseMargenFilters(),
        empresas: [payload],
        sedes: [payload],
        categorias: [payload],
        lineas: [payload],
        sublineas: [payload],
        items: [payload],
        fechas: [],
      },
      params,
    );

    assertSqlDoesNotEmbedPayloads(where, SQL_INJECTION_PAYLOADS);
    assert.match(where, /ANY\(\$\d+::text\[\]\)/g);
    for (const p of params) {
      if (Array.isArray(p)) {
        assert.ok(p.length > 0);
        for (const entry of p) {
          assert.equal(typeof entry, "string");
        }
      }
    }
  }
});

test("parseMargenFilters descarta fechas compactas invalidas", () => {
  const params = new URLSearchParams({
    from: "2026-06-01",
    to: "2026-06-30",
    fecha: "20260601,20260602'; DROP TABLE margen_final;--,bad",
    orderBy: "ventas_netas; DELETE FROM margen_final",
    orderDir: "desc; DROP",
  });
  const parsed = parseMargenFilters(params);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;

  assert.deepEqual(parsed.fechas, ["20260601"]);
  assert.ok(
    !parsed.fechas.some((f) => f.includes("'") || f.includes(";")),
    "fechas maliciosas deben descartarse por regex YYYYMMDD",
  );
  assert.equal(parsed.orderBy, "ventas_netas; DELETE FROM margen_final");
  assert.equal(parsed.orderDir, undefined);

  const orderSql = buildMargenOrderBy(
    parsed.orderBy,
    parsed.orderDir,
    "ventas_netas DESC",
  );
  assertSqlDoesNotEmbedPayloads(orderSql, SQL_INJECTION_PAYLOADS);
  assert.match(orderSql, /^ORDER BY ventas_netas DESC$/);
});

test("buildKardexWhereClause parametriza valores maliciosos", () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    const { clause, params } = buildKardexWhereClause({
      empresa: payload,
      sede: payload,
      bodegaLocal: payload,
      idItem: payload,
      idCategoria: payload,
      idLineaNivel1: payload,
      fechaDesde: "2026-06-01",
      fechaHasta: "2026-06-30",
    });

    assertSqlDoesNotEmbedPayloads(clause, SQL_INJECTION_PAYLOADS);
    assert.deepEqual(params, [
      payload,
      payload,
      payload,
      payload,
      payload,
      payload,
      "2026-06-01",
      "2026-06-30",
    ]);
    assert.match(clause, /empresa = \$1/);
    assert.match(clause, /fecha_dia BETWEEN \$7::date AND \$8::date/);
  }
});

test("parseKardexFilters rechaza fechas con sintaxis extra", () => {
  for (const badDate of [
    "2026-06-01'; DROP TABLE rotacion_base_item_dia_sede;--",
    "20260601",
    "not-a-date",
  ]) {
    assert.throws(
      () =>
        parseKardexFilters(
          new URLSearchParams({
            fechaDesde: badDate,
            fechaHasta: "2026-06-30",
          }),
        ),
      /fechaDesde|fechaHasta|Invalid|regex/i,
    );
  }
});

test("parseKardexFilters acepta texto libre en dimensiones sin meterlo en SQL", () => {
  const payload = SQL_INJECTION_PAYLOADS[0];
  const filters = parseKardexFilters(
    new URLSearchParams({
      empresa: payload,
      sede: payload,
      idItem: payload,
      fechaDesde: "2026-06-01",
      fechaHasta: "2026-06-02",
    }),
  );
  const { clause, params } = buildKardexWhereClause(filters);
  assertSqlDoesNotEmbedPayloads(clause, SQL_INJECTION_PAYLOADS);
  assert.deepEqual(params.slice(0, 3), [payload, payload, payload]);
});

test("validateVentasXItemDateRange rechaza fechas con caracteres SQL", () => {
  for (const bad of [
    "2026-06-01'; DROP TABLE ventas_item_diario;--",
    "20260406",
    "2026-06-01' OR '1'='1",
  ]) {
    const result = validateVentasXItemDateRange(bad, "2026-06-30");
    assert.equal(result.ok, false);
  }
});

test("resolveRotacionMatviewSqlStrategy solo permite estrategias conocidas", () => {
  for (const payload of SQL_INJECTION_PAYLOADS) {
    assert.equal(resolveRotacionMatviewSqlStrategy(payload), "ranked");
  }
  assert.equal(resolveRotacionMatviewSqlStrategy("hashagg"), "hashagg");
  assert.equal(resolveRotacionMatviewSqlStrategy("ranked"), "ranked");
  assert.equal(resolveRotacionMatviewSqlStrategy("item_bounds"), "hashagg");
});
