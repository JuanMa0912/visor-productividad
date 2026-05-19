import {
  CERO_ROTACION_ESTADO_SORT_ORDER,
  CERO_ROTACION_ESTADO_VALUES,
  type CeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import { mapRawSedeToCanonical } from "@/lib/horarios/planilla-sede";
import { formatDateLabel } from "@/lib/shared/utils";

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

type DateRange = {
  start: string;
  end: string;
};

type RotationRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  linea: string;
  lineaN1Codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  bodega: string | null;
  nombreBodega: string | null;
  categoria: string | null;
  nombreCategoria: string | null;
  linea01: string | null;
  nombreLinea01: string | null;
  totalSales: number;
  totalCost: number;
  totalMargin: number;
  marginDailyAvgPct: number;
  totalUnits: number;
  openingInventoryUnits: number;
  minInventoryUnits: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  salesEffectiveDays: number;
  lastMovementDate: string | null;
  lastPurchaseDate: string | null;
  effectiveDays: number | null;
  status: "Agotado" | "Futuro agotado" | "Baja rotacion" | "En seguimiento";
};

type RotationCategoriaFilterOption = {
  categoriaKey: string;
  nombreCategoria: string | null;
};

type RotationApiResponse = {
  rows: RotationRow[];
  stats: {
    evaluatedSedes: number;
    visibleItems: number;
    withoutMovement: number;
  };
  filters: {
    companies: string[];
    sedes: Array<{
      empresa: string;
      sedeId: string;
      sedeName: string;
    }>;
    lineasN1: string[];
    /** Nombre legible por codigo N1 (desde API / BD). */
    lineasN1Nombres?: Record<string, string>;
    categorias: RotationCategoriaFilterOption[];
    lineasN1PorCategoria: Record<string, string[]>;
  };
  meta: {
    effectiveRange: DateRange;
    availableRange: { min: string; max: string };
    sourceTable: string;
    maxSalesValue: number | null;
    abcdConfig?: {
      aUntilPercent: number;
      bUntilPercent: number;
      cUntilPercent: number;
    };
  };
  message?: string;
  error?: string;
};

type RotationCatalogSnapshot = {
  filters: RotationApiResponse["filters"];
  meta?: RotationApiResponse["meta"];
};

type LineaN1Option = {
  value: string;
  label: string;
  shortName?: string;
};

type LineaN1FamilyKey = "perecederos" | "manufactura";

const ALL_LINEA_N1_FAMILY_KEYS: LineaN1FamilyKey[] = [
  "perecederos",
  "manufactura",
];

const LINEA_N1_FAMILY_LABELS: Record<LineaN1FamilyKey, string> = {
  perecederos: "Perecederos",
  manufactura: "Manufactura",
};

const matchesLineaN1Family = (
  value: string,
  keys: Set<LineaN1FamilyKey>,
): boolean => {
  const code = normalizeLineaN1CodeForFilter(value);
  const isPerecedero = PERECEDEROS_LINEAS_N1.has(code);
  if (keys.has("perecederos") && isPerecedero) return true;
  if (keys.has("manufactura") && !isPerecedero) return true;
  return false;
};

type AbcdConfig = {
  aUntilPercent: number;
  bUntilPercent: number;
  cUntilPercent: number;
};
type AbcdCategory = "A" | "B" | "C" | "D";
/** "all" = sin filtro ABCD; "0"/"S" = modos especiales; arreglo = union de clases A-D. */
type GroupAbcdFilter = "all" | "0" | "S" | "R" | "N" | AbcdCategory[];

const ABCD_FILTER_LETTERS_ORDER: AbcdCategory[] = ["A", "B", "C", "D"];

const normalizeAbcdLetterSelection = (
  letters: readonly AbcdCategory[],
): AbcdCategory[] =>
  ABCD_FILTER_LETTERS_ORDER.filter((letter) => letters.includes(letter));

const toggleAbcdLetterFilter = (
  current: GroupAbcdFilter,
  letter: AbcdCategory,
): GroupAbcdFilter => {
  if (current === "0" || current === "S" || current === "R" || current === "N") {
    return normalizeAbcdLetterSelection([letter]);
  }
  if (current === "all") {
    return normalizeAbcdLetterSelection([letter]);
  }
  if (Array.isArray(current)) {
    const has = current.includes(letter);
    const next = has
      ? current.filter((l) => l !== letter)
      : normalizeAbcdLetterSelection([...current, letter]);
    return next.length === 0 ? "all" : next;
  }
  return "all";
};

const isAbcdLetterFilterActive = (
  filter: GroupAbcdFilter,
  letter: AbcdCategory,
): boolean => Array.isArray(filter) && filter.includes(letter);

const formatAbcdCategoryFilterLabel = (
  filter: GroupAbcdFilter,
): string | null => {
  if (filter === "all") return null;
  if (filter === "0") return "0";
  if (filter === "S" || filter === "R" || filter === "N") return "S";
  if (Array.isArray(filter) && filter.length > 0) {
    return filter.join("+");
  }
  return null;
};

type RotationSortField =
  | "item"
  | "descripcion"
  | "totalSales"
  | "totalCost"
  | "totalMargin"
  | "totalUnits"
  | "inventoryUnits"
  | "inventoryValue"
  | "rotation"
  | "trackedDays"
  | "duvDays"
  | "salesEffectiveDays"
  | "lastMovementDate"
  | "lastPurchaseDate"
  | "status"
  | "ceroRotacionEstado";

