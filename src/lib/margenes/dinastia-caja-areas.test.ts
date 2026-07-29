import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendDinastiaCajaAreaSql,
  parseDinastiaCajaAreas,
  resolveDinastiaCajaArea,
} from "@/lib/margenes/dinastia-caja-areas";
import { buildMargenWhereForTable } from "@/lib/margenes/margen-data-source";
import { parseMargenFilters } from "@/lib/margenes/margen-final-query";

describe("dinastia caja areas", () => {
  it("parsea y ordena áreas", () => {
    assert.deepEqual(parseDinastiaCajaAreas("call_center,mayorista"), [
      "mayorista",
      "call_center",
    ]);
    assert.deepEqual(parseDinastiaCajaAreas("detal,detal,foo"), ["detal"]);
    assert.deepEqual(parseDinastiaCajaAreas(""), []);
  });

  it("clasifica código de caja", () => {
    assert.equal(resolveDinastiaCajaArea("05"), "mayorista");
    assert.equal(resolveDinastiaCajaArea("11"), "detal");
    assert.equal(resolveDinastiaCajaArea("Caja 35"), "call_center");
    assert.equal(resolveDinastiaCajaArea("99"), null);
  });

  it("arma SQL de rangos", () => {
    const parts: string[] = [];
    const params: unknown[] = [];
    appendDinastiaCajaAreaSql(parts, params, ["mayorista", "detal"]);
    assert.equal(parts.length, 1);
    assert.match(parts[0]!, /BETWEEN/);
    assert.deepEqual(params, [1, 10, 11, 30]);
  });
});

describe("margen filters cajaArea", () => {
  it("parsea cajaArea solo Dinastia en query", () => {
    const parsed = parseMargenFilters(
      new URLSearchParams({
        from: "2026-06-01",
        to: "2026-06-30",
        cajaArea: "mayorista,call_center",
      }),
    );
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    assert.deepEqual(parsed.cajaAreas, ["mayorista", "call_center"]);
  });

  it("aplica filtro solo en tablas dinastia", () => {
    const base = {
      fromCompact: "20260601",
      toCompact: "20260630",
      fechas: [] as string[],
      empresas: ["dinastia"],
      sedes: [] as string[],
      categorias: [] as string[],
      lineas: [] as string[],
      sublineas: [] as string[],
      items: [] as string[],
      cajaAreas: ["mayorista" as const],
    };
    const paramsDinastia: unknown[] = [];
    const whereDinastia = buildMargenWhereForTable(
      base,
      paramsDinastia,
      "margen_dinastia",
    );
    assert.match(whereDinastia, /id_caja/);
    assert.ok(paramsDinastia.includes(1) && paramsDinastia.includes(10));

    const paramsFinal: unknown[] = [];
    buildMargenWhereForTable(base, paramsFinal, "margen_final");
    assert.equal(paramsFinal.includes(1) && paramsFinal.includes(10), false);
  });
});
