"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Filter,
  MapPin,
  PackageSearch,
  Store,
  TrendingDown,
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
import { canAccessRotacionBoard } from "@/lib/special-role-features";
import { formatDateLabel } from "@/lib/utils";

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
  totalSales: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  lastMovementDate: string | null;
  effectiveDays: number | null;
  status: "Agotado" | "Futuro agotado" | "Baja rotacion" | "En seguimiento";
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

type LineaN1Option = {
  value: string;
  label: string;
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
  | "inventoryUnits"
  | "inventoryValue"
  | "rotation"
  | "lastMovementDate"
  | "status";

type RotationSortDirection = "asc" | "desc";
type PageSize = 25 | 50 | 100;

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_SALES_THRESHOLD = 200000;
const NO_SALES_DI_VALUE = 999999;
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

/** Fin = hoy (o tope de datos); inicio = mismo día un mes calendario atrás, acotado a datos disponibles. */
const getRollingMonthBackRange = (
  minAvailable: string,
  maxAvailable: string,
): DateRange => {
  const todayKey = toDateKey(new Date());
  const endKey = clampDateKeyToBounds(todayKey, minAvailable, maxAvailable);
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

const sanitizeNumericInput = (value: string) => value.replace(/\D/g, "");

const sanitizeSalesThresholdInput = (value: string) => {
  const normalized = sanitizeNumericInput(value);
  if (!normalized) return "";
  return String(Math.min(Number(normalized), MAX_SALES_THRESHOLD));
};

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

const formatRotationOneDecimal = (value: number) => {
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return (Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
};

const clampPercent = (value: number) =>
  Math.max(1, Math.min(100, Number.isFinite(value) ? value : 0));

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
      case "lastMovementDate":
        result = compareNullableIsoDateKeys(
          left.lastMovementDate,
          right.lastMovementDate,
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
    const key = `${row.empresa}::${row.sedeId}::${row.sedeName}`;
    const current = grouped.get(key) ?? {
      empresa: row.empresa,
      sedeId: row.sedeId,
      sedeName: row.sedeName,
      rows: [],
    };
    current.rows.push(row);
    grouped.set(key, current);
  });

  return Array.from(grouped.values());
};

/** Filtros rápidos por bloque de sede (tabla). */
type GroupRowsQuickFilter =
  | "none"
  | "cero_rotacion"
  | "venta_hasta";

const applyRowsQuickFilter = (
  rows: RotationRow[],
  filter: GroupRowsQuickFilter,
  ventaHastaMax: number | null,
): RotationRow[] => {
  if (filter === "none") return rows;
  if (filter === "cero_rotacion") {
    return rows.filter(
      (row) => row.totalSales <= 0 && row.inventoryUnits > 0,
    );
  }
  if (filter === "venta_hasta") {
    if (ventaHastaMax == null || Number.isNaN(ventaHastaMax)) return rows;
    return rows.filter((row) => row.totalSales <= ventaHastaMax);
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

const parseSedeSelection = (value: string) => {
  if (!value) return null;
  const [empresa, sedeId] = value.split("::");
  if (!empresa || !sedeId) return null;
  return { empresa, sedeId };
};

type StatCardProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  description: string;
  iconClassName: string;
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  description,
  iconClassName,
}: StatCardProps) => (
  <Card className="border-slate-200/80 bg-white/95 shadow-[0_22px_45px_-40px_rgba(15,23,42,0.45)]">
    <CardContent className="flex items-start justify-between gap-4 px-5 py-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {label}
        </p>
        <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>
      <div className={`rounded-2xl p-3 ${iconClassName}`}>
        <Icon className="h-5 w-5" />
      </div>
    </CardContent>
  </Card>
);

type SortableRotationHeaderProps = {
  field: RotationSortField;
  label: React.ReactNode;
  activeField: RotationSortField | null;
  direction: RotationSortDirection;
  onSort: (field: RotationSortField) => void;
};

const WhatsAppLogo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden
    {...props}
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const SortableRotationHeader = ({
  field,
  label,
  activeField,
  direction,
  onSort,
}: SortableRotationHeaderProps) => {
  const isActive = activeField === field;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex w-full items-center gap-2 text-left transition-colors ${
        isActive ? "text-amber-700" : "text-slate-700 hover:text-amber-700"
      }`}
      aria-pressed={isActive}
    >
      <span className="block flex-1">{label}</span>
      <ArrowUp
        className={`h-3.5 w-3.5 shrink-0 transition-all ${
          isActive
            ? `opacity-100 ${direction === "desc" ? "rotate-180" : ""}`
            : "opacity-35"
        }`}
      />
    </button>
  );
};

type SelectFieldProps = {
  icon: React.ElementType;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  allLabel: string;
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
  value,
  options,
  onChange,
  allLabel,
  accentClassName,
  disabled = false,
}: SelectFieldProps) => (
  <label className="block">
    <FilterFieldLabel
      icon={Icon}
      label={label}
      accentClassName={accentClassName}
    />
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 outline-none transition-all focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

export default function RotacionPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingAbcdConfig, setIsSavingAbcdConfig] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [selectedSede, setSelectedSede] = useState("");
  const [salesThreshold, setSalesThreshold] = useState(
    String(MAX_SALES_THRESHOLD),
  );
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
  const [abcdConfig, setAbcdConfig] = useState<AbcdConfig>(DEFAULT_ABCD_CONFIG);
  const [abcdDraftConfig, setAbcdDraftConfig] =
    useState<AbcdConfig>(DEFAULT_ABCD_CONFIG);
  const [filterCatalog, setFilterCatalog] = useState<
    RotationApiResponse["filters"]
  >({
    companies: [],
    sedes: [],
    lineasN1: [],
  });
  const [error, setError] = useState<string | null>(null);
  const skipNextFetchRef = useRef(false);
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
  const rotacionTablesExportRef = useRef<HTMLDivElement>(null);
  const whatsappDetailsRef = useRef<HTMLDetailsElement>(null);
  const whatsappShareLockRef = useRef(false);

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
    if (!ready) return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const controller = new AbortController();

    const loadLineCatalog = async () => {
      setIsLoadingLineCatalog(true);
      setError(null);
      setRows([]);
      setHasLoadedItems(false);

      try {
        const hadEmptyDateRange = !dateRange.start || !dateRange.end;
        const params = new URLSearchParams();
        const selectedSedeMeta = parseSedeSelection(selectedSede);
        const effectiveCompany = selectedSedeMeta?.empresa ?? selectedCompany;

        if (dateRange.start && dateRange.end) {
          params.set("start", dateRange.start);
          params.set("end", dateRange.end);
        }
        if (effectiveCompany) {
          params.set("empresa", effectiveCompany);
        }
        if (selectedSedeMeta?.sedeId) {
          params.set("sede", selectedSedeMeta.sedeId);
        }
        params.set("catalogOnly", "1");

        const response = await fetch(
          `/api/rotacion${params.size > 0 ? `?${params.toString()}` : ""}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as RotationApiResponse;
        if (!response.ok) {
          throw new Error(
            payload.error ?? "No fue posible consultar la rotacion.",
          );
        }

        setFilterCatalog(
          payload.filters ?? {
            companies: [],
            sedes: [],
            lineasN1: [],
          },
        );
        const allLineasN1 = payload.filters?.lineasN1 ?? [];
        setSelectedLineaN1Values(allLineasN1);
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
          setDateRange(payload.meta.effectiveRange);
        }

        if (selectedSedeMeta?.sedeId) {
          setIsLoadingData(true);
          try {
            const rowsParams = new URLSearchParams();
            if (dateRange.start && dateRange.end) {
              rowsParams.set("start", dateRange.start);
              rowsParams.set("end", dateRange.end);
            }
            if (effectiveCompany) {
              rowsParams.set("empresa", effectiveCompany);
            }
            rowsParams.set("sede", selectedSedeMeta.sedeId);
            allLineasN1.forEach((linea) => {
              rowsParams.append("lineasN1", linea);
            });

            const rowsResponse = await fetch(
              `/api/rotacion${rowsParams.size > 0 ? `?${rowsParams.toString()}` : ""}`,
              {
                signal: controller.signal,
                cache: "no-store",
              },
            );
            if (rowsResponse.status === 401) {
              router.replace("/login");
              return;
            }
            if (rowsResponse.status === 403) {
              router.replace("/secciones");
              return;
            }

            const rowsPayload = (await rowsResponse.json()) as RotationApiResponse;
            if (!rowsResponse.ok) {
              throw new Error(
                rowsPayload.error ?? "No fue posible consultar la rotacion.",
              );
            }
            setRows(rowsPayload.rows ?? []);
            if (rowsPayload.meta?.abcdConfig) {
              const normalizedConfig = normalizeAbcdConfig(
                rowsPayload.meta.abcdConfig,
              );
              setAbcdConfig(normalizedConfig);
              setAbcdDraftConfig(normalizedConfig);
            }
            setHasLoadedItems(true);
          } finally {
            setIsLoadingData(false);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRows([]);
        setHasLoadedItems(false);
        setError(
          err instanceof Error ? err.message : "Error consultando rotacion.",
        );
      } finally {
        setIsLoadingLineCatalog(false);
      }
    };

    void loadLineCatalog();
    return () => controller.abort();
  }, [
    dateRange.end,
    dateRange.start,
    ready,
    router,
    selectedCompany,
    selectedSede,
  ]);

  const daysConsulted = useMemo(
    () => countInclusiveDays(dateRange),
    [dateRange],
  );
  const formattedRange = useMemo(
    () => formatRangeLabel(dateRange),
    [dateRange],
  );
  const parsedThreshold = salesThreshold
    ? Number(salesThreshold)
    : MAX_SALES_THRESHOLD;
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
          const cleanedSedeName = formatSedeLabel(option.sedeName);
          return {
            value: `${option.empresa}::${option.sedeId}`,
            label: `${formatCompanyLabel(option.empresa)} - ${cleanedSedeName}`,
            empresa: option.empresa,
            sedeId: option.sedeId,
            sedeName: cleanedSedeName,
          };
        })
        .filter((option) => option.sedeName.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [filterCatalog.sedes],
  );

  const sedeOptions = useMemo(() => {
    const scopedOptions = selectedCompany
      ? allSedeOptions.filter((option) => option.empresa === selectedCompany)
      : allSedeOptions;

    return scopedOptions.map((option) => ({
      value: option.value,
      label: selectedCompany ? option.sedeName : option.label,
    }));
  }, [allSedeOptions, selectedCompany]);

  const selectedSedeMeta = useMemo(
    () =>
      allSedeOptions.find((option) => option.value === selectedSede) ?? null,
    [allSedeOptions, selectedSede],
  );

  const lineaN1Options = useMemo<LineaN1Option[]>(
    () =>
      [...filterCatalog.lineasN1]
        .map((value) => ({
          value,
          label: value === "__sin_n1__" ? "Sin N1" : `N1 ${value}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [filterCatalog.lineasN1],
  );

  const selectedLineaN1Set = useMemo(
    () => new Set(selectedLineaN1Values),
    [selectedLineaN1Values],
  );

  useEffect(() => {
    if (!selectedSede) return;
    if (!sedeOptions.some((option) => option.value === selectedSede)) {
      setSelectedSede("");
    }
  }, [selectedSede, sedeOptions]);

  const sortedRows = useMemo(
    () => sortRotationRows(rows, tableSortField, tableSortDirection),
    [rows, tableSortDirection, tableSortField],
  );
  const rowsBySede = useMemo(() => buildRowsBySede(sortedRows), [sortedRows]);
  const visibleStats = useMemo(
    () => ({
      evaluatedSedes: new Set(rows.map((row) => row.sedeName)).size,
      visibleItems: rows.length,
    }),
    [rows],
  );

  const handleValueChange = (value: string) => {
    setSalesThreshold(sanitizeSalesThresholdInput(value));
  };

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

  const handleReloadRows = async () => {
    if (!selectedSede) return;

    const selectedSedeMeta = parseSedeSelection(selectedSede);
    if (!selectedSedeMeta?.sedeId) return;

    setIsLoadingData(true);
    setError(null);
    setHasLoadedItems(true);

    try {
      const params = new URLSearchParams();
      const effectiveCompany = selectedSedeMeta.empresa ?? selectedCompany;

      if (dateRange.start && dateRange.end) {
        params.set("start", dateRange.start);
        params.set("end", dateRange.end);
      }
      if (effectiveCompany) {
        params.set("empresa", effectiveCompany);
      }
      params.set("sede", selectedSedeMeta.sedeId);
      if (salesThreshold) {
        params.set("maxSalesValue", salesThreshold);
      }
      selectedLineaN1Values.forEach((linea) => {
        params.append("lineasN1", linea);
      });

      const response = await fetch(
        `/api/rotacion${params.size > 0 ? `?${params.toString()}` : ""}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        router.replace("/secciones");
        return;
      }
      const payload = (await response.json()) as RotationApiResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible consultar la rotacion.");
      }

      setRows(payload.rows ?? []);
      if (payload.meta?.abcdConfig) {
        const normalizedConfig = normalizeAbcdConfig(payload.meta.abcdConfig);
        setAbcdConfig(normalizedConfig);
        setAbcdDraftConfig(normalizedConfig);
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Error consultando rotacion.");
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleSaveAbcdConfig = async () => {
    if (!isAdmin || isSavingAbcdConfig) return;
    setIsSavingAbcdConfig(true);
    setError(null);
    try {
      const normalized = normalizeAbcdConfig(abcdDraftConfig);
      const response = await fetch("/api/rotacion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
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
    filter: Exclude<GroupRowsQuickFilter, "none" | "venta_hasta">,
  ) => {
    setRowsQuickFilterByGroup((prev) => {
      const current = prev[groupKey] ?? "none";
      const next: GroupRowsQuickFilter =
        current === filter ? "none" : filter;
      return { ...prev, [groupKey]: next };
    });
    setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
  };

  const applyOrToggleVentaHastaFilter = (groupKey: string) => {
    const current = rowsQuickFilterByGroup[groupKey] ?? "none";
    if (current === "venta_hasta") {
      setRowsQuickFilterByGroup((prev) => ({ ...prev, [groupKey]: "none" }));
      setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
      return;
    }
    const raw = ventaHastaInputByGroup[groupKey] ?? "";
    const parsed = Number(sanitizeNumericInput(raw));
    if (Number.isNaN(parsed) || parsed < 0) return;
    setVentaHastaCapByGroup((prev) => ({ ...prev, [groupKey]: parsed }));
    setRowsQuickFilterByGroup((prev) => ({ ...prev, [groupKey]: "venta_hasta" }));
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

  const shouldSelectSedeFirst = !selectedSede;
  const shouldReloadFirst = selectedSede && !hasLoadedItems;

  const exportRows = useMemo(
    () =>
      rowsBySede.flatMap((group) => {
        const groupKey = `${group.empresa}-${group.sedeId}`;
        const rowFilter = rowsQuickFilterByGroup[groupKey] ?? "none";
        const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
        const ventaHastaCap =
          rowFilter === "venta_hasta"
            ? (ventaHastaCapByGroup[groupKey] ?? null)
            : null;
        const filteredRows = applyRowsQuickFilter(
          group.rows,
          rowFilter,
          ventaHastaCap,
        );
        const categoryByItem = buildAbcdCategoryByItem(filteredRows, abcdConfig);
        const categoryFilteredRows =
          categoryFilter === "all"
            ? filteredRows
            : filteredRows.filter(
                (row) => categoryByItem.get(row.item) === categoryFilter,
              );
        return categoryFilteredRows.map((row) => ({
          empresa: formatCompanyLabel(row.empresa),
          sede: row.sedeName,
          item: row.item,
          descripcion: row.descripcion,
          ventaPeriodo: row.totalSales,
          invCierre: row.inventoryUnits,
          unidad: row.unidad ?? "",
          valorInventario: row.inventoryValue,
          rotacion: formatRotationOneDecimal(row.rotation),
          ultimoIngreso: row.lastMovementDate
            ? formatDateLabel(row.lastMovementDate, dateLabelOptions)
            : "Sin fecha de ingreso",
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
      head: [[
        "Empresa",
        "Sede",
        "Item",
        "Descripcion",
        "Venta periodo",
        "Inv cierre",
        "Unidad",
        "Valor inventario",
        "DI (dias inv.)",
        "Ultimo ingreso",
      ]],
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
        row.ultimoIngreso,
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
        { header: "Ultimo ingreso", key: "ultimoIngreso", width: 16 },
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
      buildRotacionPdfDocument().save(
        `rotacion_${buildExportFileStamp()}.pdf`,
      );
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
          window.open(
            "https://web.whatsapp.com/",
            "_blank",
            "noopener,noreferrer",
          );
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
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-foreground sm:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
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
              <div className="flex flex-wrap items-center gap-2">
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
            </div>
          </CardContent>
        </Card>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(320px,1fr)]">
          <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <Filter className="h-5 w-5 text-amber-600" />
                Filtros principales
              </CardTitle>
              <CardDescription>
                Selecciona empresa y sede; el umbral de venta se define en el
                periodo de consulta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <FilterSelectField
                  icon={Building2}
                  label="Empresa"
                  value={selectedCompany}
                  options={companyOptions}
                  onChange={(value) => {
                    setSelectedCompany(value);
                    setSelectedSede("");
                  }}
                  allLabel={
                    isLoadingLineCatalog && companyOptions.length === 0
                      ? "Cargando empresas..."
                      : "Todas las empresas"
                  }
                  accentClassName="text-indigo-700"
                  disabled={isLoadingLineCatalog && companyOptions.length === 0}
                />
                <FilterSelectField
                  icon={MapPin}
                  label="Sede"
                  value={selectedSede}
                  options={sedeOptions}
                  onChange={(value) => {
                    setSelectedSede(value);
                    if (!value) return;
                    const nextSede = allSedeOptions.find(
                      (option) => option.value === value,
                    );
                    if (nextSede) {
                      setSelectedCompany(nextSede.empresa);
                    }
                  }}
                  allLabel={
                    isLoadingLineCatalog && allSedeOptions.length === 0
                      ? "Cargando sedes..."
                      : "Todas las sedes"
                  }
                  accentClassName="text-sky-700"
                  disabled={isLoadingLineCatalog && allSedeOptions.length === 0}
                />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <FilterFieldLabel
                    icon={Filter}
                    label="Lineas nivel 1"
                    accentClassName="text-violet-700"
                  />
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
                      disabled={lineaN1Options.length === 0 || isLoadingLineCatalog}
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
                      disabled={!selectedSede || isLoadingData || isLoadingLineCatalog}
                      className="h-8 rounded-lg bg-violet-700 px-3 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {isLoadingData ? "Recargando..." : "Recargar"}
                    </Button>
                  </div>
                </div>
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {lineaN1Options.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Selecciona una sede para habilitar las lineas N1.
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
                                  ? current.filter((value) => value !== option.value)
                                  : [...current, option.value],
                              )
                            }
                            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-200"
                          />
                          <span className="font-medium">{option.label}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                      Clasificacion ABCD (editable)
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSaveAbcdConfig()}
                      disabled={isSavingAbcdConfig}
                      className="h-8 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {isSavingAbcdConfig ? "Guardando..." : "Guardar ABCD"}
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
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
                  <p className="mt-2 text-xs text-emerald-900/90">
                    D siempre va hasta 100%.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  {selectedCompany
                    ? formatCompanyLabel(selectedCompany)
                    : "Todas las empresas"}
                </Badge>
                <Badge className="border-sky-200 bg-sky-50 text-sky-700">
                  {selectedSede
                    ? selectedCompany
                      ? (selectedSedeMeta?.sedeName ?? selectedSede)
                      : (selectedSedeMeta?.label ?? selectedSede)
                    : "Todas las sedes"}
                </Badge>
                <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                  Venta ≤ {formatPrice(parsedThreshold)}
                </Badge>
                <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                  {lineaN1Options.length === 0
                    ? "N1 sin datos"
                    : selectedLineaN1Values.length === lineaN1Options.length
                      ? "Todas las lineas N1"
                      : `${selectedLineaN1Values.length} de ${lineaN1Options.length} lineas N1`}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <CalendarDays className="h-5 w-5 text-amber-600" />
                Periodo de consulta
              </CardTitle>
              <CardDescription>
                Elige primero las fechas: por defecto el periodo es desde el
                mismo dia del mes anterior hasta hoy (dentro de los datos
                disponibles). Luego ajusta la venta maxima del periodo.
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

              <label className="block">
                <FilterFieldLabel
                  icon={Filter}
                  label="Venta maxima del periodo"
                  accentClassName="text-slate-500"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={salesThreshold}
                  onChange={(event) => handleValueChange(event.target.value)}
                  placeholder="Maximo 200000"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-4 focus:ring-amber-100"
                />
              </label>
              <p className="text-xs leading-5 text-slate-500">
                Solo números enteros, sin puntos ni comas. El filtro usa la venta
                acumulada del producto dentro del rango seleccionado y se limita
                a un máximo de 200.000.
              </p>

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

        <section className="grid gap-4 md:grid-cols-2">
          <StatCard
            icon={Store}
            label="Sedes evaluadas"
            value={String(visibleStats.evaluatedSedes)}
            description="Sedes visibles con inventario dentro de los filtros actuales."
            iconClassName="bg-amber-100 text-amber-700"
          />
          <StatCard
            icon={TrendingDown}
            label="Items visibles"
            value={String(visibleStats.visibleItems)}
            description="Referencias mostradas con datos reales del rango consultado."
            iconClassName="bg-sky-100 text-sky-700"
          />
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
              <div className="rounded-full bg-amber-100 p-4 text-amber-700">
                <PackageSearch className="h-7 w-7" />
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
                Selecciona una sede para consultar
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Mantuvimos visible el catalogo de empresas y sedes, pero la
                tabla solo carga cuando eliges una sede para evitar una consulta
                demasiado pesada sobre toda la base.
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
                Selecciona lineas N1 y pulsa Recargar
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                El listado de items solo se consulta cuando confirmas las lineas
                N1 con el botón <span className="font-semibold">Recargar</span>.
              </p>
            </CardContent>
          </Card>
        ) : rowsBySede.length === 0 ? (
          <Card className="border-dashed border-amber-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
            <CardContent className="flex flex-col items-center px-6 py-12 text-center">
              <div className="rounded-full bg-amber-100 p-4 text-amber-700">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                Sin resultados para los filtros actuales
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                No encontramos items cuya venta del período esté dentro del
                umbral actual en{" "}
                <span className="font-semibold text-slate-800">
                  rotacion_base_item_dia_sede
                </span>
                . Ajusta el rango o sube el tope de venta para ampliar la
                lectura.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-5">
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
              <details
                ref={whatsappDetailsRef}
                className="relative group"
              >
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
                    Imagen: solo la tabla (paginación por sede), captura ampliada y
                    alta densidad de píxeles. JPG usa calidad 98%; WhatsApp puede
                    volver a comprimir al enviar — si no se lee bien, prueba PNG o
                    PDF. PDF: todas las filas filtradas, igual que &quot;Descargar
                    PDF&quot;.{" "}
                    {typeof navigator !== "undefined" &&
                    typeof navigator.share === "function"
                      ? "Con compartir, elige WhatsApp si aparece."
                      : "Se descarga el archivo y se abre WhatsApp Web: adjunta el archivo (clip)."}
                  </p>
                </div>
              </details>
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Filas por pagina
              </label>
              <select
                value={pageSize}
                onChange={(event) => handlePageSizeChange(event.target.value)}
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
              const lowRotation = group.rows.filter(
                (row) => row.status === "Baja rotacion",
              ).length;
              const groupKey = `${group.empresa}-${group.sedeId}`;
              const rowFilter = rowsQuickFilterByGroup[groupKey] ?? "none";
              const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
              const ventaHastaCap =
                rowFilter === "venta_hasta"
                  ? (ventaHastaCapByGroup[groupKey] ?? null)
                  : null;
              const filteredRows = applyRowsQuickFilter(
                group.rows,
                rowFilter,
                ventaHastaCap,
              );
              const categoryByItem = buildAbcdCategoryByItem(
                filteredRows,
                abcdConfig,
              );
              const categoryFilteredRows =
                categoryFilter === "all"
                  ? filteredRows
                  : filteredRows.filter(
                      (row) => categoryByItem.get(row.item) === categoryFilter,
                    );
              const categoryFilteredLowRotation = categoryFilteredRows.filter(
                (row) => row.status === "Baja rotacion",
              ).length;
              const categoryFilteredCeroRotacionCount = categoryFilteredRows.filter(
                (row) => row.totalSales <= 0 && row.inventoryUnits > 0,
              ).length;
              const ventaHastaInput = ventaHastaInputByGroup[groupKey] ?? "";
              const ventaHastaDigits = sanitizeNumericInput(ventaHastaInput);
              const ventaHastaParsedPreview = Number(ventaHastaDigits);
              const ventaHastaPreviewCount =
                ventaHastaDigits.length === 0 ||
                Number.isNaN(ventaHastaParsedPreview)
                  ? null
                  : categoryFilteredRows.filter(
                      (row) => row.totalSales <= ventaHastaParsedPreview,
                    ).length;
              const totalItemsCount = categoryFilteredRows.length;
              const totalInventoryValue = categoryFilteredRows.reduce(
                (acc, row) => acc + row.inventoryValue,
                0,
              );
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
                  className="rotacion-whatsapp-export-card overflow-hidden border-slate-200/80 bg-white shadow-[0_24px_50px_-42px_rgba(15,23,42,0.65)]"
                >
                  <CardHeader
                    className="border-b border-slate-100 bg-slate-50/70"
                    {...{ [WHATSAPP_TABLE_EXCLUDE]: "" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-2xl font-black text-slate-900">
                          {group.sedeName}
                        </CardTitle>
                        <CardDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                          Consolidado real por sede usando ventas sin impuesto,
                          inventario de cierre y ultimo ingreso sobre el rango
                          seleccionado.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
                          {group.empresa}
                        </Badge>
                        <Badge
                          className="border-slate-200 bg-white text-slate-700"
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
                        <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                          {categoryFilter === "all"
                            ? lowRotation
                            : categoryFilteredLowRotation}{" "}
                          baja rotacion
                        </Badge>
                        <Button
                          type="button"
                          variant={
                            rowFilter === "cero_rotacion" ? "default" : "outline"
                          }
                          title="Venta del periodo en cero e inventario de cierre mayor que cero"
                          className={`h-8 rounded-full px-3 text-xs font-semibold ${
                            rowFilter === "cero_rotacion"
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
                              rowFilter === "venta_hasta" ? "default" : "outline"
                            }
                            title="Filtrar items con venta del periodo menor o igual al valor ingresado"
                            className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${
                              rowFilter === "venta_hasta"
                                ? "bg-emerald-700 text-white hover:bg-emerald-800"
                                : ""
                            }`}
                            onClick={() => applyOrToggleVentaHastaFilter(groupKey)}
                          >
                            {rowFilter === "venta_hasta" &&
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
                        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                          <span className="text-[11px] font-semibold text-slate-600">
                            ABCD
                          </span>
                          <select
                            value={categoryFilter}
                            onChange={(event) => {
                              const nextValue = event.target
                                .value as GroupAbcdFilter;
                              setAbcdFilterByGroup((prev) => ({
                                ...prev,
                                [groupKey]: nextValue,
                              }));
                              setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
                            }}
                            className="h-7 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-800 outline-none focus:border-amber-300 focus:ring-1 focus:ring-amber-100"
                          >
                            <option value="all">Todas</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                            <option value="D">D</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-3 text-sm leading-5 text-slate-600">
                          <span className="whitespace-nowrap">
                            Total items:{" "}
                            <span className="font-semibold text-slate-800">
                              {totalItemsCount.toLocaleString("es-CO")}
                            </span>
                          </span>
                          <span className="whitespace-nowrap">
                            Total inv:{" "}
                            <span className="font-semibold text-slate-800">
                              {formatPrice(totalInventoryValue)}
                            </span>
                          </span>
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
                        {categoryFilteredRows.length === 0 ? 0 : startIndex + 1}
                      </span>{" "}
                      a{" "}
                      <span className="font-semibold text-slate-800">
                        {Math.min(startIndex + pageSize, categoryFilteredRows.length)}
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
                          setGroupPage(groupKey, currentPage - 1, totalPages)
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
                          setGroupPage(groupKey, currentPage + 1, totalPages)
                        }
                        disabled={currentPage >= totalPages}
                      >
                        Siguiente
                      </Button>
                    </div>
                  </div>
                  <CardContent className="rotacion-table-capture-scroll overflow-x-auto px-0 py-0">
                    <Table className="min-w-[1180px]">
                      <TableHeader>
                        <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                          <TableHead className="px-4 py-3">
                            <SortableRotationHeader
                              field="item"
                              label="Item"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-nowrap">
                            Categoria
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-normal">
                            <SortableRotationHeader
                              field="descripcion"
                              label="Descripcion"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-normal">
                            <SortableRotationHeader
                              field="totalSales"
                              label="Venta periodo"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-normal">
                            <SortableRotationHeader
                              field="inventoryUnits"
                              label="Inv. cierre"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-normal">
                            <SortableRotationHeader
                              field="inventoryValue"
                              label="Valor inventario"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3">
                            <SortableRotationHeader
                              field="rotation"
                              label="DI (dias inv.)"
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                            />
                          </TableHead>
                          <TableHead className="px-4 py-3 whitespace-normal">
                            <SortableRotationHeader
                              field="lastMovementDate"
                              label="Ult. ingreso"
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
                            <TableCell className="px-4 py-3 font-semibold text-slate-900">
                              {row.item}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-center">
                              {(() => {
                                const category = categoryByItem.get(row.item) ?? "D";
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
                                    className={`min-w-8 justify-center px-2 py-0.5 text-sm font-black ${colorClass}`}
                                  >
                                    {category}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="px-4 py-3 whitespace-normal">
                              <div className="min-w-[24rem]">
                                <p className="font-medium text-slate-900">
                                  {row.descripcion}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Linea {row.linea}
                                  {row.lineaN1Codigo
                                    ? ` | N1 ${row.lineaN1Codigo}`
                                    : ""}
                                  {row.unidad ? ` | ${row.unidad}` : ""}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {formatPrice(row.totalSales)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {row.inventoryUnits.toLocaleString("es-CO")}{" "}
                              {row.unidad ?? ""}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {formatPrice(row.inventoryValue)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700">
                              {formatRotationOneDecimal(row.rotation)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-slate-700 whitespace-normal">
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
          </section>
        )}
      </div>
    </div>
  );
}
