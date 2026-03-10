import { LineMetrics } from "../types";

// Líneas que NO tienen datos de horas en asistencia_horas
// Todas las líneas principales ahora tienen datos de horas
const linesWithoutLaborData = new Set<string>([]);

export const hasLaborDataForLine = (lineId: string) =>
  !linesWithoutLaborData.has(lineId);

export const formatCOP = (value: number) => {
  const inThousands = Math.round(value / 1000);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(inThousands);
};


export const formatHours = (value: number) => {
  return value.toFixed(2);
};

export const formatPercent = (value: number) => {
  return new Intl.NumberFormat("es-CO", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
};

export const calcLineCost = (line: LineMetrics) => {
  if (!hasLaborDataForLine(line.id)) {
    return 0;
  }
  return line.hours * line.hourlyRate;
};

export const calcLineMargin = (line: LineMetrics) => {
  if (!hasLaborDataForLine(line.id)) {
    return 0;
  }
  return line.sales - calcLineCost(line);
};

// m2 por sede (según la lista compartida en este chat)
const SEDE_M2: Record<string, number> = {
  "Calle 5ta": 6300.44,
  Floresta: 5906.38,
  "Calle 39": 2788.32,
  Floralia: 3284.09,
  "Plaza Norte": 3468.51,
  Guaduales: 2536.09,
  "La 80": 3952.6,
  "Ciudad Jardín": 1891.13,
  Palmira: 1375.02,
};

export type SedeSizeBucket = "lt_1000" | "gte_1000" | "unknown";

export const getSedeM2 = (sedeName: string): number | null => {
  const value = SEDE_M2[sedeName];
  return typeof value === "number" ? value : null;
};

export const getSedeSizeBucket = (sedeName: string): SedeSizeBucket => {
  const m2 = getSedeM2(sedeName);
  if (m2 == null) return "unknown";
  return m2 < 1000 ? "lt_1000" : "gte_1000";
};


