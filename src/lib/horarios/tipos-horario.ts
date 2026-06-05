// Tipos y utilidades puras para el analisis de "tipos de horario por sede y area".
// Un "tipo de horario" se deriva de las marcaciones reales (hora_entrada / hora_salida)
// de `asistencia_horas`, redondeando cada extremo a un bucket de minutos. La jornada es
// una etiqueta descriptiva (banda de horas) calculada sobre total_laborado_horas.
//
// Importante: refleja el horario DE FACTO (lo marcado), no el programado en planillas.

export const TIPOS_HORARIO_BUCKETS = [15, 30, 60] as const;
export type TipoHorarioBucket = (typeof TIPOS_HORARIO_BUCKETS)[number];

export const TIPOS_HORARIO_DEFAULT_BUCKET: TipoHorarioBucket = 30;
export const TIPOS_HORARIO_MAX_RANGE_DAYS = 366;
export const TIPOS_HORARIO_DEFAULT_TOP_N = 8;
export const TIPOS_HORARIO_MAX_TOP_N = 50;

export type TipoHorarioRow = {
  sede: string;
  departamento: string;
  /** Etiqueta del turno, p. ej. "06:00–14:00". */
  turno: string;
  entradaMin: number;
  salidaMin: number;
  /** true si la salida cae el dia siguiente (turno nocturno). */
  cruzaMedianoche: boolean;
  /** Banda de jornada derivada de las horas promedio, p. ej. "8–9h". */
  jornada: string;
  horasPromedio: number;
  diasEmpleado: number;
  empleadosDistintos: number;
  /** Porcentaje de dias-empleado del turno dentro de su sede+area (0–100). */
  pctDias: number;
};

export type TipoHorarioGrupoMeta = {
  sede: string;
  departamento: string;
  /** Total de turnos distintos detectados en la sede+area (antes de recortar a topN). */
  totalTurnos: number;
  /** Turnos efectivamente devueltos (<= totalTurnos). */
  turnosMostrados: number;
  /** Total de dias-empleado de la sede+area (incluye la cola no mostrada). */
  totalDias: number;
};

export type TiposHorarioResponse = {
  usedRange: { start: string; end: string } | null;
  bucket: number;
  topN: number;
  rows: TipoHorarioRow[];
  grupos: TipoHorarioGrupoMeta[];
  departamentos: string[];
  error?: string;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Convierte minuto-del-dia (0–1439) a "HH:MM". */
export const formatMinuteOfDay = (minuteOfDay: number): string => {
  const safe = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
};

/** Etiqueta de turno a partir de los extremos en minutos. */
export const formatTurno = (entradaMin: number, salidaMin: number): string =>
  `${formatMinuteOfDay(entradaMin)}–${formatMinuteOfDay(salidaMin)}`;

/**
 * Banda de jornada a partir de las horas diarias. Son horas REALES del dia, no el
 * tipo de contrato (medio tiempo, 36h, etc. viven en `cargo`, no en la marcacion).
 */
export const jornadaBand = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) return "sin dato";
  if (hours <= 4) return "≤4h";
  if (hours <= 6) return "4–6h";
  if (hours <= 8) return "6–8h";
  if (hours <= 9) return "8–9h";
  return ">9h";
};
