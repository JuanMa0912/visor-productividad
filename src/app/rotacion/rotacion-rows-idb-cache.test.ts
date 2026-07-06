import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRotacionRowsCacheKey } from "./rotacion-rows-idb-cache";
import { buildRotacionRowsKey } from "./rotacion-preamble";

const filterKeyFloresta = buildRotacionRowsKey({
  start: "2026-05-03",
  end: "2026-06-02",
  empresas: ["mtodo"],
  sedeIds: ["floresta"],
  lineasN1: [],
  categoriaKeys: [],
});

test("buildRotacionRowsCacheKey separa API path y filtros de sede", () => {
  const floresta = buildRotacionRowsCacheKey(
    "/api/rotacion",
    "user-a",
    filterKeyFloresta,
  );
  const floraria = buildRotacionRowsCacheKey(
    "/api/rotacion",
    "user-a",
    buildRotacionRowsKey({
      start: "2026-05-03",
      end: "2026-06-02",
      empresas: ["mtodo"],
      sedeIds: ["floraria"],
      lineasN1: [],
      categoriaKeys: [],
    }),
  );

  assert.notEqual(floresta, floraria);
  assert.match(floresta, /^\/api\/rotacion\|user-a\|/);
});

test("buildRotacionRowsCacheKey separa usuarios en el mismo browser", () => {
  assert.notEqual(
    buildRotacionRowsCacheKey("/api/rotacion", "user-a", filterKeyFloresta),
    buildRotacionRowsCacheKey("/api/rotacion", "user-b", filterKeyFloresta),
  );
});

test("buildRotacionRowsCacheKey separa rutas API distintas", () => {
  const filterKey = buildRotacionRowsKey({
    start: "2026-05-03",
    end: "2026-06-02",
    empresas: ["mtodo"],
    sedeIds: ["001"],
    lineasN1: [],
    categoriaKeys: [],
  });

  assert.notEqual(
    buildRotacionRowsCacheKey("/api/rotacion", "user-a", filterKey),
    buildRotacionRowsCacheKey("/api/otro-modulo", "user-a", filterKey),
  );
});
