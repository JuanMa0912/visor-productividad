"use client";

import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toJpeg } from "html-to-image";
import * as ExcelJS from "exceljs";
import {
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Database,
  Filter,
  Loader2,
  MapPin,
  PackageSearch,
  Search,
} from "lucide-react";
import {
  INVENTARIO_SUBCATEGORY_LABELS,
  INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS,
  compareInventarioMatrixSedeRows,
  stripInventarioSedeDisplayPrefix,
  type InventarioSubcategoryKey,
} from "@/lib/inventario/x-item";
import {
  MAX_ITEM_PRESETS,
  normalizeItemPresetsFromUnknown,
  type ItemPreset,
} from "@/lib/inventario/x-item-presets";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { formatDateLabel } from "@/lib/shared/utils";

type InventarioSummaryRow = {
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
  companyCount: number;
  sedeCount: number;
};

type InventarioMatrixRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  totalUnits: number;
  trackedDays: number;
  rotationDays: number;
};

type InventarioFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
};

type InventarioApiResponse = {
  rows: InventarioSummaryRow[];
  matrixRows: InventarioMatrixRow[];
  filters: InventarioFilterCatalog;
  meta: {
    availableDate: string;
    availableDateStart?: string;
    availableDateEnd?: string;
    selectedDateStart?: string;
    selectedDateEnd?: string;
    sourceTable: string;
    selectedCompany?: string | null;
    selectedSede?: string | null;
  };
  message?: string;
  error?: string;
};

type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  key?: string;
};

type LineSelectionMode = "unset" | "all" | "specific";
type MatrixSortDirection = "asc" | "desc";
type MatrixSortField = "sede" | string;

const ALL_FILTER_VALUE = "__all__";
const ITEM_DROPDOWN_NO_SEARCH_LIMIT = 120;
const ITEM_DROPDOWN_SEARCH_LIMIT = 250;
/** Clave legacy en localStorage; se migra una vez al servidor por usuario. */
const ITEM_PRESETS_STORAGE_KEY = "inventario-x-item:item-presets:v1";
const NO_SALES_DI_VALUE = 999999;

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const dateLabelOptions: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "long",
  year: "numeric",
};

/**
 * Rango por defecto: 1 mes corrido hacia atras (misma logica que `/rotacion`)
 * para que DI calce exactamente con el DIC sin necesidad de entrar por deep
 * link. Es `end - 1 mes calendario + 1 dia`, p.ej. `2026-05-20` -> `2026-04-21`.
 *
 * Nunca devuelve un `start` anterior a `min` (limite real de datos) ni un
 * rango invertido.
 */
const defaultRollingMonthBackRange = (
  min: string,
  max: string,
): { start: string; end: string } | null => {
  if (!max || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return null;
  const endAtNoon = new Date(`${max}T12:00:00`);
  if (Number.isNaN(endAtNoon.getTime())) return null;

  const formatYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const oneMonthBack = new Date(endAtNoon);
  oneMonthBack.setMonth(oneMonthBack.getMonth() - 1);
  oneMonthBack.setDate(oneMonthBack.getDate() + 1);
  let start = formatYMD(oneMonthBack);

  if (start > max) start = max;
  if (min && /^\d{4}-\d{2}-\d{2}$/.test(min) && start < min) start = min;
  return { start, end: max };
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, "es", { sensitivity: "base", numeric: true });

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

const formatUnits = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);

const formatDi = (value: number) => {
  if (!Number.isFinite(value)) return "Sin venta";
  if (value >= NO_SALES_DI_VALUE) return "Sin venta";
  return `${(Math.round(value * 10) / 10).toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} d`;
};

type MatrixCellValue = {
  inventoryUnits: number;
  diDays: number;
};

/** Misma formula que la API de rotacion (rotation): inv*cierre * dias_con_dato / ventas_periodo; sin ventas -> NO_SALES. */
const calculateDiDays = (
  row: Pick<
    InventarioSummaryRow,
    "inventoryUnits" | "inventoryValue" | "totalUnits" | "trackedDays"
  >,
) => {
  if (row.inventoryUnits <= 0 || row.inventoryValue <= 0) return 0;
  if (row.totalUnits <= 0 || row.trackedDays <= 0) return NO_SALES_DI_VALUE;
  return (row.inventoryUnits * row.trackedDays) / row.totalUnits;
};

type SummaryItemAgg = InventarioSummaryRow & {
  diWeightedNum: number;
  diWeightedDen: number;
  anyNoSalesDi: boolean;
};

const buildSedeOptionValue = (empresa: string, sedeId: string) =>
  `${encodeURIComponent(empresa)}::${encodeURIComponent(sedeId)}`;

