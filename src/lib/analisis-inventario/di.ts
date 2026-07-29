/** Sin venta en el periodo: mismo centinela que inventario-x-item. */
export const NO_SALES_DI_VALUE = 999999;

export type DiMetricsInput = {
  inventoryUnits: number;
  inventoryValue: number;
  soldUnits: number;
  costOfSales: number;
  trackedDays: number;
};

export type DiMetrics = {
  diUnits: number;
  diValue: number;
};

/**
 * DI unidades = inv_cierre × dias / unidades_vendidas.
 * DI valor = inv_valor_cierre × dias / costo_de_venta.
 * Sin movimiento de venta/costo → NO_SALES; inventario cero → 0.
 */
export const calculateDiMetrics = (input: DiMetricsInput): DiMetrics => {
  const trackedDays = Math.max(0, Number(input.trackedDays) || 0);
  const inventoryUnits = Math.max(0, Number(input.inventoryUnits) || 0);
  const inventoryValue = Math.max(0, Number(input.inventoryValue) || 0);
  const soldUnits = Math.max(0, Number(input.soldUnits) || 0);
  const costOfSales = Math.max(0, Number(input.costOfSales) || 0);

  const diUnits =
    inventoryUnits <= 0
      ? 0
      : soldUnits <= 0 || trackedDays <= 0
        ? NO_SALES_DI_VALUE
        : (inventoryUnits * trackedDays) / soldUnits;

  const diValue =
    inventoryValue <= 0
      ? 0
      : costOfSales <= 0 || trackedDays <= 0
        ? NO_SALES_DI_VALUE
        : (inventoryValue * trackedDays) / costOfSales;

  return { diUnits, diValue };
};

export const formatDiDays = (value: number): string => {
  if (!Number.isFinite(value) || value >= NO_SALES_DI_VALUE) return "Sin venta";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} d`;
};

/** Días calendario inclusive del rango consultado (misma base que rotación). */
export const calendarDaysInclusive = (start: string, end: string): number => {
  const from = new Date(`${start}T12:00:00`);
  const to = new Date(`${end}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return Math.max(0, diff + 1);
};

/** Bandas alineadas a inventario-x-item. */
export type DiBand = "alta" | "normal" | "revisar" | "sobrestock" | "sin-venta" | "cero";

export const resolveDiBand = (diDays: number): DiBand => {
  if (!Number.isFinite(diDays) || diDays >= NO_SALES_DI_VALUE) return "sin-venta";
  if (diDays <= 0) return "cero";
  if (diDays < 15) return "alta";
  if (diDays < 35) return "normal";
  if (diDays < 60) return "revisar";
  return "sobrestock";
};

export const DI_BAND_LABELS: Record<DiBand, string> = {
  alta: "< 15 d · rotación alta",
  normal: "15–35 d · normal",
  revisar: "35–60 d · revisar",
  sobrestock: "> 60 d · sobrestock",
  "sin-venta": "Sin venta",
  cero: "Sin inventario",
};

/** Colores de mapa de calor (fondo / texto). */
export const diHeatmapStyle = (
  diDays: number,
): { background: string; color: string } => {
  const band = resolveDiBand(diDays);
  switch (band) {
    case "alta":
      return { background: "rgba(16, 185, 129, 0.28)", color: "#065f46" };
    case "normal":
      return { background: "rgba(56, 189, 248, 0.28)", color: "#075985" };
    case "revisar":
      return { background: "rgba(251, 191, 36, 0.35)", color: "#92400e" };
    case "sobrestock":
      return { background: "rgba(244, 63, 94, 0.28)", color: "#9f1239" };
    case "cero":
      return { background: "#f8fafc", color: "#94a3b8" };
    case "sin-venta":
    default:
      return { background: "#e2e8f0", color: "#64748b" };
  }
};

export const diPillClassName = (diDays: number): string => {
  const band = resolveDiBand(diDays);
  switch (band) {
    case "alta":
      return "bg-emerald-50 text-emerald-700";
    case "normal":
      return "bg-sky-50 text-sky-700";
    case "revisar":
      return "bg-amber-100 text-amber-800";
    case "sobrestock":
      return "bg-rose-100 text-rose-700";
    case "cero":
      return "bg-slate-50 text-slate-400";
    case "sin-venta":
    default:
      return "bg-slate-100 text-slate-500";
  }
};
