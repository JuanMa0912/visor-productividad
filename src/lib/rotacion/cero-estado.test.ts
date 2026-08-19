import assert from "node:assert/strict";
import test from "node:test";
import {
  countCeroRotacionEstados,
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
} from "./cero-estado";

test("cuenta sin verificar, seguimiento y surtido; el default es sin verificar", () => {
  const a = { empresa: "mercamio", sedeId: "001", item: "10" };
  const b = { empresa: "mercamio", sedeId: "001", item: "20" };
  const c = { empresa: "mercamio", sedeId: "001", item: "30" };
  const d = { empresa: "mercamio", sedeId: "001", item: "40" };
  const counts = countCeroRotacionEstados(
    [a, b, c, d],
    {
      [makeCeroRotacionEstadoKey(a.empresa, a.sedeId, a.item)]: "surtido",
      [makeCeroRotacionEstadoKey(b.empresa, b.sedeId, b.item)]: "seguimiento",
      [makeCeroRotacionEstadoKey(c.empresa, c.sedeId, c.item)]: "sin_verificar",
    },
  );
  assert.equal(counts.sin_verificar, 2);
  assert.equal(counts.seguimiento, 1);
  assert.equal(counts.surtido, 1);
  assert.equal(DEFAULT_CERO_ROTACION_ESTADO, "sin_verificar");
});
