import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMargenWhereClause,
  compactDateToIso,
  filterSedeOptionsByEmpresas,
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
      fechas: [],
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

test("filterSedeOptionsByEmpresas deja solo sedes de la empresa elegida", () => {
  const sedes = [
    { value: "mercamio|001", empresa: "mercamio", label: "Calle 5ta" },
    { value: "mercamio|002", empresa: "mercamio", label: "La 39" },
    { value: "mtodo|001", empresa: "mtodo", label: "Floresta" },
    { value: "mtodo|002", empresa: "mtodo", label: "Floralia" },
    { value: "bogota|001", empresa: "bogota", label: "Bogotá" },
  ];

  const onlyMercamio = filterSedeOptionsByEmpresas(sedes, ["mercamio"]);
  assert.deepEqual(
    onlyMercamio.map((s) => s.value),
    ["mercamio|001", "mercamio|002"],
  );

  const byKeyOnly = filterSedeOptionsByEmpresas(
    sedes.map(({ value, label }) => ({ value, label })),
    ["MERCAMIO"],
  );
  assert.deepEqual(
    byKeyOnly.map((s) => s.value),
    ["mercamio|001", "mercamio|002"],
  );

  assert.equal(filterSedeOptionsByEmpresas(sedes, []).length, sedes.length);
  assert.equal(sedeKey("mercatodo", "1"), "mtodo|001");
});