const parseSedeOptionValue = (
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

const SelectField = ({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  emptyLabel,
  disabled = false,
  invalid = false,
  helperText,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  emptyLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  helperText?: string;
}) => (
  <label className="block">
    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-blue-600" />
      {label}
    </span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={`w-full rounded-2xl border bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid
          ? "border-red-300 hover:border-red-400 focus:border-red-300 focus:ring-red-100"
          : "border-slate-200/70 hover:border-slate-300 focus:border-blue-300 focus:ring-blue-100"
      }`}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.key ?? option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {helperText ? (
      <p
        className={`mt-2 text-xs leading-5 ${
          invalid ? "text-red-600" : "text-slate-500"
        }`}
      >
        {helperText}
      </p>
    ) : null}
  </label>
);

const MultiSelectField = ({
  icon: Icon,
  label,
  values,
  options,
  visibleOptions,
  onChange,
  emptyLabel,
  maxSelected,
  searchable = false,
  searchValue = "",
  onSearchChange,
  totalResultsCount,
  truncatedResults = false,
  disabled = false,
  invalid = false,
  helperText,
  allLabel,
  selectAllLabel,
  onSelectAll,
  onClearSelection,
  clearLabel,
  allSelected = false,
}: {
  icon: React.ElementType;
  label: string;
  values: string[];
  options: SelectOption[];
  visibleOptions?: SelectOption[];
  onChange: (value: string[]) => void;
  emptyLabel: string;
  maxSelected?: number;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  totalResultsCount?: number;
  truncatedResults?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  helperText?: string;
  allLabel?: string;
  selectAllLabel?: string;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  clearLabel?: string;
  allSelected?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectedOptions = options.filter((option) => values.includes(option.value));
  const renderedOptions = visibleOptions ?? options;
  const selectedPreview = allSelected
    ? []
    : selectedOptions.slice(0, 2);
  const hiddenSelectedOptions = allSelected ? [] : selectedOptions.slice(2);
  const remainingSelectedCount = Math.max(0, selectedOptions.length - selectedPreview.length);
  const limitReached =
    maxSelected !== undefined && maxSelected > 0 && values.length >= maxSelected;

  const selectionCountLabel =
    allSelected
      ? "Todas"
      : values.length > 0
        ? maxSelected
          ? `${values.length}/${maxSelected}`
          : `${values.length}`
        : maxSelected
          ? `0/${maxSelected}`
          : null;

  /** Con busqueda y sin seleccion: no mostramos fila inferior (solo Buscar + contadores; la lista abre al foco en Buscar). */
  const hideSearchableSelectionRow =
    Boolean(searchable && onSearchChange) && !allSelected && selectedOptions.length === 0;

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    if (limitReached) return;
    onChange([...values, value]);
  };

  return (
    <div className="block" ref={menuRef}>
      <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <Icon className="h-3.5 w-3.5 text-blue-600" />
        {label}
      </span>

      <div className="relative">
        {searchable && onSearchChange ? (
          <div
            className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow focus-within:shadow-md ${
              invalid
                ? "border-red-300 ring-1 ring-red-100"
                : "border-slate-200/70 focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100/80"
            }`}
          >
            <label className="flex items-center gap-2 bg-slate-50/90 px-3 py-2 transition-colors focus-within:bg-white">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                onFocus={() => {
                  if (!disabled) setOpen(true);
                }}
                placeholder="Buscar..."
                disabled={disabled}
                className="min-h-0 w-full bg-transparent py-0.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <div
              className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-slate-100 px-3 py-1 ${
                hideSearchableSelectionRow ? "rounded-b-2xl pb-2" : ""
              }`}
            >
              <span className="text-[10px] font-medium tabular-nums text-slate-500">
                {renderedOptions.length} de {totalResultsCount ?? options.length}{" "}
                resultados
              </span>
              {truncatedResults ? (
                <span className="text-[10px] leading-tight text-amber-800">
                  Lista parcial: escribe mas para acotar.
                </span>
              ) : null}
            </div>
            {!hideSearchableSelectionRow ? (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                disabled={disabled}
                className="flex w-full items-start justify-between gap-2 border-t border-slate-100 bg-white px-3 py-2 text-left text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  {allSelected ? (
                    <span className="block truncate">{allLabel ?? emptyLabel}</span>
                  ) : selectedOptions.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {selectedPreview.map((option) => (
                        <span
                          key={option.key ?? option.value}
                          className="max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                          title={option.label}
                        >
                          <span className="block truncate">{option.label}</span>
                        </span>
                      ))}
                      {remainingSelectedCount > 0 && (
                        <span className="group/summary relative inline-flex">
                          <span
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                            title={hiddenSelectedOptions.map((option) => option.label).join("\n")}
                          >
                            +{remainingSelectedCount}
                          </span>
                          <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-30 hidden w-max max-w-72 -translate-x-1/2 rounded-2xl border border-slate-200/80 bg-slate-950/95 px-3 py-2 text-left text-[11px] font-medium leading-5 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.6)] group-hover/summary:block">
                            {hiddenSelectedOptions.map((option) => (
                              <span
                                key={option.key ?? option.value}
                                className="block whitespace-normal"
                              >
                                {option.label}
                              </span>
                            ))}
                          </span>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="block truncate text-slate-500">{emptyLabel}</span>
                  )}
                </span>
                {selectionCountLabel ? (
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {selectionCountLabel}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : (
          <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              disabled={disabled}
              className={`flex w-full items-start justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                invalid
                  ? "border-red-300 hover:border-red-400 focus:border-red-300 focus:ring-red-100"
                  : "border-slate-200/70 hover:border-slate-300 focus:border-blue-300 focus:ring-blue-100"
              }`}
            >
              <span className="min-w-0 flex-1">
                {allSelected ? (
                  <span className="block truncate">{allLabel ?? emptyLabel}</span>
                ) : selectedOptions.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {selectedPreview.map((option) => (
                      <span
                        key={option.key ?? option.value}
                        className="max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                        title={option.label}
                      >
                        <span className="block truncate">{option.label}</span>
                      </span>
                    ))}
                    {remainingSelectedCount > 0 && (
                      <span className="group/summary relative inline-flex">
                        <span
                          className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                          title={hiddenSelectedOptions.map((option) => option.label).join("\n")}
                        >
                          +{remainingSelectedCount}
                        </span>
                        <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-30 hidden w-max max-w-72 -translate-x-1/2 rounded-2xl border border-slate-200/80 bg-slate-950/95 px-3 py-2 text-left text-[11px] font-medium leading-5 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.6)] group-hover/summary:block">
                          {hiddenSelectedOptions.map((option) => (
                            <span
                              key={option.key ?? option.value}
                              className="block whitespace-normal"
                            >
                              {option.label}
                            </span>
                          ))}
                        </span>
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="block truncate text-slate-500">{emptyLabel}</span>
                )}
              </span>
              {selectionCountLabel ? (
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {selectionCountLabel}
                </span>
              ) : null}
            </button>
        )}

        {open && (
          <div className="absolute left-0 top-full z-30 mt-0.5 w-full rounded-b-2xl rounded-t-lg border border-slate-200/90 bg-white p-1.5 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.35)]">
            {(onSelectAll || onClearSelection) && (
              <div className="mb-1 flex flex-wrap gap-1 border-b border-slate-100 px-1 pb-1">
                {onSelectAll && (
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    {selectAllLabel ?? allLabel ?? emptyLabel}
                  </button>
                )}
                {onClearSelection && (
                  <button
                    type="button"
                    onClick={onClearSelection}
                    className="rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-slate-50"
                  >
                    {clearLabel ?? "Limpiar filtro"}
                  </button>
                )}
              </div>
            )}

            <div className="max-h-60 space-y-0.5 overflow-auto pr-0.5 sm:max-h-72">
              {renderedOptions.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">
                  No hay opciones disponibles para este filtro.
                </p>
              ) : (
                renderedOptions.map((option) => {
                  const checked = values.includes(option.value);
                  const disabledOption = !checked && Boolean(limitReached);
                  return (
                    <button
                      key={option.key ?? option.value}
                      type="button"
                      onClick={() => toggleValue(option.value)}
                      disabled={disabledOption}
                      className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                        disabledOption
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {option.label}
                        </p>
                        {option.hint && (
                          <p className="mt-0.5 text-xs leading-5 text-slate-500">
                            {option.hint}
                          </p>
                        )}
                      </div>
                      <span
                        className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          checked
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {maxSelected && limitReached && (
              <p className="mt-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">
                Maximo {maxSelected} seleccionados
              </p>
            )}
          </div>
        )}
      </div>
      {helperText ? (
        <p
          className={`mt-1.5 text-xs leading-snug ${
            invalid ? "text-red-600" : "text-slate-500"
          }`}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

export default function InventarioXItemPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingJpg, setExportingJpg] = useState(false);
  /** Variante visual usada SOLO durante la generacion del JPG. */
  const [jpgExportMode, setJpgExportMode] = useState<"full" | "di-only">("full");
  const [jpgMenuOpen, setJpgMenuOpen] = useState(false);
  const jpgMenuRef = useRef<HTMLDivElement | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const excelMenuRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<InventarioSummaryRow[]>([]);
  const [matrixRows, setMatrixRows] = useState<InventarioMatrixRow[]>([]);
  const [filters, setFilters] = useState<InventarioFilterCatalog>({
    companies: [],
    sedes: [],
  });
  const [availableDate, setAvailableDate] = useState("");
  const [availableDateStart, setAvailableDateStart] = useState("");
  const [availableDateEnd, setAvailableDateEnd] = useState("");
  const [selectedDateStartState, setSelectedDateStartState] = useState("");
  const [selectedDateEndState, setSelectedDateEndState] = useState("");
  const [selectedCompanyState, setSelectedCompanyState] = useState<string[]>([]);
  const [selectedSedeState, setSelectedSedeState] = useState<string[]>([]);
  const [selectedLinesState, setSelectedLinesState] = useState<string[]>([]);
  const [selectedSubcategoryState, setSelectedSubcategoryState] = useState<
    "" | typeof ALL_FILTER_VALUE | InventarioSubcategoryKey
  >(ALL_FILTER_VALUE);
  const [selectedItemsState, setSelectedItemsState] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const deferredItemSearch = useDeferredValue(itemSearch);
  const loading = loadingFilters || loadingCatalog || loadingMatrix;
  const [catalogLoadedScopeKey, setCatalogLoadedScopeKey] = useState("");
  const [lineSelectionMode, setLineSelectionMode] =
    useState<LineSelectionMode>("all");
  const [showValidation, setShowValidation] = useState(false);
  const [appliedMatrixKey, setAppliedMatrixKey] = useState("");
  const [matrixSortField, setMatrixSortField] = useState<MatrixSortField>("sede");
  const [matrixSortDirection, setMatrixSortDirection] =
    useState<MatrixSortDirection>("asc");
  const [itemPresets, setItemPresets] = useState<ItemPreset[]>([]);
  const [presetNameInput, setPresetNameInput] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const matrixImageRef = useRef<HTMLDivElement | null>(null);
  const pendingInventarioDeepLinkRef = useRef<{
    item: string;
    needsScope: boolean;
  } | null>(null);
  const inventarioDeepLinkInitRef = useRef(false);
  /** Marca si ya seleccionamos automaticamente todas las empresas/sedes al
   * cargar los filtros iniciales (default: todas, el usuario solo elige items). */
  const autoScopeAppliedRef = useRef(false);
  /** Marca si ya aplicamos el default "mes corrido" al cargar metadatos por
   * primera vez. Evita pisar selecciones manuales del usuario en recargas. */
  const monthToDateDefaultAppliedRef = useRef(false);

  const persistItemPresetsRemote = useCallback(
    async (presets: ItemPreset[]): Promise<boolean> => {
      const csrf = getCookieValue("vp_csrf");
      if (!csrf) {
        setError("No se pudo validar la sesion. Recargue la pagina.");
        return false;
      }
      try {
        const res = await fetch("/api/inventario-x-item/presets", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({ presets }),
        });
        if (res.status === 401) {
          router.replace("/login");
          return false;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "No se pudieron guardar los presets.");
          return false;
        }
        setError(null);
        return true;
      } catch {
        setError("No se pudieron guardar los presets.");
        return false;
      }
    },
    [router],
  );

  const loadItemPresetsFromServer = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      try {
        const res = await fetch("/api/inventario-x-item/presets", {
          cache: "no-store",
          credentials: "include",
          signal,
        });
        if (res.status === 401) {
          router.replace("/login");
          setItemPresets([]);
          return false;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            data.error ?? "No se pudieron cargar los presets. Intenta recargar.",
          );
          return true;
        }
        setError(null);
        const data = (await res.json()) as { presets?: unknown };
        let presets = normalizeItemPresetsFromUnknown(data.presets);
        if (presets.length === 0 && typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem(ITEM_PRESETS_STORAGE_KEY);
            if (raw) {
              const local = normalizeItemPresetsFromUnknown(JSON.parse(raw) as unknown);
              if (local.length > 0) {
                const migrated = await persistItemPresetsRemote(local);
                if (migrated) {
                  window.localStorage.removeItem(ITEM_PRESETS_STORAGE_KEY);
                  presets = local;
                }
              }
            }
          } catch {
            /* ignorar migracion */
          }
        }
        setItemPresets(presets);
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return false;
        setError("No se pudieron cargar los presets. Verifica tu conexion.");
        return true;
      }
    },
    [router, persistItemPresetsRemote],
  );

  useEffect(() => {
    if (inventarioDeepLinkInitRef.current) return;
    inventarioDeepLinkInitRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const item = params.get("item")?.trim();
    const dateStart = params.get("dateStart")?.trim();
    const dateEnd = params.get("dateEnd")?.trim();
    if (dateStart) setSelectedDateStartState(dateStart);
    if (dateEnd) setSelectedDateEndState(dateEnd);
    if (item) {
      pendingInventarioDeepLinkRef.current = { item, needsScope: true };
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUserAndPresets = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
          credentials: "include",
        });

        if (response.status === 401) {
          if (isMounted) router.replace("/login");
          return;
        }
        if (!response.ok) return;

        const payload = (await response.json()) as {
          user?: {
            role?: string;
            allowedDashboards?: string[] | null;
            allowedSubdashboards?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          (!canAccessPortalSection(payload.user?.allowedDashboards, "venta") ||
            !canAccessPortalSubsection(
              payload.user?.allowedSubdashboards,
              "inventario-x-item",
            ))
        ) {
          if (isMounted) router.replace("/secciones");
          return;
        }

        if (!isMounted) return;
        const presetsLoaded = await loadItemPresetsFromServer(controller.signal);
        if (!isMounted || !presetsLoaded) return;
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUserAndPresets();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router, loadItemPresetsFromServer]);

  const resetScopedData = useCallback(() => {
    setRows([]);
    setMatrixRows([]);
    setSelectedLinesState([]);
    setLineSelectionMode("all");
    setSelectedSubcategoryState(ALL_FILTER_VALUE);
    setSelectedItemsState([]);
    setItemSearch("");
    setCatalogLoadedScopeKey("");
    setAppliedMatrixKey("");
    setError(null);
    setMessage(null);
  }, []);

  const resetDependentSelections = useCallback(() => {
    setRows([]);
    setMatrixRows([]);
    setSelectedLinesState([]);
    setLineSelectionMode("all");
    setSelectedSubcategoryState(ALL_FILTER_VALUE);
    setSelectedItemsState([]);
    setItemSearch("");
    setCatalogLoadedScopeKey("");
    setAppliedMatrixKey("");
    setError(null);
    setMessage(null);
  }, []);

  const availableSedeOptions = useMemo(
    () =>
      selectedCompanyState.length > 0
        ? filters.sedes.filter((sede) =>
            selectedCompanyState.includes(sede.empresa),
          )
        : filters.sedes,
    [filters.sedes, selectedCompanyState],
  );

  const selectedSede = useMemo(
    () => {
      const optionSet = new Set(
        availableSedeOptions.map((sede) =>
          buildSedeOptionValue(sede.empresa, sede.sedeId),
        ),
      );
      return selectedSedeState.filter((value) => optionSet.has(value));
    },
    [availableSedeOptions, selectedSedeState],
  );
  const selectedSedeIds = useMemo(
    () =>
      selectedSede
        .map((value) => parseSedeOptionValue(value)?.sedeId ?? null)
        .filter((value): value is string => Boolean(value)),
    [selectedSede],
  );
  const effectiveCompanies = useMemo(
    () =>
      selectedCompanyState.length > 0 ? selectedCompanyState : filters.companies,
    [filters.companies, selectedCompanyState],
  );
  const selectedDateStart = selectedDateStartState;
  const selectedDateEnd = selectedDateEndState || selectedDateStartState;
  const catalogScopeKey = `${effectiveCompanies.slice().sort().join(",")}::${selectedSede
    .slice()
    .sort()
    .join(",")}::${selectedDateStart}::${selectedDateEnd}`;
  const selectedSubcategory =
    selectedSubcategoryState === ALL_FILTER_VALUE
      ? "all"
      : selectedSubcategoryState;
  const hasCompanySelection = selectedCompanyState.length > 0;
  const hasSedeSelection = selectedSede.length > 0;
  const hasScopeSelection = hasCompanySelection && hasSedeSelection;

  const loadFilterOptions = useCallback(
    async (signal?: AbortSignal) => {
      setLoadingFilters(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("mode", "filters");
        if (selectedDateStart) params.set("dateStart", selectedDateStart);
        if (selectedDateEnd) params.set("dateEnd", selectedDateEnd);
        const response = await fetch(
          `/api/inventario-x-item?${params.toString()}`,
          { signal },
        );

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as InventarioApiResponse;
        if (!response.ok) {
          throw new Error(
            payload.error ?? "No fue posible consultar los filtros de inventario.",
          );
        }

        setFilters(
          payload.filters ?? {
            companies: [],
            sedes: [],
          },
        );
        setAvailableDate(payload.meta?.availableDate ?? "");
        setAvailableDateStart(payload.meta?.availableDateStart ?? "");
        setAvailableDateEnd(payload.meta?.availableDateEnd ?? "");
        const meta = payload.meta;

        const shouldApplyMonthToDateDefault =
          !monthToDateDefaultAppliedRef.current &&
          !selectedDateStartState &&
          !selectedDateEndState &&
          !pendingInventarioDeepLinkRef.current?.item &&
          Boolean(meta?.availableDateEnd);
        if (shouldApplyMonthToDateDefault) {
          const rolling = defaultRollingMonthBackRange(
            meta?.availableDateStart ?? "",
            meta?.availableDateEnd ?? "",
          );
          if (rolling) {
            setSelectedDateStartState(rolling.start);
            setSelectedDateEndState(rolling.end);
            monthToDateDefaultAppliedRef.current = true;
            return;
          }
        }

        if (meta?.selectedDateStart) {
          setSelectedDateStartState(meta.selectedDateStart);
        } else if (!selectedDateStartState) {
          const start =
            meta?.availableDateStart ?? meta?.availableDateEnd ?? "";
          if (start) setSelectedDateStartState(start);
        }
        if (meta?.selectedDateEnd) {
          setSelectedDateEndState(meta.selectedDateEnd);
        } else if (!selectedDateEndState) {
          const end = meta?.availableDateEnd ?? meta?.availableDateStart ?? "";
          if (end) setSelectedDateEndState(end);
        }
        monthToDateDefaultAppliedRef.current = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFilters({
          companies: [],
          sedes: [],
        });
        setError(
          err instanceof Error
            ? err.message
            : "Error desconocido consultando inventario por item.",
        );
      } finally {
        setLoadingFilters(false);
      }
    },
    [router, selectedDateEnd, selectedDateStart, selectedDateEndState, selectedDateStartState],
  );

  const loadCatalogData = useCallback(
    async (signal?: AbortSignal) => {
      setLoadingCatalog(true);
      setError(null);
      setMessage(null);

      try {
        const params = new URLSearchParams();
        params.set("mode", "catalog");
        effectiveCompanies.forEach((company) => params.append("empresa", company));
        selectedSedeIds.forEach((sedeId) => params.append("sede", sedeId));
        if (selectedDateStart) params.set("dateStart", selectedDateStart);
        if (selectedDateEnd) params.set("dateEnd", selectedDateEnd);

        const response = await fetch(
          `/api/inventario-x-item${params.size > 0 ? `?${params.toString()}` : ""}`,
          { signal },
        );

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as InventarioApiResponse;
        if (!response.ok) {
          throw new Error(
            payload.error ?? "No fue posible consultar el inventario por item.",
          );
        }

        setRows(payload.rows ?? []);
        setAvailableDate(payload.meta?.availableDate ?? "");
        setAvailableDateStart(payload.meta?.availableDateStart ?? "");
        setAvailableDateEnd(payload.meta?.availableDateEnd ?? "");
        if (payload.meta?.selectedDateStart) {
          setSelectedDateStartState(payload.meta.selectedDateStart);
        }
        if (payload.meta?.selectedDateEnd) {
          setSelectedDateEndState(payload.meta.selectedDateEnd);
        }
        setMessage(payload.message ?? null);
        setCatalogLoadedScopeKey(catalogScopeKey);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRows([]);
        setCatalogLoadedScopeKey("");
        setError(
          err instanceof Error
            ? err.message
            : "Error desconocido consultando inventario por item.",
        );
      } finally {
        setLoadingCatalog(false);
      }
    },
    [
      catalogScopeKey,
      effectiveCompanies,
      router,
      selectedSedeIds,
      selectedDateEnd,
      selectedDateStart,
    ],
  );

  useEffect(() => {
    if (!ready) return;
    if (autoScopeAppliedRef.current) return;
    if (filters.companies.length === 0 || filters.sedes.length === 0) return;
    if (selectedCompanyState.length === 0) {
      setSelectedCompanyState([...filters.companies]);
      setSelectedSedeState(
        filters.sedes.map((sede) =>
          buildSedeOptionValue(sede.empresa, sede.sedeId),
        ),
      );
    }
    autoScopeAppliedRef.current = true;
    const pending = pendingInventarioDeepLinkRef.current;
    if (pending) {
      pending.needsScope = false;
    }
  }, [
    filters.companies,
    filters.sedes,
    ready,
    selectedCompanyState.length,
  ]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void loadFilterOptions(controller.signal);
    return () => controller.abort();
  }, [loadFilterOptions, ready, selectedDateEnd, selectedDateStart]);

  useEffect(() => {
    if (!ready || !hasScopeSelection) return;
    const controller = new AbortController();
    void loadCatalogData(controller.signal);
    return () => controller.abort();
  }, [hasScopeSelection, loadCatalogData, ready]);

  const companyOptions = useMemo<SelectOption[]>(
    () =>
      filters.companies.map((company) => ({
        value: company,
        label: company.toUpperCase(),
        key: `company-${company}`,
      })),
    [filters.companies],
  );

  const sedeOptions = useMemo<SelectOption[]>(
    () =>
      [...availableSedeOptions]
        .sort((left, right) =>
          compareInventarioMatrixSedeRows(
            left.empresa,
            left.sedeName,
            right.empresa,
            right.sedeName,
          ),
        )
        .map((sede) => {
          const shortName = stripInventarioSedeDisplayPrefix(sede.sedeName);
          return {
            value: buildSedeOptionValue(sede.empresa, sede.sedeId),
            label:
              selectedCompanyState.length > 0
                ? shortName
                : `${shortName} (${sede.empresa.toUpperCase()})`,
            key: buildSedeOptionValue(sede.empresa, sede.sedeId),
          };
        }),
    [availableSedeOptions, selectedCompanyState],
  );

  const lineOptions = useMemo<SelectOption[]>(() => {
    const lineMap = new Map<
      string,
      {
        label: string;
        itemCount: number;
        inventoryValue: number;
        subcategory: InventarioSubcategoryKey;
      }
    >();

    rows.forEach((row) => {
      const current = lineMap.get(row.lineKey);
      if (current) {
        current.itemCount += 1;
        current.inventoryValue += row.inventoryValue;
        return;
      }

      lineMap.set(row.lineKey, {
        label: row.lineLabel,
        itemCount: 1,
        inventoryValue: row.inventoryValue,
        subcategory: row.subcategory,
      });
    });

    return Array.from(lineMap.entries())
      .map(([value, current]) => ({
        value,
        label: current.label,
        hint: `${INVENTARIO_SUBCATEGORY_LABELS[current.subcategory]} | ${current.itemCount} item(s) | ${formatPrice(current.inventoryValue)}`,
      }))
      .sort((left, right) => compareText(left.label, right.label));
  }, [rows]);

  const lineOptionSet = useMemo(
    () => new Set(lineOptions.map((option) => option.value)),
    [lineOptions],
  );

  const hasLineOptions = lineOptions.length > 0;
  const hasCatalogForCurrentScope =
    hasScopeSelection && catalogLoadedScopeKey === catalogScopeKey;

  const selectedLines = useMemo(
    () =>
      lineSelectionMode === "all"
        ? lineOptions.map((option) => option.value)
        : selectedLinesState.filter((line) => lineOptionSet.has(line)),
    [lineOptionSet, lineOptions, lineSelectionMode, selectedLinesState],
  );

  const hasLineSelection =
    lineSelectionMode === "all" ||
    (lineSelectionMode === "specific" && selectedLines.length > 0);
  const hasSubcategorySelection = selectedSubcategoryState !== "";

  const rowsByLine = useMemo(
    () =>
      selectedLines.length > 0
        ? rows.filter((row) => selectedLines.includes(row.lineKey))
        : rows,
    [rows, selectedLines],
  );

  const filteredRows = useMemo(
    () =>
      selectedSubcategory === "all"
        ? rowsByLine
        : selectedSubcategory
          ? rowsByLine.filter((row) => row.subcategory === selectedSubcategory)
          : rowsByLine,
    [rowsByLine, selectedSubcategory],
  );

  const summarizedItemRows = useMemo(() => {
    const itemMap = new Map<string, SummaryItemAgg>();

    const mergedRotationDays = (agg: SummaryItemAgg) => {
      if (agg.inventoryUnits <= 0 || agg.inventoryValue <= 0) return 0;
      if (agg.anyNoSalesDi) return NO_SALES_DI_VALUE;
      if (agg.diWeightedDen <= 0) return NO_SALES_DI_VALUE;
      return agg.diWeightedNum / agg.diWeightedDen;
    };

    filteredRows.forEach((row) => {
      const current = itemMap.get(row.item);
      const rowNoSales =
        row.totalUnits <= 0 ||
        row.trackedDays <= 0 ||
        row.rotationDays >= NO_SALES_DI_VALUE;

      if (current) {
        current.inventoryUnits += row.inventoryUnits;
        current.inventoryValue += row.inventoryValue;
        current.totalUnits += row.totalUnits;
        current.trackedDays = Math.max(current.trackedDays, row.trackedDays);
        current.companyCount = Math.max(current.companyCount, row.companyCount);
        current.sedeCount = Math.max(current.sedeCount, row.sedeCount);
        current.anyNoSalesDi = current.anyNoSalesDi || rowNoSales;
        if (!rowNoSales && row.totalUnits > 0) {
          current.diWeightedNum += row.rotationDays * row.totalUnits;
          current.diWeightedDen += row.totalUnits;
        }
        current.rotationDays = mergedRotationDays(current);
        return;
      }

      itemMap.set(row.item, {
        ...row,
        diWeightedNum: rowNoSales ? 0 : row.rotationDays * row.totalUnits,
        diWeightedDen: rowNoSales ? 0 : row.totalUnits,
        anyNoSalesDi: rowNoSales,
        rotationDays: calculateDiDays(row),
      });
    });

    return Array.from(itemMap.values()).map(
      ({ diWeightedNum: _n, diWeightedDen: _d, anyNoSalesDi: _a, ...rest }) =>
        rest,
    );
  }, [filteredRows]);

  const itemOptions = useMemo<SelectOption[]>(() => {
    if (!hasLineSelection || !hasSubcategorySelection) return [];
    return summarizedItemRows
      .sort((left, right) => {
        if (right.inventoryValue !== left.inventoryValue) {
          return right.inventoryValue - left.inventoryValue;
        }
        return compareText(left.item, right.item);
      })
      .map((row) => ({
        value: row.item,
        label: `${row.item} - ${row.descripcion}`,
        hint: `${row.lineLabel} | ${formatPrice(row.inventoryValue)}`,
      }));
  }, [
    hasLineSelection,
    hasSubcategorySelection,
    summarizedItemRows,
  ]);

  useEffect(() => {
    const pending = pendingInventarioDeepLinkRef.current;
    if (!pending?.item || itemOptions.length === 0) return;
    const normalized = pending.item.trim();
    if (!itemOptions.some((option) => option.value === normalized)) return;
    setSelectedItemsState([normalized]);
    pendingInventarioDeepLinkRef.current = null;
  }, [itemOptions]);

  const selectedItemOptionSet = useMemo(
    () => new Set(selectedItemsState),
    [selectedItemsState],
  );

  const itemDropdownState = useMemo(() => {
    const normalizedSearch = deferredItemSearch.trim().toLowerCase();
    const filteredOptions = itemOptions.filter((option) => {
      if (!normalizedSearch) return true;
      const searchable = `${option.value} ${option.label} ${option.hint ?? ""}`.toLowerCase();
      return searchable.includes(normalizedSearch);
    });

    if (!normalizedSearch) {
      const selected = itemOptions.filter((option) => selectedItemOptionSet.has(option.value));
      const others = itemOptions.filter((option) => !selectedItemOptionSet.has(option.value));
      const limitedOthers = others.slice(0, ITEM_DROPDOWN_NO_SEARCH_LIMIT);
      return {
        visibleOptions: [...selected, ...limitedOthers],
        totalResults: itemOptions.length,
        truncated: others.length > ITEM_DROPDOWN_NO_SEARCH_LIMIT,
      };
    }

    const selectedMatched = filteredOptions.filter((option) =>
      selectedItemOptionSet.has(option.value),
    );
    const otherMatched = filteredOptions
      .filter((option) => !selectedItemOptionSet.has(option.value))
      .slice(0, ITEM_DROPDOWN_SEARCH_LIMIT);

    return {
      visibleOptions: [...selectedMatched, ...otherMatched],
      totalResults: filteredOptions.length,
      truncated:
        filteredOptions.length - selectedMatched.length > ITEM_DROPDOWN_SEARCH_LIMIT,
    };
  }, [deferredItemSearch, itemOptions, selectedItemOptionSet]);

  const itemOptionSet = useMemo(
    () => new Set(itemOptions.map((option) => option.value)),
    [itemOptions],
  );

  const selectedItems = useMemo(
    () =>
      selectedItemsState
        .filter((item) => itemOptionSet.has(item))
        .slice(0, INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS),
    [itemOptionSet, selectedItemsState],
  );

  const handleCompanyChange = useCallback(
    (values: string[]) => {
      setSelectedCompanyState(values);
      const allowed = new Set(values);
      setSelectedSedeState((current) =>
        current.filter((value) => {
          const parsed = parseSedeOptionValue(value);
          return parsed ? allowed.has(parsed.empresa) : false;
        }),
      );
      resetScopedData();
      setShowValidation(false);
    },
    [resetScopedData],
  );

  const handleDateStartChange = useCallback(
    (value: string) => {
      setSelectedDateStartState(value);
      if (selectedDateEndState && value && value > selectedDateEndState) {
        setSelectedDateEndState(value);
      }
      resetDependentSelections();
      setShowValidation(false);
    },
    [resetDependentSelections, selectedDateEndState],
  );

  const handleDateEndChange = useCallback(
    (value: string) => {
      setSelectedDateEndState(value);
      if (selectedDateStartState && value && value < selectedDateStartState) {
        setSelectedDateStartState(value);
      }
      resetDependentSelections();
      setShowValidation(false);
    },
    [resetDependentSelections, selectedDateStartState],
  );

  const handleSedeChange = useCallback(
    (values: string[]) => {
      setSelectedSedeState(values);
      resetScopedData();
      setShowValidation(false);
    },
    [resetScopedData],
  );

  const handleLineSelectionChange = useCallback((values: string[]) => {
    setSelectedLinesState(values);
    setLineSelectionMode(values.length > 0 ? "specific" : "unset");
    setSelectedItemsState([]);
    setItemSearch("");
    setAppliedMatrixKey("");
    setMessage(null);
    setError(null);
  }, []);

  const handleSelectAllLines = useCallback(() => {
    setLineSelectionMode("all");
    setSelectedLinesState([]);
    setSelectedItemsState([]);
    setItemSearch("");
    setAppliedMatrixKey("");
    setMessage(null);
    setError(null);
  }, []);

  const handleClearLines = useCallback(() => {
    setLineSelectionMode("unset");
    setSelectedLinesState([]);
    setSelectedItemsState([]);
    setItemSearch("");
    setAppliedMatrixKey("");
    setMessage(null);
    setError(null);
  }, []);

  const handleSubcategoryChange = useCallback(
    (value: string) => {
      setSelectedSubcategoryState(
        value as "" | typeof ALL_FILTER_VALUE | InventarioSubcategoryKey,
      );
      setSelectedItemsState([]);
      setItemSearch("");
      setAppliedMatrixKey("");
      setMessage(null);
      setError(null);
    },
    [],
  );

  const handleItemsChange = useCallback((values: string[]) => {
    setSelectedItemsState(values);
    setAppliedMatrixKey("");
    setMessage(null);
    setError(null);
  }, []);

  const handleClearItems = useCallback(() => {
    setSelectedItemsState([]);
    setItemSearch("");
    setAppliedMatrixKey("");
    setMessage(null);
    setError(null);
  }, []);

  const handleSaveItemsPreset = useCallback(async () => {
    const name = presetNameInput.trim();
    if (!name || selectedItems.length === 0) return;

    const now = Date.now();
    let savedPresetId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const newPreset: ItemPreset = {
      id: savedPresetId,
      name,
      items: selectedItems.slice(0, INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS),
      createdAt: now,
    };

    const sameNameIndex = itemPresets.findIndex(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );
    const nextPresets =
      sameNameIndex >= 0
        ? itemPresets.map((preset, index) =>
            index === sameNameIndex
              ? { ...newPreset, id: itemPresets[sameNameIndex].id }
              : preset,
          )
        : [newPreset, ...itemPresets];
    if (sameNameIndex >= 0) {
      savedPresetId = itemPresets[sameNameIndex].id;
    }
    const bounded = nextPresets.slice(0, MAX_ITEM_PRESETS);
    setItemPresets(bounded);

    const ok = await persistItemPresetsRemote(bounded);
    if (!ok) {
      await loadItemPresetsFromServer();
      return;
    }

    setSelectedPresetId(savedPresetId);
    setPresetNameInput("");
    setMessage(`Preset "${name}" guardado.`);
    setError(null);
  }, [
    itemPresets,
    presetNameInput,
    selectedItems,
    persistItemPresetsRemote,
    loadItemPresetsFromServer,
  ]);

  const handleApplyItemsPreset = useCallback(
    (presetId: string) => {
      setSelectedPresetId(presetId);
      const preset = itemPresets.find((entry) => entry.id === presetId);
      if (!preset) return;

      const optionSet = new Set(itemOptions.map((option) => option.value));
      const applicableItems = preset.items
        .filter((item) => optionSet.has(item))
        .slice(0, INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS);

      setSelectedItemsState(applicableItems);
      setAppliedMatrixKey("");
      setItemSearch("");
      setError(null);
      if (applicableItems.length === 0) {
        setMessage(
          `El preset "${preset.name}" no tiene items disponibles con los filtros actuales.`,
        );
      } else if (applicableItems.length < preset.items.length) {
        setMessage(
          `Preset "${preset.name}" aplicado parcialmente (${applicableItems.length}/${preset.items.length} items disponibles).`,
        );
      } else {
        setMessage(`Preset "${preset.name}" aplicado.`);
      }
    },
    [itemOptions, itemPresets],
  );

  const handleDeleteItemsPreset = useCallback(async () => {
    if (!selectedPresetId) return;
    const next = itemPresets.filter((preset) => preset.id !== selectedPresetId);
    setItemPresets(next);
    const ok = await persistItemPresetsRemote(next);
    if (!ok) {
      await loadItemPresetsFromServer();
      return;
    }
    setSelectedPresetId("");
    setMessage("Preset eliminado.");
    setError(null);
  }, [
    itemPresets,
    selectedPresetId,
    persistItemPresetsRemote,
    loadItemPresetsFromServer,
  ]);

  const loadMatrixData = useCallback(
    async (signal?: AbortSignal) => {
      setLoadingMatrix(true);
      setError(null);
      setMessage(null);

      try {
        const params = new URLSearchParams();
        params.set("mode", "table");
        effectiveCompanies.forEach((company) => params.append("empresa", company));
        selectedSedeIds.forEach((sedeId) => params.append("sede", sedeId));
        if (selectedDateStart) params.set("dateStart", selectedDateStart);
        if (selectedDateEnd) params.set("dateEnd", selectedDateEnd);
        if (selectedSubcategory && selectedSubcategory !== "all") {
          params.set("subcategory", selectedSubcategory);
        }
        selectedLines.forEach((line) => params.append("line", line));
        selectedItems.forEach((item) => params.append("item", item));

        const response = await fetch(`/api/inventario-x-item?${params.toString()}`, {
          signal,
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/secciones");
          return;
        }

        const payload = (await response.json()) as InventarioApiResponse;
        if (!response.ok) {
          throw new Error(
            payload.error ?? "No fue posible construir la matriz de existencias.",
          );
        }

        setMatrixRows(payload.matrixRows ?? []);
        setAvailableDate(payload.meta?.availableDate ?? "");
        setAvailableDateStart(payload.meta?.availableDateStart ?? "");
        setAvailableDateEnd(payload.meta?.availableDateEnd ?? "");
        if (payload.meta?.selectedDateStart) {
          setSelectedDateStartState(payload.meta.selectedDateStart);
        }
        if (payload.meta?.selectedDateEnd) {
          setSelectedDateEndState(payload.meta.selectedDateEnd);
        }
        setMessage(payload.message ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMatrixRows([]);
        setError(
          err instanceof Error
            ? err.message
            : "Error desconocido consultando inventario por item.",
        );
      } finally {
        setLoadingMatrix(false);
      }
    },
    [
      router,
      effectiveCompanies,
      selectedItems,
      selectedLines,
      selectedSedeIds,
      selectedSubcategory,
      selectedDateEnd,
      selectedDateStart,
    ],
  );

  const rowsByItem = useMemo(() => {
    const map = new Map(summarizedItemRows.map((row) => [row.item, row]));
    return map;
  }, [summarizedItemRows]);

  const summaryRows = useMemo(() => {
    if (selectedItems.length === 0) return [];

    return selectedItems
      .map((item) => rowsByItem.get(item))
      .filter((row): row is InventarioSummaryRow => Boolean(row));
  }, [rowsByItem, selectedItems]);

  /**
   * Ajuste dinamico del ancho de columnas para reducir espacio blanco muerto
   * (especialmente en la exportacion JPG) sin perder legibilidad.
   */
  const matrixItemColMinClass = useMemo(() => {
    if (summaryRows.length >= 10) return "min-w-20";
    if (summaryRows.length >= 6) return "min-w-24";
    return "min-w-32";
  }, [summaryRows.length]);

  const selectedSedeLabel = useMemo(() => {
    if (selectedSede.length === 0) return "Todas";
    if (selectedSede.length === 1) {
      const only = selectedSede[0];
      const opt = availableSedeOptions.find(
        (sede) => buildSedeOptionValue(sede.empresa, sede.sedeId) === only,
      );
      return opt ? stripInventarioSedeDisplayPrefix(opt.sedeName) : "1 sede";
    }
    return `${selectedSede.length} sedes`;
  }, [availableSedeOptions, selectedSede]);
  const effectiveCompanyLabel =
    selectedCompanyState.length === 0
      ? "Todas"
      : selectedCompanyState.length === 1
        ? selectedCompanyState[0].toUpperCase()
        : `${selectedCompanyState.length} empresas`;

  const currentMatrixKey = useMemo(
    () =>
      JSON.stringify({
        empresas:
          selectedCompanyState.length > 0
            ? selectedCompanyState
            : [ALL_FILTER_VALUE],
        sedes: selectedSede.length > 0 ? selectedSede : [ALL_FILTER_VALUE],
        dateStart: selectedDateStart || "",
        dateEnd: selectedDateEnd || "",
        lines: selectedLines,
        subcategory: selectedSubcategory || "",
        items: selectedItems,
      }),
    [
      selectedCompanyState,
      selectedDateEnd,
      selectedDateStart,
      selectedItems,
      selectedLines,
      selectedSede,
      selectedSubcategory,
    ],
  );

  const hasRequiredFilters =
    hasCompanySelection &&
    hasSedeSelection &&
    hasLineSelection &&
    hasSubcategorySelection &&
    selectedItems.length > 0;
  const canBuildMatrix =
    hasRequiredFilters && hasCatalogForCurrentScope && !loadingCatalog;
  const hasAppliedCurrentFilters =
    appliedMatrixKey.length > 0 && appliedMatrixKey === currentMatrixKey;
  const hasPendingMatrixChanges =
    appliedMatrixKey.length > 0 && appliedMatrixKey !== currentMatrixKey;

  const matrixItemOrder = useMemo(
    () => summaryRows.map((row) => row.item),
    [summaryRows],
  );

  const matrixItemSet = useMemo(
    () => new Set(matrixItemOrder),
    [matrixItemOrder],
  );

  const filteredMatrixRows = useMemo(
    () =>
      matrixRows.filter(
        (row) =>
          (selectedLines.length === 0 || selectedLines.includes(row.lineKey)) &&
          (!selectedSubcategory ||
            selectedSubcategory === "all" ||
            row.subcategory === selectedSubcategory) &&
          matrixItemSet.has(row.item),
      ),
    [matrixItemSet, matrixRows, selectedLines, selectedSubcategory],
  );

  const matrixRowsBySede = useMemo(() => {
    type CellAgg = {
      inventoryUnits: number;
      diWeightedNum: number;
      diWeightedDen: number;
      anyNoSalesDi: boolean;
    };

    const cellAggs = new Map<string, CellAgg>();
    const sedeMeta = new Map<
      string,
      { empresa: string; sedeId: string; sedeName: string }
    >();

    filteredMatrixRows.forEach((row) => {
      const sedeKey = `${row.empresa}::${row.sedeId}`;
      sedeMeta.set(sedeKey, {
        empresa: row.empresa,
        sedeId: row.sedeId,
        sedeName: row.sedeName,
      });

      const cellKey = `${sedeKey}::${row.item}`;
      const rowNoSales =
        row.totalUnits <= 0 ||
        row.trackedDays <= 0 ||
        row.rotationDays >= NO_SALES_DI_VALUE;

      const agg = cellAggs.get(cellKey) ?? {
        inventoryUnits: 0,
        diWeightedNum: 0,
        diWeightedDen: 0,
        anyNoSalesDi: false,
      };
      agg.inventoryUnits += row.inventoryUnits;
      agg.anyNoSalesDi = agg.anyNoSalesDi || rowNoSales;
      if (!rowNoSales && row.totalUnits > 0) {
        agg.diWeightedNum += row.rotationDays * row.totalUnits;
        agg.diWeightedDen += row.totalUnits;
      }
      cellAggs.set(cellKey, agg);
    });

    const grouped = new Map<
      string,
      {
        key: string;
        empresa: string;
        sedeId: string;
        sedeName: string;
        displayName: string;
        items: Record<string, MatrixCellValue>;
      }
    >();

    cellAggs.forEach((agg, cellKey) => {
      const parts = cellKey.split("::");
      const item = parts.pop() ?? "";
      const sedeKey = parts.join("::");
      const meta = sedeMeta.get(sedeKey);
      if (!meta) return;

      const shortSede = stripInventarioSedeDisplayPrefix(meta.sedeName);
      const current = grouped.get(sedeKey) ?? {
        key: sedeKey,
        empresa: meta.empresa,
        sedeId: meta.sedeId,
        sedeName: meta.sedeName,
        displayName: shortSede,
        items: {},
      };

      const diDays =
        agg.inventoryUnits <= 0
          ? 0
          : agg.anyNoSalesDi
            ? NO_SALES_DI_VALUE
            : agg.diWeightedDen > 0
              ? agg.diWeightedNum / agg.diWeightedDen
              : NO_SALES_DI_VALUE;

      current.items[item] = {
        inventoryUnits: agg.inventoryUnits,
        diDays,
      };
      grouped.set(sedeKey, current);
    });

    return Array.from(grouped.values()).sort((left, right) =>
      compareInventarioMatrixSedeRows(
        left.empresa,
        left.sedeName,
        right.empresa,
        right.sedeName,
      ),
    );
  }, [filteredMatrixRows]);

  const matrixTotalsByItem = useMemo(() => {
    const totals: Record<string, number> = {};
    filteredMatrixRows.forEach((row) => {
      totals[row.item] = (totals[row.item] ?? 0) + row.inventoryUnits;
    });
    return totals;
  }, [filteredMatrixRows]);

  const multipleCompaniesInMatrix = useMemo(
    () => new Set(matrixRowsBySede.map((row) => row.empresa)).size > 1,
    [matrixRowsBySede],
  );

  const sortedMatrixRowsBySede = useMemo(() => {
    const directionFactor = matrixSortDirection === "asc" ? 1 : -1;
    return [...matrixRowsBySede].sort((left, right) => {
      if (matrixSortField === "sede") {
        return (
          compareInventarioMatrixSedeRows(
            left.empresa,
            left.sedeName,
            right.empresa,
            right.sedeName,
          ) * directionFactor
        );
      }

      const leftInventory = left.items[matrixSortField]?.inventoryUnits ?? 0;
      const rightInventory = right.items[matrixSortField]?.inventoryUnits ?? 0;
      if (leftInventory !== rightInventory) {
        return (leftInventory - rightInventory) * directionFactor;
      }

      return compareText(left.displayName, right.displayName) * directionFactor;
    });
  }, [matrixRowsBySede, matrixSortDirection, matrixSortField]);

  /** Carga la matriz cuando los filtros obligatorios estan listos (sin boton manual). */
  useEffect(() => {
    if (!canBuildMatrix) return;
    if (
      appliedMatrixKey.length > 0 &&
      appliedMatrixKey === currentMatrixKey
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowValidation(true);
      setAppliedMatrixKey(currentMatrixKey);
      void loadMatrixData();
    }, 550);

    return () => window.clearTimeout(timer);
  }, [canBuildMatrix, currentMatrixKey, appliedMatrixKey, loadMatrixData]);

  const handleReload = useCallback(() => {
    void loadFilterOptions();
    if (hasScopeSelection) {
      void loadCatalogData();
    }
    if (canBuildMatrix && hasAppliedCurrentFilters) {
      void loadMatrixData();
    }
  }, [
    canBuildMatrix,
    hasAppliedCurrentFilters,
    hasScopeSelection,
    loadCatalogData,
    loadFilterOptions,
    loadMatrixData,
  ]);

  const handleMatrixSort = useCallback((
    field: MatrixSortField,
    direction?: MatrixSortDirection,
  ) => {
    setMatrixSortField(field);
    setMatrixSortDirection((currentDirection) => {
      if (direction) return direction;
      if (matrixSortField === field) {
        return currentDirection === "asc" ? "desc" : "asc";
      }
      return "desc";
    });
  }, [matrixSortField]);

  const availableDateLabel = availableDate
    ? formatDateLabel(availableDate, dateLabelOptions)
    : "Sin fecha";
  const availableRangeLabel =
    availableDateStart && availableDateEnd
      ? availableDateStart === availableDateEnd
        ? formatDateLabel(availableDateStart, dateLabelOptions)
        : `${formatDateLabel(availableDateStart, dateLabelOptions)} al ${formatDateLabel(
            availableDateEnd,
            dateLabelOptions,
          )}`
      : availableDateLabel;
  const selectedDateLabel =
    selectedDateStartState && selectedDateEndState
      ? selectedDateStartState === selectedDateEndState
        ? formatDateLabel(selectedDateStartState, dateLabelOptions)
        : `${formatDateLabel(selectedDateStartState, dateLabelOptions)} al ${formatDateLabel(
            selectedDateEndState,
            dateLabelOptions,
          )}`
      : availableDateLabel;

  const handleDownloadMatrixPdf = useCallback(() => {
    if (summaryRows.length === 0 || sortedMatrixRowsBySede.length === 0) return;

    setExportingPdf(true);

    try {
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a3",
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const title = "Inventario por item";
      const scopeLabel = `Empresa: ${effectiveCompanyLabel} | Sede: ${selectedSedeLabel}`;
      const filtersLabel = `Lineas: ${
        lineSelectionMode === "all" ? "TODAS" : selectedLines.length
      } | Subcategoria: ${
        selectedSubcategory === "all"
          ? "TODAS"
          : selectedSubcategory
            ? INVENTARIO_SUBCATEGORY_LABELS[selectedSubcategory].toUpperCase()
            : "N/A"
      } | Items: ${summaryRows.length}`;

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 18, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(title, 14, 11.5);

      doc.setTextColor(51, 65, 85);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(scopeLabel, 14, 26);
      doc.text(filtersLabel, 14, 32);
      doc.text(`Corte: ${selectedDateLabel}`, 14, 38);
      doc.text(
        `Generado: ${new Intl.DateTimeFormat("es-CO", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date())}`,
        14,
        44,
      );

      const truncatePdfDesc = (value: string, max = 30) => {
        const trimmed = value.trim();
        if (trimmed.length <= max) return trimmed;
        return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
      };

      /** Misma estructura que la matriz en pantalla: ítem + descripción, luego Inventario y DI por referencia. */
      const head = [
        [
          { content: "Sede", rowSpan: 2, styles: { valign: "middle" as const } },
          ...summaryRows.map((row) => ({
            content: `${row.item}\n${truncatePdfDesc(row.descripcion)}`,
            colSpan: 2,
            styles: { halign: "center" as const, valign: "middle" as const },
          })),
        ],
        summaryRows.flatMap(() => [
          {
            content: "Inventario",
            styles: { halign: "center" as const, fontStyle: "normal" as const },
          },
          {
            content: "DI",
            styles: {
              halign: "center" as const,
              fontStyle: "bold" as const,
            },
          },
        ]),
      ];

      const body = sortedMatrixRowsBySede.map((row) => [
        row.displayName,
        ...summaryRows.flatMap((itemRow) => {
          const cell = row.items[itemRow.item] ?? {
            inventoryUnits: 0,
            diDays: 0,
          };
          return [formatUnits(cell.inventoryUnits), formatDi(cell.diDays)];
        }),
      ]);

      const foot = [
        [
          "Total general",
          ...summaryRows.flatMap((row) => [
            formatUnits(matrixTotalsByItem[row.item] ?? 0),
            formatDi(row.rotationDays),
          ]),
        ],
      ];

      const marginX = 10;
      const pdfSedeColMm = 42;
      const dataColCount = summaryRows.length * 2;
      const usableWidthMm = pageWidth - marginX * 2 - pdfSedeColMm;
      /** Ancho por columna numérica: si no cabe en una página, autotable reparte con salto horizontal. */
      const pdfDataColMm = Math.max(8.5, usableWidthMm / Math.max(1, dataColCount));
      const tableNaturalWidthMm = pdfSedeColMm + dataColCount * pdfDataColMm;
      const pdfFontSize = Math.max(
        5,
        Math.min(7, 7.25 - summaryRows.length * 0.12),
      );

      const pdfColumnStyles: Record<
        number,
        { cellWidth: number; halign?: "left" | "center" | "right"; fontStyle?: "bold" }
      > = {
        0: {
          cellWidth: pdfSedeColMm,
          halign: "left",
          fontStyle: "bold",
        },
      };
      for (let i = 0; i < dataColCount; i++) {
        pdfColumnStyles[i + 1] = { cellWidth: pdfDataColMm, halign: "right" };
      }

      autoTable(doc, {
        startY: 50,
        head,
        body,
        foot,
        theme: "grid",
        tableWidth: tableNaturalWidthMm,
        margin: { left: marginX, right: marginX, top: 10, bottom: 12 },
        styles: {
          fontSize: pdfFontSize,
          cellPadding: 1.5,
          lineColor: [203, 213, 225],
          lineWidth: 0.1,
          valign: "middle",
        },
        headStyles: {
          fillColor: [219, 234, 254],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          halign: "center",
          valign: "middle",
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          halign: "right",
        },
        footStyles: {
          fillColor: [254, 249, 195],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          halign: "right",
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: pdfColumnStyles,
        didParseCell: (data) => {
          const col = data.column.index;
          const isPdfDiColumn = col > 0 && (col - 1) % 2 === 1;

          if (
            data.section === "head" &&
            data.row.index === 0 &&
            col === 0
          ) {
            data.cell.styles.halign = "left";
          }

          if (data.section === "head" && data.row.index === 1 && col > 0) {
            if (isPdfDiColumn) {
              data.cell.styles.fillColor = [252, 250, 255];
              data.cell.styles.textColor = [15, 23, 42];
            } else {
              data.cell.styles.fillColor = [241, 249, 255];
              data.cell.styles.textColor = [71, 85, 105];
            }
          }

          if (data.section === "body" && isPdfDiColumn) {
            const zebra = data.row.index % 2 === 0;
            data.cell.styles.fillColor = zebra
              ? [253, 252, 254]
              : [251, 248, 254];
            data.cell.styles.textColor = [15, 23, 42];
          }

          if (data.section === "foot" && isPdfDiColumn) {
            data.cell.styles.fillColor = [249, 246, 252];
            data.cell.styles.textColor = [15, 23, 42];
          }

          if (data.section === "foot" && col === 0) {
            data.cell.styles.halign = "left";
          }
        },
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: 0,
        showHead: "everyPage",
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(
            "Visor de Productividad | Inventario x item",
            pageWidth - 14,
            pageHeight - 6,
            { align: "right" },
          );
        },
      });

      const safeCompany =
        selectedCompanyState.length === 1
          ? selectedCompanyState[0].toLowerCase()
          : selectedCompanyState.length > 1
            ? "multiples-empresas"
            : "todas";
      const safeSede = selectedSedeLabel.toLowerCase().replace(/\s+/g, "-");
      doc.save(`inventario-x-item-${safeCompany}-${safeSede}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }, [
    effectiveCompanyLabel,
    lineSelectionMode,
    matrixTotalsByItem,
    selectedLines.length,
    selectedCompanyState,
    selectedDateLabel,
    selectedSedeLabel,
    selectedSubcategory,
    sortedMatrixRowsBySede,
    summaryRows,
  ]);

  useEffect(() => {
    if (!jpgMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!jpgMenuRef.current) return;
      if (!jpgMenuRef.current.contains(event.target as Node)) {
        setJpgMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setJpgMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [jpgMenuOpen]);

  useEffect(() => {
    if (!excelMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!excelMenuRef.current) return;
      if (!excelMenuRef.current.contains(event.target as Node)) {
        setExcelMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExcelMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [excelMenuOpen]);

  const handleDownloadMatrixJpg = useCallback(
    async (variant: "full" | "di-only" = "full") => {
      if (
        !matrixImageRef.current ||
        summaryRows.length === 0 ||
        sortedMatrixRowsBySede.length === 0
      ) {
        return;
      }

      setJpgMenuOpen(false);
      setExportingJpg(true);
      setJpgExportMode(variant);

      try {
        // Espera dos frames para que React commitee el cambio de columnas
        // antes de capturar la imagen.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );

        const node = matrixImageRef.current;
        if (!node) return;
        // html-to-image usa clientWidth por defecto; con max-w-full la tabla se recorta al ancho
        // visible del scroll horizontal. scrollWidth/scrollHeight incluyen todo el contenido.
        const width = node.scrollWidth;
        const height = node.scrollHeight;
        const dataUrl = await toJpeg(node, {
          quality: 0.95,
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          cacheBust: true,
          width,
          height,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            maxWidth: "none",
            overflow: "visible",
          },
        });

        const link = document.createElement("a");
        const safeCompany =
          selectedCompanyState.length === 1
            ? selectedCompanyState[0].toLowerCase()
            : selectedCompanyState.length > 1
              ? "multiples-empresas"
              : "todas";
        const safeSede = selectedSedeLabel.toLowerCase().replace(/\s+/g, "-");
        const variantSuffix = variant === "di-only" ? "-solo-di" : "";
        link.href = dataUrl;
        link.download = `inventario-x-item-${safeCompany}-${safeSede}${variantSuffix}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        setJpgExportMode("full");
        setExportingJpg(false);
      }
    },
    [
      selectedCompanyState,
      selectedSedeLabel,
      sortedMatrixRowsBySede.length,
      summaryRows.length,
    ],
  );

  const handleDownloadMatrixExcel = useCallback(
    async (variant: "full" | "di-only" = "full") => {
      if (summaryRows.length === 0 || sortedMatrixRowsBySede.length === 0) {
        return;
      }

      setExcelMenuOpen(false);
      setExportingExcel(true);

      try {
        const includeInv = variant !== "di-only";

        const workbook = new ExcelJS.Workbook();
        workbook.created = new Date();
        const sheet = workbook.addWorksheet("Inventario x Item");
        sheet.views = [{ showGridLines: false, state: "frozen", ySplit: 5, xSplit: 1 }];

        const colsPerItem = includeInv ? 2 : 1;
        const totalDataCols = summaryRows.length * colsPerItem;
        const totalCols = 1 + totalDataCols; // sede + items
        const lastColLetter = sheet.getColumn(totalCols).letter;

        const thinBorder = {
          top: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
          left: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
          bottom: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
          right: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
        };

        const titleParts = [
          `Empresa: ${effectiveCompanyLabel}`,
          `Sede: ${selectedSedeLabel}`,
          `Corte: ${selectedDateLabel}`,
        ];
        sheet.mergeCells(`A1:${lastColLetter}1`);
        const titleCell = sheet.getCell("A1");
        titleCell.value =
          variant === "di-only"
            ? "Inventario x Item - Solo DI"
            : "Inventario x Item";
        titleCell.font = { bold: true, color: { argb: "FF0F172A" }, size: 14 };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        titleCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF1F5F9" },
        };
        sheet.getRow(1).height = 22;

        sheet.mergeCells(`A2:${lastColLetter}2`);
        const subtitleCell = sheet.getCell("A2");
        subtitleCell.value = titleParts.join(" | ");
        subtitleCell.font = { italic: true, color: { argb: "FF475569" }, size: 10 };
        subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
        sheet.getRow(2).height = 18;

        // Filas 3 (codigo item), 4 (descripcion), 5 (sub-encabezados)
        const itemHeaderRow = 3;
        const descHeaderRow = 4;
        const subHeaderRow = 5;
        const dataStartRow = 6;

        // Sede (rowSpan 3)
        sheet.mergeCells(itemHeaderRow, 1, subHeaderRow, 1);
        const sedeHeader = sheet.getCell(itemHeaderRow, 1);
        sedeHeader.value = "Sede";
        sedeHeader.font = { bold: true, color: { argb: "FF0F172A" } };
        sedeHeader.alignment = { horizontal: "left", vertical: "middle" };
        sedeHeader.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2E8F0" },
        };
        sedeHeader.border = thinBorder;

        summaryRows.forEach((row, index) => {
          const startCol = 2 + index * colsPerItem;
          const endCol = startCol + colsPerItem - 1;
          if (colsPerItem > 1) sheet.mergeCells(itemHeaderRow, startCol, itemHeaderRow, endCol);
          const codeCell = sheet.getCell(itemHeaderRow, startCol);
          codeCell.value = row.item;
          codeCell.font = { bold: true, color: { argb: "FF0F172A" }, size: 11 };
          codeCell.alignment = { horizontal: "center", vertical: "middle" };
          codeCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFDBEAFE" },
          };
          for (let c = startCol; c <= endCol; c += 1) {
            sheet.getCell(itemHeaderRow, c).border = thinBorder;
          }

          if (colsPerItem > 1) sheet.mergeCells(descHeaderRow, startCol, descHeaderRow, endCol);
          const descCell = sheet.getCell(descHeaderRow, startCol);
          descCell.value = row.descripcion ?? "";
          descCell.font = { color: { argb: "FF475569" }, size: 9 };
          descCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          descCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFEFF6FF" },
          };
          for (let c = startCol; c <= endCol; c += 1) {
            sheet.getCell(descHeaderRow, c).border = thinBorder;
          }

          if (includeInv) {
            const invSub = sheet.getCell(subHeaderRow, startCol);
            invSub.value = "Inventario";
            invSub.font = { bold: true, size: 9, color: { argb: "FF0C4A6E" } };
            invSub.alignment = { horizontal: "center", vertical: "middle" };
            invSub.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0F9FF" },
            };
            invSub.border = thinBorder;
          }
          const diSub = sheet.getCell(subHeaderRow, endCol);
          diSub.value = "DI";
          diSub.font = { bold: true, size: 9, color: { argb: "FF4C1D95" } };
          diSub.alignment = { horizontal: "center", vertical: "middle" };
          diSub.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF5F3FF" },
          };
          diSub.border = thinBorder;
        });

        sheet.getRow(itemHeaderRow).height = 22;
        sheet.getRow(descHeaderRow).height = 28;
        sheet.getRow(subHeaderRow).height = 18;

        // Cuerpo
        sortedMatrixRowsBySede.forEach((row, rowIndex) => {
          const excelRow = dataStartRow + rowIndex;
          const sedeCell = sheet.getCell(excelRow, 1);
          const sedeText = multipleCompaniesInMatrix
            ? `${row.empresa.toUpperCase()} - ${row.displayName}`
            : row.displayName;
          sedeCell.value = sedeText;
          sedeCell.font = { bold: true, color: { argb: "FF0F172A" } };
          sedeCell.alignment = { horizontal: "left", vertical: "middle" };
          sedeCell.border = thinBorder;
          if (rowIndex % 2 === 1) {
            sedeCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF8FAFC" },
            };
          }

          summaryRows.forEach((itemRow, itemIndex) => {
            const startCol = 2 + itemIndex * colsPerItem;
            const cellValue = row.items[itemRow.item] ?? {
              inventoryUnits: 0,
              diDays: 0,
            };
            const rowFill: ExcelJS.FillPattern | undefined =
              rowIndex % 2 === 1
                ? {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF8FAFC" },
                  }
                : undefined;
            if (includeInv) {
              const invCell = sheet.getCell(excelRow, startCol);
              invCell.value = cellValue.inventoryUnits;
              invCell.numFmt = "#,##0";
              invCell.alignment = { horizontal: "right", vertical: "middle" };
              invCell.border = thinBorder;
              if (cellValue.inventoryUnits === 0) {
                invCell.font = { color: { argb: "FFCBD5E1" } };
              }
              if (rowFill) invCell.fill = rowFill;
            }
            const diCol = startCol + colsPerItem - 1;
            const diCell = sheet.getCell(excelRow, diCol);
            diCell.value = cellValue.diDays;
            diCell.numFmt = "0.0";
            diCell.alignment = { horizontal: "right", vertical: "middle" };
            diCell.border = thinBorder;
            if (rowFill) diCell.fill = rowFill;
          });
        });

        // Total general
        const totalRow = dataStartRow + sortedMatrixRowsBySede.length;
        const totalLabelCell = sheet.getCell(totalRow, 1);
        totalLabelCell.value = "Total general";
        totalLabelCell.font = {
          bold: true,
          color: { argb: "FF0F172A" },
          size: 11,
        };
        totalLabelCell.alignment = { horizontal: "left", vertical: "middle" };
        totalLabelCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFEF3C7" },
        };
        totalLabelCell.border = thinBorder;

        summaryRows.forEach((row, itemIndex) => {
          const startCol = 2 + itemIndex * colsPerItem;
          if (includeInv) {
            const invTotalCell = sheet.getCell(totalRow, startCol);
            invTotalCell.value = matrixTotalsByItem[row.item] ?? 0;
            invTotalCell.numFmt = "#,##0";
            invTotalCell.font = { bold: true };
            invTotalCell.alignment = { horizontal: "right", vertical: "middle" };
            invTotalCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFEF3C7" },
            };
            invTotalCell.border = thinBorder;
          }
          const diCol = startCol + colsPerItem - 1;
          const diTotalCell = sheet.getCell(totalRow, diCol);
          diTotalCell.value = row.rotationDays;
          diTotalCell.numFmt = "0.0";
          diTotalCell.font = { bold: true };
          diTotalCell.alignment = { horizontal: "right", vertical: "middle" };
          diTotalCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFDE68A" },
          };
          diTotalCell.border = thinBorder;
        });

        // Anchos de columna
        sheet.getColumn(1).width = 32;
        for (let i = 0; i < summaryRows.length; i += 1) {
          const startCol = 2 + i * colsPerItem;
          if (includeInv) {
            sheet.getColumn(startCol).width = 13;
            sheet.getColumn(startCol + 1).width = 9;
          } else {
            sheet.getColumn(startCol).width = 11;
          }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeCompany =
          selectedCompanyState.length === 1
            ? selectedCompanyState[0].toLowerCase()
            : selectedCompanyState.length > 1
              ? "multiples-empresas"
              : "todas";
        const safeSede = selectedSedeLabel.toLowerCase().replace(/\s+/g, "-");
        const variantSuffix = variant === "di-only" ? "-solo-di" : "";
        link.href = url;
        link.download = `inventario-x-item-${safeCompany}-${safeSede}${variantSuffix}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } finally {
        setExportingExcel(false);
      }
    },
    [
      effectiveCompanyLabel,
      matrixTotalsByItem,
      multipleCompaniesInMatrix,
      selectedCompanyState,
      selectedDateLabel,
      selectedSedeLabel,
      sortedMatrixRowsBySede,
      summaryRows,
    ],
  );

  const subcategoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: ALL_FILTER_VALUE, label: "Todas", key: ALL_FILTER_VALUE },
      { value: "perecederos", label: "Perecederos", key: "perecederos" },
      { value: "manufacturas", label: "Manufacturas", key: "manufacturas" },
    ],
    [],
  );
  const companyHelperText =
    showValidation && !hasCompanySelection
      ? "Selecciona una o varias empresas."
      : "Puedes seleccionar multiples empresas.";
  const sedeHelperText =
    !hasCompanySelection && !hasSedeSelection
      ? "Selecciona una o varias empresas primero y luego define sedes."
      : showValidation && !hasSedeSelection
        ? "Selecciona una o varias sedes."
        : "Puedes seleccionar multiples sedes.";
  const lineHelperText = !hasScopeSelection
    ? "Primero define empresa y sede."
    : loadingCatalog
      ? "Consultando lineas disponibles para el alcance seleccionado..."
      : !hasLineOptions
        ? "No encontramos lineas con inventario para ese alcance."
        : showValidation && !hasLineSelection
          ? "Selecciona una o varias lineas, o usa 'Todas las lineas'."
          : "Este filtro es obligatorio para cargar la matriz.";
  const subcategoryHelperText = !hasScopeSelection
    ? "Primero define empresa y sede."
    : showValidation && !hasSubcategorySelection
      ? "Selecciona una subcategoria puntual o marca 'Todas'."
      : "Este filtro es obligatorio para cargar la matriz.";
  const itemHelperText = !hasScopeSelection
    ? "Los items se habilitan despues de definir empresa y sede."
    : !hasLineSelection || !hasSubcategorySelection
      ? "Primero define lineas y subcategoria para habilitar la lista de items."
      : selectedItems.length > 0
        ? `Toca la zona de chips para abrir el listado y cambiar la seleccion (maximo ${INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS}).`
        : `Haz clic o foco en Buscar para abrir el listado; elige entre 1 y ${INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS} items.`;

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200/70 bg-white p-10 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <div
            className="rounded-full bg-blue-100 p-4 text-blue-700"
            aria-hidden
          >
            <Loader2
              className="h-8 w-8 animate-spin motion-reduce:animate-none"
              strokeWidth={2}
            />
          </div>
          <p className="text-center text-sm font-medium text-slate-700">
            Cargando seccion...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_55%),linear-gradient(180deg,#f8fafc,#eef4ff)] px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-7xl rounded-[30px] border border-slate-200/70 bg-white p-8 shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
        <div className="rounded-3xl border border-blue-200/80 bg-linear-to-br from-blue-100 via-white to-indigo-100 p-6 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-blue-700">
                Venta
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Inventario x item
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px]">
                Filtra empresa, sede, linea, subcategoria e items para resumir
                el inventario vigente por referencia usando el ultimo corte
                disponible de la tabla base de rotacion.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-white/90 px-3 py-1 text-xs font-semibold text-blue-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Rango disponible: {availableRangeLabel}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Seleccionado: {selectedDateLabel}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600">
                  <Database className="h-3.5 w-3.5" />
                  Fuente: rotacion
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="inline-flex items-center rounded-full border border-blue-200/80 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-50"
              >
                Recargar
              </button>
              <Link
                href="/venta"
                className="inline-flex items-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                Volver a venta
              </Link>
              <Link
                href="/secciones"
                className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-all hover:bg-blue-700"
              >
                Cambiar seccion
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200/70 bg-slate-50/70 p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.2)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                Filtros
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                Configura la tabla
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Empresa y sede filtran el alcance; lineas y subcategoria
                refinan la lectura. Escoge hasta{" "}
                {INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS} items; al completar los
                filtros la matriz se consulta sola.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                <Filter className="h-3.5 w-3.5 text-blue-600" />
                {selectedItems.length > 0
                  ? `${selectedItems.length} item(s) seleccionados`
                  : "Items pendientes por seleccionar"}
              </div>
            </div>
          </div>

          {showValidation && !hasRequiredFilters && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Completa los filtros obligatorios para ver la matriz. Puedes
              escoger una opcion puntual o seleccionar {"\"Todas\""} cuando
              quieras ampliar el alcance.
            </div>
          )}

          {loadingFilters && (
            <div
              className="mt-4 flex items-center gap-3 rounded-2xl border border-blue-200/80 bg-blue-50/90 px-4 py-3 text-sm text-blue-900"
              role="status"
              aria-live="polite"
            >
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin text-blue-700 motion-reduce:animate-none"
                strokeWidth={2}
                aria-hidden
              />
              <span className="font-medium">
                Actualizando fechas y opciones de filtro...
              </span>
            </div>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
                Fecha desde
              </span>
              <input
                type="date"
                value={selectedDateStartState}
                onChange={(event) => handleDateStartChange(event.target.value)}
                min={availableDateStart || undefined}
                max={availableDateEnd || undefined}
                disabled={loadingFilters || !availableDateEnd}
                className="w-full rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
                Fecha hasta
              </span>
              <input
                type="date"
                value={selectedDateEndState}
                onChange={(event) => handleDateEndChange(event.target.value)}
                min={availableDateStart || undefined}
                max={availableDateEnd || undefined}
                disabled={loadingFilters || !availableDateEnd}
                className="w-full rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr_1fr_1.5fr]">
            <MultiSelectField
              icon={Building2}
              label="Empresa"
              values={selectedCompanyState}
              options={companyOptions}
              onChange={handleCompanyChange}
              emptyLabel="Selecciona empresas"
              allLabel="Todas las empresas"
              selectAllLabel="Seleccionar todas"
              onSelectAll={() => handleCompanyChange(filters.companies)}
              onClearSelection={() => handleCompanyChange([])}
              disabled={loadingFilters}
              invalid={showValidation && !hasCompanySelection}
              helperText={companyHelperText}
            />
            <MultiSelectField
              icon={MapPin}
              label="Sede"
              values={selectedSede}
              options={sedeOptions}
              onChange={handleSedeChange}
              emptyLabel="Selecciona sedes"
              allLabel="Todas las sedes"
              selectAllLabel="Seleccionar todas"
              onSelectAll={() =>
                handleSedeChange(
                  availableSedeOptions.map((sede) =>
                    buildSedeOptionValue(sede.empresa, sede.sedeId),
                  ),
                )
              }
              onClearSelection={() => handleSedeChange([])}
              disabled={loadingFilters || !hasCompanySelection}
              invalid={showValidation && !hasSedeSelection}
              helperText={sedeHelperText}
            />
            <MultiSelectField
              icon={Filter}
              label="Lineas"
              values={selectedLines}
              options={lineOptions}
              onChange={handleLineSelectionChange}
              emptyLabel="Selecciona lineas"
              allLabel="Todas las lineas"
              selectAllLabel="Seleccionar todas las lineas"
              onSelectAll={hasLineOptions ? handleSelectAllLines : undefined}
              onClearSelection={handleClearLines}
              allSelected={lineSelectionMode === "all" && hasLineOptions}
              disabled={!hasScopeSelection || loadingCatalog || !hasLineOptions}
              invalid={showValidation && !hasLineSelection}
              helperText={lineHelperText}
            />
            <SelectField
              icon={Filter}
              label="Subcategoria"
              value={selectedSubcategoryState}
              options={subcategoryOptions}
              onChange={handleSubcategoryChange}
              emptyLabel="Selecciona subcategoria"
              disabled={!hasScopeSelection || loadingCatalog || !hasLineOptions}
              invalid={showValidation && !hasSubcategorySelection}
              helperText={subcategoryHelperText}
            />
            <MultiSelectField
              icon={PackageSearch}
              label="Items"
              values={selectedItems}
              options={itemOptions}
              visibleOptions={itemDropdownState.visibleOptions}
              onChange={handleItemsChange}
              emptyLabel="Selecciona items"
              maxSelected={INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS}
              searchable
              searchValue={itemSearch}
              onSearchChange={setItemSearch}
              totalResultsCount={itemDropdownState.totalResults}
              truncatedResults={itemDropdownState.truncated}
              onClearSelection={handleClearItems}
              clearLabel="Borrar todo"
              disabled={
                !hasScopeSelection ||
                loadingCatalog ||
                !hasLineSelection ||
                !hasSubcategorySelection ||
                itemOptions.length === 0
              }
              invalid={showValidation && selectedItems.length === 0}
              helperText={itemHelperText}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Presets de items
            </p>
            <div className="mt-2 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={presetNameInput}
                  onChange={(event) => setPresetNameInput(event.target.value)}
                  placeholder="Nombre del preset"
                  className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={handleSaveItemsPreset}
                  disabled={presetNameInput.trim().length === 0 || selectedItems.length === 0}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Guardar busqueda
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedPresetId}
                  onChange={(event) => handleApplyItemsPreset(event.target.value)}
                  className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Selecciona un preset</option>
                  {itemPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} ({preset.items.length} items)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleDeleteItemsPreset}
                  disabled={!selectedPresetId}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Cada usuario tiene sus propios presets (hasta {MAX_ITEM_PRESETS},{" "}
              {INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS} items c/u); se guardan en el servidor y
              siguen disponibles al cerrar el navegador. Si tenias presets viejos en este
              equipo, la primera vez se copian a tu cuenta.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Matriz por sede
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                Existencias por sede x item
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Esta tabla usa los mismos filtros del modulo y distribuye por
                sede las existencias en unidades de los items visibles.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1">
                Empresa: {effectiveCompanyLabel}
              </span>
              <span className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1">
                Sede: {selectedSedeLabel}
              </span>
              <span className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1">
                Columnas: {hasAppliedCurrentFilters ? summaryRows.length : 0}
              </span>
              <span className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1">
                Sedes: {hasAppliedCurrentFilters ? matrixRowsBySede.length : 0}
              </span>
              <button
                type="button"
                onClick={handleDownloadMatrixPdf}
                disabled={!hasAppliedCurrentFilters || summaryRows.length === 0 || exportingPdf}
                className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exportingPdf ? "Generando PDF..." : "PDF"}
              </button>
              <div ref={excelMenuRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setExcelMenuOpen((open) => !open)}
                  disabled={
                    !hasAppliedCurrentFilters ||
                    summaryRows.length === 0 ||
                    exportingExcel
                  }
                  aria-haspopup="menu"
                  aria-expanded={excelMenuOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportingExcel ? "Generando Excel..." : "Excel"}
                  {!exportingExcel && (
                    <ChevronDown className="h-3 w-3" aria-hidden />
                  )}
                </button>
                {excelMenuOpen && !exportingExcel && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleDownloadMatrixExcel("full")}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-emerald-50"
                    >
                      Todo completo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleDownloadMatrixExcel("di-only")}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-emerald-50"
                    >
                      Solo DI
                    </button>
                  </div>
                )}
              </div>
              <div ref={jpgMenuRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setJpgMenuOpen((open) => !open)}
                  disabled={
                    !hasAppliedCurrentFilters ||
                    summaryRows.length === 0 ||
                    exportingJpg
                  }
                  aria-haspopup="menu"
                  aria-expanded={jpgMenuOpen}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportingJpg ? "Generando JPG..." : "JPG"}
                  {!exportingJpg && (
                    <ChevronDown className="h-3 w-3" aria-hidden />
                  )}
                </button>
                {jpgMenuOpen && !exportingJpg && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleDownloadMatrixJpg("full")}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-emerald-50"
                    >
                      Todo completo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleDownloadMatrixJpg("di-only")}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-emerald-50"
                    >
                      Solo DI
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {message && !loading && !error && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {!hasScopeSelection ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                Selecciona al menos una empresa y una sede para habilitar el resto de filtros.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Primero define el alcance; luego completa lineas, subcategoria e
                items para cargar la consulta.
              </p>
            </div>
          ) : loadingCatalog ? (
            <div
              className="mt-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-12 text-center"
              role="status"
              aria-live="polite"
            >
              <div
                className="rounded-full bg-slate-200/80 p-3 text-slate-700"
                aria-hidden
              >
                <Loader2
                  className="h-8 w-8 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                />
              </div>
              <p className="max-w-md text-sm text-slate-600">
                Consultando lineas e items disponibles para el alcance
                seleccionado...
              </p>
            </div>
          ) : !hasLineOptions ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                No hay inventario disponible para ese alcance.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Ajusta empresa o sede para encontrar lineas con existencias y
                seguir armando la tabla.
              </p>
            </div>
          ) : !hasRequiredFilters ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                Completa los filtros obligatorios para continuar.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Debes definir empresa, sede, lineas, subcategoria e items. Si
                quieres consultar todo, selecciona explicitamente la opcion
                {" \"Todas\" "}en cada filtro.
              </p>
            </div>
          ) : hasPendingMatrixChanges || !hasAppliedCurrentFilters ? (
            <div
              className="mt-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-12 text-center"
              role="status"
              aria-live="polite"
            >
              <div
                className="rounded-full bg-blue-100 p-3 text-blue-700"
                aria-hidden
              >
                <Loader2
                  className="h-7 w-7 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  Actualizando la matriz...
                </p>
                <p className="mt-2 text-sm leading-6 text-blue-800">
                  Ajustamos la consulta con los filtros que acabas de cambiar.
                </p>
              </div>
            </div>
          ) : loadingMatrix ? (
            <div
              className="mt-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-12 text-center"
              role="status"
              aria-live="polite"
            >
              <div
                className="rounded-full bg-slate-200/80 p-3 text-slate-700"
                aria-hidden
              >
                <Loader2
                  className="h-8 w-8 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                />
              </div>
              <p className="max-w-md text-sm text-slate-600">
                Construyendo matriz de existencias...
              </p>
            </div>
          ) : summaryRows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                No hay items visibles con el filtro actual.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Ajusta empresa, sede, lineas o subcategoria para encontrar
                las referencias que necesitas.
              </p>
            </div>
          ) : matrixRowsBySede.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                No encontramos sedes con existencias para esos items.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Ajusta la sede, las lineas o la subcategoria para poblar la
                matriz.
              </p>
            </div>
          ) : (
            <div className="relative mt-6 overflow-visible rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.28)]">
              <div className="overflow-x-auto overflow-y-visible bg-[linear-gradient(180deg,rgba(248,250,252,0.8),rgba(255,255,255,1))]">
                <div
                  ref={matrixImageRef}
                  className="mx-auto inline-block w-max max-w-full bg-white px-2 py-2"
                >
                  <table className="w-max border-separate border-spacing-0">
                  <thead>
                    <tr className="h-[54px] text-center text-sm font-black uppercase text-slate-900">
                      <th
                        rowSpan={3}
                        className="sticky top-0 left-0 z-30 w-max max-w-52 rounded-tl-2xl border-b border-r border-slate-300 bg-slate-100 px-3 py-2 text-left align-middle shadow-[8px_0_16px_-14px_rgba(15,23,42,0.25)]"
                      >
                        <button
                          type="button"
                          onClick={() => handleMatrixSort("sede")}
                          className="flex items-center gap-2 text-left"
                          title={
                            matrixSortField === "sede" && matrixSortDirection === "asc"
                              ? "Orden actual: sedes (listado estandar). Click para invertir"
                              : matrixSortField === "sede" && matrixSortDirection === "desc"
                                ? "Orden actual: sedes invertido. Click para volver al listado estandar"
                                : "Ordenar por sede (listado estandar)"
                          }
                        >
                          <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                            Sede
                          </span>
                          {matrixSortField === "sede" ? (
                            <ArrowUp
                              className={`h-3.5 w-3.5 ${
                                matrixSortDirection === "asc"
                                  ? "text-slate-900"
                                  : "rotate-180 text-slate-900"
                              }`}
                            />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </button>
                      </th>
                      {summaryRows.map((row) => (
                        <th
                          key={`matrix-head-${row.item}`}
                          colSpan={jpgExportMode === "di-only" ? 1 : 2}
                          className={`sticky top-0 z-20 ${matrixItemColMinClass} border-b border-x-2 border-slate-300 bg-sky-100 px-2.5 py-2`}
                        >
                          <button
                            type="button"
                            onClick={() => handleMatrixSort(row.item)}
                            className="flex w-full items-center justify-center gap-2"
                            title={
                              matrixSortField === row.item && matrixSortDirection === "asc"
                                ? `Orden actual de ${row.item}: menor a mayor. Click para cambiar a mayor a menor`
                                : matrixSortField === row.item && matrixSortDirection === "desc"
                                  ? `Orden actual de ${row.item}: mayor a menor. Click para cambiar a menor a mayor`
                                  : `Ordenar por ${row.item}`
                            }
                          >
                            <div className="text-base font-black text-slate-900">
                              {row.item}
                            </div>
                            {matrixSortField === row.item ? (
                              <ArrowUp
                                className={`h-3.5 w-3.5 ${
                                  matrixSortDirection === "asc"
                                    ? "text-sky-700"
                                    : "rotate-180 text-sky-700"
                                }`}
                              />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                    <tr className="h-[42px] text-center text-xs font-bold uppercase tracking-[0.04em] text-slate-700">
                      {summaryRows.map((row) => (
                        <th
                          key={`matrix-subhead-${row.item}`}
                          colSpan={jpgExportMode === "di-only" ? 1 : 2}
                          className={`sticky top-[54px] z-20 ${matrixItemColMinClass} border-b border-x-2 border-slate-300 bg-sky-50 px-2.5 py-1.5 text-center align-middle`}
                          title={row.descripcion}
                        >
                          <div
                            className="mx-auto max-w-56 overflow-hidden text-center text-[10px] font-bold leading-snug tracking-[0.04em] text-slate-600"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            }}
                          >
                            {row.descripcion}
                          </div>
                        </th>
                      ))}
                    </tr>
                    <tr className="h-[32px] text-center text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      {summaryRows.flatMap((row) => {
                        const cells: ReactNode[] = [];
                        if (jpgExportMode !== "di-only") {
                          cells.push(
                            <th
                              key={`matrix-col-inv-${row.item}`}
                              className={`sticky top-[96px] z-20 ${matrixItemColMinClass} border-b border-l-2 border-r border-sky-100/90 bg-sky-50/70 px-2 py-1 text-sky-900/80`}
                            >
                              Inventario
                            </th>,
                          );
                        }
                        cells.push(
                          <th
                            key={`matrix-col-di-${row.item}`}
                            className={`sticky top-[96px] z-20 ${matrixItemColMinClass} border-b border-r-2 border-l border-violet-100/90 bg-violet-50/80 px-2 py-1 font-semibold tracking-[0.06em] text-violet-950`}
                          >
                            DI
                          </th>,
                        );
                        return cells;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMatrixRowsBySede.map((row, index) => (
                      <tr
                        key={row.key}
                        className={index % 2 === 0 ? "bg-white" : "bg-slate-50/80"}
                      >
                        <td
                          className="sticky left-0 z-10 w-max max-w-52 border-b border-r border-slate-200 bg-inherit px-3 py-1.5 text-sm font-bold text-slate-900 shadow-[8px_0_16px_-14px_rgba(15,23,42,0.2)]"
                          title={row.displayName}
                        >
                          <div className="max-w-52">
                            {multipleCompaniesInMatrix && (
                              <span className="mb-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                                {row.empresa}
                              </span>
                            )}
                            <div className="truncate">{row.displayName}</div>
                          </div>
                        </td>
                        {summaryRows.flatMap((itemRow) => {
                          const cellValue = row.items[itemRow.item] ?? {
                            inventoryUnits: 0,
                            diDays: 0,
                          };
                          const isZero = cellValue.inventoryUnits === 0;
                          const cells: ReactNode[] = [];
                          if (jpgExportMode !== "di-only") {
                            cells.push(
                              <td
                                key={`${row.key}-${itemRow.item}-inv`}
                                title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: Inv ${formatUnits(cellValue.inventoryUnits)}`}
                                className={`${matrixItemColMinClass} border-b border-l-2 border-r border-sky-100/70 bg-sky-50/35 px-2 py-1.5 text-right text-sm font-semibold tabular-nums ${
                                  isZero ? "text-slate-300" : "text-slate-700"
                                }`}
                              >
                                {formatUnits(cellValue.inventoryUnits)}
                              </td>,
                            );
                          }
                          cells.push(
                            <td
                              key={`${row.key}-${itemRow.item}-di`}
                              title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: DI ${formatDi(cellValue.diDays)}`}
                              className={`${matrixItemColMinClass} border-b border-slate-200/80 border-l-2 border-l-violet-100 border-r-2 border-r-violet-100 bg-violet-50/45 px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-800`}
                            >
                              {formatDi(cellValue.diDays)}
                            </td>,
                          );
                          return cells;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                {summaryRows.length > 2 ? (
                  <div className="border-t border-slate-200/80 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Desplaza horizontalmente para ver todos los items.
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-none fixed bottom-6 right-6 z-40">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-900/90 bg-slate-900 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.75)] transition-all hover:-translate-y-0.5 hover:bg-slate-800"
          >
            <ArrowUp className="h-4 w-4" />
            Volver arriba
          </button>
        </div>
      </div>
    </div>
  );
}