type RotationSortDirection = "asc" | "desc";
type PageSize = 25 | 50 | 100;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Anchos de columna (table-layout: fixed) — thead y tbody comparten la misma rejilla. */
const ROTACION_TABLE_COL_WIDTHS = [
  "4%",
  "6%",
  "3%",
  "14%",
  "8%",
  "8%",
  "6%",
  "7%",
  "7%",
  "8%",
  "5%",
  "4%",
  "4%",
  "6%",
  "8%",
] as const;
const ROTACION_ZERO_TABLE_COL_WIDTHS = [
  "4%",
  "7%",
  "4%",
  "10%",
  "16%",
  "9%",
  "10%",
  "10%",
  "7%",
  "7%",
  "11%",
  "8%",
] as const;
const ROTACION_FLOATING_HEADER_TOP_PX = 0;
const ROTACION_FLOATING_HEADER_COLUMNS = [
  { label: "#", align: "right" as const },
  { label: "Item", align: "left" as const, field: "item" as const },
  { label: "Cat.", align: "center" as const },
  {
    label: "Descripcion",
    align: "left" as const,
    field: "descripcion" as const,
  },
  { label: "Venta", align: "right" as const, field: "totalSales" as const },
  { label: "Costo", align: "right" as const, field: "totalCost" as const },
  { label: "Margen %", align: "right" as const },
  { label: "Inv.", align: "right" as const, field: "inventoryUnits" as const },
  { label: "U. vend.", align: "right" as const, field: "totalUnits" as const },
  {
    label: "V. inv.",
    align: "right" as const,
    field: "inventoryValue" as const,
  },
  { label: "DIC", align: "right" as const, field: "rotation" as const },
  { label: "DIE", align: "right" as const, field: "trackedDays" as const },
  {
    label: "DVE",
    align: "right" as const,
    field: "salesEffectiveDays" as const,
  },
  {
    label: "Ult. venta",
    align: "right" as const,
    field: "lastPurchaseDate" as const,
  },
  {
    label: "Ult. ingr.",
    align: "right" as const,
    field: "lastMovementDate" as const,
  },
] as const;
const ROTACION_FLOATING_HEADER_COLUMNS_ZERO = [
  { label: "#", align: "right" as const },
  { label: "Item", align: "left" as const, field: "item" as const },
  { label: "Cat.", align: "center" as const },
  {
    label: "R.inventario",
    align: "left" as const,
    field: "ceroRotacionEstado" as const,
  },
  {
    label: "Descripcion",
    align: "left" as const,
    field: "descripcion" as const,
  },
  {
    label: "Venta período",
    align: "right" as const,
    field: "totalSales" as const,
  },
  { label: "Inv.", align: "right" as const, field: "inventoryUnits" as const },
  {
    label: "V. inv.",
    align: "right" as const,
    field: "inventoryValue" as const,
  },
  { label: "DI", align: "right" as const, field: "lastMovementDate" as const },
  { label: "DUV", align: "right" as const, field: "duvDays" as const },
  {
    label: "Ult. venta",
    align: "right" as const,
    field: "lastPurchaseDate" as const,
  },
  {
    label: "Ult. ingr.",
    align: "right" as const,
    field: "lastMovementDate" as const,
  },
] as const;
const NO_SALES_DI_VALUE = 999999;
const PERECEDEROS_LINEAS_N1 = new Set(["01", "02", "03", "04", "12"]);

/** Misma regla que en /api/rotacion: codigos numericos a 2 cifras para alinear con familias. */
const mergeRotationLineaN1NombreMaps = (
  base: Record<string, string> | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> => {
  const out = { ...(base ?? {}) };
  for (const [code, name] of Object.entries(extra ?? {})) {
    const prev = out[code];
    if (!prev || name.length > prev.length) out[code] = name;
  }
  return out;
};

const bestLineaDisplayFromRow = (row: RotationRow): string | null => {
  const linea = row.linea?.trim();
  const n01 = row.nombreLinea01?.trim();
  const safeLinea = linea && linea.toLowerCase() !== "sin linea" ? linea : null;
  if (!safeLinea) return n01 && n01.length > 0 ? n01 : null;
  if (!n01) return safeLinea;
  return safeLinea.length >= n01.length ? safeLinea : n01;
};

/** Orden del filtro N1: numericos por valor (01, 2, 14), alfanumericos al final por etiqueta. */
const compareLineaN1FilterCodes = (a: string, b: string): number => {
  if (a === "__sin_n1__" && b === "__sin_n1__") return 0;
  if (a === "__sin_n1__") return 1;
  if (b === "__sin_n1__") return -1;
  const aNum = /^\d+$/.test(a) ? Number.parseInt(a, 10) : Number.NaN;
  const bNum = /^\d+$/.test(b) ? Number.parseInt(b, 10) : Number.NaN;
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum && aNum !== bNum) return aNum - bNum;
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
  return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
};

const normalizeLineaN1CodeForFilter = (
  raw: string | null | undefined,
): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "__sin_n1__";
  if (t === "__sin_n1__") return t;
  if (/^\d+$/.test(t)) return t.padStart(2, "0");
  return t;
};
const LINEA_N1_SHORT_NAMES: Record<string, string> = {
  "01": "Fruver",
  "02": "Carnes rojas",
  "03": "Pollo y aves",
  "04": "Pescados",
  "05": "Granos",
  "06": "Bebidas vegetales",
  "07": "Lacteos",
  "08": "Aceites",
  "09": "Nutricion",
  "10": "Embutidos",
  "11": "Achocolatados",
  "12": "Huevos",
  "13": "Sazonadores",
  "14": "Cafe",
  "15": "Pasabocas",
  "16": "Blanqueadores",
  "17": "Congelados",
  "18": "Pastas",
  "19": "Condimentos",
  "20": "Bebidas",
  "21": "Harinas",
  "22": "Panaderia",
  "23": "Confiteria",
  "24": "Snacks",
  "25": "Conservas",
  "26": "Salsas",
  "27": "Aseo hogar",
  "28": "Empaques hogar",
  "29": "Desechables",
  "30": "Insumos internos",
  "31": "Charcuteria",
  "32": "No codificados",
  "33": "Licores",
  "34": "Antipastos",
  "36": "Cuidado bebe",
  "37": "Higiene oral",
  "38": "Cuidado personal",
  "39": "Higiene intima",
  "40": "Cuidado capilar",
  "41": "Papel higienico",
  "42": "Botiquin",
  "43": "Implementos aseo",
  "44": "Ambientadores",
  "45": "Mascotas",
  "46": "Almacenamiento",
  "47": "Ferreteria",
  "48": "Calzado",
  "49": "Bolsas y pequenos",
};
const DEFAULT_ABCD_CONFIG: AbcdConfig = {
  aUntilPercent: 70,
  bUntilPercent: 85,
  cUntilPercent: 98,
};
const PAGE_SIZE_OPTIONS: PageSize[] = [25, 50, 100];

const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const parseDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const clampDateKeyToBounds = (key: string, min: string, max: string) => {
  if (key < min) return min;
  if (key > max) return max;
  return key;
};

