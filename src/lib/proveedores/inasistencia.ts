/** Unidades que una persona surte en una hora (mismo factor HL de OIPV). */
export const INASISTENCIA_UNIDADES_POR_HORA = 350;
/** Horas de una jornada laboral. Personas = horas ÷ 7. */
export const INASISTENCIA_HORAS_POR_JORNADA = 7;

const UNIDADES_POR_PERSONA_DIA =
  INASISTENCIA_UNIDADES_POR_HORA * INASISTENCIA_HORAS_POR_JORNADA;

const finiteOrZero = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

/** Horas necesarias para surtir las unidades: und ÷ 350. */
export const inasistenciaHorasFromUnidades = (unidades: number): number =>
  finiteOrZero(unidades) / INASISTENCIA_UNIDADES_POR_HORA;

/**
 * Personas para surtir esas unidades en una jornada:
 * und ÷ 350 ÷ 7 (horas ÷ jornada).
 */
export const inasistenciaPersonasFromUnidades = (unidades: number): number =>
  finiteOrZero(unidades) / UNIDADES_POR_PERSONA_DIA;

export type InasistenciaBreakdown = {
  unidades: number;
  horas: number;
  jornadas: number;
  personas: number;
};

export const inasistenciaFromUnidades = (
  unidades: number,
): InasistenciaBreakdown => {
  const safe = finiteOrZero(unidades);
  const horas = inasistenciaHorasFromUnidades(safe);
  const jornadas = horas / INASISTENCIA_HORAS_POR_JORNADA;
  const personas = inasistenciaPersonasFromUnidades(safe);
  return { unidades: safe, horas, jornadas, personas };
};
