import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import type { InformeMetric } from "@/lib/informe-variacion/types";

const nfU = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });
const nfMoney = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export const metricOffset = (metric: InformeMetric): number =>
  metric === "u" ? 5 : 8;

export const formatInformeValue = (
  value: number,
  metric: InformeMetric,
): string => {
  if (metric === "u") return nfU.format(value);
  return `$${nfMoney.format(Math.round(value / 1000))}`;
};

export const formatInformeValueRaw = (
  value: number,
  metric: InformeMetric,
): number => (metric === "u" ? value : Math.round(value / 1000));

/** Etiqueta de unidad en filas de detalle Actual / YoY / MoM de la matriz. */
export const informeMetricDetailLabel = (
  metric: InformeMetric,
  options?: {
    pollosUnd?: boolean;
    huevosUnd?: boolean;
    unitLabel?: string;
  },
): string => {
  if (metric === "v") return "$ miles";
  if (options?.pollosUnd) return "pollos und";
  if (options?.huevosUnd) return "huevos und";
  if (options?.unitLabel) return options.unitLabel;
  return "unidades";
};

export const formatInformePct = (pct: number | null): string => {
  if (pct === null) return "N/D";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
};

export const formatMargenPct = (ventas: number, margenPesos: number): string => {
  if (ventas <= 0) return "—";
  return `${((margenPesos / ventas) * 100).toFixed(1)}%`;
};

export const margenPctValue = (ventas: number, margenPesos: number): number | null => {
  if (ventas <= 0) return null;
  return (margenPesos / ventas) * 100;
};

export const computeVariationPct = (
  current: number,
  previous: number,
): number | null => {
  if (previous === 0 || previous === null) return null;
  return (current / previous - 1) * 100;
};

/** Ordenamiento de columnas en tablas sede / arbol. */
export const comparePeriodTriple = (values: PeriodTriple, col: string): number => {
  switch (col) {
    case "cur":
    case "part":
      return values[0];
    case "yoy":
      return values[2];
    case "mom":
      return values[1];
    case "yoypct":
      return values[2] > 0 ? values[0] / values[2] - 1 : values[0] > 0 ? Infinity : -Infinity;
    case "mompct":
      return values[1] > 0 ? values[0] / values[1] - 1 : values[0] > 0 ? Infinity : -Infinity;
    default:
      return 0;
  }
};

export type VariationChipKind = "positive" | "negative" | "neutral" | "new";

export const resolveVariationChip = (
  current: number,
  previous: number,
  yoyOk = true,
): { kind: VariationChipKind; label: string } => {
  if (!yoyOk) return { kind: "neutral", label: "N/D" };
  if (previous === 0) {
    if (current === 0) return { kind: "neutral", label: "—" };
    return { kind: "new", label: "Nuevo" };
  }
  const pct = computeVariationPct(current, previous);
  if (pct === null) return { kind: "neutral", label: "N/D" };
  return {
    kind: pct >= 0 ? "positive" : "negative",
    label: formatInformePct(pct),
  };
};

export const variationPctLabel = (
  current: number,
  previous: number,
  yoyOk = true,
): string => resolveVariationChip(current, previous, yoyOk).label;

export const variationPctNumber = (
  current: number,
  previous: number,
): number | null => computeVariationPct(current, previous);

export const matrixValueCellStyle = (): { background: string; color: string } => ({
  background: "#f8fafc",
  color: "#1e293b",
});

export const heatmapCellStyle = (
  pct: number | null,
  notAvailable = false,
): { background: string; color: string } => {
  if (notAvailable || pct === null) {
    return { background: "#eef0f4", color: "#9aa3b2" };
  }
  const cap = Math.max(-40, Math.min(40, pct));
  const alpha = Math.min(0.85, (Math.abs(cap) / 40) * 0.85 + 0.06);
  if (pct >= 0) {
    return {
      background: `rgba(14,138,77,${alpha.toFixed(2)})`,
      color: alpha > 0.45 ? "#fff" : "#0e6b3d",
    };
  }
  return {
    background: `rgba(198,40,56,${alpha.toFixed(2)})`,
    color: alpha > 0.45 ? "#fff" : "#a01f2d",
  };
};
