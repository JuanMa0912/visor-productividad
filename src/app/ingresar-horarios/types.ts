export type DayKey =
  | "domingo"
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado";

export type DaySchedule = {
  he1: string;
  hs1: string;
  he2: string;
  hs2: string;
  conDescanso: boolean;
};

export type RowSchedule = {
  nombre: string;
  firma: string;
  days: Record<DayKey, DaySchedule>;
};

export type ScheduleDraft = {
  version: number;
  sede: string;
  seccion: string;
  fechaInicial: string;
  fechaFinal: string;
  mes: string;
  rows: RowSchedule[];
  updatedAt: string;
  /** Replicar horarios del lunes al resto de dias (por fila) */
  syncLunesToRest?: boolean;
  /** Por fila, dias que el usuario edito aparte y no deben pisarse desde lunes */
  lunesIndependentByRow?: Record<string, DayKey[]>;
};