/** Fin = ayer (o tope de datos); inicio = mismo día un mes calendario atrás +1 día, acotado a datos disponibles. */
const getRollingMonthBackRange = (
  minAvailable: string,
  maxAvailable: string,
): DateRange => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);
  const endKey = clampDateKeyToBounds(yesterdayKey, minAvailable, maxAvailable);
  const endDate = parseDateKey(endKey);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 1);
  startDate.setDate(startDate.getDate() + 1);
  let startKey = clampDateKeyToBounds(
    toDateKey(startDate),
    minAvailable,
    maxAvailable,
  );
  if (startKey > endKey) {
    startKey = endKey;
  }
  return { start: startKey, end: endKey };
};

const buildRotacionRowsKey = (input: {
  start: string;
  end: string;
  empresas: string[];
  sedeIds: string[];
  lineasN1: string[];
  categoriaKeys: string[];
}) => {
  const empresas = [...input.empresas].sort((a, b) => a.localeCompare(b, "es"));
  const sedeIds = [...input.sedeIds].sort((a, b) => a.localeCompare(b, "es"));
  const lineas = [...input.lineasN1].sort((a, b) => a.localeCompare(b, "es"));
  const cats = [...input.categoriaKeys].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  return `${input.start}|${input.end}|${empresas.join(",")}|${sedeIds.join(",")}|${lineas.join(",")}|${cats.join(",")}`;
};

const sanitizeNumericInput = (value: string) => value.replace(/\D/g, "");

const normalizeDateRange = (
  current: DateRange,
  changedField: "start" | "end",
): DateRange => {
  const start = current.start;
  const end = current.end;

  if (!start && !end) return current;
  if (!start) return { start: end, end };
  if (!end) return { start, end: start };
  if (start <= end) return { start, end };

  return changedField === "start" ? { start, end: start } : { start: end, end };
};

const addMonthsToDateKey = (dateKey: string, months: number) => {
  const shifted = parseDateKey(dateKey);
  shifted.setMonth(shifted.getMonth() + months);
  return toDateKey(shifted);
};

const ROTACION_MAX_RANGE_MONTHS = 2;
const ROTACION_MAX_RANGE_ERROR =
  "El rango maximo permitido es de 2 meses. Ajusta las fechas para continuar.";

const enforceMaxDateRangeMonths = (
  range: DateRange,
  changedField: "start" | "end",
  availableRange?: DateRange,
): DateRange => {
  if (!range.start || !range.end) return range;

  const next = { ...range };
  if (changedField === "start") {
    const maxEnd = addMonthsToDateKey(next.start, ROTACION_MAX_RANGE_MONTHS);
    if (next.end > maxEnd) next.end = maxEnd;
  } else {
    const minStart = addMonthsToDateKey(next.end, -ROTACION_MAX_RANGE_MONTHS);
    if (next.start < minStart) next.start = minStart;
  }

  if (availableRange?.start) {
    next.start = clampDateKeyToBounds(
      next.start,
      availableRange.start,
      availableRange.end || next.start,
    );
  }
  if (availableRange?.end) {
    next.end = clampDateKeyToBounds(
      next.end,
      availableRange.start || next.end,
      availableRange.end,
    );
  }
  return next.start <= next.end
    ? next
    : changedField === "start"
      ? { start: next.start, end: next.start }
      : { start: next.end, end: next.end };
};

const isRangeWithinMaxMonths = (range: DateRange) => {
  if (!range.start || !range.end) return true;
  const maxEnd = addMonthsToDateKey(range.start, ROTACION_MAX_RANGE_MONTHS);
  return range.end <= maxEnd;
};

const countInclusiveDays = (range: DateRange) => {
  if (!range.start || !range.end) return 0;
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  return Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS) + 1;
};

const formatRangeLabel = (range: DateRange) => {
  if (!range.start || !range.end) return "Sin rango";
  if (range.start === range.end) {
    return `${formatDateLabel(range.start, dateLabelOptions)}`;
  }
  return `${formatDateLabel(range.start, dateLabelOptions)} al ${formatDateLabel(
    range.end,
    dateLabelOptions,
  )}`;
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

const formatPriceWithoutSixZeros = (value: number) =>
  `$ ${Math.round(value / 1_000_000).toLocaleString("es-CO")}`;

const formatPercent = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
};

