import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estadoAsistenciaToneClass,
  isIncidenceEstado,
  isRestDayWorkedEstado,
} from "@/components/hourly-analysis/overtime-sede-utils";

/**
 * Valores REALES de `asistencia_horas.estado_asistencia`, medidos en la 232 sobre los
 * ultimos 30 dias (2026-08-11). Escritos tal cual salen de la base, CON tilde:
 *
 *   Laborado                 28.736
 *   Inasistencia                954
 *   Laborado con Incidencia     353
 *   Día descanso laborado        91
 */
const LABORADO = "Laborado";
const INASISTENCIA = "Inasistencia";
const CON_INCIDENCIA = "Laborado con Incidencia";
const DESCANSO = "Día descanso laborado";

describe("isRestDayWorkedEstado", () => {
  it("detecta el descanso laborado pese a la tilde de 'Día'", () => {
    assert.equal(isRestDayWorkedEstado(DESCANSO), true);
  });

  it("no confunde los demas estados", () => {
    for (const estado of [LABORADO, INASISTENCIA, CON_INCIDENCIA]) {
      assert.equal(isRestDayWorkedEstado(estado), false, estado);
    }
  });

  it("tolera vacios", () => {
    assert.equal(isRestDayWorkedEstado(null), false);
    assert.equal(isRestDayWorkedEstado(undefined), false);
    assert.equal(isRestDayWorkedEstado(""), false);
  });
});

describe("isIncidenceEstado", () => {
  it("acierta con 'Incidencia', que es lo que dice la base", () => {
    // REGRESION: el color de la columna Estado comparaba contra "incidente", palabra
    // que NO aparece en ningun valor real. Por eso nunca acertaba.
    assert.equal(isIncidenceEstado(CON_INCIDENCIA), true);
    assert.equal(CON_INCIDENCIA.toLowerCase().includes("incidente"), false);
  });

  it("tambien aceptaria variantes tipo 'Incidente'", () => {
    assert.equal(isIncidenceEstado("Laborado con Incidente"), true);
    assert.equal(isIncidenceEstado("INCIDENTES"), true);
  });

  it("no marca los estados sin incidencia", () => {
    for (const estado of [LABORADO, INASISTENCIA, DESCANSO]) {
      assert.equal(isIncidenceEstado(estado), false, estado);
    }
  });
});

describe("estadoAsistenciaToneClass", () => {
  it("da un color DISTINTO a cada uno de los 4 estados reales", () => {
    const tonos = [LABORADO, INASISTENCIA, CON_INCIDENCIA, DESCANSO].map(
      estadoAsistenciaToneClass,
    );
    assert.equal(new Set(tonos).size, 4, `tonos repetidos: ${tonos.join(", ")}`);
  });

  it("el descanso laborado NO comparte el verde de un dia normal", () => {
    // Es el bug que se reporto como "se sube pero no se muestra": "Día descanso
    // laborado" contiene "laborado", asi que sin una rama propia caia en el mismo
    // emerald que "Laborado" y era indistinguible entre ~1.100 filas.
    assert.notEqual(
      estadoAsistenciaToneClass(DESCANSO),
      estadoAsistenciaToneClass(LABORADO),
    );
    assert.equal(estadoAsistenciaToneClass(DESCANSO), "text-indigo-700");
  });

  it("la incidencia se resalta en ambar, no en verde", () => {
    assert.equal(estadoAsistenciaToneClass(CON_INCIDENCIA), "text-amber-700");
    assert.notEqual(
      estadoAsistenciaToneClass(CON_INCIDENCIA),
      estadoAsistenciaToneClass(LABORADO),
    );
  });

  it("laborado normal en verde y desconocidos en gris", () => {
    assert.equal(estadoAsistenciaToneClass(LABORADO), "text-emerald-700");
    assert.equal(estadoAsistenciaToneClass(INASISTENCIA), "text-slate-700");
    assert.equal(estadoAsistenciaToneClass(""), "text-slate-700");
    assert.equal(estadoAsistenciaToneClass(null), "text-slate-700");
  });

  it("el orden importa: descanso se evalua antes que laborado", () => {
    // Si se invirtiera, "Día descanso laborado" caeria en la rama de "laborado".
    assert.equal(estadoAsistenciaToneClass("Día descanso laborado"), "text-indigo-700");
  });
});
