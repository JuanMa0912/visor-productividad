import assert from "node:assert/strict";
import test from "node:test";
import {
  TIPO_CONTRATO_36H,
  TIPO_CONTRATO_COMPLETO,
  TIPO_CONTRATO_MEDIO,
  classifyContrato,
  formatMinuteOfDay,
  formatTurno,
  jornadaBand,
} from "./tipos-horario";

test("classifyContrato detecta 36 horas en distintas escrituras", () => {
  assert.equal(classifyContrato("Cajero 36 horas", "CAJAS"), TIPO_CONTRATO_36H);
  assert.equal(classifyContrato("CAJERA 36 HORAS", "CAJAS"), TIPO_CONTRATO_36H);
  assert.equal(classifyContrato("Auxiliar 36h", "CAJAS"), TIPO_CONTRATO_36H);
  assert.equal(classifyContrato("aux caja 36horas", null), TIPO_CONTRATO_36H);
});

test("classifyContrato usa departamento como apoyo cuando falta cargo", () => {
  assert.equal(classifyContrato(null, "CAJAS 36 HORAS"), TIPO_CONTRATO_36H);
  assert.equal(classifyContrato("", "Cajas"), TIPO_CONTRATO_COMPLETO);
});

test("classifyContrato detecta medio tiempo (con y sin acentos)", () => {
  assert.equal(classifyContrato("Cajero medio tiempo", "CAJAS"), TIPO_CONTRATO_MEDIO);
  assert.equal(classifyContrato("Médio Tiempo", null), TIPO_CONTRATO_MEDIO);
});

test("classifyContrato cae en tiempo completo por defecto", () => {
  assert.equal(classifyContrato("Cajero", "CAJAS"), TIPO_CONTRATO_COMPLETO);
  assert.equal(classifyContrato(null, null), TIPO_CONTRATO_COMPLETO);
});

test("classifyContrato no confunde un 36 suelto sin 'hora' ni '36h'", () => {
  // "36" presente pero sin "hora" y sin "36h" compacto => no es contrato 36h.
  assert.equal(classifyContrato("Ruta 36 norte", "Logistica"), TIPO_CONTRATO_COMPLETO);
});

test("formatMinuteOfDay y formatTurno arman etiquetas HH:MM", () => {
  assert.equal(formatMinuteOfDay(0), "00:00");
  assert.equal(formatMinuteOfDay(6 * 60 + 30), "06:30");
  // Envuelve a 24h cuando se pasa de 1440 (turno que cruza medianoche).
  assert.equal(formatMinuteOfDay(1440 + 60), "01:00");
  assert.equal(formatTurno(6 * 60, 14 * 60), "06:00–14:00");
});

test("jornadaBand etiqueta bandas de horas diarias", () => {
  assert.equal(jornadaBand(0), "sin dato");
  assert.equal(jornadaBand(5.5), "4–6h");
  assert.equal(jornadaBand(8.5), "8–9h");
  assert.equal(jornadaBand(10), ">9h");
});
