"use client";

import {
  Fragment,
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
  Bookmark,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Filter,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  PackageSearch,
  RefreshCcw,
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
import { formatDateLabel } from "@/lib/shared/utils";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { TUTORIAL_LOCAL_STORAGE_KEYS, TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import { INVENTARIO_X_ITEM_TOUR_ANCHOR } from "@/lib/ui/portal-tours/inventario-x-item-tour-anchors";
import { INVENTARIO_X_ITEM_TOUR_STEPS } from "@/lib/ui/portal-tours/inventario-x-item-tour-steps";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import type {
  InventarioSummaryRow,
  InventarioMatrixRow,
  InventarioFilterCatalog,
  InventarioApiResponse,
  SelectOption,
  LineSelectionMode,
  MatrixSortDirection,
  MatrixSortField,
  MatrixCellValue,
  SummaryItemAgg,
} from "./types";
import {
  ALL_FILTER_VALUE,
  ITEM_DROPDOWN_NO_SEARCH_LIMIT,
  ITEM_DROPDOWN_SEARCH_LIMIT,
  ITEM_PRESETS_STORAGE_KEY,
  NO_SALES_DI_VALUE,
  dateLabelOptions,
  getCookieValue,
  defaultRollingMonthBackRange,
  compareText,
  formatPrice,
  formatUnits,
  prettifyItemDescription,
  getDiPillClasses,
  formatDi,
  calculateDiDays,
  calculateMatrixItemTotalDiDays,
  type InventarioMatrixItemTotals,
  buildSedeOptionValue,
  parseSedeOptionValue,
} from "./inventario-utils";
import { SelectField, MultiSelectField } from "./select-fields";

/**
 * Lee la respuesta de un endpoint y la devuelve tipada.
 *
 * Maneja de forma elegante el caso en que el endpoint NO devuelve JSON valido
 * (ej: cuando el GCP Load Balancer mata la request con un texto plano
 * "stream timeout" porque la query duro mas de 30s, o cuando nginx devuelve
 * una pagina HTML de error 502/504). En esos casos lanzamos un Error con
 * mensaje accionable en lugar del crash de `SyntaxError: Unexpected token ...`.
 */
async function readApiPayload<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const rawText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  let parsed: T | null = null;
  if (contentType.includes("application/json") && rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      // Si dice ser JSON pero esta corrupto, lo tratamos como error de red.
    }
  }

  if (response.ok && parsed) {
    return parsed;
  }

  const apiError = (parsed as { error?: string } | null)?.error;
  const lowerText = rawText.toLowerCase();
  const isTimeout =
    /timeout|timed out|gateway/.test(lowerText) ||
    response.status === 504 ||
    response.status === 408;
  const isUnavailable = response.status === 502 || response.status === 503;

  throw new Error(
    apiError ??
      (isTimeout
        ? "La consulta se demoro demasiado. Acota los filtros (menos sedes, items o un rango de fechas mas corto) y vuelve a intentar."
        : isUnavailable
          ? "El servidor no esta disponible en este momento. Intenta de nuevo en unos segundos."
          : `${fallbackMessage} (codigo ${response.status}).`),
  );
}

/**
 * Formatea milisegundos a un string corto y legible para el log de consola del
 * cronometro de carga de la matriz. No se muestra en la UI.
 */
const formatLoadDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};


