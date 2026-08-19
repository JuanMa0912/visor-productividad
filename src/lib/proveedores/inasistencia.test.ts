import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INASISTENCIA_DIAS_MES,
  INASISTENCIA_HORAS_POR_JORNADA,
  INASISTENCIA_UNIDADES_POR_HORA,
  inasistenciaFromUnidades,
  inasistenciaHorasFromUnidades,
  inasistenciaPersonasFromUnidades,
} from "@/lib/proveedores/inasistencia";

describe("inasistenciaFromUnidades", () => {
  it("350 und = 1 hora; 7 horas = 1 jornada; 30 jornadas = 1 persona", () => {
    assert.equal(inasistenciaHorasFromUnidades(350), 1);
    assert.equal(
      inasistenciaPersonasFromUnidades(
        INASISTENCIA_UNIDADES_POR_HORA *
          INASISTENCIA_HORAS_POR_JORNADA *
          INASISTENCIA_DIAS_MES,
      ),
      1,
    );
    const onePerson = inasistenciaFromUnidades(73_500);
    assert.equal(onePerson.horas, 210);
    assert.equal(onePerson.jornadas, 30);
    assert.equal(onePerson.personas, 1);
  });

  it("trata ceros y no finitos como 0", () => {
    assert.equal(inasistenciaPersonasFromUnidades(0), 0);
    assert.equal(inasistenciaPersonasFromUnidades(-10), 0);
    assert.equal(inasistenciaHorasFromUnidades(Number.NaN), 0);
  });
});
