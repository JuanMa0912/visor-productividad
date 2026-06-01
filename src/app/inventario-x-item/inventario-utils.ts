import type { InventarioSummaryRow } from "./types";

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

/**
 * Rango por defecto: MES CALENDARIO ANTERIOR COMPLETO (dia 1 → ultimo dia),
 * acotado a los datos disponibles. Misma logica que `/rotacion` para mantener
 * consistencia entre ambos modulos. La longitud varia segun los dias del mes:
 *   - Hoy = 2026-06-01 → May 01 .. May 31 (31 dias).
 *   - Hoy = 2026-07-15 → Jun 01 .. Jun 30 (30 dias).
 *   - Hoy = 2026-03-10 → Feb 01 .. Feb 28 (28 dias).
 *
 * Antes calculaba "max menos un mes calendario + 1 dia". Eso terminaba dando
 * SIEMPRE 30 dias por overflow de `Date.setMonth()` en meses cortos (p.ej.
 * May 31 → April 31 no existe → desborda a May 1 → +1 dia → May 2 → solo
 * 30 dias en vez de 31).
 *
 * Devuelve `null` si `max` no es valido (sin datos para calcular el rango).
 */
export const defaultRollingMonthBackRange = (
  min: string,
  max: string,
): { start: string; end: string } | null => {
  if (!max || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return null;

  const formatYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const today = new Date();
  // `new Date(y, m, 0)` devuelve el ultimo dia del mes m-1 (truco clasico
  // de la API de Date: el dia 0 de un mes es el ultimo del mes anterior).
  const lastDayPrevMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    0,
  );
  const firstDayPrevMonth = new Date(
    lastDayPrevMonth.getFullYear(),
    lastDayPrevMonth.getMonth(),
    1,
  );

  let end = formatYMD(lastDayPrevMonth);
  let start = formatYMD(firstDayPrevMonth);

  // Acotamos a los datos realmente disponibles. Comparar strings funciona
  // porque YYYY-MM-DD ordena alfabeticamente igual que cronologicamente.
  if (end > max) end = max;
  if (min && /^\d{4}-\d{2}-\d{2}$/.test(min)) {
    if (start < min) start = min;
    if (end < min) end = min;
  }
  if (start > end) start = end;

  return { start, end };
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
