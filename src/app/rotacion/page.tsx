"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as ExcelJS from "exceljs";
import { toJpeg, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  MapPin,
  PackageSearch,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canAccessPortalSection } from "@/lib/portal-sections";
import {
  canAccessRotacionBoard,
  canEditRotacionAbcdConfig,
} from "@/lib/special-role-features";
import { mapRawSedeToCanonical } from "@/lib/planilla-sede";
import { cn, formatDateLabel } from "@/lib/utils";

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
  totalMargin: number;
  totalUnits: number;
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
type GroupAbcdFilter = "all" | AbcdCategory;

type RotationSortField =
  | "item"
  | "descripcion"
  | "totalSales"
  | "totalMargin"
  | "totalUnits"
  | "inventoryUnits"
  | "inventoryValue"
  | "rotation"
  | "trackedDays"
  | "salesEffectiveDays"
  | "lastMovementDate"
  | "lastPurchaseDate"
  | "status";

type RotationSortDirection = "asc" | "desc";
type PageSize = 25 | 50 | 100;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Anchos de columna (table-layout: fixed) — thead y tbody comparten la misma rejilla. */
const ROTACION_TABLE_COL_WIDTHS = [
  "6%",
  "3%",
  "20%",
  "8%",
  "8%",
  "7%",
  "8%",
  "8%",
  "8%",
  "7%",
  "6%",
  "5%",
  "6%",
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
  const safeLinea =
    linea && linea.toLowerCase() !== "sin linea" ? linea : null;
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

const formatPercent = (value: number) =>
  `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

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

const calculateSalesCoverageDays = (
  row: Pick<RotationRow, "inventoryValue" | "totalSales" | "trackedDays">,
) => {
  if (row.inventoryValue <= 0) return 0;
  if (row.totalSales <= 0 || row.trackedDays <= 0) return NO_SALES_DI_VALUE;
  return (row.inventoryValue * row.trackedDays) / row.totalSales;
};

const clampPercent = (value: number) =>
  Math.max(1, Math.min(100, Number.isFinite(value) ? value : 0));

const safeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeRotationRows = (rows: RotationRow[]) =>
  rows.map((row) => ({
    ...row,
    totalUnits: safeNumber(
      (row as RotationRow & { totalUnits?: number }).totalUnits,
    ),
    bodega: row.bodega ?? null,
    nombreBodega: row.nombreBodega ?? null,
    categoria: row.categoria ?? null,
    nombreCategoria: row.nombreCategoria ?? null,
    linea01: row.linea01 ?? null,
    nombreLinea01: row.nombreLinea01 ?? null,
  }));

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
    valid.length === catalog.length && catalog.every((value) => valid.includes(value));
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

const compareNullableIsoDateKeys = (
  left: string | null,
  right: string | null,
) => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareRotationText(left, right);
};

const getDefaultSortDirection = (
  field: RotationSortField,
): RotationSortDirection =>
  field === "item" || field === "descripcion" || field === "status"
    ? "asc"
    : "desc";

const sortRotationRows = (
  rows: RotationRow[],
  field: RotationSortField | null,
  direction: RotationSortDirection,
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
        if (
          left.rotation >= NO_SALES_DI_VALUE &&
          right.rotation >= NO_SALES_DI_VALUE
        ) {
          result = 0;
        } else if (left.rotation >= NO_SALES_DI_VALUE) {
          result = 1;
        } else if (right.rotation >= NO_SALES_DI_VALUE) {
          result = -1;
        } else {
          result = left.rotation - right.rotation;
        }
        break;
      case "trackedDays":
        result = left.trackedDays - right.trackedDays;
        break;
      case "salesEffectiveDays":
        if (
          calculateSalesCoverageDays(left) >= NO_SALES_DI_VALUE &&
          calculateSalesCoverageDays(right) >= NO_SALES_DI_VALUE
        ) {
          result = 0;
        } else if (calculateSalesCoverageDays(left) >= NO_SALES_DI_VALUE) {
          result = 1;
        } else if (calculateSalesCoverageDays(right) >= NO_SALES_DI_VALUE) {
          result = -1;
        } else {
          result =
            calculateSalesCoverageDays(left) -
            calculateSalesCoverageDays(right);
        }
        break;
      case "lastMovementDate":
        result = compareNullableIsoDateKeys(
          left.lastMovementDate,
          right.lastMovementDate,
        );
        break;
      case "lastPurchaseDate":
        result = compareNullableIsoDateKeys(
          left.lastPurchaseDate,
          right.lastPurchaseDate,
        );
        break;
      case "status":
        result =
          STATUS_SORT_ORDER[left.status] - STATUS_SORT_ORDER[right.status];
        break;
      default:
        result = 0;
    }

    if (result !== 0) return result * directionFactor;
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
    current.totalMargin += row.totalMargin;
    current.totalUnits += row.totalUnits;
    current.inventoryUnits += row.inventoryUnits;
    current.inventoryValue += row.inventoryValue;
    current.trackedDays = Math.max(current.trackedDays, row.trackedDays);
    current.salesEffectiveDays = Math.max(
      current.salesEffectiveDays,
      row.salesEffectiveDays,
    );
    current.lastMovementDate =
      !current.lastMovementDate || (row.lastMovementDate ?? "") > current.lastMovementDate
        ? row.lastMovementDate
        : current.lastMovementDate;
    current.lastPurchaseDate =
      !current.lastPurchaseDate || (row.lastPurchaseDate ?? "") > current.lastPurchaseDate
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

const applyRowsQuickFilter = (
  rows: RotationRow[],
  filter: GroupRowsQuickFilter,
  ventaHastaMax: number | null,
): RotationRow[] => {
  if (filter === "none") return rows;
  if (filter === "cero_rotacion") {
    return rows.filter((row) => row.totalSales <= 0 && row.inventoryUnits > 0);
  }
  if (filter === "venta_hasta") {
    if (ventaHastaMax == null || Number.isNaN(ventaHastaMax)) return rows;
    return rows.filter(
      (row) => row.totalSales >= 1 && row.totalSales <= ventaHastaMax,
    );
  }
  if (filter === "both") {
    if (ventaHastaMax == null || Number.isNaN(ventaHastaMax)) {
      return rows.filter(
        (row) => row.totalSales <= 0 && row.inventoryUnits > 0,
      );
    }
    return rows.filter((row) => {
      const isCeroRotacion = row.totalSales <= 0 && row.inventoryUnits > 0;
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

type SortableRotationHeaderProps = {
  field: RotationSortField;
  label: React.ReactNode;
  activeField: RotationSortField | null;
  direction: RotationSortDirection;
  onSort: (field: RotationSortField) => void;
  /** Encabezados numericos alineados a la derecha como las celdas (evita desfase visual). */
  align?: "left" | "right";
};

const WhatsAppLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const SortableRotationHeader = ({
  field,
  label,
  activeField,
  direction,
  onSort,
  align = "left",
}: SortableRotationHeaderProps) => {
  const isActive = activeField === field;
  const isRight = align === "right";

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "inline-flex w-full min-w-0 items-center gap-1.5 transition-colors",
        isRight ? "justify-end text-right" : "justify-start text-left",
        isActive ? "text-amber-700" : "text-slate-700 hover:text-amber-700",
      )}
      aria-pressed={isActive}
    >
      <span className={cn("min-w-0", isRight ? "shrink" : "block flex-1")}>
        {label}
      </span>
      <ArrowUp
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-all",
          isActive
            ? `opacity-100 ${direction === "desc" ? "rotate-180" : ""}`
            : "opacity-35",
        )}
      />
    </button>
  );
};

type SelectFieldProps = {
  icon: React.ElementType;
  label: string;
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
  helperText: string;
  accentClassName: string;
  disabled?: boolean;
};

const FilterFieldLabel = ({
  icon: Icon,
  label,
  accentClassName,
}: {
  icon: React.ElementType;
  label: string;
  accentClassName: string;
}) => (
  <span
    className={`mb-2 flex min-h-2.75rem items-start gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] leading-4 ${accentClassName}`}
  >
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <span className="block">{label}</span>
  </span>
);

const FilterSelectField = ({
  icon: Icon,
  label,
  values,
  options,
  onChange,
  helperText,
  accentClassName,
  disabled = false,
}: SelectFieldProps) => {
  const valueSet = new Set(values);
  const allSelected = options.length > 0 && values.length === options.length;
  return (
    <div className="block">
    <FilterFieldLabel
      icon={Icon}
      label={label}
      accentClassName={accentClassName}
    />
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || allSelected}
          onClick={() => onChange(options.map((option) => option.value))}
          className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
        >
          Seleccionar todas
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || values.length === 0}
          onClick={() => onChange([])}
          className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
        >
          Limpiar
        </Button>
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {options.map((option) => {
          const checked = valueSet.has(option.value);
          return (
            <label
              key={option.value}
              className="flex items-start gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() =>
                  onChange(
                    checked
                      ? values.filter((value) => value !== option.value)
                      : [...values, option.value],
                  )
                }
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-200"
              />
              <span className="leading-5">{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
    <p className="mt-1 text-[11px] text-slate-500">{helperText}</p>
    </div>
  );
};

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

export default function RotacionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [specialRoles, setSpecialRoles] = useState<string[] | null>(null);
  const [isAbcdModalOpen, setIsAbcdModalOpen] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingAbcdConfig, setIsSavingAbcdConfig] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedSedes, setSelectedSedes] = useState<string[]>([]);
  const [lineaN1FamilyKeys, setLineaN1FamilyKeys] = useState<
    LineaN1FamilyKey[]
  >(["manufactura"]);
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });
  const [availableRange, setAvailableRange] = useState<DateRange>({
    start: "",
    end: "",
  });
  const [rows, setRows] = useState<RotationRow[]>([]);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [isLoadingLineCatalog, setIsLoadingLineCatalog] = useState(false);
  const [selectedLineaN1Values, setSelectedLineaN1Values] = useState<string[]>(
    [],
  );
  const [selectedCategoriaKeys, setSelectedCategoriaKeys] = useState<string[]>(
    [],
  );
  const [abcdConfig, setAbcdConfig] = useState<AbcdConfig>(DEFAULT_ABCD_CONFIG);
  const [abcdDraftConfig, setAbcdDraftConfig] =
    useState<AbcdConfig>(DEFAULT_ABCD_CONFIG);
  const [abcdSaveScope, setAbcdSaveScope] = useState<"global" | "sede">(
    "global",
  );
  const [filterCatalog, setFilterCatalog] = useState<
    RotationApiResponse["filters"]
  >({
    companies: [],
    sedes: [],
    lineasN1: [],
    lineasN1Nombres: {},
    categorias: [],
    lineasN1PorCategoria: {},
  });
  const [error, setError] = useState<string | null>(null);
  const skipNextFetchRef = useRef(false);
  const catalogLoadGenerationRef = useRef(0);
  const previousLineaN1FamilyKeysRef = useRef<string>(
    [...["manufactura"]].sort().join("|"),
  );
  const rotacionRowsFetchKeyRef = useRef<string | null>(null);
  const reloadRotacionRowsRef = useRef<
    (
      overrides?: {
        lineasN1?: string[];
        categoriaKeys?: string[];
        categoriasCatalog?: RotationCategoriaFilterOption[];
      },
      options?: { signal?: AbortSignal },
    ) => Promise<boolean>
  >(() => Promise.resolve(false));
  const [tableSortField, setTableSortField] =
    useState<RotationSortField | null>("totalSales");
  const [tableSortDirection, setTableSortDirection] =
    useState<RotationSortDirection>("desc");
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [pageByGroupKey, setPageByGroupKey] = useState<Record<string, number>>(
    {},
  );
  const [rowsQuickFilterByGroup, setRowsQuickFilterByGroup] = useState<
    Record<string, GroupRowsQuickFilter>
  >({});
  /** Valor aplicado al pulsar «Venta ≤» (tope de venta periodo en COP). */
  const [ventaHastaCapByGroup, setVentaHastaCapByGroup] = useState<
    Record<string, number | undefined>
  >({});
  const [ventaHastaInputByGroup, setVentaHastaInputByGroup] = useState<
    Record<string, string>
  >({});
  const [abcdFilterByGroup, setAbcdFilterByGroup] = useState<
    Record<string, GroupAbcdFilter>
  >({});
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isWhatsAppSharing, setIsWhatsAppSharing] = useState(false);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [isCategoriaFilterOpen, setIsCategoriaFilterOpen] = useState(false);
  const [isFamilyFilterOpen, setIsFamilyFilterOpen] = useState(false);
  const rotacionTablesExportRef = useRef<HTMLDivElement>(null);
  const whatsappDetailsRef = useRef<HTMLDetailsElement>(null);
  const whatsappShareLockRef = useRef(false);
  const skipSedeRestoreRef = useRef(false);
  const catalogBaseCacheRef = useRef<
    Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>
  >(new Map());
  const catalogBySedeCacheRef = useRef<
    Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>
  >(new Map());
  const selectedCompanySet = useMemo(
    () => new Set(selectedCompanies),
    [selectedCompanies],
  );
  const selectedSedeSet = useMemo(() => new Set(selectedSedes), [selectedSedes]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;

        const payload = (await response.json()) as {
          user?: {
            role?: string;
            allowedDashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        setIsAdmin(Boolean(isAdmin));
        setSpecialRoles(payload.user?.specialRoles ?? null);
        if (
          !isAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
        ) {
          router.replace("/secciones");
          return;
        }
        if (!canAccessRotacionBoard(payload.user?.specialRoles, isAdmin)) {
          router.replace("/productividad");
          return;
        }

        if (isMounted) setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  useEffect(() => {
    try {
      if (selectedSedes.length > 0) {
        localStorage.setItem(
          ROTACION_LAST_SEDE_STORAGE_KEY,
          JSON.stringify(selectedSedes),
        );
      } else {
        localStorage.removeItem(ROTACION_LAST_SEDE_STORAGE_KEY);
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, [selectedSedes]);

  const canEditAbcdConfig = useMemo(
    () => canEditRotacionAbcdConfig(specialRoles, isAdmin),
    [specialRoles, isAdmin],
  );

  const reloadRotacionRows = useCallback(
    async (
      overrides?: {
        lineasN1?: string[];
        categoriaKeys?: string[];
        categoriasCatalog?: RotationCategoriaFilterOption[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<boolean> => {
      const allSedeOptionsForQuery = mapRotationSedeOptions(filterCatalog.sedes);
      const selectedSedeMetasForQuery = allSedeOptionsForQuery.filter((option) =>
        selectedSedeSet.has(option.value),
      );
      const targetSedeSelectionsForQuery =
        selectedSedeMetasForQuery.length > 0
          ? selectedSedeMetasForQuery
          : selectedCompanySet.size > 0
            ? allSedeOptionsForQuery.filter((option) =>
                selectedCompanySet.has(option.empresa),
              )
            : [];
      if (targetSedeSelectionsForQuery.length === 0) return false;

      const lineas = overrides?.lineasN1 ?? selectedLineaN1Values;
      const cats = overrides?.categoriaKeys ?? selectedCategoriaKeys;
      const categoriasForParams =
        overrides?.categoriasCatalog ?? filterCatalog.categorias ?? [];
      const lineasForParams = buildLineasN1QueryValues(
        filterCatalog.lineasN1 ?? [],
        lineas,
      );
      const lineasKeyValues = lineasForParams ?? [];

      setIsLoadingData(true);
      setError(null);
      setHasLoadedItems(true);

      try {
        const params = new URLSearchParams();
        if (dateRange.start && dateRange.end) {
          params.set("start", dateRange.start);
          params.set("end", dateRange.end);
        }
        targetSedeSelectionsForQuery.forEach((sedeMeta) => {
          params.append("sedeScope", `${sedeMeta.empresa}::${sedeMeta.sedeId}`);
        });
        lineasKeyValues.forEach((linea) => {
          params.append("lineasN1", linea);
        });
        appendCategoriaParams(params, categoriasForParams, cats);
        const response = await fetch(
          `/api/rotacion${params.size > 0 ? `?${params.toString()}` : ""}`,
          { cache: "no-store", signal: options?.signal },
        );
        if (response.status === 401) {
          router.replace("/login");
          return false;
        }
        if (response.status === 403) {
          setError(await readRotationApiForbiddenMessage(response));
          setHasLoadedItems(false);
          return false;
        }
        const payload = (await response.json()) as RotationApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No fue posible consultar la rotacion.");
        }

        setRows(normalizeRotationRows(payload.rows ?? []));
        if (targetSedeSelectionsForQuery.length === 1 && payload.meta?.abcdConfig) {
          const normalizedConfig = normalizeAbcdConfig(payload.meta.abcdConfig);
          setAbcdConfig(normalizedConfig);
          setAbcdDraftConfig(normalizedConfig);
        }
        rotacionRowsFetchKeyRef.current = buildRotacionRowsKey({
          start: dateRange.start ?? "",
          end: dateRange.end ?? "",
          empresas: targetSedeSelectionsForQuery.map((s) => s.empresa),
          sedeIds: targetSedeSelectionsForQuery.map((s) => s.sedeId),
          lineasN1: lineasKeyValues,
          categoriaKeys: cats,
        });
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return false;
        }
        setRows([]);
        setHasLoadedItems(false);
        setError(
          err instanceof Error ? err.message : "Error consultando rotacion.",
        );
        return false;
      } finally {
        setIsLoadingData(false);
      }
    },
    [
      router,
      filterCatalog.sedes,
      selectedCompanySet,
      selectedSedeSet,
      dateRange.start,
      dateRange.end,
      selectedLineaN1Values,
      selectedCategoriaKeys,
      filterCatalog.lineasN1,
      filterCatalog.categorias,
    ],
  );

  reloadRotacionRowsRef.current = reloadRotacionRows;

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    if (rotacionRowsFetchKeyRef.current === null) return;
    const allSedeOptionsForQuery = mapRotationSedeOptions(filterCatalog.sedes);
    const selectedSedeMetasForQuery = allSedeOptionsForQuery.filter((option) =>
      selectedSedeSet.has(option.value),
    );
    const targetSedeSelectionsForQuery =
      selectedSedeMetasForQuery.length > 0
        ? selectedSedeMetasForQuery
        : selectedCompanySet.size > 0
          ? allSedeOptionsForQuery.filter((option) =>
              selectedCompanySet.has(option.empresa),
            )
          : [];

    if (
      targetSedeSelectionsForQuery.length === 0 ||
      !dateRange.start ||
      !dateRange.end
    )
      return;

    const key = buildRotacionRowsKey({
      start: dateRange.start,
      end: dateRange.end,
      empresas: targetSedeSelectionsForQuery.map((s) => s.empresa),
      sedeIds: targetSedeSelectionsForQuery.map((s) => s.sedeId),
      lineasN1:
        buildLineasN1QueryValues(
          filterCatalog.lineasN1 ?? [],
          selectedLineaN1Values,
        ) ?? [],
      categoriaKeys: selectedCategoriaKeys,
    });

    if (key === rotacionRowsFetchKeyRef.current) return;

    const timer = window.setTimeout(() => {
      void reloadRotacionRows();
    }, 480);
    return () => window.clearTimeout(timer);
  }, [
    ready,
    isLoadingLineCatalog,
    filterCatalog.sedes,
    filterCatalog.lineasN1,
    selectedCompanySet,
    selectedSedeSet,
    dateRange.start,
    dateRange.end,
    selectedLineaN1Values,
    selectedCategoriaKeys,
    reloadRotacionRows,
  ]);

  useEffect(() => {
    if (!ready) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    catalogLoadGenerationRef.current += 1;
    const generation = catalogLoadGenerationRef.current;
    const rowsController = new AbortController();

    const loadLineCatalog = async () => {
      setIsLoadingLineCatalog(true);
      setError(null);
      setRows([]);
      setHasLoadedItems(false);
      rotacionRowsFetchKeyRef.current = null;

      try {
        const hadEmptyDateRange = !dateRange.start || !dateRange.end;
        const rangeKey = `${dateRange.start || ""}|${dateRange.end || ""}`;
        const params = new URLSearchParams();

        if (dateRange.start && dateRange.end) {
          params.set("start", dateRange.start);
          params.set("end", dateRange.end);
        }
        params.set("catalogOnly", "1");

        const baseCatalogCacheKey = `base|${rangeKey}`;
        const payloadFromCache = readCatalogCache(
          catalogBaseCacheRef.current,
          baseCatalogCacheKey,
        );
        let payload: RotationApiResponse;
        if (payloadFromCache) {
          payload = {
            rows: [],
            stats: { evaluatedSedes: 0, visibleItems: 0, withoutMovement: 0 },
            filters: payloadFromCache.filters,
            meta:
              payloadFromCache.meta ?? {
                effectiveRange: {
                  start: dateRange.start || "",
                  end: dateRange.end || "",
                },
                availableRange: { min: "", max: "" },
                sourceTable: "rotacion_base_item_dia_sede",
                maxSalesValue: null,
                abcdConfig: DEFAULT_ABCD_CONFIG,
              },
          };
        } else {
          const response = await fetch(
            `/api/rotacion${params.size > 0 ? `?${params.toString()}` : ""}`,
            {
              cache: "no-store",
            },
          );

          if (generation !== catalogLoadGenerationRef.current) return;

          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          if (response.status === 403) {
            const forbiddenMessage =
              await readRotationApiForbiddenMessage(response);
            if (generation !== catalogLoadGenerationRef.current) return;
            setError(forbiddenMessage);
            return;
          }

          payload = (await response.json()) as RotationApiResponse;
          if (!response.ok) {
            throw new Error(
              payload.error ?? "No fue posible consultar la rotacion.",
            );
          }
          writeCatalogCache(catalogBaseCacheRef.current, baseCatalogCacheKey, {
            filters: payload.filters,
            meta: payload.meta,
          });
        }

        if (generation !== catalogLoadGenerationRef.current) return;

        const baseFilters =
          payload.filters ?? {
            companies: [],
            sedes: [],
            lineasN1: [],
            lineasN1Nombres: {},
            categorias: [],
            lineasN1PorCategoria: {},
          };
        let allLineasN1 = baseFilters.lineasN1 ?? [];
        let allCategorias = baseFilters.categorias ?? [];
        let allLineasN1PorCategoria = baseFilters.lineasN1PorCategoria ?? {};
        let allLineasN1Nombres = mergeRotationLineaN1NombreMaps(
          undefined,
          baseFilters.lineasN1Nombres,
        );
        const allSedeOptionsForQuery = mapRotationSedeOptions(baseFilters.sedes);
        const selectedSedeMetasForQuery = allSedeOptionsForQuery.filter((option) =>
          selectedSedeSet.has(option.value),
        );
        const targetSedeSelectionsForQuery =
          selectedSedeMetasForQuery.length > 0
            ? selectedSedeMetasForQuery
            : selectedCompanySet.size > 0
              ? allSedeOptionsForQuery.filter((option) =>
                  selectedCompanySet.has(option.empresa),
                )
              : [];

        if (targetSedeSelectionsForQuery.length > 0) {
          const comboKey = `${rangeKey}|${targetSedeSelectionsForQuery
            .map((s) => `${s.empresa}::${s.sedeId}`)
            .sort((a, b) => a.localeCompare(b, "es"))
            .join(",")}`;
          const cachedCombo = readCatalogCache(
            catalogBySedeCacheRef.current,
            comboKey,
          );
          let comboPayload: RotationApiResponse | null = null;
          if (cachedCombo) {
            comboPayload = {
              rows: [],
              stats: { evaluatedSedes: 0, visibleItems: 0, withoutMovement: 0 },
              filters: cachedCombo.filters,
              meta:
                cachedCombo.meta ?? {
                  effectiveRange: {
                    start: dateRange.start || "",
                    end: dateRange.end || "",
                  },
                  availableRange: { min: "", max: "" },
                  sourceTable: "rotacion_base_item_dia_sede",
                  maxSalesValue: null,
                  abcdConfig: DEFAULT_ABCD_CONFIG,
                },
            };
          } else {
            const comboParams = new URLSearchParams();
            if (dateRange.start && dateRange.end) {
              comboParams.set("start", dateRange.start);
              comboParams.set("end", dateRange.end);
            }
            comboParams.set("catalogOnly", "1");
            targetSedeSelectionsForQuery.forEach((sedeMeta) => {
              comboParams.append(
                "sedeScope",
                `${sedeMeta.empresa}::${sedeMeta.sedeId}`,
              );
            });
            const comboResponse = await fetch(
              `/api/rotacion?${comboParams.toString()}`,
              { cache: "no-store" },
            );
            if (comboResponse.status === 401) {
              router.replace("/login");
              return;
            }
            if (comboResponse.ok) {
              comboPayload = (await comboResponse.json()) as RotationApiResponse;
              writeCatalogCache(catalogBySedeCacheRef.current, comboKey, {
                filters: comboPayload.filters,
                meta: comboPayload.meta,
              });
            }
          }

          if (comboPayload) {
            allLineasN1 = comboPayload.filters?.lineasN1 ?? [];
            allCategorias = comboPayload.filters?.categorias ?? [];
            allLineasN1PorCategoria =
              comboPayload.filters?.lineasN1PorCategoria ?? {};
            allLineasN1Nombres = mergeRotationLineaN1NombreMaps(
              allLineasN1Nombres,
              comboPayload.filters?.lineasN1Nombres,
            );
          }
        }

        setFilterCatalog({
          ...baseFilters,
          lineasN1: allLineasN1,
          categorias: allCategorias,
          lineasN1PorCategoria: allLineasN1PorCategoria,
          lineasN1Nombres: allLineasN1Nombres,
        });
        const defaultCategoriaKeys = buildDefaultCategoriaKeys(allCategorias);
        setSelectedLineaN1Values(allLineasN1);
        setSelectedCategoriaKeys(defaultCategoriaKeys);
        if (payload.meta?.abcdConfig) {
          const normalizedConfig = normalizeAbcdConfig(payload.meta.abcdConfig);
          setAbcdConfig(normalizedConfig);
          setAbcdDraftConfig(normalizedConfig);
        }

        if (payload.meta?.availableRange) {
          setAvailableRange({
            start: payload.meta.availableRange.min,
            end: payload.meta.availableRange.max,
          });
        }

        const avMin = payload.meta?.availableRange?.min;
        const avMax = payload.meta?.availableRange?.max;
        if (generation !== catalogLoadGenerationRef.current) return;
        if (
          hadEmptyDateRange &&
          typeof avMin === "string" &&
          avMin &&
          typeof avMax === "string" &&
          avMax
        ) {
          const rolling = getRollingMonthBackRange(avMin, avMax);
          setDateRange(rolling);
        } else if (
          payload.meta?.effectiveRange &&
          payload.meta.effectiveRange.start &&
          payload.meta.effectiveRange.end &&
          (dateRange.start !== payload.meta.effectiveRange.start ||
            dateRange.end !== payload.meta.effectiveRange.end)
        ) {
          skipNextFetchRef.current = true;
          window.setTimeout(() => {
            if (skipNextFetchRef.current) {
              skipNextFetchRef.current = false;
            }
          }, 500);
          setDateRange(payload.meta.effectiveRange);
        }

        if (generation !== catalogLoadGenerationRef.current) return;

        if (targetSedeSelectionsForQuery.length > 0) {
          await reloadRotacionRowsRef.current(
            {
              lineasN1: allLineasN1,
              categoriaKeys: defaultCategoriaKeys,
              categoriasCatalog: allCategorias,
            },
            { signal: rowsController.signal },
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (generation !== catalogLoadGenerationRef.current) return;
        setRows([]);
        setHasLoadedItems(false);
        setError(
          err instanceof Error ? err.message : "Error consultando rotacion.",
        );
      } finally {
        if (generation === catalogLoadGenerationRef.current) {
          setIsLoadingLineCatalog(false);
        }
      }
    };

    const timer = window.setTimeout(() => {
      void loadLineCatalog();
    }, 220);
    return () => {
      window.clearTimeout(timer);
      rowsController.abort();
    };
  }, [
    dateRange.end,
    dateRange.start,
    ready,
    router,
    selectedCompanies,
    selectedSedes,
    selectedCompanySet,
    selectedSedeSet,
  ]);

  const daysConsulted = useMemo(
    () => countInclusiveDays(dateRange),
    [dateRange],
  );
  const formattedRange = useMemo(
    () => formatRangeLabel(dateRange),
    [dateRange],
  );
  const companyOptions = useMemo(
    () =>
      [...filterCatalog.companies]
        .sort((a, b) =>
          formatCompanyLabel(a).localeCompare(formatCompanyLabel(b), "es"),
        )
        .map((empresa) => ({
          value: empresa,
          label: formatCompanyLabel(empresa),
        })),
    [filterCatalog.companies],
  );

  const allSedeOptions = useMemo(
    () =>
      filterCatalog.sedes
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
        .sort((a, b) => {
          const parseN1 = (value: string) => {
            if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
            return Number.POSITIVE_INFINITY;
          };
          const aN1 = parseN1(a.value);
          const bN1 = parseN1(b.value);
          if (aN1 !== bN1) return aN1 - bN1;
          if (a.value === "__sin_n1__") return 1;
          if (b.value === "__sin_n1__") return -1;
          return a.label.localeCompare(b.label, "es");
        }),
    [filterCatalog.sedes],
  );

  const sedeOptions = useMemo(() => {
    const scopedOptions =
      selectedCompanySet.size > 0
        ? allSedeOptions.filter((option) => selectedCompanySet.has(option.empresa))
        : allSedeOptions;

    return scopedOptions.map((option) => ({
      value: option.value,
      label: selectedCompanySet.size === 1 ? option.sedeName : option.label,
    }));
  }, [allSedeOptions, selectedCompanySet]);

  const selectedSedeMetas = useMemo(
    () => allSedeOptions.filter((option) => selectedSedeSet.has(option.value)),
    [allSedeOptions, selectedSedeSet],
  );
  const targetSedeSelections = useMemo(() => {
    if (selectedSedeMetas.length > 0) return selectedSedeMetas;
    if (selectedCompanySet.size === 0) return [];
    return allSedeOptions.filter((option) => selectedCompanySet.has(option.empresa));
  }, [allSedeOptions, selectedCompanySet, selectedSedeMetas]);
  const singleSelectedSedeTarget = useMemo(
    () => (targetSedeSelections.length === 1 ? targetSedeSelections[0] : null),
    [targetSedeSelections],
  );

  const lineaN1FamilyKeySet = useMemo(
    () => new Set(lineaN1FamilyKeys),
    [lineaN1FamilyKeys],
  );

  const lineasN1DerivedFromRows = useMemo(() => {
    const acc = new Set<string>();
    for (const row of rows) {
      acc.add(normalizeLineaN1CodeForFilter(row.lineaN1Codigo));
    }
    return Array.from(acc).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const lineasN1ForFilterUi = useMemo(() => {
    const fromApi = (filterCatalog.lineasN1 ?? []).map(
      normalizeLineaN1CodeForFilter,
    );
    const byCat = filterCatalog.lineasN1PorCategoria ?? {};
    const categories = filterCatalog.categorias ?? [];
    const dedupeSort = (arr: string[]) =>
      Array.from(new Set(arr.map(normalizeLineaN1CodeForFilter))).sort((a, b) =>
        a.localeCompare(b, "es"),
      );

    if (categories.length === 0 || Object.keys(byCat).length === 0) {
      const deduped = dedupeSort(fromApi);
      if (deduped.length > 0) return deduped;
      return lineasN1DerivedFromRows;
    }

    const catalogKeySet = new Set(categories.map((c) => c.categoriaKey));
    const isFullSelection =
      selectedCategoriaKeys.length > 0 &&
      selectedCategoriaKeys.length === categories.length &&
      categories.every((c) => selectedCategoriaKeys.includes(c.categoriaKey));

    if (isFullSelection) {
      const deduped = dedupeSort(fromApi);
      if (deduped.length > 0) return deduped;
      return lineasN1DerivedFromRows;
    }

    if (selectedCategoriaKeys.length === 0) {
      return dedupeSort(fromApi);
    }

    const acc = new Set<string>();
    for (const ck of selectedCategoriaKeys) {
      if (!catalogKeySet.has(ck)) continue;
      const list = byCat[ck];
      if (list) {
        for (const n of list) {
          acc.add(normalizeLineaN1CodeForFilter(n));
        }
      }
    }
    return Array.from(acc).sort((a, b) => a.localeCompare(b, "es"));
  }, [
    filterCatalog.lineasN1,
    filterCatalog.lineasN1PorCategoria,
    filterCatalog.categorias,
    selectedCategoriaKeys,
    lineasN1DerivedFromRows,
  ]);

  const lineasN1NombreMap = useMemo(() => {
    const out = mergeRotationLineaN1NombreMaps(
      undefined,
      filterCatalog.lineasN1Nombres,
    );
    for (const row of rows) {
      const code = normalizeLineaN1CodeForFilter(row.lineaN1Codigo);
      const cand = bestLineaDisplayFromRow(row);
      if (!cand) continue;
      const prev = out[code];
      if (!prev || cand.length > prev.length) out[code] = cand;
    }
    return out;
  }, [filterCatalog.lineasN1Nombres, rows]);

  const lineaN1Options = useMemo<LineaN1Option[]>(
    () =>
      [...lineasN1ForFilterUi]
        .filter((value) => {
          const allSelected =
            lineaN1FamilyKeySet.size === ALL_LINEA_N1_FAMILY_KEYS.length;
          if (allSelected || lineaN1FamilyKeySet.size === 0) return true;
          return matchesLineaN1Family(value, lineaN1FamilyKeySet);
        })
        .map((value) => {
          if (value === "__sin_n1__") {
            return { value, label: "Sin N1" as const };
          }
          const dbNombre = lineasN1NombreMap[value]?.trim();
          const shortFallback = LINEA_N1_SHORT_NAMES[value];
          const label =
            dbNombre && dbNombre.length > 0
              ? `${dbNombre} (N1 ${value})`
              : shortFallback
                ? `${shortFallback} (N1 ${value})`
                : `N1 ${value}`;
          const shortName =
            dbNombre && dbNombre.length > 0 ? undefined : shortFallback;
          return { value, label, shortName };
        })
        .sort((a, b) => {
          const byCode = compareLineaN1FilterCodes(a.value, b.value);
          if (byCode !== 0) return byCode;
          return a.label.localeCompare(b.label, "es");
        }),
    [lineasN1ForFilterUi, lineaN1FamilyKeySet, lineasN1NombreMap],
  );

  const selectedLineaN1Set = useMemo(
    () => new Set(selectedLineaN1Values),
    [selectedLineaN1Values],
  );

  const categoriaFilterOptions = useMemo(
    () => filterCatalog.categorias ?? [],
    [filterCatalog.categorias],
  );

  const selectedCategoriaKeySet = useMemo(
    () => new Set(selectedCategoriaKeys),
    [selectedCategoriaKeys],
  );

  useEffect(() => {
    const optionValues = lineaN1Options.map((option) => option.value);
    const optionSet = new Set(optionValues);
    const familyKey = [...lineaN1FamilyKeys].sort().join("|");
    const familyChanged = familyKey !== previousLineaN1FamilyKeysRef.current;
    previousLineaN1FamilyKeysRef.current = familyKey;

    setSelectedLineaN1Values((prev) => {
      if (familyChanged) {
        return optionValues;
      }
      return prev.filter((value) => optionSet.has(value));
    });
  }, [lineaN1FamilyKeys, lineaN1Options]);

  useEffect(() => {
    setSelectedCategoriaKeys(buildDefaultCategoriaKeys(categoriaFilterOptions));
  }, [categoriaFilterOptions]);

  useEffect(() => {
    const validSedeValues = new Set(sedeOptions.map((option) => option.value));
    setSelectedSedes((current) => {
      const next = current.filter((value) => validSedeValues.has(value));
      if (
        next.length === current.length &&
        next.every((value, idx) => value === current[idx])
      ) {
        return current;
      }
      return next;
    });
  }, [sedeOptions]);

  useEffect(() => {
    if (selectedSedes.length > 0) return;
    if (isLoadingLineCatalog) return;
    if (allSedeOptions.length !== 1) return;
    const only = allSedeOptions[0];
    setSelectedSedes([only.value]);
    setSelectedCompanies([only.empresa]);
  }, [allSedeOptions, isLoadingLineCatalog, selectedSedes.length]);

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    if (selectedSedes.length > 0) return;
    if (skipSedeRestoreRef.current) return;
    if (allSedeOptions.length < 2) return;

    try {
      const raw = localStorage.getItem(ROTACION_LAST_SEDE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      const restored = Array.isArray(parsed)
        ? parsed.filter((value) =>
            allSedeOptions.some((option) => option.value === value),
          )
        : [];
      if (restored.length === 0) return;
      setSelectedSedes(restored);
      const restoredCompanies = Array.from(
        new Set(
          allSedeOptions
            .filter((option) => restored.includes(option.value))
            .map((option) => option.empresa),
        ),
      );
      setSelectedCompanies(restoredCompanies);
    } catch {
      /* ignore */
    }
  }, [
    ready,
    isLoadingLineCatalog,
    selectedSedes,
    allSedeOptions,
  ]);

  const sortedRows = useMemo(
    () => sortRotationRows(rows, tableSortField, tableSortDirection),
    [rows, tableSortDirection, tableSortField],
  );
  const rowsAfterProductFilter = useMemo(
    () =>
      sortedRows.filter((row) =>
        rowMatchesProductSearch(row, productSearchInput),
      ),
    [sortedRows, productSearchInput],
  );
  const rowsBySede = useMemo(
    () =>
      targetSedeSelections.length > 1
        ? buildConsolidatedRowsBySelection(
            rowsAfterProductFilter,
            targetSedeSelections.length,
          )
        : buildRowsBySede(rowsAfterProductFilter),
    [rowsAfterProductFilter, targetSedeSelections.length],
  );

  const handleStartDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) =>
      normalizeDateRange({ start: value, end: current.end }, "start"),
    );
  };

  const handleEndDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) =>
      normalizeDateRange({ start: current.start, end: value }, "end"),
    );
  };

  const handleReloadRows = () => {
    void reloadRotacionRows();
  };

  const handleSaveAbcdConfig = async () => {
    if (!canEditAbcdConfig || isSavingAbcdConfig) return;
    if (abcdSaveScope === "sede" && !singleSelectedSedeTarget) {
      setError(
        "Para guardar por sede selecciona una sola sede en los filtros principales.",
      );
      return;
    }
    setIsSavingAbcdConfig(true);
    setError(null);
    try {
      const normalized = normalizeAbcdConfig(abcdDraftConfig);
      const response = await fetch("/api/rotacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...normalized,
          saveScope: abcdSaveScope,
          empresa:
            abcdSaveScope === "sede"
              ? (singleSelectedSedeTarget?.empresa ?? "")
              : undefined,
          sedeId:
            abcdSaveScope === "sede"
              ? (singleSelectedSedeTarget?.sedeId ?? "")
              : undefined,
        }),
      });
      const payload = (await response.json()) as {
        config?: AbcdConfig;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error ?? "No fue posible guardar la configuracion ABCD.",
        );
      }
      const saved = normalizeAbcdConfig(payload.config ?? normalized);
      setAbcdConfig(saved);
      setAbcdDraftConfig(saved);
      setIsAbcdModalOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error guardando configuracion ABCD.",
      );
    } finally {
      setIsSavingAbcdConfig(false);
    }
  };

  const handleTableSort = (field: RotationSortField) => {
    if (tableSortField === field) {
      setTableSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setTableSortField(field);
    setTableSortDirection(getDefaultSortDirection(field));
  };

  const handlePageSizeChange = (value: string) => {
    const next = Number(value) as PageSize;
    if (!PAGE_SIZE_OPTIONS.includes(next)) return;
    setPageSize(next);
    setPageByGroupKey({});
  };

  const toggleGroupRowsQuickFilter = (
    groupKey: string,
    filter: Exclude<GroupRowsQuickFilter, "none" | "venta_hasta" | "both">,
  ) => {
    setRowsQuickFilterByGroup((prev) => {
      const current = prev[groupKey] ?? "none";
      let next: GroupRowsQuickFilter = current;
      if (filter === "cero_rotacion") {
        if (current === "cero_rotacion") next = "none";
        else if (current === "venta_hasta") next = "both";
        else if (current === "both") next = "venta_hasta";
        else next = "cero_rotacion";
      }
      return { ...prev, [groupKey]: next };
    });
    setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
  };

  const applyOrToggleVentaHastaFilter = (groupKey: string) => {
    const current = rowsQuickFilterByGroup[groupKey] ?? "none";
    if (current === "venta_hasta" || current === "both") {
      setRowsQuickFilterByGroup((prev) => ({
        ...prev,
        [groupKey]: current === "both" ? "cero_rotacion" : "none",
      }));
      setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
      return;
    }
    const raw = ventaHastaInputByGroup[groupKey] ?? "";
    const parsedRaw = Number(sanitizeNumericInput(raw));
    if (Number.isNaN(parsedRaw)) return;
    const parsed = Math.max(1, parsedRaw);
    setVentaHastaCapByGroup((prev) => ({ ...prev, [groupKey]: parsed }));
    setRowsQuickFilterByGroup((prev) => ({
      ...prev,
      [groupKey]: current === "cero_rotacion" ? "both" : "venta_hasta",
    }));
    setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
  };

  const setGroupPage = (
    groupKey: string,
    nextPage: number,
    totalPages: number,
  ) => {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    setPageByGroupKey((prev) => ({
      ...prev,
      [groupKey]: safePage,
    }));
  };

  const shouldSelectSedeFirst = targetSedeSelections.length === 0;
  const shouldReloadFirst =
    targetSedeSelections.length > 0 && !hasLoadedItems && !isLoadingLineCatalog;

  const exportRows = useMemo(
    () =>
      rowsBySede.flatMap((group) => {
        const groupKey = `${group.empresa}-${group.sedeId}`;
        const rowFilter = rowsQuickFilterByGroup[groupKey] ?? "none";
        const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
        const ventaHastaCap =
          rowFilter === "venta_hasta" || rowFilter === "both"
            ? (ventaHastaCapByGroup[groupKey] ?? null)
            : null;
        const filteredRows = applyRowsQuickFilter(
          group.rows,
          rowFilter,
          ventaHastaCap,
        );
        /** Pareto ABCD sobre el universo del periodo + filtros superiores; no aplica filtros de tabla (cero rot., venta ≤). */
        const categoryByItem = buildAbcdCategoryByItem(group.rows, abcdConfig);
        const categoryFilteredRows =
          categoryFilter === "all"
            ? filteredRows
            : filteredRows.filter(
                (row) => categoryByItem.get(row.item) === categoryFilter,
              );
        return categoryFilteredRows.map((row) => ({
          empresa: formatCompanyLabel(row.empresa),
          sede: displayRotationSedeName(row.sedeName),
          item: row.item,
          descripcion: row.descripcion,
          ventaPeriodo: row.totalSales,
          invCierre: row.inventoryUnits,
          unidad: row.unidad ?? "",
          valorInventario: row.inventoryValue,
          rotacion: formatRotationOneDecimal(row.rotation),
          diaInventarioEfectivo: row.trackedDays.toLocaleString("es-CO"),
          diaVentaEfectivo: formatRotationOneDecimal(
            calculateSalesCoverageDays(row),
          ),
          ultimoIngreso: row.lastMovementDate
            ? formatDateLabel(row.lastMovementDate, dateLabelOptions)
            : "Sin fecha de ingreso",
          fechaUltimaVenta: row.lastPurchaseDate
            ? formatDateLabel(row.lastPurchaseDate, dateLabelOptions)
            : "Sin fecha",
        }));
      }),
    [
      abcdConfig,
      abcdFilterByGroup,
      rowsBySede,
      rowsQuickFilterByGroup,
      ventaHastaCapByGroup,
    ],
  );

  const buildRotacionPdfDocument = useCallback(() => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(12);
    doc.text("Reporte de Rotacion", 14, 12);
    doc.setFontSize(9);
    doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`, 14, 18);

    autoTable(doc, {
      startY: 22,
      styles: { fontSize: 7, cellPadding: 1.8 },
      head: [
        [
          "Empresa",
          "Sede",
          "Item",
          "Descripcion",
          "Venta periodo",
          "Inv cierre",
          "Unidad",
          "Valor inventario",
          "DI (dias inv.)",
          "Dia inventario efectivo",
          "Dia venta efectivo",
          "Ultimo ingreso",
          "Fecha ultima venta",
        ],
      ],
      body: exportRows.map((row) => [
        row.empresa,
        row.sede,
        row.item,
        row.descripcion,
        formatPrice(row.ventaPeriodo),
        row.invCierre.toLocaleString("es-CO"),
        row.unidad,
        formatPrice(row.valorInventario),
        row.rotacion,
        row.diaInventarioEfectivo,
        row.diaVentaEfectivo,
        row.ultimoIngreso,
        row.fechaUltimaVenta,
      ]),
      margin: { left: 8, right: 8 },
    });
    return doc;
  }, [exportRows]);

  const handleExportExcel = async () => {
    if (exportRows.length === 0 || isExportingExcel) return;
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Rotacion");
      sheet.columns = [
        { header: "Empresa", key: "empresa", width: 18 },
        { header: "Sede", key: "sede", width: 24 },
        { header: "Item", key: "item", width: 14 },
        { header: "Descripcion", key: "descripcion", width: 46 },
        { header: "Venta periodo", key: "ventaPeriodo", width: 16 },
        { header: "Inv cierre", key: "invCierre", width: 12 },
        { header: "Unidad", key: "unidad", width: 10 },
        { header: "Valor inventario", key: "valorInventario", width: 16 },
        { header: "DI (dias inv.)", key: "rotacion", width: 14 },
        {
          header: "Dia inventario efectivo",
          key: "diaInventarioEfectivo",
          width: 18,
        },
        { header: "Dia venta efectivo", key: "diaVentaEfectivo", width: 16 },
        { header: "Ultimo ingreso", key: "ultimoIngreso", width: 16 },
        { header: "Fecha ultima venta", key: "fechaUltimaVenta", width: 20 },
      ];
      sheet.addRows(exportRows);

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      });
      sheet.getColumn("ventaPeriodo").numFmt = '"$"#,##0';
      sheet.getColumn("valorInventario").numFmt = '"$"#,##0';
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rotacion_${buildExportFileStamp()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPdf = () => {
    if (exportRows.length === 0 || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      buildRotacionPdfDocument().save(`rotacion_${buildExportFileStamp()}.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleWhatsAppShare = useCallback(
    async (format: "png" | "jpeg" | "pdf") => {
      if (exportRows.length === 0 || whatsappShareLockRef.current) return;
      whatsappShareLockRef.current = true;
      setIsWhatsAppSharing(true);
      try {
        const stamp = buildExportFileStamp();
        let blob: Blob;
        let filename: string;
        let mime: string;

        if (format === "pdf") {
          mime = "application/pdf";
          blob = buildRotacionPdfDocument().output("blob");
          filename = `rotacion_${stamp}.pdf`;
        } else {
          const node = rotacionTablesExportRef.current;
          if (!node) return;
          const restoreDom = prepareRotacionWhatsappExportDom(node);
          let dataUrl: string;
          const pixelRatio = getRotacionWhatsappPixelRatio();
          try {
            if (format === "png") {
              dataUrl = await toPng(node, {
                pixelRatio,
                backgroundColor: "#ffffff",
                cacheBust: true,
                filter: rotacionWhatsappExportFilter,
              });
              mime = "image/png";
              filename = `rotacion_${stamp}.png`;
            } else {
              dataUrl = await toJpeg(node, {
                pixelRatio,
                quality: WHATSAPP_JPEG_QUALITY,
                backgroundColor: "#ffffff",
                cacheBust: true,
                filter: rotacionWhatsappExportFilter,
              });
              mime = "image/jpeg";
              filename = `rotacion_${stamp}.jpg`;
            }
          } finally {
            restoreDom();
          }
          blob = dataUrlToBlob(dataUrl);
        }

        const file = new File([blob], filename, { type: mime });
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.share === "function" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] })
        ) {
          await navigator.share({
            files: [file],
            title: "Reporte de rotacion",
            text: "Reporte de rotacion",
          });
        } else {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
          openWhatsAppDesktopPreferred();
        }
        whatsappDetailsRef.current?.removeAttribute("open");
      } finally {
        whatsappShareLockRef.current = false;
        setIsWhatsAppSharing(false);
      }
    },
    [buildRotacionPdfDocument, exportRows.length],
  );

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando rotacion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-8 text-foreground sm:px-5 sm:py-10 lg:px-8">
      <div className="mx-auto flex w-full max-w-[min(100%,100rem)] flex-col gap-6">
        <Card className="overflow-hidden border-amber-200/80 bg-linear-to-br from-white via-amber-50/70 to-orange-50 shadow-[0_28px_70px_-45px_rgba(245,158,11,0.55)]">
          <CardContent className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700">
                  Producto
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  Rotacion
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                  Esta vista toma datos reales desde la base diaria para
                  detectar productos de baja rotación, agotados y futuros
                  agotados por sede, usando la venta acumulada del rango
                  consultado.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    asChild
                    variant="outline"
                    className="rounded-full border-slate-200 bg-white/90 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 hover:bg-slate-50"
                  >
                    <Link href="/productividad">
                      <ArrowLeft className="h-4 w-4" />
                      Volver a producto
                    </Link>
                  </Button>
                  <Button
                    asChild
                    className="rounded-full bg-amber-600 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-white hover:bg-amber-700"
                  >
                    <Link href="/secciones">Cambiar seccion</Link>
                  </Button>
                </div>
                {canEditAbcdConfig ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-full border-emerald-300 bg-emerald-50/90 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-900 hover:bg-emerald-100 sm:w-auto"
                    onClick={() => {
                      setAbcdDraftConfig(abcdConfig);
                      setAbcdSaveScope("global");
                      setIsAbcdModalOpen(true);
                    }}
                  >
                    Configurar ABCD
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(320px,1fr)]">
          <Card className="h-full border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <Filter className="h-5 w-5 text-amber-600" />
                Filtros principales
              </CardTitle>
              <CardDescription>
                Puedes elegir varias empresas y varias sedes para evaluarlas en
                conjunto. Para acotar por venta del periodo usa el boton Venta ≤
                en la tabla.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <FilterSelectField
                  icon={Building2}
                  label="Empresa"
                  values={selectedCompanies}
                  options={companyOptions}
                  onChange={(values) => {
                    setSelectedCompanies(values);
                    if (values.length === 0) return;
                    const allowed = new Set(values);
                    setSelectedSedes((current) =>
                      current.filter((sedeValue) => {
                        const match = allSedeOptions.find(
                          (option) => option.value === sedeValue,
                        );
                        return match ? allowed.has(match.empresa) : false;
                      }),
                    );
                  }}
                  helperText={
                    isLoadingLineCatalog && companyOptions.length === 0
                      ? "Cargando empresas..."
                      : "Marca una o varias empresas."
                  }
                  accentClassName="text-indigo-700"
                  disabled={isLoadingLineCatalog && companyOptions.length === 0}
                />
                <FilterSelectField
                  icon={MapPin}
                  label="Sede"
                  values={selectedSedes}
                  options={sedeOptions}
                  onChange={(values) => {
                    if (values.length === 0) skipSedeRestoreRef.current = true;
                    setSelectedSedes(values);
                    if (values.length === 0) return;
                    const nextCompanies = Array.from(
                      new Set(
                        allSedeOptions
                          .filter((option) => values.includes(option.value))
                          .map((option) => option.empresa),
                      ),
                    );
                    setSelectedCompanies(nextCompanies);
                  }}
                  helperText={
                    isLoadingLineCatalog && allSedeOptions.length === 0
                      ? "Cargando sedes..."
                      : "Marca una o varias sedes."
                  }
                  accentClassName="text-sky-700"
                  disabled={isLoadingLineCatalog && allSedeOptions.length === 0}
                />
              </div>
              <div className="rounded-2xl border border-teal-200 bg-white px-4 py-3 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[10px] font-bold text-teal-800">
                        1
                      </span>
                      Paso 1
                    </div>
                    <FilterFieldLabel
                      icon={PackageSearch}
                      label="Categoria (destino)"
                      accentClassName="text-teal-800"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsCategoriaFilterOpen((prev) => !prev)}
                      className="h-8 rounded-lg border-teal-200 bg-white px-2.5 text-[11px] font-semibold text-teal-900 hover:bg-teal-50"
                    >
                      {isCategoriaFilterOpen ? (
                        <>
                          Ocultar
                          <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          Ver categorias
                          <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedCategoriaKeys(
                          categoriaFilterOptions.map((o) => o.categoriaKey),
                        )
                      }
                      disabled={
                        categoriaFilterOptions.length === 0 ||
                        isLoadingLineCatalog
                      }
                      className="h-8 rounded-lg border-teal-200 bg-teal-50 px-2.5 text-[11px] font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                    >
                      Seleccionar todas
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCategoriaKeys([])}
                      disabled={
                        categoriaFilterOptions.length === 0 ||
                        selectedCategoriaKeys.length === 0 ||
                        isLoadingLineCatalog
                      }
                      className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Limpiar seleccion
                    </Button>
                  </div>
                </div>
                <div className="mb-2">
                  <Badge className="border-teal-200 bg-teal-50 text-teal-800">
                    {categoriaFilterOptions.length === 0
                      ? "Sin categorias cargadas"
                      : `${selectedCategoriaKeys.length} de ${categoriaFilterOptions.length} categorias seleccionadas`}
                  </Badge>
                </div>
                {isCategoriaFilterOpen ? (
                  <>
                    <p className="mb-2 text-[11px] leading-snug text-slate-500">
                      Elige una o mas categorias. Esto define que lineas N1
                      aparecen en los siguientes pasos.
                    </p>
                    <div className="max-h-48 space-y-3 overflow-y-auto pr-1">
                      {targetSedeSelections.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          Selecciona al menos una empresa o sede para cargar categorias.
                        </p>
                      ) : categoriaFilterOptions.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          {isLoadingLineCatalog
                            ? "Cargando categorias..."
                            : "No hay categorias en este periodo para la sede elegida."}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {categoriaFilterOptions.map((opt) => {
                            const checked = selectedCategoriaKeySet.has(
                              opt.categoriaKey,
                            );
                            const label =
                              opt.nombreCategoria?.trim() ||
                              (opt.categoriaKey === "__sin_cat__"
                                ? "Sin categoria"
                                : opt.categoriaKey);
                            return (
                              <label
                                key={opt.categoriaKey}
                                className="flex cursor-pointer items-start gap-2 text-sm text-slate-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedCategoriaKeys((cur) =>
                                      checked
                                        ? cur.filter(
                                            (k) => k !== opt.categoriaKey,
                                          )
                                        : [...cur, opt.categoriaKey],
                                    )
                                  }
                                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-200"
                                />
                                <span>
                                  <span className="font-medium">{label}</span>
                                  {opt.categoriaKey !== "__sin_cat__" ? (
                                    <span className="ml-1 font-mono text-[11px] font-normal text-slate-500">
                                      ({opt.categoriaKey})
                                    </span>
                                  ) : null}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
              <div className="rounded-2xl border border-violet-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                        2
                      </span>
                      Paso 2
                    </div>
                    <FilterFieldLabel
                      icon={Filter}
                      label="Familia de lineas"
                      accentClassName="text-violet-700"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsFamilyFilterOpen((prev) => !prev)}
                      className="h-8 rounded-lg border-violet-200 bg-white px-2.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-50"
                    >
                      {isFamilyFilterOpen ? (
                        <>
                          Ocultar
                          <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          Ver familias
                          <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setLineaN1FamilyKeys([...ALL_LINEA_N1_FAMILY_KEYS])
                      }
                      disabled={
                        isLoadingLineCatalog &&
                        filterCatalog.lineasN1.length === 0
                      }
                      className="h-8 rounded-lg border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                    >
                      Todas las familias
                    </Button>
                  </div>
                </div>
                <div className="mt-2">
                  <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                    {lineaN1FamilyKeys.length === 0 ||
                    lineaN1FamilyKeys.length === ALL_LINEA_N1_FAMILY_KEYS.length
                      ? "Todas las familias activas"
                      : `${lineaN1FamilyKeys.length} familias activas`}
                  </Badge>
                </div>
                {isFamilyFilterOpen ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                      {ALL_LINEA_N1_FAMILY_KEYS.map((familyKey) => {
                        const checked = lineaN1FamilyKeys.includes(familyKey);
                        return (
                          <label
                            key={familyKey}
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm transition",
                              checked
                                ? "border-violet-300 bg-violet-50 text-violet-900"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setLineaN1FamilyKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(familyKey)) {
                                    if (next.size <= 1) return prev;
                                    next.delete(familyKey);
                                  } else {
                                    next.add(familyKey);
                                  }
                                  return [...next];
                                });
                              }}
                              disabled={
                                isLoadingLineCatalog &&
                                filterCatalog.lineasN1.length === 0
                              }
                              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-200 disabled:opacity-50"
                            />
                            <span className="font-medium">
                              {LINEA_N1_FAMILY_LABELS[familyKey]}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-slate-500">
                      Puedes marcar varias familias a la vez; la lista de lineas
                      N1 debajo muestra la union de las elegidas.
                    </p>
                  </>
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                        3
                      </span>
                      Paso 3
                    </div>
                    <FilterFieldLabel
                      icon={Filter}
                      label="Lineas nivel 1"
                      accentClassName="text-violet-700"
                    />
                    <p className="max-w-xl text-[11px] leading-snug text-slate-500">
                      Al cambiar lineas N1 o categorías, la tabla se actualiza
                      sola en unos instantes. Usa{" "}
                      <span className="font-medium text-slate-600">
                        Actualizar ahora
                      </span>{" "}
                      solo para forzar la consulta al momento.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedLineaN1Values(
                          lineaN1Options.map((option) => option.value),
                        )
                      }
                      disabled={
                        lineaN1Options.length === 0 || isLoadingLineCatalog
                      }
                      className="h-8 rounded-lg border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                    >
                      Seleccionar todas
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedLineaN1Values([])}
                      disabled={
                        lineaN1Options.length === 0 ||
                        selectedLineaN1Values.length === 0 ||
                        isLoadingLineCatalog
                      }
                      className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      Limpiar seleccion
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleReloadRows()}
                      disabled={
                        targetSedeSelections.length === 0 ||
                        isLoadingData ||
                        isLoadingLineCatalog
                      }
                      className="h-8 rounded-lg bg-violet-700 px-3 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {isLoadingData ? "Actualizando..." : "Actualizar ahora"}
                    </Button>
                  </div>
                </div>
                <div className="mb-2">
                  <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                    {lineaN1Options.length === 0
                      ? "Sin lineas N1 disponibles"
                      : `${selectedLineaN1Values.length} de ${lineaN1Options.length} lineas N1 seleccionadas`}
                  </Badge>
                </div>
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {lineaN1Options.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      {targetSedeSelections.length === 0
                        ? "Selecciona al menos una empresa o sede para habilitar las lineas N1."
                        : isLoadingLineCatalog
                          ? "Cargando lineas N1..."
                          : hasLoadedItems && lineasN1ForFilterUi.length === 0
                            ? "No hay lineas N1 en este periodo para la sede elegida (o todas quedaron fuera de las familias marcadas arriba)."
                            : "No hay lineas N1 que mostrar con los filtros actuales."}
                    </p>
                  ) : (
                    lineaN1Options.map((option) => {
                      const isChecked = selectedLineaN1Set.has(option.value);
                      return (
                        <label
                          key={option.value}
                          className="flex items-center gap-2 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setSelectedLineaN1Values((current) =>
                                isChecked
                                  ? current.filter(
                                      (value) => value !== option.value,
                                    )
                                  : [...current, option.value],
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-200"
                          />
                          <span className="font-medium">
                            {option.label}
                            {option.shortName ? (
                              <span className="ml-1 text-[11px] font-normal text-slate-500">
                                {option.shortName}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {selectedCompanies.length > 0
                    ? `${selectedCompanies.length} empresa(s)`
                    : "Todas las empresas"}
                </Badge>
                <Badge className="border-sky-200 bg-sky-50 text-sky-700">
                  {selectedSedes.length > 0
                    ? `${selectedSedes.length} sede(s)`
                    : "Todas las sedes"}
                </Badge>
                <Badge className="border-teal-200 bg-teal-50 text-teal-800">
                  {categoriaFilterOptions.length === 0
                    ? "Sin categorias"
                    : selectedCategoriaKeys.length ===
                        categoriaFilterOptions.length
                      ? "Todas las categorias"
                      : `${selectedCategoriaKeys.length} de ${categoriaFilterOptions.length} categorias`}
                </Badge>
                <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                  {lineaN1FamilyKeys.length === 0 ||
                  lineaN1FamilyKeys.length === ALL_LINEA_N1_FAMILY_KEYS.length
                    ? "Todas las familias"
                    : lineaN1FamilyKeys.length === 1
                      ? LINEA_N1_FAMILY_LABELS[lineaN1FamilyKeys[0]]
                      : lineaN1FamilyKeys
                          .slice()
                          .sort(
                            (a, b) =>
                              ALL_LINEA_N1_FAMILY_KEYS.indexOf(a) -
                              ALL_LINEA_N1_FAMILY_KEYS.indexOf(b),
                          )
                          .map((k) => LINEA_N1_FAMILY_LABELS[k])
                          .join(" + ")}
                </Badge>
                <Badge className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700">
                  {lineaN1Options.length === 0
                    ? "N1 sin datos"
                    : selectedLineaN1Values.length === lineaN1Options.length
                      ? "Todas las lineas N1"
                      : `${selectedLineaN1Values.length} de ${lineaN1Options.length} lineas N1`}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <CalendarDays className="h-5 w-5 text-amber-600" />
                Periodo de consulta
              </CardTitle>
              <CardDescription>
                Por defecto el periodo va desde el mismo dia del mes anterior
                hasta <span className="font-medium text-slate-700">ayer</span>{" "}
                (acotado a los datos disponibles). Puedes cambiarlo cuando
                quieras.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                  {daysConsulted} {daysConsulted === 1 ? "dia" : "dias"}{" "}
                  consultados
                </Badge>
                <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                  {formattedRange}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Desde
                  </span>
                  <input
                    type="date"
                    value={dateRange.start}
                    min={availableRange.start || undefined}
                    max={availableRange.end || undefined}
                    onChange={(event) =>
                      handleStartDateChange(event.target.value)
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Hasta
                  </span>
                  <input
                    type="date"
                    value={dateRange.end}
                    min={availableRange.start || undefined}
                    max={availableRange.end || undefined}
                    onChange={(event) =>
                      handleEndDateChange(event.target.value)
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                  />
                </label>
              </div>

              {availableRange.start && availableRange.end && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
                  Datos disponibles entre{" "}
                  <span className="font-semibold">
                    {formatDateLabel(availableRange.start, dateLabelOptions)}
                  </span>{" "}
                  y{" "}
                  <span className="font-semibold">
                    {formatDateLabel(availableRange.end, dateLabelOptions)}
                  </span>
                  .
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {error ? (
          <Card className="border-dashed border-rose-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-rose-100 p-4 text-rose-700">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                No fue posible cargar la rotacion
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {error}
              </p>
            </CardContent>
          </Card>
        ) : isLoadingData ? (
          <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div
                className="rounded-full bg-amber-100 p-4 text-amber-700"
                aria-hidden
              >
                <Loader2
                  className="h-8 w-8 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                  aria-hidden
                />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Cargando rotacion real
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Estamos leyendo la tabla base y consolidando los items por sede
                para el rango seleccionado.
              </p>
            </CardContent>
          </Card>
        ) : shouldSelectSedeFirst ? (
          <Card className="border-dashed border-sky-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-sky-100 p-4 text-sky-700">
                <MapPin className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Selecciona empresa o sede para consultar
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Mantuvimos visible el catalogo de empresas y sedes, pero la
                tabla solo carga cuando eliges una sede para evitar una consulta
                demasiado pesada sobre toda la base.
              </p>
            </CardContent>
          </Card>
        ) : isLoadingLineCatalog && targetSedeSelections.length > 0 ? (
          <Card className="border-dashed border-violet-200 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-violet-100 p-4 text-violet-700">
                <PackageSearch className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Cargando filtros de la seleccion
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Estamos trayendo lineas N1, categorías y el rango disponible. En
                cuanto termine, la tabla se consultará sola con los filtros
                seleccionados.
              </p>
            </CardContent>
          </Card>
        ) : shouldReloadFirst ? (
          <Card className="border-dashed border-violet-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-violet-100 p-4 text-violet-700">
                <Filter className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                No se pudo cargar el listado
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Pulsa <span className="font-semibold">Actualizar ahora</span>{" "}
                para repetir la consulta. Al cambiar lineas N1 o categorías, la
                tabla suele actualizarse sola en unos instantes sin necesidad de
                ese botón.
              </p>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-amber-100 p-4 text-amber-700">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Sin resultados para los filtros actuales
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                No encontramos items para los filtros actuales en{" "}
                <span className="font-semibold text-slate-800">
                  rotacion_base_item_dia_sede
                </span>
                . Ajusta el rango de fechas o usa el boton{" "}
                <span className="font-semibold">Venta ≤</span> en la tabla para
                filtrar por debajo de un valor.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-5">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                    Buscar por codigo o nombre de producto
                  </span>
                  <div className="relative">
                    <PackageSearch
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={productSearchInput}
                      onChange={(e) => setProductSearchInput(e.target.value)}
                      placeholder="Ej. 12345 o leche"
                      autoComplete="off"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-100"
                      aria-label="Filtrar por codigo o nombre de producto"
                    />
                    {productSearchInput.trim() ? (
                      <button
                        type="button"
                        onClick={() => setProductSearchInput("")}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200/80 hover:text-slate-800"
                        aria-label="Limpiar busqueda"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </label>
              </div>
            </div>
            {rowsAfterProductFilter.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
                <CardContent className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="rounded-full bg-slate-100 p-4 text-slate-600">
                    <PackageSearch className="h-7 w-7" />
                  </div>
                  <h2 className="mt-4 text-xl font-bold text-slate-900">
                    Ningun producto coincide con la busqueda
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                    Prueba otro codigo o fragmento del nombre. La busqueda no
                    distingue mayusculas ni tildes.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 rounded-lg border-slate-300"
                    onClick={() => setProductSearchInput("")}
                  >
                    Limpiar busqueda
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportExcel}
                    disabled={exportRows.length === 0 || isExportingExcel}
                    className="h-9 rounded-lg border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {isExportingExcel ? "Exportando..." : "Descargar Excel"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportPdf}
                    disabled={exportRows.length === 0 || isExportingPdf}
                    className="h-9 rounded-lg border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                  >
                    {isExportingPdf ? "Exportando..." : "Descargar PDF"}
                  </Button>
                  <details ref={whatsappDetailsRef} className="relative group">
                    <summary
                      className="flex h-9 list-none cursor-pointer items-center gap-2 rounded-lg border border-emerald-600 bg-[#25D366] px-3 text-xs font-semibold text-white shadow-sm outline-none transition hover:bg-[#20bd5a] [&::-webkit-details-marker]:hidden disabled:pointer-events-none disabled:opacity-50"
                      aria-label="Enviar tabla por WhatsApp"
                    >
                      <WhatsAppLogo className="h-5 w-5 shrink-0 text-white" />
                      <span className="hidden sm:inline">WhatsApp</span>
                    </summary>
                    <div
                      className="absolute right-0 z-30 mt-1 min-w-[220px] rounded-xl border border-slate-200 bg-white p-2 shadow-lg ring-1 ring-black/5"
                      role="menu"
                    >
                      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Enviar tabla como
                      </p>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={
                            exportRows.length === 0 || isWhatsAppSharing
                          }
                          className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                          onClick={() => void handleWhatsAppShare("png")}
                        >
                          Imagen PNG (sin pérdida)
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={
                            exportRows.length === 0 || isWhatsAppSharing
                          }
                          className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                          onClick={() => void handleWhatsAppShare("jpeg")}
                        >
                          Imagen JPG (98% calidad)
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={
                            exportRows.length === 0 || isWhatsAppSharing
                          }
                          className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                          onClick={() => void handleWhatsAppShare("pdf")}
                        >
                          PDF
                        </button>
                      </div>
                      <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-[11px] leading-snug text-slate-500">
                        Imagen: solo la tabla (paginación por sede), captura
                        ampliada y alta densidad de píxeles. JPG usa calidad
                        98%; WhatsApp puede volver a comprimir al enviar — si no
                        se lee bien, prueba PNG o PDF. PDF: todas las filas
                        filtradas, igual que &quot;Descargar PDF&quot;.{" "}
                        {typeof navigator !== "undefined" &&
                        typeof navigator.share === "function"
                          ? "Con compartir, elige WhatsApp si aparece."
                          : "Se descarga el archivo y se intenta abrir WhatsApp Desktop; si no abre, se usa WhatsApp Web (adjunta el archivo con clip)."}
                      </p>
                    </div>
                  </details>
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Filas por pagina
                  </label>
                  <select
                    value={pageSize}
                    onChange={(event) =>
                      handlePageSizeChange(event.target.value)
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div
                  ref={rotacionTablesExportRef}
                  className="grid gap-5 bg-white p-2"
                >
                  {rowsBySede.map((group) => {
                    const groupKey = `${group.empresa}-${group.sedeId}`;
                    const rowFilter =
                      rowsQuickFilterByGroup[groupKey] ?? "none";
                    const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
                    const ventaHastaCap =
                      rowFilter === "venta_hasta" || rowFilter === "both"
                        ? (ventaHastaCapByGroup[groupKey] ?? null)
                        : null;
                    const filteredRows = applyRowsQuickFilter(
                      group.rows,
                      rowFilter,
                      ventaHastaCap,
                    );
                    /** Misma regla que export: letra ABCD según ventas del conjunto filtrado arriba, sin filtros rápidos de tabla. */
                    const categoryByItem = buildAbcdCategoryByItem(
                      group.rows,
                      abcdConfig,
                    );
                    const abcdCounts = countAbcdItemsByCategory(
                      group.rows,
                      categoryByItem,
                    );
                    const categoryFilteredRows =
                      categoryFilter === "all"
                        ? filteredRows
                        : filteredRows.filter(
                            (row) =>
                              categoryByItem.get(row.item) === categoryFilter,
                          );
                    const infoTotalItems = filteredRows.length;
                    const infoTotalInv = filteredRows.reduce(
                      (acc, row) => acc + row.inventoryValue,
                      0,
                    );
                    const infoTotalSales = filteredRows.reduce(
                      (acc, row) => acc + row.totalSales,
                      0,
                    );
                    const infoTotalMargin = filteredRows.reduce(
                      (acc, row) => acc + row.totalMargin,
                      0,
                    );
                    const selectedCategoryTotalInv =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.inventoryValue,
                        0,
                      );
                    const selectedCategoryTotalSales =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.totalSales,
                        0,
                      );
                    const selectedCategoryTotalMargin =
                      rowFilter === "cero_rotacion"
                        ? 0
                        : categoryFilteredRows.reduce(
                            (acc, row) => acc + row.totalMargin,
                            0,
                          );
                    const selectedCategoryMarginPct =
                      selectedCategoryTotalSales > 0
                        ? (selectedCategoryTotalMargin /
                            selectedCategoryTotalSales) *
                          100
                        : 0;
                    const infoDisplayMargin =
                      rowFilter === "cero_rotacion" ? 0 : infoTotalMargin;
                    const infoMarginPct =
                      infoTotalSales > 0
                        ? (infoDisplayMargin / infoTotalSales) * 100
                        : 0;
                    const infoSalesCoverageDays =
                      infoTotalSales > 0 && daysConsulted > 0
                        ? (infoTotalInv * daysConsulted) / infoTotalSales
                        : infoTotalInv > 0
                          ? NO_SALES_DI_VALUE
                          : 0;
                    const selectedCategorySalesCoverageDays =
                      selectedCategoryTotalSales > 0 && daysConsulted > 0
                        ? (selectedCategoryTotalInv * daysConsulted) /
                          selectedCategoryTotalSales
                        : selectedCategoryTotalInv > 0
                          ? NO_SALES_DI_VALUE
                          : 0;
                    const selectedCategoryLabel =
                      categoryFilter === "all" ? null : categoryFilter;
                    const categoryFilteredCeroRotacionCount =
                      categoryFilteredRows.filter(
                        (row) => row.totalSales <= 0 && row.inventoryUnits > 0,
                      ).length;
                    const ventaHastaInput =
                      ventaHastaInputByGroup[groupKey] ?? "";
                    const ventaHastaDigits =
                      sanitizeNumericInput(ventaHastaInput);
                    const ventaHastaParsedPreviewRaw = Number(ventaHastaDigits);
                    const ventaHastaParsedPreview = Math.max(
                      1,
                      ventaHastaParsedPreviewRaw,
                    );
                    const ventaHastaPreviewCount =
                      ventaHastaDigits.length === 0 ||
                      Number.isNaN(ventaHastaParsedPreviewRaw)
                        ? null
                        : categoryFilteredRows.filter((row) => {
                            const includeZero = rowFilter === "both";
                            return includeZero
                              ? row.totalSales <= ventaHastaParsedPreview
                              : row.totalSales >= 1 &&
                                  row.totalSales <= ventaHastaParsedPreview;
                          }).length;
                    const ceroRotacionCount = group.rows.filter(
                      (row) => row.totalSales <= 0 && row.inventoryUnits > 0,
                    ).length;
                    const totalPages = Math.max(
                      1,
                      Math.ceil(categoryFilteredRows.length / pageSize),
                    );
                    const currentPage = Math.max(
                      1,
                      Math.min(pageByGroupKey[groupKey] ?? 1, totalPages),
                    );
                    const startIndex = (currentPage - 1) * pageSize;
                    const paginatedRows = categoryFilteredRows.slice(
                      startIndex,
                      startIndex + pageSize,
                    );

                    return (
                      <Card
                        key={groupKey}
                        className="rotacion-whatsapp-export-card border-slate-200/80 bg-white shadow-[0_24px_50px_-42px_rgba(15,23,42,0.65)]"
                      >
                        <CardHeader
                          className="border-b border-slate-100 bg-slate-50/70"
                          {...{ [WHATSAPP_TABLE_EXCLUDE]: "" }}
                        >
                          <div className="flex flex-col gap-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                  Información
                                </p>
                                <CardTitle className="text-2xl font-black text-slate-900">
                                  {group.sedeName}
                                </CardTitle>
                                <CardDescription className="max-w-2xl text-sm leading-6 text-slate-600">
                                  {targetSedeSelections.length > 1
                                    ? "Consolidado real de las sedes seleccionadas usando ventas sin impuesto, inventario de cierre y ultimo ingreso sobre el rango seleccionado."
                                    : "Consolidado real por sede usando ventas sin impuesto, inventario de cierre y ultimo ingreso sobre el rango seleccionado."}
                                </CardDescription>
                              </div>
                              <Badge className="shrink-0 border-indigo-200 bg-indigo-50 text-indigo-700">
                                {group.empresa}
                              </Badge>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base font-semibold leading-6 text-slate-700">
                                <span className="whitespace-nowrap">
                                  Total items:{" "}
                                  <span className="font-black text-slate-900">
                                    {infoTotalItems.toLocaleString("es-CO")}
                                  </span>
                                </span>
                                <span className="whitespace-nowrap">
                                  Total inv:{" "}
                                  <span className="font-black text-slate-900">
                                    {formatPriceWithoutSixZeros(infoTotalInv)}
                                  </span>
                                </span>
                              </div>
                              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Por categoría
                              </span>
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <div className="flex flex-wrap items-end gap-2">
                                  <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] font-semibold text-emerald-500">
                                    {abcdConfig.aUntilPercent.toFixed(0)}%
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      setAbcdFilterByGroup((prev) => ({
                                        ...prev,
                                        [groupKey]:
                                          categoryFilter === "A" ? "all" : "A",
                                      }));
                                      setPageByGroupKey((prev) => ({
                                        ...prev,
                                        [groupKey]: 1,
                                      }));
                                    }}
                                    className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                      categoryFilter === "A"
                                        ? "border-emerald-700 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-200"
                                        : "border-emerald-300 bg-emerald-100 text-emerald-900"
                                    }`}
                                  >
                                    A: {abcdCounts.A.toLocaleString("es-CO")}
                                  </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] font-semibold text-amber-500">
                                    {(
                                      abcdConfig.bUntilPercent -
                                      abcdConfig.aUntilPercent
                                    ).toFixed(0)}
                                    %
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      setAbcdFilterByGroup((prev) => ({
                                        ...prev,
                                        [groupKey]:
                                          categoryFilter === "B" ? "all" : "B",
                                      }));
                                      setPageByGroupKey((prev) => ({
                                        ...prev,
                                        [groupKey]: 1,
                                      }));
                                    }}
                                    className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                      categoryFilter === "B"
                                        ? "border-amber-700 bg-amber-500 text-white shadow-md ring-2 ring-amber-200"
                                        : "border-amber-300 bg-amber-100 text-amber-900"
                                    }`}
                                  >
                                    B: {abcdCounts.B.toLocaleString("es-CO")}
                                  </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] font-semibold text-orange-500">
                                    {(
                                      abcdConfig.cUntilPercent -
                                      abcdConfig.bUntilPercent
                                    ).toFixed(0)}
                                    %
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      setAbcdFilterByGroup((prev) => ({
                                        ...prev,
                                        [groupKey]:
                                          categoryFilter === "C" ? "all" : "C",
                                      }));
                                      setPageByGroupKey((prev) => ({
                                        ...prev,
                                        [groupKey]: 1,
                                      }));
                                    }}
                                    className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                      categoryFilter === "C"
                                        ? "border-orange-700 bg-orange-500 text-white shadow-md ring-2 ring-orange-200"
                                        : "border-orange-300 bg-orange-100 text-orange-900"
                                    }`}
                                  >
                                    C: {abcdCounts.C.toLocaleString("es-CO")}
                                  </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                  <span className="text-[10px] font-semibold text-rose-500">
                                    {(100 - abcdConfig.cUntilPercent).toFixed(
                                      0,
                                    )}
                                    %
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      setAbcdFilterByGroup((prev) => ({
                                        ...prev,
                                        [groupKey]:
                                          categoryFilter === "D" ? "all" : "D",
                                      }));
                                      setPageByGroupKey((prev) => ({
                                        ...prev,
                                        [groupKey]: 1,
                                      }));
                                    }}
                                    className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                      categoryFilter === "D"
                                        ? "border-rose-700 bg-rose-600 text-white shadow-md ring-2 ring-rose-200"
                                        : "border-rose-300 bg-rose-100 text-rose-900"
                                    }`}
                                  >
                                    D: {abcdCounts.D.toLocaleString("es-CO")}
                                  </Button>
                                  </div>
                                </div>
                                {rowFilter === "none" ? (
                                  <div className="ml-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                                    <div className="space-y-1">
                                      <div className="whitespace-nowrap">
                                        Total venta:{" "}
                                        <span className="font-black text-slate-900">
                                          {formatPriceWithoutSixZeros(infoTotalSales)}
                                        </span>
                                      </div>
                                      <div className="whitespace-nowrap">
                                        Margen de venta %:{" "}
                                        <span className="font-black text-slate-900">
                                          {formatPercent(infoMarginPct)}
                                        </span>
                                      </div>
                                      <div className="whitespace-nowrap">
                                        Dias de inventario:{" "}
                                        <span className="font-black text-slate-900">
                                          {formatRotationOneDecimal(
                                            infoSalesCoverageDays,
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              {selectedCategoryLabel ? (
                                <div className="flex w-full flex-wrap items-start justify-between gap-4 pt-1 text-sm text-slate-600">
                                  <div className="min-w-0 space-y-1">
                                    <div>
                                      Total venta:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPriceWithoutSixZeros(
                                          selectedCategoryTotalSales,
                                        )}
                                      </span>
                                    </div>
                                    <div>
                                      Total inventario:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPriceWithoutSixZeros(
                                          selectedCategoryTotalInv,
                                        )}
                                      </span>
                                    </div>
                                    <div>
                                      Dias de inventario:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatRotationOneDecimal(
                                          selectedCategorySalesCoverageDays,
                                        )}
                                      </span>
                                    </div>
                                    <div>
                                      Margen {selectedCategoryLabel} %:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPercent(
                                          selectedCategoryMarginPct,
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="border-t border-slate-200/90 pt-5">
                              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                Filtros y resumen
                              </p>
                              <div className="flex flex-col gap-3">
                                <Badge
                                  className="w-fit border-slate-200 bg-white text-slate-700"
                                  title={
                                    rowFilter !== "none"
                                      ? "Items que cumplen el filtro rapido (sobre el total cargado para esta sede)"
                                      : undefined
                                  }
                                >
                                  {rowFilter === "none"
                                    ? group.rows.length
                                    : filteredRows.length}{" "}
                                  items
                                </Badge>
                                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                                  <Button
                                    type="button"
                                    variant={
                                      rowFilter === "cero_rotacion" ||
                                      rowFilter === "both"
                                        ? "default"
                                        : "outline"
                                    }
                                    title="Venta del periodo en cero e inventario de cierre mayor que cero"
                                    className={`h-8 rounded-full px-3 text-xs font-semibold ${
                                      rowFilter === "cero_rotacion" ||
                                      rowFilter === "both"
                                        ? "bg-amber-600 text-white hover:bg-amber-700"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      toggleGroupRowsQuickFilter(
                                        groupKey,
                                        "cero_rotacion",
                                      )
                                    }
                                  >
                                    Cero rotacion (
                                    {categoryFilter === "all"
                                      ? ceroRotacionCount
                                      : categoryFilteredCeroRotacionCount}
                                    )
                                  </Button>
                                  <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1">
                                    <Button
                                      type="button"
                                      variant={
                                        rowFilter === "venta_hasta" ||
                                        rowFilter === "both"
                                          ? "default"
                                          : "outline"
                                      }
                                      title="Filtrar items con venta del periodo menor o igual al valor ingresado"
                                      className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${
                                        rowFilter === "venta_hasta" ||
                                        rowFilter === "both"
                                          ? "bg-emerald-700 text-white hover:bg-emerald-800"
                                          : ""
                                      }`}
                                      onClick={() =>
                                        applyOrToggleVentaHastaFilter(groupKey)
                                      }
                                    >
                                      {(rowFilter === "venta_hasta" ||
                                        rowFilter === "both") &&
                                      ventaHastaCapByGroup[groupKey] != null
                                        ? `Venta ≤ ${formatPrice(ventaHastaCapByGroup[groupKey]!)} (${categoryFilteredRows.length})`
                                        : ventaHastaPreviewCount != null
                                          ? `Venta ≤ (${ventaHastaPreviewCount})`
                                          : "Venta ≤"}
                                    </Button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      placeholder="COP"
                                      aria-label="Tope venta periodo para filtrar"
                                      value={ventaHastaInput}
                                      onChange={(e) =>
                                        setVentaHastaInputByGroup((prev) => ({
                                          ...prev,
                                          [groupKey]: sanitizeNumericInput(
                                            e.target.value,
                                          ),
                                        }))
                                      }
                                      className="h-7 w-22 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-300 focus:ring-1 focus:ring-amber-100"
                                    />
                                  </div>
                                </div>
                                {rowFilter !== "none" ? (
                                  <div className="w-full space-y-1 pt-2 text-sm text-slate-600">
                                    <div>
                                      Total venta:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPrice(infoTotalSales)}
                                      </span>
                                    </div>
                                    <div>
                                      Total inv:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPriceWithoutSixZeros(infoTotalInv)}
                                      </span>
                                    </div>
                                    <div>
                                      Margen:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPrice(infoDisplayMargin)}
                                      </span>
                                    </div>
                                    <div>
                                      Margen %:{" "}
                                      <span className="font-black text-slate-900">
                                        {formatPercent(infoMarginPct)}
                                      </span>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-5 py-3 text-xs text-slate-600"
                          {...{ [WHATSAPP_TABLE_EXCLUDE]: "" }}
                        >
                          <span>
                            Mostrando{" "}
                            <span className="font-semibold text-slate-800">
                              {categoryFilteredRows.length === 0
                                ? 0
                                : startIndex + 1}
                            </span>{" "}
                            a{" "}
                            <span className="font-semibold text-slate-800">
                              {Math.min(
                                startIndex + pageSize,
                                categoryFilteredRows.length,
                              )}
                            </span>{" "}
                            de{" "}
                            <span className="font-semibold text-slate-800">
                              {categoryFilteredRows.length}
                            </span>{" "}
                            items
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-md px-3 text-xs font-semibold"
                              onClick={() =>
                                setGroupPage(
                                  groupKey,
                                  currentPage - 1,
                                  totalPages,
                                )
                              }
                              disabled={currentPage <= 1}
                            >
                              Anterior
                            </Button>
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Pagina {currentPage} de {totalPages}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-md px-3 text-xs font-semibold"
                              onClick={() =>
                                setGroupPage(
                                  groupKey,
                                  currentPage + 1,
                                  totalPages,
                                )
                              }
                              disabled={currentPage >= totalPages}
                            >
                              Siguiente
                            </Button>
                          </div>
                        </div>
                        <CardContent className="px-0 py-0">
                          <Table
                            containerClassName="rotacion-table-capture-scroll min-w-0 overflow-x-auto overscroll-x-contain"
                            className="rotacion-sticky-table w-full min-w-[72rem] table-fixed border-collapse text-sm"
                          >
                            <colgroup>
                              {ROTACION_TABLE_COL_WIDTHS.map((w, i) => (
                                <col key={i} style={{ width: w }} />
                              ))}
                            </colgroup>
                            <TableHeader>
                              <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="item"
                                    label="Item"
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-1 py-2 text-center align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-600 backdrop-blur-sm">
                                  Cat.
                                </TableHead>
                                <TableHead className="border-b border-slate-200 bg-slate-50/95 px-2 py-2 align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="descripcion"
                                    label="Descripcion"
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="totalSales"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        Venta
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="totalMargin"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        Margen
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <span className="block text-[11px] leading-tight text-slate-700">
                                    Margen %
                                  </span>
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="inventoryUnits"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        Inv.
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="totalUnits"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        U. vend.
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="inventoryValue"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        V. inv.
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 py-2 pl-4 pr-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="rotation"
                                    align="right"
                                    label="DI"
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 py-2 pl-4 pr-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="trackedDays"
                                    align="right"
                                    label="DIE"
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 py-2 pl-4 pr-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="salesEffectiveDays"
                                    align="right"
                                    label="DVE"
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                                <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                  <SortableRotationHeader
                                    field="lastMovementDate"
                                    align="right"
                                    label={
                                      <span className="block text-[11px] leading-tight">
                                        Ult. ingr.
                                      </span>
                                    }
                                    activeField={tableSortField}
                                    direction={tableSortDirection}
                                    onSort={handleTableSort}
                                  />
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {paginatedRows.map((row) => (
                                <TableRow key={`${group.sedeId}-${row.item}`}>
                                  <TableCell className="whitespace-nowrap px-2 py-2 align-top font-semibold text-slate-900">
                                    <span className="text-xs">{row.item}</span>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-1 py-2 text-center align-top">
                                    {(() => {
                                      const category =
                                        categoryByItem.get(row.item) ?? "D";
                                      const colorClass =
                                        category === "A"
                                          ? "border-emerald-300 bg-emerald-200 text-emerald-900"
                                          : category === "B"
                                            ? "border-amber-300 bg-amber-200 text-amber-900"
                                            : category === "C"
                                              ? "border-orange-300 bg-orange-200 text-orange-900"
                                              : "border-rose-300 bg-rose-200 text-rose-900";
                                      return (
                                        <Badge
                                          className={`min-w-7 justify-center px-1.5 py-0 text-xs font-black ${colorClass}`}
                                        >
                                          {category}
                                        </Badge>
                                      );
                                    })()}
                                  </TableCell>
                                  <TableCell className="min-w-0 px-2 py-2 align-top whitespace-normal">
                                    <div className="wrap-break-word">
                                      <p className="text-[13px] font-medium leading-snug text-slate-900">
                                        {row.descripcion}
                                      </p>
                                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                                        Linea {row.linea}
                                        {row.lineaN1Codigo
                                          ? ` | N1 ${row.lineaN1Codigo}`
                                          : ""}
                                        {row.unidad ? ` | ${row.unidad}` : ""}
                                      </p>
                                    </div>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                    {formatPrice(row.totalSales)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                    {formatPrice(
                                      rowFilter === "cero_rotacion"
                                        ? 0
                                        : row.totalMargin,
                                    )}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                    {formatPercent(
                                      row.totalSales > 0
                                        ? ((rowFilter === "cero_rotacion"
                                            ? 0
                                            : row.totalMargin) /
                                            row.totalSales) *
                                            100
                                        : 0,
                                    )}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-sm tabular-nums text-slate-700">
                                    {row.inventoryUnits.toLocaleString("es-CO")}{" "}
                                    {row.unidad ?? ""}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-sm tabular-nums text-slate-700">
                                    {row.totalUnits.toLocaleString("es-CO")}
                                    {row.unidad ? ` ${row.unidad}` : ""}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                    {formatPrice(row.inventoryValue)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top tabular-nums text-slate-700">
                                    {formatRotationOneDecimal(row.rotation)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top text-xs tabular-nums text-slate-600">
                                    {row.trackedDays.toLocaleString("es-CO")}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top text-xs tabular-nums text-slate-600">
                                    {formatRotationOneDecimal(
                                      calculateSalesCoverageDays(row),
                                    )}
                                  </TableCell>
                            <TableCell className="px-2 py-2 text-right align-top text-xs leading-tight tabular-nums text-slate-700 whitespace-normal wrap-break-word">
                                    {row.lastMovementDate
                                      ? formatDateLabel(
                                          row.lastMovementDate,
                                          dateLabelOptions,
                                        )
                                      : "Sin fecha de ingreso"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {isAbcdModalOpen && canEditAbcdConfig ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotacion-abcd-modal-title"
          onClick={() => setIsAbcdModalOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              onClick={() => setIsAbcdModalOpen(false)}
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
            <h2
              id="rotacion-abcd-modal-title"
              className="pr-10 text-lg font-bold text-emerald-900"
            >
              Clasificacion ABCD
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Umbrales por venta acumulada del periodo (D llega hasta 100%).
            </p>
            <div className="mt-4 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
              <p className="text-xs font-semibold text-emerald-900">
                Guardar configuracion para:
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="abcd-save-scope"
                  checked={abcdSaveScope === "global"}
                  onChange={() => setAbcdSaveScope("global")}
                  className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-200"
                />
                <span>Todas las sedes</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="abcd-save-scope"
                  checked={abcdSaveScope === "sede"}
                  onChange={() => setAbcdSaveScope("sede")}
                  disabled={!singleSelectedSedeTarget}
                  className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-200 disabled:opacity-50"
                />
                <span>
                  Solo esta sede
                  {singleSelectedSedeTarget
                    ? ` (${singleSelectedSedeTarget.sedeName})`
                    : " (selecciona una sola sede)"}
                </span>
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-emerald-900">
                A hasta %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={abcdDraftConfig.aUntilPercent}
                  onChange={(event) =>
                    setAbcdDraftConfig((prev) =>
                      normalizeAbcdConfig({
                        ...prev,
                        aUntilPercent: Number(event.target.value || 0),
                      }),
                    )
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="text-xs font-semibold text-emerald-900">
                B hasta %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={abcdDraftConfig.bUntilPercent}
                  onChange={(event) =>
                    setAbcdDraftConfig((prev) =>
                      normalizeAbcdConfig({
                        ...prev,
                        bUntilPercent: Number(event.target.value || 0),
                      }),
                    )
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="text-xs font-semibold text-emerald-900">
                C hasta %
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={abcdDraftConfig.cUntilPercent}
                  onChange={(event) =>
                    setAbcdDraftConfig((prev) =>
                      normalizeAbcdConfig({
                        ...prev,
                        cUntilPercent: Number(event.target.value || 0),
                      }),
                    )
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setIsAbcdModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="rounded-full bg-emerald-700 text-white hover:bg-emerald-800"
                disabled={
                  isSavingAbcdConfig ||
                  (abcdSaveScope === "sede" && !singleSelectedSedeTarget)
                }
                onClick={() => void handleSaveAbcdConfig()}
              >
                {isSavingAbcdConfig ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
