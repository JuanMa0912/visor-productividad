import assert from "node:assert/strict";
import test from "node:test";
import {
  OC_SLA_DAYS,
  ocFlags,
  ocMatchesVista,
  ocPrimaryBadge,
  yyyymmddAddDays,
  yyyymmddDiffDays,
} from "./status";

test("SLA son 7 dias calendario", () => {
  assert.equal(OC_SLA_DAYS, 7);
  assert.equal(yyyymmddAddDays("20260801", 7), "20260808");
  assert.equal(yyyymmddAddDays("20260825", 7), "20260901");
  assert.equal(yyyymmddDiffDays("20260801", "20260808"), 7);
  assert.equal(yyyymmddDiffDays("20260813", "20260808"), -5);
});

test("cumplida por estado 2 o cantidad recibida", () => {
  const a = ocFlags({
    indEstado: "2",
    cantidad: 10,
    cantidadEnt: 0,
    fechaDcto: "20260801",
    todayYyyymmdd: "20260813",
  });
  assert.equal(a.cumplida, true);
  assert.equal(ocPrimaryBadge(a), "cumplida");

  const b = ocFlags({
    indEstado: "1",
    cantidad: 10,
    cantidadEnt: 10,
    fechaDcto: "20260801",
    todayYyyymmdd: "20260813",
  });
  assert.equal(b.cumplida, true);
});

test("incompleta: llego algo pero no todo", () => {
  const flags = ocFlags({
    indEstado: "1",
    cantidad: 100,
    cantidadEnt: 40,
    fechaDcto: "20260810",
    todayYyyymmdd: "20260813",
  });
  assert.equal(flags.incompleta, true);
  assert.equal(flags.pendiente, false);
  assert.equal(flags.vencidaSla, false);
  assert.equal(ocPrimaryBadge(flags), "incompleta");
  assert.equal(ocMatchesVista(flags, "incompletas", "20260810", "20260812"), true);
  assert.equal(ocMatchesVista(flags, "abiertas", "20260810", "20260812"), true);
});

test("vencida SLA: fecha_dcto + 7 < hoy y no cumplida", () => {
  const flags = ocFlags({
    indEstado: "1",
    cantidad: 50,
    cantidadEnt: 0,
    fechaDcto: "20260801",
    todayYyyymmdd: "20260813",
  });
  assert.equal(flags.vencidaSla, true);
  assert.equal(flags.pendiente, true);
  assert.equal(ocPrimaryBadge(flags), "vencida");
});

test("a tiempo: dentro de 7 dias y sin reciba", () => {
  const flags = ocFlags({
    indEstado: "1",
    cantidad: 50,
    cantidadEnt: 0,
    fechaDcto: "20260810",
    todayYyyymmdd: "20260813",
  });
  assert.equal(flags.aTiempo, true);
  assert.equal(flags.vencidaSla, false);
  assert.equal(ocPrimaryBadge(flags), "pendiente");
});
