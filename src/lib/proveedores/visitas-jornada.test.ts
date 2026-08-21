import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  qrVisitaCierreJornadaSql,
  visitaJornadaCierreAt,
} from "@/lib/proveedores/visitas-jornada";

describe("proveedores visitas-jornada", () => {
  it("cierra a las 21:00 Bogotá si entró de día", () => {
    const entrada = new Date("2026-08-20T13:00:00.000Z"); // 08:00 Bogotá
    const cierre = visitaJornadaCierreAt(entrada);
    assert.equal(cierre.toISOString(), "2026-08-21T02:00:00.000Z"); // 21:00 Bogotá
  });

  it("si entra después de las 21:00, cierra 15 minutos después", () => {
    const entrada = new Date("2026-08-21T02:30:00.000Z"); // 21:30 Bogotá
    const cierre = visitaJornadaCierreAt(entrada);
    assert.equal(cierre.toISOString(), "2026-08-21T02:45:00.000Z");
  });

  it("SQL de cierre usa jornada Bogotá, no UTC", () => {
    const sql = qrVisitaCierreJornadaSql("entrada_at");
    assert.match(sql, /America\/Bogota/);
    assert.match(sql, /21:00/);
    assert.match(sql, /15 minutes/);
  });
});