const buildExportFileStamp = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}_${h}${min}`;
};

/** Avoid fetch(data:...) — not reliable in all runtimes; decode inline like inventario flow. */
const dataUrlToBlob = (dataUrl: string): Blob => {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    throw new Error("dataUrlToBlob: invalid data URL");
  }
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mimeMatch = /^data:([^;,]+)/.exec(header);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
};

const WHATSAPP_TABLE_EXCLUDE = "data-whatsapp-table-exclude";

/** Más píxeles por lado; WhatsApp comprime mucho al enviar — conviene ir alto. */
const getRotacionWhatsappPixelRatio = () => {
  if (typeof window === "undefined") return 4;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(5, Math.max(4, dpr * 2));
};

/** Intenta abrir WhatsApp Desktop (deep link) y, si no responde, cae a WhatsApp Web. */
const openWhatsAppDesktopPreferred = () => {
  if (typeof window === "undefined") return;
  const desktopDeepLink = "whatsapp://send?text=Reporte%20de%20rotacion";
  const webFallbackUrl = "https://web.whatsapp.com/";
  let appOpened = false;

  const onBlur = () => {
    appOpened = true;
  };

  window.addEventListener("blur", onBlur, { once: true });
  window.location.href = desktopDeepLink;

  window.setTimeout(() => {
    window.removeEventListener("blur", onBlur);
    if (!appOpened) {
      window.open(webFallbackUrl, "_blank", "noopener,noreferrer");
    }
  }, 1000);
};

const WHATSAPP_JPEG_QUALITY = 0.98;

const rotacionWhatsappExportFilter = (node: HTMLElement) => {
  if (!(node instanceof Element)) return true;
  return !node.hasAttribute(WHATSAPP_TABLE_EXCLUDE);
};

/** Ancho completo de tabla + tarjeta compacta; restaurar después de toPng (html-to-image no expone onclone en tipos). */
const prepareRotacionWhatsappExportDom = (root: HTMLElement) => {
  const cleanups: Array<() => void> = [];

  const prevZoom = root.style.zoom;
  root.style.zoom = "1.22";
  cleanups.push(() => {
    root.style.zoom = prevZoom;
  });

  root.querySelectorAll(".rotacion-whatsapp-export-card").forEach((el) => {
    const c = el as HTMLElement;
    const pad = c.style.padding;
    const bs = c.style.boxShadow;
    const gap = c.style.gap;
    const br = c.style.borderRadius;
    c.style.padding = "0";
    c.style.boxShadow = "none";
    c.style.gap = "0";
    c.style.borderRadius = "8px";
    cleanups.push(() => {
      c.style.padding = pad;
      c.style.boxShadow = bs;
      c.style.gap = gap;
      c.style.borderRadius = br;
    });
  });
  root.querySelectorAll(".rotacion-table-capture-scroll").forEach((el) => {
    const h = el as HTMLElement;
    const ov = h.style.overflow;
    const mw = h.style.maxWidth;
    h.style.overflow = "visible";
    h.style.maxWidth = "none";
    cleanups.push(() => {
      h.style.overflow = ov;
      h.style.maxWidth = mw;
    });
  });
  root.querySelectorAll("table").forEach((t) => {
    const ht = t as HTMLElement;
    const w = ht.style.width;
    const minW = ht.style.minWidth;
    ht.style.width = "max-content";
    ht.style.minWidth = "100%";
    cleanups.push(() => {
      ht.style.width = w;
      ht.style.minWidth = minW;
    });
  });
  return () => {
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]();
  };
};

const STATUS_SORT_ORDER: Record<RotationRow["status"], number> = {
  Agotado: 0,
  "Futuro agotado": 1,
  "Baja rotacion": 2,
  "En seguimiento": 3,
};

const compareRotationText = (left: string, right: string) =>
  left.localeCompare(right, "es", { sensitivity: "base", numeric: true });

const foldForProductSearch = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const rowMatchesProductSearch = (row: RotationRow, rawQuery: string) => {
  const q = rawQuery.trim();
  if (!q) return true;
  const needle = foldForProductSearch(q);
  return (
    foldForProductSearch(row.item).includes(needle) ||
    foldForProductSearch(row.descripcion).includes(needle)
  );
};

const formatRotationOneDecimal = (value: number) => {
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return (Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
};

const calculateDuvDays = (lastPurchaseDate: string | null) => {
  if (!lastPurchaseDate) return null;
  const today = parseDateKey(toDateKey(new Date()));
  const sale = parseDateKey(lastPurchaseDate);
  const diff = Math.floor((today.getTime() - sale.getTime()) / DAY_IN_MS);
  return diff < 0 ? 0 : diff;
};

const calculateDiSinceLastIngresoDays = (lastMovementDate: string | null) => {
  if (!lastMovementDate) return null;
  const today = parseDateKey(toDateKey(new Date()));
  const ingreso = parseDateKey(lastMovementDate);
  const diff = Math.floor((today.getTime() - ingreso.getTime()) / DAY_IN_MS);
  return diff < 0 ? 0 : diff;
};

const clampPercent = (value: number) =>
  Math.max(1, Math.min(100, Number.isFinite(value) ? value : 0));

const safeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeRotationRows = (rows: RotationRow[]) =>
  rows.map((row) => {
    return {
    ...row,
    totalUnits: safeNumber(
      (row as RotationRow & { totalUnits?: number }).totalUnits,
    ),
    marginDailyAvgPct: safeNumber(
      (row as RotationRow & { marginDailyAvgPct?: number }).marginDailyAvgPct,
    ),
    openingInventoryUnits: safeNumber(
      (row as RotationRow & { openingInventoryUnits?: number })
        .openingInventoryUnits,
    ),
    minInventoryUnits: safeNumber(
      (row as RotationRow & { minInventoryUnits?: number }).minInventoryUnits,
    ),
    bodega: row.bodega ?? null,
    nombreBodega: row.nombreBodega ?? null,
    categoria: row.categoria ?? null,
    nombreCategoria: row.nombreCategoria ?? null,
    linea01: row.linea01 ?? null,
    nombreLinea01: row.nombreLinea01 ?? null,
  };
  });

/** Categorias a enviar en query: null = sin filtro (todo el catalogo o vacio). */
const buildCategoriaQueryKeys = (
  catalog: RotationCategoriaFilterOption[],
  selectedKeys: string[],
): string[] | null => {
  if (catalog.length === 0) return null;
  const catalogSet = new Set(catalog.map((c) => c.categoriaKey));
  const valid = selectedKeys.filter((k) => catalogSet.has(k));
  const isFull =
    valid.length === catalog.length &&
    catalog.every((c) => valid.includes(c.categoriaKey));
  if (valid.length === 0 || isFull) return null;
  return valid;
};

const appendCategoriaParams = (
  params: URLSearchParams,
  catalog: RotationCategoriaFilterOption[],
  selectedKeys: string[],
) => {
  const keys = buildCategoriaQueryKeys(catalog, selectedKeys);
  if (!keys) return;
  keys.forEach((k) => params.append("categoria", k));
};

/** Lineas N1 a enviar en query: null = sin filtro (todo el catalogo o vacio). */
const buildLineasN1QueryValues = (
  catalog: string[],
  selectedValues: string[],
): string[] | null => {
  if (catalog.length === 0) {
    return selectedValues.length > 0 ? selectedValues : null;
  }
  const catalogSet = new Set(catalog);
  const valid = selectedValues.filter((value) => catalogSet.has(value));
  const isFull =
    valid.length === catalog.length &&
    catalog.every((value) => valid.includes(value));
  if (valid.length === 0 || isFull) return null;
  return valid;
};

const readCatalogCache = (
  cache: Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>,
  key: string,
): RotationCatalogSnapshot | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

const writeCatalogCache = (
  cache: Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>,
  key: string,
  value: RotationCatalogSnapshot,
) => {
  if (cache.size > 120) cache.clear();
  cache.set(key, {
    value,
    expiresAt: Date.now() + ROTACION_FRONT_CATALOG_CACHE_TTL_MS,
  });
};

const DEFAULT_CATEGORIA_DESTINO = "MERCANCIA NO FABRICADA POR LA EMPRESA";

const buildDefaultCategoriaKeys = (
  options: RotationCategoriaFilterOption[],
): string[] => {
  const preferred = options.filter(
    (option) =>
      (option.nombreCategoria ?? "").trim().toUpperCase() ===
      DEFAULT_CATEGORIA_DESTINO,
  );
  if (preferred.length > 0) {
    return preferred.map((option) => option.categoriaKey);
  }
  return options.map((option) => option.categoriaKey);
};

const normalizeAbcdConfig = (raw: AbcdConfig): AbcdConfig => {
  const a = clampPercent(raw.aUntilPercent);
  const b = Math.max(a, clampPercent(raw.bUntilPercent));
  const c = Math.max(b, clampPercent(raw.cUntilPercent));
  return { aUntilPercent: a, bUntilPercent: b, cUntilPercent: c };
};

const buildAbcdCategoryByItem = (
  rows: RotationRow[],
  config: AbcdConfig,
): Map<string, AbcdCategory> => {
  const sortedRows = [...rows].sort((a, b) => b.totalSales - a.totalSales);
  const totalSales = sortedRows.reduce(
    (sum, row) => sum + Math.max(0, row.totalSales),
    0,
  );
  let cumulativeSales = 0;
  const categories = new Map<string, AbcdCategory>();

  for (const row of sortedRows) {
    if (totalSales <= 0) {
      categories.set(row.item, "D");
      continue;
    }
    cumulativeSales += Math.max(0, row.totalSales);
    const cumulativePercent = (cumulativeSales / totalSales) * 100;
    const category: AbcdCategory =
      cumulativePercent <= config.aUntilPercent
        ? "A"
        : cumulativePercent <= config.bUntilPercent
          ? "B"
          : cumulativePercent <= config.cUntilPercent
            ? "C"
            : "D";
    categories.set(row.item, category);
  }

  return categories;
};

const countAbcdItemsByCategory = (
  rows: RotationRow[],
  categoryByItem: Map<string, AbcdCategory>,
): Record<AbcdCategory, number> => {
  const counts: Record<AbcdCategory, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const row of rows) {
    const cat = categoryByItem.get(row.item) ?? "D";
    counts[cat]++;
  }
  return counts;
};

/**
 * Margen % de ventas = (1 - costo/venta) x 100 (misma regla que negocio / Excel).
 * Con costo 0 no hay base para el % (antes salía 100% y distorsionaba resúmenes).
 */
const rotationMarginPct = (
  totalSales: number,
  totalCost: number,
): number | null => {
  if (!Number.isFinite(totalSales)) return 0;
  if (!(totalSales > 0)) return 0;
  const cost = Number.isFinite(totalCost) ? totalCost : 0;
  if (!(cost > 0)) return null;
  return (1 - cost / totalSales) * 100;
};

type AbcdSummaryRow = {
  categoria: AbcdCategory;
  totalSales: number;
  itemCount: number;
  totalMargin: number;
  marginPct: number | null;
};

const buildAbcdSummaryRows = (
  rows: RotationRow[],
  categoryByItem: Map<string, AbcdCategory>,
): AbcdSummaryRow[] => {
  const byCategory: Record<
    AbcdCategory,
    {
      totalSales: number;
      totalMargin: number;
      totalCost: number;
      marginBasisSales: number;
      marginBasisCost: number;
      items: Set<string>;
    }
  > = {
    A: {
      totalSales: 0,
      totalMargin: 0,
      totalCost: 0,
      marginBasisSales: 0,
      marginBasisCost: 0,
      items: new Set<string>(),
    },
    B: {
      totalSales: 0,
      totalMargin: 0,
      totalCost: 0,
      marginBasisSales: 0,
      marginBasisCost: 0,
      items: new Set<string>(),
    },
    C: {
      totalSales: 0,
      totalMargin: 0,
      totalCost: 0,
      marginBasisSales: 0,
      marginBasisCost: 0,
      items: new Set<string>(),
    },
    D: {
      totalSales: 0,
      totalMargin: 0,
      totalCost: 0,
      marginBasisSales: 0,
      marginBasisCost: 0,
      items: new Set<string>(),
    },
  };

  for (const row of rows) {
    const categoria = categoryByItem.get(row.item) ?? "D";
    const bucket = byCategory[categoria];
    bucket.totalSales += row.totalSales;
    bucket.totalMargin += row.totalMargin;
    bucket.totalCost += row.totalCost;
    bucket.items.add(row.item);
    if (row.totalSales > 0 && row.totalCost > 0) {
      bucket.marginBasisSales += row.totalSales;
      bucket.marginBasisCost += row.totalCost;
    }
  }

  const order: AbcdCategory[] = ["A", "B", "C", "D"];
  return order.map((categoria) => {
    const bucket = byCategory[categoria];
    const totalSales = bucket.totalSales;
    const totalMargin = bucket.totalMargin;
    const marginPct =
      bucket.marginBasisSales > 0
        ? rotationMarginPct(bucket.marginBasisSales, bucket.marginBasisCost)
        : null;
    return {
      categoria,
      totalSales,
      totalMargin,
      itemCount: bucket.items.size,
      marginPct,
    };
  });
};

const compareNullableIsoDateKeys = (
  left: string | null,
  right: string | null,
  direction: RotationSortDirection,
) => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const base = compareRotationText(left, right);
  return direction === "asc" ? base : -base;
};

const getDefaultSortDirection = (
  field: RotationSortField,
): RotationSortDirection =>
  field === "item" ||
  field === "descripcion" ||
  field === "status" ||
  field === "ceroRotacionEstado"
    ? "asc"
    : "desc";

const sortRotationRows = (
  rows: RotationRow[],
  field: RotationSortField | null,
  direction: RotationSortDirection,
  getCeroEstadoRank?: (row: RotationRow) => number,
) => {
  if (!field) return rows;

  const directionFactor = direction === "asc" ? 1 : -1;
  const skipExpensiveTieBreak =
    field === "rotation" ||
    field === "trackedDays" ||
    field === "salesEffectiveDays";

  return [...rows].sort((left, right) => {
    let result = 0;

    switch (field) {
      case "item":
        result = compareRotationText(left.item, right.item);
        break;
      case "descripcion":
        result = compareRotationText(left.descripcion, right.descripcion);
        break;
      case "totalSales":
        result = left.totalSales - right.totalSales;
        break;
      case "totalCost":
        result = left.totalCost - right.totalCost;
        break;
      case "totalMargin":
        result = left.totalMargin - right.totalMargin;
        break;
      case "totalUnits":
        result = left.totalUnits - right.totalUnits;
        break;
      case "inventoryUnits":
        result = left.inventoryUnits - right.inventoryUnits;
        break;
      case "inventoryValue":
        result = left.inventoryValue - right.inventoryValue;
        break;
      case "rotation":
        {
          const leftNoSales = left.rotation >= NO_SALES_DI_VALUE;
          const rightNoSales = right.rotation >= NO_SALES_DI_VALUE;
          if (leftNoSales !== rightNoSales) {
            // "Sin venta" siempre se envia al final, sin importar asc/desc.
            return leftNoSales ? 1 : -1;
          }
          if (leftNoSales && rightNoSales) {
            result = 0;
          } else {
            result = left.rotation - right.rotation;
          }
        }
        break;
      case "trackedDays":
        result = left.trackedDays - right.trackedDays;
        break;
      case "duvDays":
        {
          const leftDuvDays = calculateDuvDays(left.lastPurchaseDate);
          const rightDuvDays = calculateDuvDays(right.lastPurchaseDate);
          const leftValue = leftDuvDays ?? Number.POSITIVE_INFINITY;
          const rightValue = rightDuvDays ?? Number.POSITIVE_INFINITY;
          result = leftValue - rightValue;
        }
        break;
      case "salesEffectiveDays":
        result = left.salesEffectiveDays - right.salesEffectiveDays;
        break;
      case "lastMovementDate":
        result = compareNullableIsoDateKeys(
          left.lastMovementDate,
          right.lastMovementDate,
          direction,
        );
        break;
      case "lastPurchaseDate":
        result = compareNullableIsoDateKeys(
          left.lastPurchaseDate,
          right.lastPurchaseDate,
          direction,
        );
        break;
      case "status":
        result =
          STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
        break;
      case "ceroRotacionEstado":
        result =
          (getCeroEstadoRank?.(left) ?? 0) - (getCeroEstadoRank?.(right) ?? 0);
        break;
      default:
        result = 0;
    }

    if (result !== 0) {
      if (field === "lastMovementDate" || field === "lastPurchaseDate") {
        return result;
      }
      return result * directionFactor;
    }
    if (skipExpensiveTieBreak) return 0;

    const byDescription = compareRotationText(
      left.descripcion,
      right.descripcion,
    );
    if (byDescription !== 0) return byDescription;

    return compareRotationText(left.item, right.item);
  });
};

const buildRowsBySede = (rows: RotationRow[]) => {
  const grouped = new Map<
    string,
    {
      empresa: string;
      sedeId: string;
      sedeName: string;
      rows: RotationRow[];
    }
  >();

  rows.forEach((row) => {
    const key = `${row.empresa}::${row.sedeId}`;
    const current = grouped.get(key) ?? {
      empresa: row.empresa,
      sedeId: row.sedeId,
      sedeName: displayRotationSedeName(row.sedeName),
      rows: [],
    };
    current.rows.push(row);
    grouped.set(key, current);
  });

  return Array.from(grouped.values());
};

const buildConsolidatedRowsBySelection = (
  rows: RotationRow[],
  selectedGroupCount: number,
) => {
  const statusRank: Record<RotationRow["status"], number> = {
    Agotado: 4,
    "Futuro agotado": 3,
    "Baja rotacion": 2,
    "En seguimiento": 1,
  };
  const byItem = new Map<string, RotationRow>();
  rows.forEach((row) => {
    const key = row.item.trim().toUpperCase();
    const current = byItem.get(key);
    if (!current) {
      byItem.set(key, { ...row });
      return;
    }
    current.totalSales += row.totalSales;
    current.totalCost += row.totalCost;
    current.totalMargin += row.totalMargin;
    current.totalUnits += row.totalUnits;
    current.inventoryUnits += row.inventoryUnits;
    current.inventoryValue += row.inventoryValue;
    current.openingInventoryUnits =
      safeNumber(current.openingInventoryUnits) +
      safeNumber(row.openingInventoryUnits);
    current.minInventoryUnits = Math.min(
      safeNumber(current.minInventoryUnits),
      safeNumber(row.minInventoryUnits),
    );
    current.trackedDays = Math.max(current.trackedDays, row.trackedDays);
    current.salesEffectiveDays = Math.max(
      current.salesEffectiveDays,
      row.salesEffectiveDays,
    );
    current.lastMovementDate =
      !current.lastMovementDate ||
      (row.lastMovementDate ?? "") > current.lastMovementDate
        ? row.lastMovementDate
        : current.lastMovementDate;
    current.lastPurchaseDate =
      !current.lastPurchaseDate ||
      (row.lastPurchaseDate ?? "") > current.lastPurchaseDate
        ? row.lastPurchaseDate
        : current.lastPurchaseDate;
    current.rotation =
      current.inventoryUnits <= 0 || current.inventoryValue <= 0
        ? 0
        : current.totalUnits <= 0 || current.trackedDays <= 0
          ? NO_SALES_DI_VALUE
          : (current.inventoryUnits * current.trackedDays) / current.totalUnits;
    current.status =
      statusRank[row.status] > statusRank[current.status]
        ? row.status
        : current.status;
  });

  return [
    {
      empresa: "Consolidado",
      sedeId: "__multi__",
      sedeName:
        selectedGroupCount > 1
          ? `Sedes seleccionadas (${selectedGroupCount})`
          : "Sede seleccionada",
      rows: Array.from(byItem.values()),
    },
  ];
};

/** Filtros rápidos por bloque de sede (tabla). */
type GroupRowsQuickFilter = "none" | "cero_rotacion" | "venta_hasta" | "both";
/** Subconjunto de estados S.inventario visibles (1–3). Los 3 = sin acotar por estado. */
type GroupZeroEstadoSetFilter = readonly CeroRotacionEstado[];

const DEFAULT_GROUP_ZERO_ESTADO_SET_FILTER: GroupZeroEstadoSetFilter =
  CERO_ROTACION_ESTADO_VALUES;

const normalizeGroupZeroEstadoSetFilter = (
  raw: unknown,
): CeroRotacionEstado[] => {
  if (raw === "all" || raw == null) {
    return [...CERO_ROTACION_ESTADO_VALUES];
  }
  if (!Array.isArray(raw)) {
    return [...CERO_ROTACION_ESTADO_VALUES];
  }
  const uniq = new Set<CeroRotacionEstado>();
  for (const v of raw) {
    if (CERO_ROTACION_ESTADO_VALUES.includes(v as CeroRotacionEstado)) {
      uniq.add(v as CeroRotacionEstado);
    }
  }
  const arr = [...uniq];
  if (arr.length === 0) return [...CERO_ROTACION_ESTADO_VALUES];
  return arr.sort(
    (a, b) => CERO_ROTACION_ESTADO_SORT_ORDER[a] - CERO_ROTACION_ESTADO_SORT_ORDER[b],
  );
};

const isCeroRotacionRow = (row: RotationRow) =>
  row.salesEffectiveDays <= 0 && row.inventoryUnits > 0;

const EXCLUDE_RECENT_SALE_DAYS = 5;

const hasNoSalesInSelectedPeriod = (row: RotationRow) =>
  row.totalSales <= 0 &&
  row.totalUnits <= 0 &&
  row.salesEffectiveDays <= 0;

const isDateKeyWithinInclusiveRange = (dateKey: string, range: DateRange) => {
  const t = dateKey.trim();
  if (!t) return false;
  return t >= range.start && t <= range.end;
};

/**
 * True si el rango incluye alguna fecha de calendario con dia de mes < dayLimit
 * (p. ej. 13 → hay dias "antes del 13" en el periodo).
 */
const rangeIntersectsDayOfMonthBefore = (
  range: DateRange,
  dayLimit: number,
): boolean => {
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_IN_MS) {
    if (new Date(t).getDate() < dayLimit) return true;
  }
  return false;
};

const passesCeroRotacionStockDuvGate = (row: RotationRow) => {
  const duvDays = calculateDuvDays(row.lastPurchaseDate);
  return duvDays === null || duvDays >= EXCLUDE_RECENT_SALE_DAYS;
};

const hasUltimoIngresoEnPeriodo = (row: RotationRow, range: DateRange) => {
  const lastMovementDate = row.lastMovementDate;
  if (!lastMovementDate) return false;
  return isDateKeyWithinInclusiveRange(lastMovementDate, range);
};

/**
 * Cero rotacion con ultimo ingreso dentro del periodo revisado → restock (no "nuevo").
 */
const isCeroRotacionRestockPorIngresoEnPeriodo = (
  row: RotationRow,
  range: DateRange,
) =>
  passesCeroRotacionStockDuvGate(row) &&
  isCeroRotacionRow(row) &&
  hasUltimoIngresoEnPeriodo(row, range);

/**
 * Restock (categoria S): sin inventario al inicio del periodo, sin ventas en el
 * periodo, inventario al cierre, y fecha de ultimo ingreso dentro del periodo;
 * o cero rotacion con ultimo ingreso en el periodo (aunque hubiera stock inicial).
 */
const isRestockItemRow = (row: RotationRow, range: DateRange) => {
  if (isCeroRotacionRestockPorIngresoEnPeriodo(row, range)) return true;
  const duvDays = calculateDuvDays(row.lastPurchaseDate);
  if (duvDays !== null && duvDays < EXCLUDE_RECENT_SALE_DAYS) return false;
  if (!hasNoSalesInSelectedPeriod(row)) return false;
  if (!(row.inventoryUnits > 0)) return false;
  if (row.openingInventoryUnits > 0) return false;
  if (!row.lastMovementDate) return false;
  return isDateKeyWithinInclusiveRange(row.lastMovementDate, range);
};

/**
 * Nuevo clasico (S): sin ventas en el periodo, con inventario, ultimo ingreso hoy o ayer.
 * No aplica si el ingreso cae dentro del periodo seleccionado (esos van a restock).
 */
const isNuevoClasicoItemRow = (
  row: RotationRow,
  range: DateRange | null,
) => {
  if (
    range?.start &&
    range?.end &&
    isCeroRotacionRestockPorIngresoEnPeriodo(row, range)
  ) {
    return false;
  }
  const duvDays = calculateDuvDays(row.lastPurchaseDate);
  if (duvDays !== null && duvDays < EXCLUDE_RECENT_SALE_DAYS) return false;
  if (!hasNoSalesInSelectedPeriod(row)) return false;
  if (!(row.salesEffectiveDays <= 0 && row.inventoryUnits > 0)) return false;
  const daysSinceIngreso = calculateDiSinceLastIngresoDays(row.lastMovementDate);
  const hasRecentIngreso = daysSinceIngreso !== null && daysSinceIngreso <= 1;
  return hasRecentIngreso;
};

/**
 * S (restock o nuevo): restock segun periodo / ingreso en periodo, o nuevo solo si
 * el ingreso es hoy/ayer y no aplica la regla de restock por periodo.
 */
const isNuevoItemRow = (row: RotationRow, range: DateRange | null) => {
  if (range?.start && range?.end && isRestockItemRow(row, range)) return true;
  return isNuevoClasicoItemRow(row, range);
};

/**
 * Cero rotacion: sin ventas efectivas en el periodo, con inventario al cierre,
 * no es S, y si el periodo incluye dias anteriores al 13 del mes debe haber
 * inventario al inicio del periodo ("tenia inventario antes del 13").
 */
const isCeroRotacionExcludingNuevo = (
  row: RotationRow,
  range: DateRange | null,
) => {
  if (!isCeroRotacionRow(row)) return false;
  if (isNuevoItemRow(row, range)) return false;
  if (!range?.start || !range?.end) return true;
  if (rangeIntersectsDayOfMonthBefore(range, 13)) {
    return row.openingInventoryUnits > 0;
  }
  return true;
};

const applyRowsQuickFilter = (
  rows: RotationRow[],
  filter: GroupRowsQuickFilter,
  ventaHastaMax: number | null,
  dateRange: DateRange | null,
): RotationRow[] => {
  if (filter === "none") return rows;
  if (filter === "cero_rotacion") {
    return rows.filter((row) => isCeroRotacionExcludingNuevo(row, dateRange));
  }
  if (filter === "venta_hasta") {
    if (ventaHastaMax == null || Number.isNaN(ventaHastaMax)) return rows;
    return rows.filter(
      (row) => row.totalSales >= 1 && row.totalSales <= ventaHastaMax,
    );
  }
  if (filter === "both") {
    if (ventaHastaMax == null || Number.isNaN(ventaHastaMax)) {
      return rows.filter((row) => isCeroRotacionExcludingNuevo(row, dateRange));
    }
    return rows.filter((row) => {
      const isCeroRotacion = isCeroRotacionExcludingNuevo(row, dateRange);
      const isVentaHasta =
        row.totalSales >= 1 && row.totalSales <= ventaHastaMax;
      return isCeroRotacion || isVentaHasta;
    });
  }
  return rows;
};

const COMPANY_LABELS: Record<string, string> = {
  mercamio: "Mercamio",
  mtodo: "Comercializadora",
  bogota: "Merkmios",
};

const formatCompanyLabel = (value: string) =>
  COMPANY_LABELS[value] ??
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const formatSedeLabel = (value: string) =>
  value
    .replace(/^sede\s+/i, "")
    .replace(/\bproduccion\s+producto\s+terminado\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Nombre de sede alineado con el resto del portal (planilla-sede / admin). */
const displayRotationSedeName = (raw: string) => {
  const cleaned = formatSedeLabel(raw);
  const canonical = mapRawSedeToCanonical(cleaned);
  return (canonical || cleaned).trim();
};

const mapRotationSedeOptions = (
  sedes: RotationApiResponse["filters"]["sedes"],
) =>
  sedes
    .map((option) => {
      const displaySedeName = displayRotationSedeName(option.sedeName);
      return {
        value: `${option.empresa}::${option.sedeId}`,
        label: `${formatCompanyLabel(option.empresa)} - ${displaySedeName}`,
        empresa: option.empresa,
        sedeId: option.sedeId,
        sedeName: displaySedeName,
      };
    })
    .filter((option) => option.sedeName.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label, "es"));


const ROTACION_LAST_SEDE_STORAGE_KEY = "rotacion:lastSedeSelection";
const ROTACION_FRONT_CATALOG_CACHE_TTL_MS = 3 * 60 * 1000;

const readRotationApiForbiddenMessage = async (
  response: Response,
): Promise<string> => {
  const fallback = "No tienes permiso para ver esta informacion.";
  try {
    const data = (await response.json()) as { error?: string };
    return data.error?.trim() || fallback;
  } catch {
    return fallback;
  }
};

export type { DateRange, RotationRow, RotationCategoriaFilterOption, RotationApiResponse, RotationCatalogSnapshot, LineaN1Option, LineaN1FamilyKey, AbcdConfig, AbcdCategory, GroupAbcdFilter, RotationSortField, RotationSortDirection, PageSize, AbcdSummaryRow, GroupRowsQuickFilter, GroupZeroEstadoSetFilter };
export { getCookieValue, ALL_LINEA_N1_FAMILY_KEYS, LINEA_N1_FAMILY_LABELS, matchesLineaN1Family, ABCD_FILTER_LETTERS_ORDER, normalizeAbcdLetterSelection, toggleAbcdLetterFilter, isAbcdLetterFilterActive, formatAbcdCategoryFilterLabel, DAY_IN_MS, ROTACION_TABLE_COL_WIDTHS, ROTACION_ZERO_TABLE_COL_WIDTHS, ROTACION_FLOATING_HEADER_TOP_PX, ROTACION_FLOATING_HEADER_COLUMNS, ROTACION_FLOATING_HEADER_COLUMNS_ZERO, NO_SALES_DI_VALUE, PERECEDEROS_LINEAS_N1, mergeRotationLineaN1NombreMaps, bestLineaDisplayFromRow, compareLineaN1FilterCodes, normalizeLineaN1CodeForFilter, LINEA_N1_SHORT_NAMES, DEFAULT_ABCD_CONFIG, PAGE_SIZE_OPTIONS, dateLabelOptions, parseDateKey, toDateKey, clampDateKeyToBounds, getRollingMonthBackRange, buildRotacionRowsKey, sanitizeNumericInput, normalizeDateRange, addMonthsToDateKey, ROTACION_MAX_RANGE_MONTHS, ROTACION_MAX_RANGE_ERROR, enforceMaxDateRangeMonths, isRangeWithinMaxMonths, countInclusiveDays, formatRangeLabel, formatPrice, formatPriceWithoutSixZeros, formatPercent, rotationMarginPct, buildExportFileStamp, dataUrlToBlob, WHATSAPP_TABLE_EXCLUDE, getRotacionWhatsappPixelRatio, openWhatsAppDesktopPreferred, WHATSAPP_JPEG_QUALITY, rotacionWhatsappExportFilter, prepareRotacionWhatsappExportDom, STATUS_SORT_ORDER, compareRotationText, foldForProductSearch, rowMatchesProductSearch, formatRotationOneDecimal, calculateDuvDays, calculateDiSinceLastIngresoDays, clampPercent, safeNumber, normalizeRotationRows, buildCategoriaQueryKeys, appendCategoriaParams, buildLineasN1QueryValues, readCatalogCache, writeCatalogCache, DEFAULT_CATEGORIA_DESTINO, buildDefaultCategoriaKeys, normalizeAbcdConfig, buildAbcdCategoryByItem, countAbcdItemsByCategory, buildAbcdSummaryRows, compareNullableIsoDateKeys, getDefaultSortDirection, sortRotationRows, buildRowsBySede, buildConsolidatedRowsBySelection, isCeroRotacionRow, isNuevoItemRow, isCeroRotacionExcludingNuevo, applyRowsQuickFilter, COMPANY_LABELS, formatCompanyLabel, formatSedeLabel, displayRotationSedeName, mapRotationSedeOptions, ROTACION_LAST_SEDE_STORAGE_KEY, ROTACION_FRONT_CATALOG_CACHE_TTL_MS, readRotationApiForbiddenMessage, DEFAULT_GROUP_ZERO_ESTADO_SET_FILTER, normalizeGroupZeroEstadoSetFilter };
