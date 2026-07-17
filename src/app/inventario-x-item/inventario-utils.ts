import type { InventarioSummaryRow } from "./types";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";

export const ALL_FILTER_VALUE = "__all__";
export const ITEM_DROPDOWN_NO_SEARCH_LIMIT = 120;
export const ITEM_DROPDOWN_SEARCH_LIMIT = 250;
/** Clave legacy en localStorage; se migra una vez al servidor por usuario. */
export const ITEM_PRESETS_STORAGE_KEY = "inventario-x-item:item-presets:v1";
export const NO_SALES_DI_VALUE = 999999;

export const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "long",
  year: "numeric",
};

export const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

/** Etiquetas de empresa como en el resto del portal (BD usa mtodo/bogota). */
export const formatInventarioEmpresaLabel = (empresa: string): string => {
  const key = empresa.trim().toLowerCase();
  if (key === "mtodo" || key === "mercatodo") return "Comercializadora";
  if (key === "bogota" || key === "merkmios") return "Merkmios";
  if (key === "mercamio") return "Mercamio";
  return empresa.trim().toUpperCase();
};

/**
 * Rango por defecto: misma regla que rotacion (`getRollingMonthBackRange`).
 * ~30/31 dias hacia atras desde el ultimo dato, acotado al minimo disponible.
 */
export const defaultRollingMonthBackRange = (
  min: string,
  max: string,
  referenceDate: Date = new Date(),
): { start: string; end: string } | null => {
  if (!max || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return null;
  const safeMin =
    min && /^\d{4}-\d{2}-\d{2}$/.test(min) ? min : max;
  return getRollingMonthBackRange(safeMin, max, referenceDate);
};

/** Detecta el default parcial mes-en-curso (dia 1 del mes del ultimo dato). */
export const isStaleMonthToDatePartialDefault = (
  start: string,
  end: string,
  availableEnd: string,
): boolean => {
  if (!availableEnd || !/^\d{4}-\d{2}-\d{2}$/.test(availableEnd)) {
    return false;
  }
  return start === `${availableEnd.slice(0, 7)}-01` && end <= availableEnd;
};

/** Detecta el default legado (mes calendario anterior completo) para refrescarlo. */
export const isStalePreviousMonthDefaultRange = (
  start: string,
  end: string,
  referenceDate: Date = new Date(),
): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return false;
  }
  const lastDayPrevMonth = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    0,
  );
  const firstDayPrevMonth = new Date(
    lastDayPrevMonth.getFullYear(),
    lastDayPrevMonth.getMonth(),
    1,
  );
  const formatYMD = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return (
    start === formatYMD(firstDayPrevMonth) && end === formatYMD(lastDayPrevMonth)
  );
};

export const compareText = (left: string, right: string) =>
  left.localeCompare(right, "es", { sensitivity: "base", numeric: true });

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

export const formatUnits = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

/** Normaliza una descripcion de item para mostrar en headers:
 *  - reemplaza `*` por espacio (asi se evita el ruido tipo "ACEITE*3000ml")
 *  - colapsa espacios repetidos
 *  - pasa todo a minusculas y capitaliza solo la primera letra (sentence case)
 *  Ej: "ACEITE MERCAMIO*3000ml SOYA" -> "Aceite mercamio 3000ml soya".
 */
export const prettifyItemDescription = (
  raw: string | null | undefined,
): string => {
  if (!raw) return "";
  const cleaned = String(raw).replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** Devuelve clases tailwind para una pildora de DI segun el rango de dias.
 * Convencion (alineada con la leyenda visual):
 *  - <15 d: rotacion alta (verde)
 *  - 15-35 d: normal (azul/celeste)
 *  - 35-60 d: revisar (amarillo)
 *  - >60 d: sobrestock (rosa/rojo)
 *  - sin venta: gris discreto.
 */
export const getDiPillClasses = (diDays: number): string => {
  if (!Number.isFinite(diDays) || diDays >= NO_SALES_DI_VALUE) {
    return "bg-slate-100 text-slate-400";
  }
  if (diDays < 15) return "bg-emerald-50 text-emerald-700";
  if (diDays < 35) return "bg-sky-50 text-sky-700";
  if (diDays < 60) return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-700";
};

export const formatDi = (value: number) => {
  if (!Number.isFinite(value)) return "Sin venta";
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} d`;
};

/** Misma formula que la API de rotacion (rotation): inv*cierre * dias_con_dato / ventas_periodo; sin ventas -> NO_SALES. */
export const calculateDiDays = (
  row: Pick<
    InventarioSummaryRow,
    "inventoryUnits" | "inventoryValue" | "totalUnits" | "trackedDays"
  >,
) => {
  if (row.inventoryUnits <= 0 || row.inventoryValue <= 0) return 0;
  if (row.totalUnits <= 0 || row.trackedDays <= 0) return NO_SALES_DI_VALUE;
  return (row.inventoryUnits * row.trackedDays) / row.totalUnits;
};

export type InventarioMatrixItemTotals = {
  inventoryUnits: number;
  inventoryValue: number;
  soldUnits: number;
  trackedDays: number;
};

/** DI del total de matriz: recalcula con inventario y vendido agregados, no suma DI por sede. */
export const calculateMatrixItemTotalDiDays = (
  totals: InventarioMatrixItemTotals,
): number =>
  calculateDiDays({
    inventoryUnits: totals.inventoryUnits,
    inventoryValue: totals.inventoryValue,
    totalUnits: totals.soldUnits,
    trackedDays: totals.trackedDays,
  });

export const buildSedeOptionValue = (empresa: string, sedeId: string) =>
  `${encodeURIComponent(empresa)}::${encodeURIComponent(sedeId)}`;

export const parseSedeOptionValue = (
  value: string,
): { empresa: string; sedeId: string } | null => {
  const [empresaPart, sedePart] = value.split("::");
  if (!empresaPart || !sedePart) return null;
  try {
    return {
      empresa: decodeURIComponent(empresaPart),
      sedeId: decodeURIComponent(sedePart),
    };
  } catch {
    return null;
  }
};
