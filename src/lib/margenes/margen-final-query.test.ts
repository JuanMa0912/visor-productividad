import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMargenWhereClause,
  compactDateToIso,
  isoDateToCompact,
  parseMargenFilters,
  parseSedeKey,
  sedeKey,
  toMargenPct,
} from "@/lib/margenes/margen-final-query";

test("compactDateToIso convierte YYYYMMDD", () => {
  assert.equal(compactDateToIso("20260623"), "2026-06-23");
  assert.equal(compactDateToIso("bad"), null);
});

test("isoDateToCompact convierte YYYY-MM-DD", () => {
  assert.equal(isoDateToCompact("2026-06-23"), "20260623");
  assert.equal(isoDateToCompact("2026-6-3"), null);
});

test("parseMargenFilters exige rango valido", () => {
  const params = new URLSearchParams({
    from: "2026-06-23",
    to: "2026-06-24",
    empresa: "mercamio,mtodo",
    sede: "mercamio|003",
  });
  const parsed = parseMargenFilters(params);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.fromCompact, "20260623");
  assert.equal(parsed.toCompact, "20260624");
  assert.deepEqual(parsed.empresas, ["mercamio", "mtodo"]);
  assert.deepEqual(parsed.sedes, ["mercamio|003"]);
});

test("buildMargenWhereClause agrega filtros parametrizados", () => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(
    {
      fromCompact: "20260623",
      toCompact: "20260624",
      empresas: ["mercamio"],
      sedes: [sedeKey("mercamio", "3")],
      categorias: ["4"],
      lineas: [],
      sublineas: [],
      items: [],
    },
    params,
  );
  assert.match(where, /fecha_dcto BETWEEN/);
  assert.match(where, /ANY\(\$\d+::text\[\]\)/);
  assert.equal(parseSedeKey("mercamio|003")?.idCo, "003");
  assert.equal(toMargenPct(100, 25), 25);
});
