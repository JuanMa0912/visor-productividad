import type { DriveStep } from "driver.js";

const PREFIX = "jornada-tour";

export const JORNADA_TOUR_ANCHOR = {
  intro: `${PREFIX}-intro`,
  alexBoard: `${PREFIX}-alex-board`,
  hourly: `${PREFIX}-hourly`,
  tiposHorario: `${PREFIX}-tipos-horario`,
} as const;

export const jornadaTourSelector = (id: string): string => `#${id}`;

export const JORNADA_TOUR_STEPS: DriveStep[] = [
  {
    element: jornadaTourSelector(JORNADA_TOUR_ANCHOR.intro),
    popover: {
      title: "Consulta operativa",
      description:
        "Horarios, jornadas extendidas y novedades de marcación por sede en un solo módulo.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: jornadaTourSelector(JORNADA_TOUR_ANCHOR.alexBoard),
    popover: {
      title: "Tablero de tiempos",
      description:
        "Resumen de +7:20h con 2 marcas, 9:20h, marcaciones impares e inasistencias. Filtra por fechas, sede y departamento.",
      side: "top",
      align: "start",
    },
  },
  {
    element: jornadaTourSelector(JORNADA_TOUR_ANCHOR.hourly),
    popover: {
      title: "Detalle por hora",
      description:
        "Profundiza en horas extra y marcaciones con filtros de sede, departamento y rango de fechas.",
      side: "top",
      align: "start",
    },
  },
  {
    element: jornadaTourSelector(JORNADA_TOUR_ANCHOR.tiposHorario),
    popover: {
      title: "Tipos de horario",
      description:
        "Consulta y administra los tipos de horario configurados por sede y área.",
      side: "left",
      align: "end",
    },
  },
];
