import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRotacionRowsCacheKey } from "./rotacion-rows-idb-cache";
import { buildRotacionRowsKey } from "./rotacion-preamble";

test("buildRotacionRowsCacheKey separa API path y filtros de sede", () => {
  const floresta = buildRotacionRowsCacheKey(
    "/api/rotacion",
    buildRotacionRowsKey({
      start: "2026-05-03",
      end: "2026-06-02",
      empresas: ["mtodo"],
      sedeIds: ["floresta"],
      lineasN1: [],
      categoriaKeys: [],
    }),
  );
  const floraria = buildRotacionRowsCacheKey(
    "/api/rotacion",
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
  assert.match(floresta, /^\/api\/rotacion\|/);
});

test("buildRotacionRowsCacheKey separa rotacion y rotacion-dos", () => {
  const filterKey = buildRotacionRowsKey({
    start: "2026-05-03",
    end: "2026-06-02",
    empresas: ["mtodo"],
    sedeIds: ["001"],
    lineasN1: [],
    categoriaKeys: [],
  });

  assert.notEqual(
    buildRotacionRowsCacheKey("/api/rotacion", filterKey),
    buildRotacionRowsCacheKey("/api/rotacion-dos", filterKey),
  );
});