export default function InventarioXItemPage() {
  const router = useRouter();
  const { status: authStatus, user } = useRequireAuth();
  const { hasSection, hasSubsection } = usePermissions();
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
  const [matrixSearchQuery, setMatrixSearchQuery] = useState("");
  const [matrixExpanded, setMatrixExpanded] = useState(false);
  const [matrixExportMenuOpen, setMatrixExportMenuOpen] = useState(false);
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
  /** Marca si ya aplicamos el default "mes anterior completo" al cargar
   * metadatos por primera vez. Evita pisar selecciones manuales del usuario
   * en recargas. */
  const monthToDateDefaultAppliedRef = useRef(false);

  const { startTour: startInventarioXItemTour } = useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.inventarioXItem,
    stateKey: TUTORIAL_STATE_KEYS.inventarioXItem,
    steps: INVENTARIO_X_ITEM_TOUR_STEPS,
    theme: "venta",
    userId: user?.id,
    ready,
    contentReady: ready,
  });

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
    if (authStatus !== "authenticated") return;
    if (!hasSection("venta") || !hasSubsection("inventario-x-item")) {
      router.replace("/secciones");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadPresets = async () => {
      try {
        const presetsLoaded = await loadItemPresetsFromServer(controller.signal);
        if (!isMounted || !presetsLoaded) return;
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadPresets();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [authStatus, hasSection, hasSubsection, router, loadItemPresetsFromServer]);

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

        const payload = await readApiPayload<InventarioApiResponse>(
          response,
          "No fue posible consultar los filtros de inventario.",
        );

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

        const payload = await readApiPayload<InventarioApiResponse>(
          response,
          "No fue posible consultar el inventario por item.",
        );

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
    // Debounce para evitar fetches encadenados cuando el usuario toca varios filtros
    // (ej: cambia el slider de fechas en pasos rapidos). El AbortController cancela la
    // peticion previa si se reprograma antes de tiempo.
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadFilterOptions(controller.signal);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadFilterOptions, ready, selectedDateEnd, selectedDateStart]);

  useEffect(() => {
    if (!ready || !hasScopeSelection) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadCatalogData(controller.signal);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
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
      ({
        diWeightedNum: _diWeightedNum,
        diWeightedDen: _diWeightedDen,
        anyNoSalesDi: _anyNoSalesDi,
        ...rest
      }) => rest,
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
      // Cronometro: marcamos inicio para loggear la duracion en consola al terminar.
      // No se muestra en la UI; solo queda en el log del navegador.
      const matrixLoadStartTs = performance.now();

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

        const payload = await readApiPayload<InventarioApiResponse>(
          response,
          "No fue posible construir la matriz de existencias.",
        );

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
        // Logueamos la duracion del fetch solo cuando la carga NO fue abortada.
        // En aborts no tiene sentido reportar el tiempo (la respuesta nunca llego).
        if (!signal?.aborted) {
          const elapsedMs = performance.now() - matrixLoadStartTs;
          console.info(
            `[inventario-x-item] Matriz cargada en ${formatLoadDuration(elapsedMs)} (${elapsedMs.toFixed(0)} ms).`,
          );
        }
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
    if (summaryRows.length >= 8) return "min-w-20";
    if (summaryRows.length >= 5) return "min-w-24";
    return "min-w-28";
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
      inventoryValue: number;
      soldUnits: number;
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
        inventoryValue: 0,
        soldUnits: 0,
        diWeightedNum: 0,
        diWeightedDen: 0,
        anyNoSalesDi: false,
      };
      agg.inventoryUnits += row.inventoryUnits;
      agg.inventoryValue += row.inventoryValue;
      agg.soldUnits += row.totalUnits;
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
        inventoryValue: agg.inventoryValue,
        soldUnits: agg.soldUnits,
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
    const totals: Record<string, InventarioMatrixItemTotals> = {};
    filteredMatrixRows.forEach((row) => {
      const acc = totals[row.item] ?? {
        inventoryUnits: 0,
        inventoryValue: 0,
        soldUnits: 0,
        trackedDays: 0,
      };
      acc.inventoryUnits += row.inventoryUnits;
      acc.inventoryValue += row.inventoryValue;
      acc.soldUnits += row.totalUnits;
      acc.trackedDays = Math.max(acc.trackedDays, row.trackedDays);
      totals[row.item] = acc;
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

  /** Filtra las filas por sede o empresa (buscador del toolbar). */
  const filteredSortedMatrixRows = useMemo(() => {
    const query = matrixSearchQuery.trim().toLowerCase();
    if (!query) return sortedMatrixRowsBySede;
    return sortedMatrixRowsBySede.filter((row) => {
      const sede = row.displayName?.toLowerCase() ?? "";
      const empresa = row.empresa?.toLowerCase() ?? "";
      return sede.includes(query) || empresa.includes(query);
    });
  }, [matrixSearchQuery, sortedMatrixRowsBySede]);

  /** Cuenta de sedes por empresa para los headers de grupo. */
  const matrixGroupCountsByCompany = useMemo(() => {
    const counts = new Map<string, number>();
    filteredSortedMatrixRows.forEach((row) => {
      counts.set(row.empresa, (counts.get(row.empresa) ?? 0) + 1);
    });
    return counts;
  }, [filteredSortedMatrixRows]);

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

      /** PDF: solo Inventario y DI por referencia (sin valor ni vendido). */
      const colsPerItem = 2;
      const head = [
        [
          { content: "Sede", rowSpan: 2, styles: { valign: "middle" as const } },
          ...summaryRows.map((row) => ({
            content: `${row.item}\n${truncatePdfDesc(row.descripcion)}`,
            colSpan: colsPerItem,
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
            inventoryValue: 0,
            soldUnits: 0,
            diDays: 0,
          };
          return [formatUnits(cell.inventoryUnits), formatDi(cell.diDays)];
        }),
      ]);

      const foot = [
        [
          "Total general",
          ...summaryRows.flatMap((row) => {
            const itemTotals = matrixTotalsByItem[row.item] ?? {
              inventoryUnits: 0,
              inventoryValue: 0,
              soldUnits: 0,
              trackedDays: 0,
            };
            return [
              formatUnits(itemTotals.inventoryUnits),
              formatDi(calculateMatrixItemTotalDiDays(itemTotals)),
            ];
          }),
        ],
      ];

      const marginX = 10;
      const pdfSedeColMm = 30;
      const pdfInvColMm = 17;
      const pdfDiColMm = 11;
      const tableNaturalWidthMm =
        pdfSedeColMm + summaryRows.length * (pdfInvColMm + pdfDiColMm);
      const pdfFontSize = Math.max(
        5.5,
        Math.min(7, 7.0 - summaryRows.length * 0.16),
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
      for (let i = 0; i < summaryRows.length; i += 1) {
        pdfColumnStyles[1 + i * colsPerItem] = {
          cellWidth: pdfInvColMm,
          halign: "right",
        };
        pdfColumnStyles[2 + i * colsPerItem] = {
          cellWidth: pdfDiColMm,
          halign: "right",
        };
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
          cellPadding: { top: 0.7, right: 1.1, bottom: 0.7, left: 1.1 },
          lineColor: [203, 213, 225],
          lineWidth: 0.1,
          valign: "middle",
          minCellHeight: 5,
        },
        headStyles: {
          fillColor: [219, 234, 254],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          halign: "center",
          valign: "middle",
          cellPadding: { top: 1, right: 1.1, bottom: 1, left: 1.1 },
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
          const isPdfDiColumn = col > 0 && (col - 1) % colsPerItem === 1;

          if (data.section === "body" || data.section === "foot") {
            data.cell.styles.cellPadding = {
              top: 0.55,
              right: 1,
              bottom: 0.55,
              left: 1,
            };
          }

          if (
            data.section === "head" &&
            data.row.index === 0 &&
            col > 0
          ) {
            data.cell.styles.fontSize = Math.max(5, pdfFontSize - 0.25);
          }

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

        const colsPerItem = includeInv ? 4 : 1;
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

            const valSub = sheet.getCell(subHeaderRow, startCol + 1);
            valSub.value = "Valor inv.";
            valSub.font = { bold: true, size: 9, color: { argb: "FF0C4A6E" } };
            valSub.alignment = { horizontal: "center", vertical: "middle" };
            valSub.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0F9FF" },
            };
            valSub.border = thinBorder;

            const soldSub = sheet.getCell(subHeaderRow, startCol + 2);
            soldSub.value = `Vendido${row.unidad ? ` (${row.unidad})` : ""}`;
            soldSub.font = { bold: true, size: 9, color: { argb: "FF065F46" } };
            soldSub.alignment = { horizontal: "center", vertical: "middle" };
            soldSub.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFECFDF5" },
            };
            soldSub.border = thinBorder;
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
              inventoryValue: 0,
              soldUnits: 0,
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

              const valCell = sheet.getCell(excelRow, startCol + 1);
              valCell.value = cellValue.inventoryValue;
              valCell.numFmt = '"$"#,##0';
              valCell.alignment = { horizontal: "right", vertical: "middle" };
              valCell.border = thinBorder;
              if (cellValue.inventoryValue <= 0) {
                valCell.font = { color: { argb: "FFCBD5E1" } };
              }
              if (rowFill) valCell.fill = rowFill;

              const soldCell = sheet.getCell(excelRow, startCol + 2);
              soldCell.value = cellValue.soldUnits;
              soldCell.numFmt = "#,##0";
              soldCell.alignment = { horizontal: "right", vertical: "middle" };
              soldCell.border = thinBorder;
              if (cellValue.soldUnits === 0) {
                soldCell.font = { color: { argb: "FFCBD5E1" } };
              }
              if (rowFill) soldCell.fill = rowFill;
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
          const itemTotals = matrixTotalsByItem[row.item] ?? {
            inventoryUnits: 0,
            inventoryValue: 0,
            soldUnits: 0,
            trackedDays: 0,
          };
          if (includeInv) {
            const invTotalCell = sheet.getCell(totalRow, startCol);
            invTotalCell.value = itemTotals.inventoryUnits;
            invTotalCell.numFmt = "#,##0";
            invTotalCell.font = { bold: true };
            invTotalCell.alignment = { horizontal: "right", vertical: "middle" };
            invTotalCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFEF3C7" },
            };
            invTotalCell.border = thinBorder;

            const valTotalCell = sheet.getCell(totalRow, startCol + 1);
            valTotalCell.value = itemTotals.inventoryValue;
            valTotalCell.numFmt = '"$"#,##0';
            valTotalCell.font = { bold: true };
            valTotalCell.alignment = { horizontal: "right", vertical: "middle" };
            valTotalCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFEF3C7" },
            };
            valTotalCell.border = thinBorder;

            const soldTotalCell = sheet.getCell(totalRow, startCol + 2);
            soldTotalCell.value = itemTotals.soldUnits;
            soldTotalCell.numFmt = "#,##0";
            soldTotalCell.font = { bold: true };
            soldTotalCell.alignment = { horizontal: "right", vertical: "middle" };
            soldTotalCell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFEF3C7" },
            };
            soldTotalCell.border = thinBorder;
          }
          const diCol = startCol + colsPerItem - 1;
          const diTotalCell = sheet.getCell(totalRow, diCol);
          diTotalCell.value = calculateMatrixItemTotalDiDays(itemTotals);
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
            sheet.getColumn(startCol).width = 12;
            sheet.getColumn(startCol + 1).width = 15;
            sheet.getColumn(startCol + 2).width = 13;
            sheet.getColumn(startCol + 3).width = 9;
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_55%),linear-gradient(180deg,#f8fafc,#eef4ff)] text-foreground">
      <AppTopBar
        backHref="/venta"
        backLabel="Volver a venta"
        onTourHelp={startInventarioXItemTour}
      />
      <div className="px-4 py-10">
      <div className="mx-auto w-full max-w-7xl rounded-[30px] border border-slate-200/70 bg-white p-8 shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
        <div className="relative overflow-hidden rounded-3xl border border-blue-200/70 bg-linear-to-br from-blue-100 via-blue-50/40 to-white p-6 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.28)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-blue-500">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_130%_100%_at_10%_-20%,rgba(59,130,246,0.32),transparent_60%)]"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl" id={INVENTARIO_X_ITEM_TOUR_ANCHOR.intro}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-600">
                Venta
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Inventario x item
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Filtra empresa, sede, linea, subcategoria e items para resumir
                el inventario vigente por referencia usando el ultimo corte
                disponible de la tabla base de rotacion.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/80 bg-blue-50/80 px-3 py-1 text-xs font-semibold text-blue-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Rango: {availableRangeLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/80 bg-violet-50/80 px-3 py-1 text-xs font-semibold text-violet-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Seleccionado: {selectedDateLabel}
                </span>
              </div>
              <div className="mt-2">
                {selectedItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    {selectedItems.length} de{" "}
                    {INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS} items seleccionados
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    <Loader2 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    Items pendientes
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleReload}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                Recargar
              </button>
            </div>
          </div>
        </div>

        <div
          id={INVENTARIO_X_ITEM_TOUR_ANCHOR.filters}
          className="mt-6 rounded-2xl border border-slate-200/70 bg-white px-4 py-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.18)]"
        >
          {showValidation && !hasRequiredFilters && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Completa los filtros obligatorios para ver la matriz. Puedes
              escoger una opcion puntual o seleccionar {"\"Todas\""} cuando
              quieras ampliar el alcance.
            </div>
          )}

          {loadingFilters && (
            <div
              className="mb-3 flex items-center gap-2 rounded-xl border border-blue-200/80 bg-blue-50/90 px-3 py-2 text-xs text-blue-900"
              role="status"
              aria-live="polite"
            >
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-blue-700 motion-reduce:animate-none"
                strokeWidth={2}
                aria-hidden
              />
              <span className="font-medium">
                Actualizando fechas y opciones de filtro...
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-12">
            <label className="block xl:col-span-2">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <CalendarDays className="h-3 w-3 text-blue-500" />
                Fecha desde
              </span>
              <input
                type="date"
                value={selectedDateStartState}
                onChange={(event) => handleDateStartChange(event.target.value)}
                min={availableDateStart || undefined}
                max={availableDateEnd || undefined}
                disabled={loadingFilters || !availableDateEnd}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="block xl:col-span-2">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <CalendarDays className="h-3 w-3 text-blue-500" />
                Fecha hasta
              </span>
              <input
                type="date"
                value={selectedDateEndState}
                onChange={(event) => handleDateEndChange(event.target.value)}
                min={availableDateStart || undefined}
                max={availableDateEnd || undefined}
                disabled={loadingFilters || !availableDateEnd}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <div className="xl:col-span-4">
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
              />
            </div>
            <div className="xl:col-span-4">
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
              />
            </div>
            <div className="xl:col-span-3">
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
              />
            </div>
            <div className="xl:col-span-3">
              <SelectField
                icon={Filter}
                label="Subcategoria"
                value={selectedSubcategoryState}
                options={subcategoryOptions}
                onChange={handleSubcategoryChange}
                emptyLabel="Selecciona subcategoria"
                disabled={!hasScopeSelection || loadingCatalog || !hasLineOptions}
                invalid={showValidation && !hasSubcategorySelection}
              />
            </div>
            <div className="xl:col-span-6">
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
              />
            </div>
          </div>

          <div
            id={INVENTARIO_X_ITEM_TOUR_ANCHOR.presets}
            className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:flex-nowrap"
          >
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em]">
              <Bookmark className="h-3 w-3 text-blue-500" aria-hidden />
              Presets
            </span>
            <input
              type="text"
              value={presetNameInput}
              onChange={(event) => setPresetNameInput(event.target.value)}
              placeholder="Nombre del preset"
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={handleSaveItemsPreset}
              disabled={
                presetNameInput.trim().length === 0 ||
                selectedItems.length === 0
              }
              className="h-8 shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Guardar
            </button>
            <span className="hidden h-5 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
            <select
              value={selectedPresetId}
              onChange={(event) => handleApplyItemsPreset(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Aplicar preset...</option>
              {itemPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.items.length})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDeleteItemsPreset}
              disabled={!selectedPresetId}
              className="h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Eliminar
            </button>
          </div>
        </div>

        <div
          id={INVENTARIO_X_ITEM_TOUR_ANCHOR.matrix}
          className={
            matrixExpanded
              ? "fixed inset-2 z-50 overflow-auto rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.35)]"
              : "mt-6 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.18)]"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Matriz de inventario
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {hasAppliedCurrentFilters ? matrixRowsBySede.length : 0} sedes ·{" "}
                {hasAppliedCurrentFilters ? summaryRows.length : 0} items · datos
                al corte
              </p>
            </div>
            {hasAppliedCurrentFilters && selectedDateLabel ? (
              <div className="order-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 lg:order-0">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                {selectedDateLabel}
              </div>
            ) : null}
            <div className="order-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600 lg:order-0">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={matrixSearchQuery}
                  onChange={(event) => setMatrixSearchQuery(event.target.value)}
                  placeholder="Buscar sede o empresa"
                  disabled={!hasAppliedCurrentFilters || summaryRows.length === 0}
                  className="h-9 w-56 rounded-full border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="relative inline-block" id={INVENTARIO_X_ITEM_TOUR_ANCHOR.export}>
                <button
                  type="button"
                  onClick={() => setMatrixExportMenuOpen((open) => !open)}
                  disabled={
                    !hasAppliedCurrentFilters ||
                    summaryRows.length === 0 ||
                    exportingPdf ||
                    exportingExcel ||
                    exportingJpg
                  }
                  aria-haspopup="menu"
                  aria-expanded={matrixExportMenuOpen}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {exportingPdf
                    ? "Generando PDF..."
                    : exportingExcel
                      ? "Generando Excel..."
                      : exportingJpg
                        ? "Generando JPG..."
                        : "Exportar"}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${matrixExportMenuOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>
                {matrixExportMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                    onMouseLeave={() => setMatrixExportMenuOpen(false)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMatrixExportMenuOpen(false);
                        handleDownloadMatrixPdf();
                      }}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMatrixExportMenuOpen(false);
                        void handleDownloadMatrixExcel("full");
                      }}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Excel · completo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMatrixExportMenuOpen(false);
                        void handleDownloadMatrixExcel("di-only");
                      }}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Excel · solo DI
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMatrixExportMenuOpen(false);
                        void handleDownloadMatrixJpg("full");
                      }}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      JPG · completo
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMatrixExportMenuOpen(false);
                        void handleDownloadMatrixJpg("di-only");
                      }}
                      className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      JPG · solo DI
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMatrixExpanded((expanded) => !expanded)}
                disabled={!hasAppliedCurrentFilters || summaryRows.length === 0}
                aria-pressed={matrixExpanded}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {matrixExpanded ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                    Contraer
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                    Expandir
                  </>
                )}
              </button>
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
            <div className="relative mt-6 overflow-visible rounded-3xl border border-slate-200 bg-white">
              <div className="overflow-x-auto overflow-y-visible rounded-3xl bg-white">
                <div
                  ref={matrixImageRef}
                  className="mx-auto inline-block w-max max-w-full rounded-3xl bg-white px-3 py-3"
                >
                  <table className="w-max border-separate border-spacing-0">
                  <thead>
                    <tr className="text-center text-slate-900">
                      <th
                        rowSpan={2}
                        className="sticky top-0 left-0 z-30 w-max max-w-52 border-b border-r border-slate-200 bg-white px-3 py-2 text-left align-middle"
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
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Sede
                          </span>
                          {matrixSortField === "sede" ? (
                            <ArrowUp
                              className={`h-3 w-3 ${
                                matrixSortDirection === "asc"
                                  ? "text-slate-700"
                                  : "rotate-180 text-slate-700"
                              }`}
                            />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 text-slate-300" />
                          )}
                        </button>
                      </th>
                      {summaryRows.map((row) => (
                        <th
                          key={`matrix-head-${row.item}`}
                          colSpan={jpgExportMode === "di-only" ? 1 : 4}
                          className={`sticky top-0 z-20 ${matrixItemColMinClass} border-b border-r border-slate-100 bg-white px-2.5 py-3 align-bottom`}
                          title={row.descripcion}
                        >
                          <button
                            type="button"
                            onClick={() => handleMatrixSort(row.item)}
                            className="flex w-full flex-col items-center justify-center gap-1"
                            title={
                              matrixSortField === row.item && matrixSortDirection === "asc"
                                ? `Orden actual de ${row.item}: menor a mayor. Click para cambiar a mayor a menor`
                                : matrixSortField === row.item && matrixSortDirection === "desc"
                                  ? `Orden actual de ${row.item}: mayor a menor. Click para cambiar a menor a mayor`
                                  : `Ordenar por ${row.item}`
                            }
                          >
                            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-blue-600">
                              {row.item}
                              {matrixSortField === row.item ? (
                                <ArrowUp
                                  className={`h-3 w-3 ${
                                    matrixSortDirection === "asc"
                                      ? "text-blue-500"
                                      : "rotate-180 text-blue-500"
                                  }`}
                                />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 text-slate-300" />
                              )}
                            </span>
                            <span
                              className="mx-auto max-w-56 overflow-hidden text-center text-sm font-medium leading-snug text-slate-700"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                              }}
                            >
                              {prettifyItemDescription(row.descripcion)}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                    <tr className="h-[28px] text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {summaryRows.flatMap((row) => {
                        const cells: ReactNode[] = [];
                        if (jpgExportMode !== "di-only") {
                          cells.push(
                            <th
                              key={`matrix-col-inv-${row.item}`}
                              className={`sticky top-[88px] z-20 ${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-white px-2 py-1`}
                            >
                              Inventario
                            </th>,
                          );
                          cells.push(
                            <th
                              key={`matrix-col-val-${row.item}`}
                              className={`sticky top-[88px] z-20 ${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-white px-2 py-1`}
                            >
                              Valor Inv.
                            </th>,
                          );
                          cells.push(
                            <th
                              key={`matrix-col-sold-${row.item}`}
                              className={`sticky top-[88px] z-20 ${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-white px-2 py-1`}
                            >
                              Vendido{row.unidad ? ` (${row.unidad})` : ""}
                            </th>,
                          );
                        }
                        cells.push(
                          <th
                            key={`matrix-col-di-${row.item}`}
                            className={`sticky top-[88px] z-20 ${matrixItemColMinClass} border-b border-r border-slate-100 bg-white px-2 py-1`}
                          >
                            DI
                          </th>,
                        );
                        return cells;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedMatrixRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={
                            1 +
                            summaryRows.length *
                              (jpgExportMode === "di-only" ? 1 : 4)
                          }
                          className="px-4 py-8 text-center text-sm text-slate-500"
                        >
                          No hay sedes que coincidan con &quot;{matrixSearchQuery}&quot;.
                        </td>
                      </tr>
                    ) : (
                      filteredSortedMatrixRows.map((row, index) => {
                        const prevRow = filteredSortedMatrixRows[index - 1];
                        const isFirstOfCompany =
                          multipleCompaniesInMatrix &&
                          (!prevRow || prevRow.empresa !== row.empresa);
                        const companyCount =
                          matrixGroupCountsByCompany.get(row.empresa) ?? 0;
                        return (
                          <Fragment key={row.key}>
                            {isFirstOfCompany && (
                              <tr className="bg-slate-50/70">
                                <td
                                  colSpan={
                                    1 +
                                    summaryRows.length *
                                      (jpgExportMode === "di-only" ? 1 : 4)
                                  }
                                  className="sticky left-0 z-10 border-t border-b border-slate-200 bg-slate-50/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500"
                                >
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                                    {row.empresa}
                                    <span className="text-slate-400">
                                      · {companyCount} sede
                                      {companyCount === 1 ? "" : "s"}
                                    </span>
                                  </span>
                                </td>
                              </tr>
                            )}
                            <tr
                              className={`group transition-colors hover:bg-sky-50/50 ${
                                index % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                              }`}
                            >
                              <td
                                className="sticky left-0 z-10 w-max max-w-52 border-b border-r border-slate-100 bg-inherit px-3 py-1.5 text-sm font-semibold text-slate-900"
                                title={row.displayName}
                              >
                                <div className="max-w-52 truncate">
                                  {row.displayName}
                                </div>
                              </td>
                              {summaryRows.flatMap((itemRow) => {
                                const cellValue = row.items[itemRow.item] ?? {
                                  inventoryUnits: 0,
                                  inventoryValue: 0,
                                  soldUnits: 0,
                                  diDays: 0,
                                };
                                const isZero = cellValue.inventoryUnits === 0;
                                const noValue = cellValue.inventoryValue <= 0;
                                const noSold = cellValue.soldUnits === 0;
                                const cells: ReactNode[] = [];
                                if (jpgExportMode !== "di-only") {
                                  cells.push(
                                    <td
                                      key={`${row.key}-${itemRow.item}-inv`}
                                      title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: Inv ${formatUnits(cellValue.inventoryUnits)}`}
                                      className={`${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-inherit px-2 py-1.5 text-center text-sm font-medium tabular-nums ${
                                        isZero ? "text-slate-300" : "text-slate-800"
                                      }`}
                                    >
                                      {formatUnits(cellValue.inventoryUnits)}
                                    </td>,
                                  );
                                  cells.push(
                                    <td
                                      key={`${row.key}-${itemRow.item}-val`}
                                      title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: Valor inventario ${formatPrice(cellValue.inventoryValue)}`}
                                      className={`${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-inherit px-2 py-1.5 text-center text-sm font-medium tabular-nums ${
                                        noValue ? "text-slate-300" : "text-slate-800"
                                      }`}
                                    >
                                      {formatPrice(cellValue.inventoryValue)}
                                    </td>,
                                  );
                                  cells.push(
                                    <td
                                      key={`${row.key}-${itemRow.item}-sold`}
                                      title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: Vendido ${formatUnits(cellValue.soldUnits)}${itemRow.unidad ? ` ${itemRow.unidad}` : ""}`}
                                      className={`${matrixItemColMinClass} border-b border-r border-dashed border-r-slate-200 bg-inherit px-2 py-1.5 text-center text-sm font-medium tabular-nums ${
                                        noSold ? "text-slate-300" : "text-slate-800"
                                      }`}
                                    >
                                      {formatUnits(cellValue.soldUnits)}
                                      {itemRow.unidad ? (
                                        <span className="ml-1 text-[10px] font-normal text-slate-400">
                                          {itemRow.unidad}
                                        </span>
                                      ) : null}
                                    </td>,
                                  );
                                }
                                cells.push(
                                  <td
                                    key={`${row.key}-${itemRow.item}-di`}
                                    title={`${row.displayName} | ${itemRow.item} | ${itemRow.descripcion}: DI ${formatDi(cellValue.diDays)}`}
                                    className={`${matrixItemColMinClass} border-b border-r border-r-slate-100 bg-inherit px-2 py-1.5 text-center text-xs font-semibold tabular-nums`}
                                  >
                                    {isZero ? (
                                      <span className="text-slate-300">
                                        {formatDi(cellValue.diDays)}
                                      </span>
                                    ) : (
                                      <span
                                        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${getDiPillClasses(cellValue.diDays)}`}
                                      >
                                        {formatDi(cellValue.diDays)}
                                      </span>
                                    )}
                                  </td>,
                                );
                                return cells;
                              })}
                            </tr>
                          </Fragment>
                        );
                      })
                    )}
                    <tr className="bg-slate-50">
                      <td className="sticky left-0 z-10 border-t-2 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">
                        Total
                      </td>
                      {summaryRows.flatMap((itemRow) => {
                        const itemTotals = matrixTotalsByItem[itemRow.item] ?? {
                          inventoryUnits: 0,
                          inventoryValue: 0,
                          soldUnits: 0,
                          trackedDays: 0,
                        };
                        const totalDiDays =
                          calculateMatrixItemTotalDiDays(itemTotals);
                        const totalDiIsZero =
                          itemTotals.inventoryUnits <= 0 ||
                          itemTotals.inventoryValue <= 0;
                        const cells: ReactNode[] = [];
                        if (jpgExportMode !== "di-only") {
                          cells.push(
                            <td
                              key={`total-${itemRow.item}-inv`}
                              className={`${matrixItemColMinClass} border-t-2 border-b border-r border-dashed border-r-slate-200 border-t-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-900`}
                            >
                              {formatUnits(itemTotals.inventoryUnits)}
                            </td>,
                          );
                          cells.push(
                            <td
                              key={`total-${itemRow.item}-val`}
                              className={`${matrixItemColMinClass} border-t-2 border-b border-r border-dashed border-r-slate-200 border-t-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-900`}
                            >
                              {formatPrice(itemTotals.inventoryValue)}
                            </td>,
                          );
                          cells.push(
                            <td
                              key={`total-${itemRow.item}-sold`}
                              className={`${matrixItemColMinClass} border-t-2 border-b border-r border-dashed border-r-slate-200 border-t-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-900`}
                            >
                              {formatUnits(itemTotals.soldUnits)}
                              {itemRow.unidad ? (
                                <span className="ml-1 text-[10px] font-normal text-slate-500">
                                  {itemRow.unidad}
                                </span>
                              ) : null}
                            </td>,
                          );
                        }
                        cells.push(
                          <td
                            key={`total-${itemRow.item}-di`}
                            className={`${matrixItemColMinClass} border-t-2 border-b border-r border-r-slate-100 border-t-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-bold tabular-nums`}
                          >
                            {totalDiIsZero ? (
                              <span className="text-slate-300">
                                {formatDi(totalDiDays)}
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${getDiPillClasses(totalDiDays)}`}
                              >
                                {formatDi(totalDiDays)}
                              </span>
                            )}
                          </td>,
                        );
                        return cells;
                      })}
                    </tr>
                  </tbody>
                </table>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/80 bg-slate-50/60 px-5 py-3 text-[11px] font-semibold text-slate-600">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      DI
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    &lt; 15 d · rotacion alta
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
                    15 - 35 d · normal
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                    35 - 60 d · revisar
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />
                    &gt; 60 d · sobrestock
                  </span>
                  {summaryRows.length > 2 ? (
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Desplaza horizontalmente para ver todos los items
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>

        <ScrollToTopButton />
      </div>
      </div>
    </div>
  );
}
