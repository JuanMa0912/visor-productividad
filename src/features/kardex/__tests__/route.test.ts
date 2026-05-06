import assert from "node:assert/strict";
import test from "node:test";
import { parseKardexFilters } from "../schema";

test("parsea query params validos de kardex", () => {
  const params = new URLSearchParams({
    empresa: "mtodo",
    sede: "001",
    fechaDesde: "2026-04-05",
    fechaHasta: "2026-05-04",
  });
  const parsed = parseKardexFilters(params);

  assert.equal(parsed.empresa, "mtodo");
  assert.equal(parsed.sede, "001");
  assert.equal(parsed.fechaDesde, "2026-04-05");
  assert.equal(parsed.fechaHasta, "2026-05-04");
});

test("rechaza rango con fechaDesde mayor que fechaHasta", () => {
  const params = new URLSearchParams({
    fechaDesde: "2026-05-05",
    fechaHasta: "2026-05-04",
  });
  assert.throws(() => parseKardexFilters(params));
});
