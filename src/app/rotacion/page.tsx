"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as ExcelJS from "exceljs";
import { toJpeg, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Filter,
  History,
  Loader2,
  MapPin,
  PackageSearch,
  CircleHelp,
  SlidersHorizontal,
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
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import {
  canAccessRotacionBoard,
  canEditRotacionAbcdConfig,
  canViewRotacionSinventarioHistorial,
} from "@/lib/shared/special-role-features";
import { resolveSessionLineCategoryScope } from "@/lib/shared/line-category-scope";
import {
  CERO_ROTACION_ESTADO_LABELS,
  CERO_ROTACION_ESTADO_SORT_ORDER,
  CERO_ROTACION_ESTADO_VALUES,
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
  type CeroRotacionEstado,
  type RotacionSurtidoEstadoContext,
} from "@/lib/rotacion/cero-estado";
import { cn, formatDateLabel } from "@/lib/shared/utils";
import {
  FilterFieldLabel,
  FilterSelectField,
  SortableRotationHeader,
  WhatsAppLogo,
} from "./rotation-filter-widgets";
import type { DateRange, RotationRow, RotationCategoriaFilterOption, RotationApiResponse, RotationCatalogSnapshot, LineaN1Option, LineaN2Option, LineaN1FamilyKey, AbcdConfig, GroupAbcdFilter, RotationSortField, RotationSortDirection, PageSize, GroupRowsQuickFilter } from "./rotacion-preamble";
import {
  getCookieValue,
  ALL_LINEA_N1_FAMILY_KEYS,
  LINEA_N1_FAMILY_LABELS,
  matchesLineaN1Family,
  toggleAbcdLetterFilter,
  isAbcdLetterFilterActive,
  formatAbcdCategoryFilterLabel,
  ROTACION_TABLE_COL_WIDTHS,
  ROTACION_ZERO_TABLE_COL_WIDTHS,
  ROTACION_FLOATING_HEADER_TOP_PX,
  ROTACION_FLOATING_HEADER_COLUMNS,
  ROTACION_FLOATING_HEADER_COLUMNS_ZERO,
  NO_SALES_DI_VALUE,
  mergeRotationLineaN1NombreMaps,
  mergeRotationLineaN2NombreMaps,
  bestLineaDisplayFromRow,
  compareLineaN1FilterCodes,
  compareLineaN2FilterCodes,
  normalizeLineaN1CodeForFilter,
  normalizeLineaN2CodeForFilter,
  resolveRowLineaN2FilterCode,
  LINEA_N1_SHORT_NAMES,
  DEFAULT_ABCD_CONFIG,
  PAGE_SIZE_OPTIONS,
  dateLabelOptions,
  getRollingMonthBackRange,
  buildRotacionRowsKey,
  sanitizeNumericInput,
  normalizeDateRange,
  ROTACION_MAX_RANGE_ERROR,
  enforceMaxDateRangeMonths,
  isRangeWithinMaxMonths,
  countInclusiveDays,
  formatRangeLabel,
  formatPrice,
  formatPriceWithoutSixZeros,
  formatPercent,
  rotationMarginPct,
  parseDateKey,
  buildExportFileStamp,
  dataUrlToBlob,
  WHATSAPP_TABLE_EXCLUDE,
  getRotacionWhatsappPixelRatio,
  openWhatsAppDesktopPreferred,
  WHATSAPP_JPEG_QUALITY,
  rotacionWhatsappExportFilter,
  prepareRotacionWhatsappExportDom,
  rowMatchesProductSearch,
  formatRotationOneDecimal,
  calculateDuvDays,
  calculateDiSinceLastIngresoDays,
  normalizeRotationRows,
  filterRotationRowsByLineaAndCategoria,
  readCatalogCache,
  writeCatalogCache,
  buildDefaultCategoriaKeys,
  normalizeAbcdConfig,
  buildAbcdCategoryByItem,
  countAbcdItemsByCategory,
  buildAbcdSummaryRows,
  getDefaultSortDirection,
  sortRotationRows,
  buildRowsBySede,
  buildConsolidatedRowsBySelection,
  isNuevoItemRow,
  isCeroRotacionExcludingNuevo,
  applyRowsQuickFilter,
  formatCompanyLabel,
  displayRotationSedeName,
  mapRotationSedeOptions,
  readRotationApiForbiddenMessage,
  normalizeGroupZeroEstadoSetFilter,
} from "./rotacion-preamble";
import { ROTACION_LEGACY_VIEW } from "@/app/rotacion/rotacion-view-config";
import {
  RotacionViewConfigProvider,
  useRotacionViewConfig,
} from "@/app/rotacion/rotacion-view-config-provider";
import { RotacionItemDrilldown } from "@/app/rotacion/rotacion-item-drilldown";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { AbcdConfigModal } from "./abcd-config-modal";
import { buildRotacionExportGroups } from "./rotacion-export-groups";
import type { RotacionExportGroup } from "./rotacion-export-groups";
import { RotacionExportSedeModal } from "./rotacion-export-sede-modal";
import { prepareRotacionExportData } from "./rotacion-export-fetch";
import { useRotacionTour } from "./use-rotacion-tour";
import { ROTACION_TOUR_ANCHOR } from "./rotacion-tour-anchors";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";
import { auditChangedAtDateKeyBogota } from "./audit-utils";
import { SurtidoAuditModal } from "./surtido-audit-modal";
import {
  buildRotacionRowsCacheKey,
  readRotacionRowsIdbCache,
  writeRotacionRowsIdbCache,
} from "./rotacion-rows-idb-cache";
import {
  buildUserLastSedeStorageKey,
  fetchRotacionRowsForCache,
  getInFlightRotacionRowsFetch,
  readUserLastSedeSelection,
  resolveRotacionPrefetchSedeValues,
  type RotacionRowsFetchResult,
} from "./rotacion-prefetch";

/** Espera breve antes de recargar filas tras cambiar sede/rango (ms). */
const ROTACION_ROWS_RELOAD_DEBOUNCE_MS = 100;

/**
 * Formatea milisegundos a un string legible para el log de consola del
 * cronometro de carga de la tabla de rotacion. No se renderiza en la UI.
 */
const formatLoadDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
};

export function RotacionPageInner() {
  const {
    apiBasePath,
    sourceTable,
    lastSedeStorageKey,
    pageTitle,
    pageDescription,
    exportFilePrefix,
  } = useRotacionViewConfig();
  const router = useRouter();
  const { user: authUser, status: authStatus } = useRequireAuth();
  const { isAdmin, hasSection, hasSubsection } = usePermissions();
  const specialRoles = authUser?.specialRoles ?? null;
  const lineCategoryScope = useMemo(
    () => (authUser ? resolveSessionLineCategoryScope(authUser) : null),
    [authUser],
  );
  const [ready, setReady] = useState(false);
  const [isAbcdModalOpen, setIsAbcdModalOpen] = useState(false);
  const [surtidoAuditModalOpen, setSurtidoAuditModalOpen] = useState(false);
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
  const [selectedLineaN2Values, setSelectedLineaN2Values] = useState<string[]>(
    [],
  );
  const [lineasN2Catalog, setLineasN2Catalog] = useState<{
    codes: string[];
    nombres: Record<string, string>;
    itemLineaN2ByKey: Record<string, string>;
  }>({ codes: [], nombres: {}, itemLineaN2ByKey: {} });
  const [isLoadingLineasN2Catalog, setIsLoadingLineasN2Catalog] =
    useState(false);
  const lineasN2LoadGenerationRef = useRef(0);
  const [selectedCategoriaKeys, setSelectedCategoriaKeys] = useState<string[]>(
    [],
  );
  const [abcdConfig, setAbcdConfig] = useState<AbcdConfig>(DEFAULT_ABCD_CONFIG);
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
  const [ceroEstadoFilterByGroup, setCeroEstadoFilterByGroup] = useState<
    Record<string, CeroRotacionEstado[]>
  >({});
  /** Valor aplicado al pulsar «Venta ≤» (tope de venta periodo en COP). */
  const [ventaHastaCapByGroup, setVentaHastaCapByGroup] = useState<
    Record<string, number | undefined>
  >({});
  const [ventaHastaInputByGroup, setVentaHastaInputByGroup] = useState<
    Record<string, string>
  >({});
  /** Piso de unidades de inventario al pulsar «Inv ≥» (independiente del filtro de venta). */
  const [invMinCapByGroup, setInvMinCapByGroup] = useState<
    Record<string, number | undefined>
  >({});
  const [invMinInputByGroup, setInvMinInputByGroup] = useState<
    Record<string, string>
  >({});
  const [abcdFilterByGroup, setAbcdFilterByGroup] = useState<
    Record<string, GroupAbcdFilter>
  >({});
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportSedePickerOpen, setIsExportSedePickerOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isWhatsAppSharing, setIsWhatsAppSharing] = useState(false);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [ceroEstadoByKey, setCeroEstadoByKey] = useState<
    Record<string, CeroRotacionEstado>
  >({});
  const [restockEstadoByKey, setRestockEstadoByKey] = useState<
    Record<string, CeroRotacionEstado>
  >({});
  const [isFamilyFilterOpen, setIsFamilyFilterOpen] = useState(false);
  const [floatingHeaderState, setFloatingHeaderState] = useState<{
    groupKey: string;
    left: number;
    width: number;
    scrollLeft: number;
  } | null>(null);
  const rotacionTablesExportRef = useRef<HTMLDivElement>(null);
  const tableHostByGroupRef = useRef<Record<string, HTMLDivElement | null>>({});
  const whatsappDetailsRef = useRef<HTMLDetailsElement>(null);
  const whatsappShareLockRef = useRef(false);
  const skipSedeRestoreRef = useRef(false);
  const rotacionPrefetchKeyRef = useRef<string | null>(null);
  const userScopedLastSedeStorageKey = useMemo(
    () => buildUserLastSedeStorageKey(lastSedeStorageKey, authUser?.id),
    [authUser?.id, lastSedeStorageKey],
  );
  const catalogBaseCacheRef = useRef<
    Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>
  >(new Map());
  const catalogBySedeCacheRef = useRef<
    Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>
  >(new Map());
  const catalogByN2CacheRef = useRef<
    Map<string, { value: RotationCatalogSnapshot; expiresAt: number }>
  >(new Map());
  const selectedCompanySet = useMemo(
    () => new Set(selectedCompanies),
    [selectedCompanies],
  );
  const selectedSedeSet = useMemo(
    () => new Set(selectedSedes),
    [selectedSedes],
  );

  useEffect(() => {
    if (authStatus !== "authenticated" || !authUser) return;
    if (!hasSection("producto") || !hasSubsection("rotacion")) {
      router.replace("/secciones");
      return;
    }
    if (
      !canAccessRotacionBoard(
        authUser.specialRoles,
        isAdmin,
        authUser.allowedSubdashboards,
      )
    ) {
      router.replace("/productividad");
      return;
    }
    setReady(true);
  }, [
    authStatus,
    authUser,
    hasSection,
    hasSubsection,
    isAdmin,
    router,
  ]);

  useEffect(() => {
    try {
      if (selectedSedes.length > 0) {
        localStorage.setItem(
          userScopedLastSedeStorageKey,
          JSON.stringify(selectedSedes),
        );
      } else {
        localStorage.removeItem(userScopedLastSedeStorageKey);
      }
    } catch {
      /* ignore quota / private mode */
    }
  }, [selectedSedes, userScopedLastSedeStorageKey]);

  const canEditAbcdConfig = useMemo(
    () => canEditRotacionAbcdConfig(specialRoles, isAdmin),
    [specialRoles, isAdmin],
  );

  const canViewSurtidoHistorial = useMemo(
    /* Admin (role en BD): siempre. Resto: solo con special_roles historial_sinventario. Sin permiso: no mostrar boton. */
    () => canViewRotacionSinventarioHistorial(specialRoles, isAdmin),
    [specialRoles, isAdmin],
  );

  const reloadRotacionRows = useCallback(
    async (
      _overrides?: {
        lineasN1?: string[];
        categoriaKeys?: string[];
        categoriasCatalog?: RotationCategoriaFilterOption[];
      },
      options?: { signal?: AbortSignal },
    ): Promise<boolean> => {
      const allSedeOptionsForQuery = mapRotationSedeOptions(
        filterCatalog.sedes,
      );
      // Solo sedes explicitamente seleccionadas; sin fallback a "todas las
      // sedes de la empresa". Ver comentario en `targetSedeSelections`.
      const targetSedeSelectionsForQuery = allSedeOptionsForQuery.filter(
        (option) => selectedSedeSet.has(option.value),
      );
      if (targetSedeSelectionsForQuery.length === 0) return false;

      // Una sola carga por sede+rango; linea N1 y categoria se filtran en cliente.
      const rowsScopeKey = buildRotacionRowsKey({
        start: dateRange.start ?? "",
        end: dateRange.end ?? "",
        empresas: targetSedeSelectionsForQuery.map((s) => s.empresa),
        sedeIds: targetSedeSelectionsForQuery.map((s) => s.sedeId),
        lineasN1: [],
        categoriaKeys: [],
      });
      const rowsCacheKey = buildRotacionRowsCacheKey(
        apiBasePath,
        authUser?.id,
        rowsScopeKey,
      );

      const scopeChanged =
        rotacionRowsFetchKeyRef.current !== null &&
        rotacionRowsFetchKeyRef.current !== rowsScopeKey;
      if (scopeChanged) {
        setHasLoadedItems(false);
      }

      setIsLoadingData(true);
      setError(null);

      const reloadStartTs = performance.now();
      console.log("[rotacion] Iniciando carga de tabla...");
      const tickerId = window.setInterval(() => {
        const elapsedMs = performance.now() - reloadStartTs;
        console.log(`[rotacion] Cargando... ${formatLoadDuration(elapsedMs)}`);
      }, 250);

      const applyFetchedRows = (
        result: RotacionRowsFetchResult,
        sourceLabel: string,
      ) => {
        setRows(normalizeRotationRows(result.rows));
        setHasLoadedItems(true);
        if (
          targetSedeSelectionsForQuery.length === 1 &&
          result.abcdConfig
        ) {
          setAbcdConfig(normalizeAbcdConfig(result.abcdConfig));
        }
        rotacionRowsFetchKeyRef.current = rowsScopeKey;
        const elapsedMs = performance.now() - reloadStartTs;
        console.log(
          `[rotacion] ${sourceLabel} en ${formatLoadDuration(elapsedMs)} (${elapsedMs.toFixed(0)} ms).`,
        );
      };

      try {
        if (
          !isRangeWithinMaxMonths({
            start: dateRange.start,
            end: dateRange.end,
          })
        ) {
          setRows([]);
          setHasLoadedItems(false);
          setError(ROTACION_MAX_RANGE_ERROR);
          return false;
        }

        if (!options?.signal?.aborted) {
          const cached = await readRotacionRowsIdbCache(rowsCacheKey);
          if (options?.signal?.aborted) {
            setHasLoadedItems(false);
            return false;
          }
          if (cached) {
            applyFetchedRows(cached, "Cache IDB hit");
            return true;
          }

          const inFlight = getInFlightRotacionRowsFetch(rowsCacheKey);
          if (inFlight) {
            const prefetched = await inFlight;
            if (options?.signal?.aborted) {
              setHasLoadedItems(false);
              return false;
            }
            if (prefetched) {
              applyFetchedRows(prefetched, "Prefetch en vuelo");
              void writeRotacionRowsIdbCache(rowsCacheKey, prefetched);
              return true;
            }
          }
        }

        const fetchStartedMs = performance.now();
        const fetched = await fetchRotacionRowsForCache({
          apiBasePath,
          cacheKey: rowsCacheKey,
          start: dateRange.start ?? "",
          end: dateRange.end ?? "",
          sedeSelections: targetSedeSelectionsForQuery.map((sede) => ({
            empresa: sede.empresa,
            sedeId: sede.sedeId,
          })),
          signal: options?.signal,
          onUnauthorized: () => {
            router.replace("/login");
          },
          onForbidden: (message) => {
            setError(message);
            setHasLoadedItems(false);
          },
        });
        if (options?.signal?.aborted) {
          setHasLoadedItems(false);
          return false;
        }
        if (!fetched) {
          return false;
        }

        const rowCount = fetched.rows.length;
        const apiElapsedMs = performance.now() - fetchStartedMs;
        console.log(
          `[rotacion] API respondio en ${formatLoadDuration(apiElapsedMs)} (${apiElapsedMs.toFixed(0)} ms, ${rowCount} filas).`,
        );

        applyFetchedRows(fetched, "Tabla lista");
        void writeRotacionRowsIdbCache(rowsCacheKey, fetched);
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setHasLoadedItems(false);
          return false;
        }
        setRows([]);
        setHasLoadedItems(false);
        setError(
          err instanceof Error ? err.message : "Error consultando rotacion.",
        );
        return false;
      } finally {
        window.clearInterval(tickerId);
        setIsLoadingData(false);
      }
    },
    [
      router,
      authUser?.id,
      filterCatalog.sedes,
      selectedSedeSet,
      dateRange.start,
      dateRange.end,
      apiBasePath,
    ],
  );

  reloadRotacionRowsRef.current = reloadRotacionRows;

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    /** No exigir ref previo: si el primer fetch se aborta o falla, el ref queda null y antes el efecto
     *  nunca volvia a disparar la recarga (tabla vacia hasta recargar la pagina). */
    const allSedeOptionsForQuery = mapRotationSedeOptions(filterCatalog.sedes);
    // Solo sedes explicitamente seleccionadas (sin fallback a empresa).
    const targetSedeSelectionsForQuery = allSedeOptionsForQuery.filter(
      (option) => selectedSedeSet.has(option.value),
    );

    if (
      targetSedeSelectionsForQuery.length === 0 ||
      !dateRange.start ||
      !dateRange.end
    )
      return;

    const scopeKey = buildRotacionRowsKey({
      start: dateRange.start,
      end: dateRange.end,
      empresas: targetSedeSelectionsForQuery.map((s) => s.empresa),
      sedeIds: targetSedeSelectionsForQuery.map((s) => s.sedeId),
      lineasN1: [],
      categoriaKeys: [],
    });

    if (scopeKey === rotacionRowsFetchKeyRef.current) return;

    const timer = window.setTimeout(() => {
      void reloadRotacionRows();
    }, ROTACION_ROWS_RELOAD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    ready,
    isLoadingLineCatalog,
    filterCatalog.sedes,
    selectedSedeSet,
    dateRange.start,
    dateRange.end,
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
            meta: payloadFromCache.meta ?? {
              effectiveRange: {
                start: dateRange.start || "",
                end: dateRange.end || "",
              },
              availableRange: { min: "", max: "" },
              sourceTable: sourceTable,
              maxSalesValue: null,
              abcdConfig: DEFAULT_ABCD_CONFIG,
            },
          };
        } else {
          const response = await fetch(
            `${apiBasePath}${params.size > 0 ? `?${params.toString()}` : ""}`,
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

        const baseFilters = payload.filters ?? {
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
        const allSedeOptionsForQuery = mapRotationSedeOptions(
          baseFilters.sedes,
        );
        const selectedSedeMetasForQuery = allSedeOptionsForQuery.filter(
          (option) => selectedSedeSet.has(option.value),
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
              meta: cachedCombo.meta ?? {
                effectiveRange: {
                  start: dateRange.start || "",
                  end: dateRange.end || "",
                },
                availableRange: { min: "", max: "" },
                sourceTable: sourceTable,
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
              `${apiBasePath}?${comboParams.toString()}`,
              { cache: "no-store" },
            );
            if (comboResponse.status === 401) {
              router.replace("/login");
              return;
            }
            if (comboResponse.ok) {
              comboPayload =
                (await comboResponse.json()) as RotationApiResponse;
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
        }

        if (payload.meta?.availableRange) {
          setAvailableRange({
            start: payload.meta.availableRange.min,
            end: payload.meta.availableRange.max,
          });
        }

        const avMin = payload.meta?.availableRange?.min;
        const avMax = payload.meta?.availableRange?.max;
        const periodoStd = payload.meta?.periodoStd;
        if (generation !== catalogLoadGenerationRef.current) return;
        if (hadEmptyDateRange) {
          // Default: periodo del snapshot (matview/periodo_std) o mes hacia
          // atras desde el ultimo dato. Nunca un solo dia si hay historico.
          if (
            periodoStd &&
            periodoStd.rowCount > 0 &&
            periodoStd.periodoStart &&
            periodoStd.periodoEnd
          ) {
            setDateRange({
              start: periodoStd.periodoStart,
              end: periodoStd.periodoEnd,
            });
          } else if (
            typeof avMin === "string" &&
            avMin &&
            typeof avMax === "string" &&
            avMax
          ) {
            setDateRange(getRollingMonthBackRange(avMin, avMax));
          } else if (
            payload.meta?.effectiveRange?.start &&
            payload.meta?.effectiveRange?.end
          ) {
            setDateRange(payload.meta.effectiveRange);
          }
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

        // NO disparamos aqui la carga de filas: lo deja para el useEffect
        // dependiente de `filterCatalog.lineasN1`, `selectedLineaN1Values`,
        // `selectedCategoriaKeys`, etc., que ya tiene su propia clave/dedupe.
        //
        // Antes haciamos `await reloadRotacionRowsRef.current({...overrides})`
        // aqui mismo, pero eso provocaba **doble fetch** al primer load: la
        // version de `reloadRotacionRows` que estaba en el ref capturaba el
        // closure VIEJO con `filterCatalog.lineasN1 = []` (los setStates de
        // arriba aun no se habian commiteado). Esa primera invocacion escribia
        // en `rotacionRowsFetchKeyRef.current` una clave calculada con catalogo
        // vacio; despues el otro useEffect calculaba la clave con el catalogo
        // ya aplicado y como no coincidian, disparaba una segunda carga.
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
    apiBasePath,
    sourceTable,
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

  const showItemDrilldownLinks =
    apiBasePath === ROTACION_LEGACY_VIEW.apiBasePath;
  const itemDrilldownDate = useMemo(() => {
    if (dateRange.end) return dateRange.end;
    if (availableRange.end) return availableRange.end;
    return auditChangedAtDateKeyBogota(new Date().toISOString());
  }, [availableRange.end, dateRange.end]);
  const itemDrilldownDateStart = useMemo(() => {
    if (dateRange.start) return dateRange.start;
    if (availableRange.start) return availableRange.start;
    return "";
  }, [availableRange.start, dateRange.start]);

  const allSedeOptions = useMemo(() => {
    const mapped = filterCatalog.sedes
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
      .filter((option) => option.sedeName.length > 0);
    const dedupedByValue = new Map<
      string,
      (typeof mapped)[number]
    >();
    for (const option of mapped) {
      const prev = dedupedByValue.get(option.value);
      if (!prev) {
        dedupedByValue.set(option.value, option);
        continue;
      }
      const preferNew =
        option.sedeName.length > prev.sedeName.length ||
        (option.sedeName.length === prev.sedeName.length &&
          option.label.length > prev.label.length);
      if (preferNew) {
        dedupedByValue.set(option.value, option);
      }
    }
    return [...dedupedByValue.values()].sort((a, b) => {
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
    });
  }, [filterCatalog.sedes]);

  const sedeOptions = useMemo(() => {
    const scopedOptions =
      selectedCompanySet.size > 0
        ? allSedeOptions.filter((option) =>
            selectedCompanySet.has(option.empresa),
          )
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
  // Solo consideramos sedes EXPLICITAMENTE seleccionadas. Antes habia un
  // fallback a "todas las sedes de la empresa seleccionada", pero eso
  // disparaba la query mas pesada posible cuando el usuario hacia clic en
  // 'Limpiar' en sedes y dejaba la empresa tildada: el sistema entendia
  // "todas las sedes de esa empresa". En local apenas se notaba; en GCP con
  // empresas grandes la consulta se quedaba colgada minutos. Ahora la falta
  // de sede explicita muestra el placeholder "Selecciona empresa o sede" y
  // ninguna query se dispara hasta que el usuario marque al menos 1 sede.
  const targetSedeSelections = useMemo(
    () => selectedSedeMetas,
    [selectedSedeMetas],
  );
  const singleSelectedSedeTarget = useMemo(
    () => (targetSedeSelections.length === 1 ? targetSedeSelections[0] : null),
    [targetSedeSelections],
  );

  const isNuevoItemInSelectedRange = useCallback(
    (row: RotationRow) => {
      const rangeForS =
        dateRange.start && dateRange.end ? dateRange : null;
      if (!isNuevoItemRow(row, rangeForS)) return false;
      if (!row.lastPurchaseDate || !dateRange.start || !dateRange.end) return true;
      const lastSale = parseDateKey(row.lastPurchaseDate);
      const rangeStart = parseDateKey(dateRange.start);
      const rangeEnd = parseDateKey(dateRange.end);
      const hasSaleDateInsideSelectedRange =
        lastSale >= rangeStart && lastSale <= rangeEnd;
      return !hasSaleDateInsideSelectedRange;
    },
    [dateRange],
  );

  const isAbcdFilterableRow = useCallback(
    (row: RotationRow) =>
      !isNuevoItemInSelectedRange(row) &&
      !isCeroRotacionExcludingNuevo(row, dateRange),
    [dateRange, isNuevoItemInSelectedRange],
  );

  const getSurtidoEstadoSortRank = useCallback(
    (row: RotationRow) => {
      const key = makeCeroRotacionEstadoKey(row.empresa, row.sedeId, row.item);
      const map = isNuevoItemInSelectedRange(row)
        ? restockEstadoByKey
        : ceroEstadoByKey;
      const estado = map[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
      return CERO_ROTACION_ESTADO_SORT_ORDER[estado];
    },
    [ceroEstadoByKey, restockEstadoByKey, isNuevoItemInSelectedRange],
  );

  useEffect(() => {
    if (!ready || !dateRange.start || !dateRange.end) return;
    if (targetSedeSelections.length === 0) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("start", dateRange.start);
    params.set("end", dateRange.end);
    targetSedeSelections.forEach((s) => params.append("sedeScope", s.value));
    void (async () => {
      try {
        const res = await fetch(
          `/api/rotacion/cero-estados?${params.toString()}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          estados?: Record<string, CeroRotacionEstado>;
          estadosRestock?: Record<string, CeroRotacionEstado>;
        };
        const nextCero = data.estados ?? {};
        const nextRestock = data.estadosRestock ?? {};
        setCeroEstadoByKey((prev) => ({ ...prev, ...nextCero }));
        setRestockEstadoByKey((prev) => ({ ...prev, ...nextRestock }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  }, [ready, router, dateRange.start, dateRange.end, targetSedeSelections]);

  useEffect(() => {
    if (surtidoAuditModalOpen && !canViewSurtidoHistorial) {
      setSurtidoAuditModalOpen(false);
    }
  }, [surtidoAuditModalOpen, canViewSurtidoHistorial]);

  const persistRotacionSurtidoEstado = useCallback(
    async (
      row: RotationRow,
      estado: CeroRotacionEstado,
      context: RotacionSurtidoEstadoContext,
    ) => {
      const key = makeCeroRotacionEstadoKey(row.empresa, row.sedeId, row.item);
      const setMap =
        context === "restock" ? setRestockEstadoByKey : setCeroEstadoByKey;
      const currentMap = context === "restock" ? restockEstadoByKey : ceroEstadoByKey;
      const rollback = currentMap[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
      setMap((prev) => ({ ...prev, [key]: estado }));
      const csrf = getCookieValue("vp_csrf");
      if (!csrf) {
        setMap((prev) => ({ ...prev, [key]: rollback }));
        setError("No se pudo validar la sesion. Recargue la pagina.");
        return;
      }
      if (!dateRange.start || !dateRange.end) {
        setMap((prev) => ({ ...prev, [key]: rollback }));
        setError("Seleccione un rango de fechas antes de cambiar el estado.");
        return;
      }
      try {
        const res = await fetch("/api/rotacion/cero-estados", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            empresa: row.empresa,
            sedeId: row.sedeId,
            item: row.item,
            estado,
            context,
            start: dateRange.start,
            end: dateRange.end,
          }),
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? "No se pudo guardar el estado.");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMap((prev) => ({ ...prev, [key]: rollback }));
        setError(
          err instanceof Error ? err.message : "Error guardando estado.",
        );
      }
    },
    [
      ceroEstadoByKey,
      restockEstadoByKey,
      dateRange.end,
      dateRange.start,
      router,
    ],
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
              ? `N1 ${value} - ${dbNombre}`
              : shortFallback
                ? `N1 ${value} - ${shortFallback}`
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

  const singleSelectedLineaN1 = useMemo(
    () =>
      selectedLineaN1Values.length === 1
        ? normalizeLineaN1CodeForFilter(selectedLineaN1Values[0])
        : null,
    [selectedLineaN1Values],
  );

  const lineasN2DerivedFromRows = useMemo(() => {
    if (!singleSelectedLineaN1) return [];
    const nombres = lineasN2Catalog.nombres;
    const itemIndex = lineasN2Catalog.itemLineaN2ByKey;
    const acc = new Set<string>();
    for (const row of rows) {
      if (
        normalizeLineaN1CodeForFilter(row.lineaN1Codigo) !== singleSelectedLineaN1
      ) {
        continue;
      }
      acc.add(resolveRowLineaN2FilterCode(row, nombres, itemIndex));
    }
    return Array.from(acc).sort(compareLineaN2FilterCodes);
  }, [
    rows,
    singleSelectedLineaN1,
    lineasN2Catalog.nombres,
    lineasN2Catalog.itemLineaN2ByKey,
  ]);

  const lineasN2ForFilterUi = useMemo(() => {
    if (!singleSelectedLineaN1) return [];
    const fromApi = lineasN2Catalog.codes.map(normalizeLineaN2CodeForFilter);
    const deduped = Array.from(new Set(fromApi)).sort(compareLineaN2FilterCodes);
    const fromRows = lineasN2DerivedFromRows.filter(
      (code) => code !== "__sin_n2__",
    );
    if (deduped.length > 0) return deduped;
    return fromRows.length > 0 ? fromRows : lineasN2DerivedFromRows;
  }, [singleSelectedLineaN1, lineasN2Catalog.codes, lineasN2DerivedFromRows]);

  const lineasN2NombreMap = useMemo(() => {
    const out = mergeRotationLineaN2NombreMaps(
      undefined,
      lineasN2Catalog.nombres,
    );
    if (!singleSelectedLineaN1) return out;
    for (const row of rows) {
      if (
        normalizeLineaN1CodeForFilter(row.lineaN1Codigo) !== singleSelectedLineaN1
      ) {
        continue;
      }
      const code = resolveRowLineaN2FilterCode(
        row,
        lineasN2Catalog.nombres,
        lineasN2Catalog.itemLineaN2ByKey,
      );
      const cand = row.sublinea?.trim();
      if (!cand || cand === "Sin sublinea") continue;
      const prev = out[code];
      if (!prev || cand.length > prev.length) out[code] = cand;
    }
    return out;
  }, [
    lineasN2Catalog.nombres,
    lineasN2Catalog.itemLineaN2ByKey,
    rows,
    singleSelectedLineaN1,
  ]);

  const lineaN2Options = useMemo<LineaN2Option[]>(() => {
    if (!singleSelectedLineaN1) return [];
    return lineasN2ForFilterUi.map((value) => {
      if (value === "__sin_n2__") {
        return { value, label: "Sin N2" };
      }
      const nombre = lineasN2NombreMap[value];
      return {
        value,
        label: nombre ? `N2 ${value} - ${nombre}` : `N2 ${value}`,
      };
    });
  }, [lineasN2ForFilterUi, lineasN2NombreMap, singleSelectedLineaN1]);

  const selectedLineaN2Set = useMemo(
    () => new Set(selectedLineaN2Values),
    [selectedLineaN2Values],
  );

  const categoriaFilterOptions = useMemo(
    () => filterCatalog.categorias ?? [],
    [filterCatalog.categorias],
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
    if (!singleSelectedLineaN1) {
      setSelectedLineaN2Values([]);
      return;
    }
    const optionValues = lineaN2Options.map((option) => option.value);
    const optionSet = new Set(optionValues);
    setSelectedLineaN2Values((prev) => {
      const kept = prev.filter((value) => optionSet.has(value));
      if (kept.length === 0 && optionValues.length > 0) return optionValues;
      if (kept.length === 0) return [];
      return kept;
    });
  }, [singleSelectedLineaN1, lineaN2Options]);

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    if (!singleSelectedLineaN1 || targetSedeSelections.length === 0) {
      setLineasN2Catalog({ codes: [], nombres: {}, itemLineaN2ByKey: {} });
      setIsLoadingLineasN2Catalog(false);
      return;
    }
    if (!dateRange.start || !dateRange.end) {
      setLineasN2Catalog({ codes: [], nombres: {}, itemLineaN2ByKey: {} });
      setIsLoadingLineasN2Catalog(false);
      return;
    }

    lineasN2LoadGenerationRef.current += 1;
    const generation = lineasN2LoadGenerationRef.current;

    const loadLineasN2Catalog = async () => {
      setIsLoadingLineasN2Catalog(true);
      try {
        const rangeKey = `${dateRange.start}|${dateRange.end}`;
        const comboKey = `n2v2|${rangeKey}|${singleSelectedLineaN1}|${targetSedeSelections
          .map((s) => `${s.empresa}::${s.sedeId}`)
          .sort((a, b) => a.localeCompare(b, "es"))
          .join(",")}`;
        const cached = readCatalogCache(catalogByN2CacheRef.current, comboKey);
        if (cached?.filters?.lineasN2) {
          if (generation !== lineasN2LoadGenerationRef.current) return;
          const codes = (cached.filters.lineasN2 ?? []).map(
            normalizeLineaN2CodeForFilter,
          );
          const nombres: Record<string, string> = {};
          for (const [key, name] of Object.entries(
            cached.filters.lineasN2Nombres ?? {},
          )) {
            nombres[normalizeLineaN2CodeForFilter(key)] = name;
          }
          setLineasN2Catalog({
            codes,
            nombres,
            itemLineaN2ByKey: cached.filters.itemLineaN2ByKey ?? {},
          });
          return;
        }

        const params = new URLSearchParams();
        params.set("start", dateRange.start);
        params.set("end", dateRange.end);
        params.set("catalogOnly", "1");
        params.set("lineaN1Scope", singleSelectedLineaN1);
        targetSedeSelections.forEach((sedeMeta) => {
          params.append(
            "sedeScope",
            `${sedeMeta.empresa}::${sedeMeta.sedeId}`,
          );
        });
        const response = await fetch(
          `${apiBasePath}?${params.toString()}`,
          { cache: "no-store" },
        );
        if (generation !== lineasN2LoadGenerationRef.current) return;
        if (!response.ok) {
          setLineasN2Catalog({ codes: [], nombres: {}, itemLineaN2ByKey: {} });
          return;
        }
        const payload = (await response.json()) as RotationApiResponse;
        const codes = (payload.filters?.lineasN2 ?? []).map(
          normalizeLineaN2CodeForFilter,
        );
        const nombres: Record<string, string> = {};
        for (const [key, name] of Object.entries(
          payload.filters?.lineasN2Nombres ?? {},
        )) {
          nombres[normalizeLineaN2CodeForFilter(key)] = name;
        }
        const itemLineaN2ByKey: Record<string, string> = {};
        for (const [key, code] of Object.entries(
          payload.filters?.itemLineaN2ByKey ?? {},
        )) {
          itemLineaN2ByKey[key] = normalizeLineaN2CodeForFilter(code);
        }
        writeCatalogCache(catalogByN2CacheRef.current, comboKey, {
          filters: {
            companies: [],
            sedes: [],
            lineasN1: [],
            lineasN1Nombres: {},
            categorias: [],
            lineasN1PorCategoria: {},
            lineasN2: codes,
            lineasN2Nombres: nombres,
            itemLineaN2ByKey,
          },
        });
        setLineasN2Catalog({ codes, nombres, itemLineaN2ByKey });
      } finally {
        if (generation === lineasN2LoadGenerationRef.current) {
          setIsLoadingLineasN2Catalog(false);
        }
      }
    };

    void loadLineasN2Catalog();
  }, [
    ready,
    isLoadingLineCatalog,
    singleSelectedLineaN1,
    targetSedeSelections,
    dateRange.start,
    dateRange.end,
    apiBasePath,
  ]);

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
    const validCompanies = new Set(companyOptions.map((option) => option.value));
    setSelectedCompanies((current) => {
      const next = current.filter((value) => validCompanies.has(value));
      if (
        next.length === current.length &&
        next.every((value, idx) => value === current[idx])
      ) {
        return current;
      }
      return next;
    });
  }, [companyOptions]);

  useEffect(() => {
    if (selectedSedes.length > 0) return;
    if (isLoadingLineCatalog) return;
    if (allSedeOptions.length !== 1) return;
    /** Solo autoseleccionar cuando el usuario tiene una unica sede en el catalogo. */
    setSelectedSedes([allSedeOptions[0]!.value]);
    setSelectedCompanies([allSedeOptions[0]!.empresa]);
  }, [allSedeOptions, isLoadingLineCatalog, selectedSedes.length]);

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    if (selectedSedes.length > 0) return;
    if (skipSedeRestoreRef.current) return;
    if (allSedeOptions.length < 2) return;

    const validValues = new Set(allSedeOptions.map((option) => option.value));
    const restored = readUserLastSedeSelection(
      lastSedeStorageKey,
      authUser?.id,
      validValues,
    );
    if (restored.length === 0) return;

    setSelectedSedes(restored);
    setSelectedCompanies(
      Array.from(
        new Set(
          allSedeOptions
            .filter((option) => restored.includes(option.value))
            .map((option) => option.empresa),
        ),
      ),
    );
  }, [
    ready,
    isLoadingLineCatalog,
    selectedSedes,
    allSedeOptions,
    lastSedeStorageKey,
    authUser?.id,
  ]);

  useEffect(() => {
    if (!ready || isLoadingLineCatalog) return;
    if (!authUser?.id || !dateRange.start || !dateRange.end) return;
    if (
      !isRangeWithinMaxMonths({
        start: dateRange.start,
        end: dateRange.end,
      })
    ) {
      return;
    }
    if (filterCatalog.sedes.length === 0) return;

    const allSedeOptionsForPrefetch = mapRotationSedeOptions(filterCatalog.sedes);
    const prefetchSedeValues = resolveRotacionPrefetchSedeValues({
      authUser,
      allSedeOptions: allSedeOptionsForPrefetch,
      selectedSedeValues: selectedSedes,
      lastSedeStorageKey,
    });
    if (prefetchSedeValues.length === 0) return;

    const targetSedes = allSedeOptionsForPrefetch.filter((option) =>
      prefetchSedeValues.includes(option.value),
    );
    const rowsScopeKey = buildRotacionRowsKey({
      start: dateRange.start,
      end: dateRange.end,
      empresas: targetSedes.map((s) => s.empresa),
      sedeIds: targetSedes.map((s) => s.sedeId),
      lineasN1: [],
      categoriaKeys: [],
    });
    const rowsCacheKey = buildRotacionRowsCacheKey(
      apiBasePath,
      authUser.id,
      rowsScopeKey,
    );
    if (rotacionPrefetchKeyRef.current === rowsCacheKey) return;
    rotacionPrefetchKeyRef.current = rowsCacheKey;

    void (async () => {
      try {
        const cached = await readRotacionRowsIdbCache(rowsCacheKey);
        if (cached) {
          console.info("[rotacion] Prefetch omitido: IDB ya caliente.");
          return;
        }
        if (getInFlightRotacionRowsFetch(rowsCacheKey)) return;

        console.info(
          `[rotacion] Prefetch en background (${targetSedes.length} sede(s))...`,
        );
        const result = await fetchRotacionRowsForCache({
          apiBasePath,
          cacheKey: rowsCacheKey,
          start: dateRange.start,
          end: dateRange.end,
          sedeSelections: targetSedes.map((sede) => ({
            empresa: sede.empresa,
            sedeId: sede.sedeId,
          })),
        });
        if (!result) return;

        await writeRotacionRowsIdbCache(rowsCacheKey, result);
        console.info(
          `[rotacion] Prefetch listo (${result.rows.length} filas en IDB).`,
        );
      } catch (err) {
        console.warn(
          "[rotacion] Prefetch fallido:",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  }, [
    ready,
    isLoadingLineCatalog,
    authUser,
    dateRange.start,
    dateRange.end,
    filterCatalog.sedes,
    selectedSedes,
    lastSedeStorageKey,
    apiBasePath,
  ]);

  const catalogFilteredRows = useMemo(
    () =>
      filterRotationRowsByLineaAndCategoria(
        rows,
        filterCatalog.lineasN1 ?? [],
        selectedLineaN1Values,
        filterCatalog.categorias ?? [],
        selectedCategoriaKeys,
        singleSelectedLineaN1 ? lineasN2ForFilterUi : [],
        singleSelectedLineaN1 ? selectedLineaN2Values : [],
        singleSelectedLineaN1 ? lineasN2NombreMap : {},
        singleSelectedLineaN1 ? lineasN2Catalog.itemLineaN2ByKey : {},
      ),
    [
      rows,
      filterCatalog.lineasN1,
      filterCatalog.categorias,
      selectedLineaN1Values,
      selectedCategoriaKeys,
      singleSelectedLineaN1,
      lineasN2ForFilterUi,
      selectedLineaN2Values,
      lineasN2NombreMap,
      lineasN2Catalog.itemLineaN2ByKey,
    ],
  );

  const sortedRows = useMemo(
    () =>
      sortRotationRows(
        catalogFilteredRows,
        tableSortField,
        tableSortDirection,
        tableSortField === "ceroRotacionEstado"
          ? getSurtidoEstadoSortRank
          : undefined,
      ),
    [catalogFilteredRows, tableSortDirection, tableSortField, getSurtidoEstadoSortRank],
  );
  const rowsAfterProductFilter = useMemo(
    () =>
      sortedRows.filter((row) =>
        rowMatchesProductSearch(row, productSearchInput),
      ),
    [sortedRows, productSearchInput],
  );
  const baseRowsBySede = useMemo(
    () =>
      targetSedeSelections.length > 1
        ? buildConsolidatedRowsBySelection(
            sortedRows,
            targetSedeSelections.length,
          )
        : buildRowsBySede(sortedRows),
    [sortedRows, targetSedeSelections.length],
  );
  const baseRowsBySedeByKey = useMemo(
    () =>
      new Map(
        baseRowsBySede.map((group) => [
          `${group.empresa}-${group.sedeId}`,
          group.rows,
        ]),
      ),
    [baseRowsBySede],
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
  const perSedeExportSourceGroups = useMemo(
    () => buildRowsBySede(rowsAfterProductFilter),
    [rowsAfterProductFilter],
  );
  const perSedeBaseRowsByKey = useMemo(
    () =>
      new Map(
        buildRowsBySede(sortedRows).map((group) => [
          `${group.empresa}-${group.sedeId}`,
          group.rows,
        ]),
      ),
    [sortedRows],
  );
  const consolidatedFilterGroupKey = useMemo(
    () =>
      targetSedeSelections.length > 1 ? "Consolidado-__multi__" : null,
    [targetSedeSelections.length],
  );
  const useConsolidatedTableFilters = targetSedeSelections.length > 1;
  const defaultExportSedeValues = useMemo(
    () => new Set(targetSedeSelections.map((sede) => sede.value)),
    [targetSedeSelections],
  );
  const rowsBySedeKeys = useMemo(
    () => rowsBySede.map((group) => `${group.empresa}-${group.sedeId}`),
    [rowsBySede],
  );
  const tableTourReady =
    hasLoadedItems &&
    rowsAfterProductFilter.length > 0 &&
    rowsBySede.length > 0;
  const { startTour: startRotacionTourGuide } = useRotacionTour(
    authUser?.id,
    ready,
    tableTourReady,
  );

  const setTableHostRef = useCallback(
    (groupKey: string, node: HTMLDivElement | null) => {
      tableHostByGroupRef.current[groupKey] = node;
    },
    [],
  );
  const scrollGroupTableToTop = useCallback((groupKey: string) => {
    const host = tableHostByGroupRef.current[groupKey];
    if (!host || typeof window === "undefined") return;
    const targetTop =
      host.getBoundingClientRect().top +
      window.scrollY -
      ROTACION_FLOATING_HEADER_TOP_PX -
      16;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, []);

  useEffect(() => {
    let rafId = 0;
    const boundTop = ROTACION_FLOATING_HEADER_TOP_PX;

    const updateFloatingHeader = () => {
      let next: {
        groupKey: string;
        left: number;
        width: number;
        scrollLeft: number;
      } | null = null;

      for (const groupKey of rowsBySedeKeys) {
        const host = tableHostByGroupRef.current[groupKey];
        if (!host) continue;
        const container = host.querySelector(
          '[data-slot="table-container"]',
        ) as HTMLDivElement | null;
        const table = host.querySelector("table") as HTMLTableElement | null;
        const thead = host.querySelector(
          "thead",
        ) as HTMLTableSectionElement | null;
        if (!container || !table || !thead) continue;

        const theadRect = thead.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        const theadHeight = Math.max(theadRect.height, 36);
        const inRange =
          theadRect.top <= boundTop &&
          tableRect.bottom > boundTop + theadHeight;
        if (!inRange) continue;

        const left = Math.max(8, tableRect.left);
        const maxWidth = Math.max(240, window.innerWidth - left - 8);
        next = {
          groupKey,
          left,
          width: Math.min(tableRect.width, maxWidth),
          scrollLeft: container.scrollLeft,
        };
        break;
      }

      setFloatingHeaderState((prev) => {
        if (!prev && !next) return prev;
        if (!prev || !next) return next;
        if (
          prev.groupKey === next.groupKey &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.scrollLeft - next.scrollLeft) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateFloatingHeader();
      });
    };

    const containers = rowsBySedeKeys
      .map((groupKey) =>
        tableHostByGroupRef.current[groupKey]?.querySelector(
          '[data-slot="table-container"]',
        ),
      )
      .filter((node): node is HTMLDivElement => node instanceof HTMLDivElement);

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    containers.forEach((container) =>
      container.addEventListener("scroll", scheduleUpdate, { passive: true }),
    );

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      containers.forEach((container) =>
        container.removeEventListener("scroll", scheduleUpdate),
      );
    };
  }, [rowsBySedeKeys]);

  const handleStartDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) => {
      const normalized = normalizeDateRange(
        { start: value, end: current.end },
        "start",
      );
      return enforceMaxDateRangeMonths(normalized, "start", availableRange);
    });
    setError(null);
  };

  const handleEndDateChange = (value: string) => {
    if (!value) return;
    setDateRange((current) => {
      const normalized = normalizeDateRange(
        { start: current.start, end: value },
        "end",
      );
      return enforceMaxDateRangeMonths(normalized, "end", availableRange);
    });
    setError(null);
  };

  const handleReloadRows = () => {
    void reloadRotacionRows();
  };

  const handleSaveAbcdConfig = async (
    draft: AbcdConfig,
    scope: "global" | "sede",
  ) => {
    if (!canEditAbcdConfig || isSavingAbcdConfig) return;
    if (scope === "sede" && !singleSelectedSedeTarget) {
      setError(
        "Para guardar por sede selecciona una sola sede en los filtros principales.",
      );
      return;
    }
    setIsSavingAbcdConfig(true);
    setError(null);
    try {
      const normalized = normalizeAbcdConfig(draft);
      const response = await fetch(apiBasePath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...normalized,
          saveScope: scope,
          empresa:
            scope === "sede"
              ? (singleSelectedSedeTarget?.empresa ?? "")
              : undefined,
          sedeId:
            scope === "sede"
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

  /**
   * Filtro de piso de unidades de inventario. Es ortogonal a los filtros de
   * rotacion/venta: se aplica como capa adicional sobre las filas para que el
   * usuario pueda esconder items con inventario por debajo del minimo elegido
   * (p.ej. para ignorar items practicamente agotados al revisar A/B/C).
   */
  const applyOrToggleInvMinFilter = (groupKey: string) => {
    const currentCap = invMinCapByGroup[groupKey];
    if (currentCap != null) {
      setInvMinCapByGroup((prev) => ({ ...prev, [groupKey]: undefined }));
      setPageByGroupKey((prev) => ({ ...prev, [groupKey]: 1 }));
      return;
    }
    const raw = invMinInputByGroup[groupKey] ?? "";
    const parsedRaw = Number(sanitizeNumericInput(raw));
    if (Number.isNaN(parsedRaw)) return;
    const parsed = Math.max(0, parsedRaw);
    setInvMinCapByGroup((prev) => ({ ...prev, [groupKey]: parsed }));
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

  const toggleSurtidoEstadoFilterChip = useCallback(
    (groupKey: string, estado: CeroRotacionEstado) => {
      setCeroEstadoFilterByGroup((prev) => {
        const cur = normalizeGroupZeroEstadoSetFilter(prev[groupKey]);
        const nextSet = new Set(cur);
        if (nextSet.has(estado)) {
          nextSet.delete(estado);
        } else {
          nextSet.add(estado);
        }
        if (nextSet.size === 0) {
          return { ...prev, [groupKey]: [...CERO_ROTACION_ESTADO_VALUES] };
        }
        return {
          ...prev,
          [groupKey]: normalizeGroupZeroEstadoSetFilter([...nextSet]),
        };
      });
      setPageByGroupKey((p) => ({ ...p, [groupKey]: 1 }));
    },
    [],
  );

  const selectAllSurtidoEstadoFilters = useCallback((groupKey: string) => {
    setCeroEstadoFilterByGroup((prev) => ({
      ...prev,
      [groupKey]: [...CERO_ROTACION_ESTADO_VALUES],
    }));
    setPageByGroupKey((p) => ({ ...p, [groupKey]: 1 }));
  }, []);

  const shouldSelectSedeFirst = targetSedeSelections.length === 0;
  const shouldReloadFirst =
    targetSedeSelections.length > 0 && !hasLoadedItems && !isLoadingLineCatalog;

  const loadedSedeValueSet = useMemo(() => {
    const values = new Set<string>();
    for (const row of rows) {
      values.add(`${row.empresa}::${row.sedeId}`);
    }
    return values;
  }, [rows]);

  const buildExportGroupsForSedes = useCallback(
    (
      includedSedeValues: ReadonlySet<string>,
      overrides?: {
        perSedeExportSourceGroups?: typeof perSedeExportSourceGroups;
        perSedeBaseRowsByKey?: Map<string, RotationRow[]>;
        ceroEstadoByKey?: Record<string, CeroRotacionEstado>;
        restockEstadoByKey?: Record<string, CeroRotacionEstado>;
      },
    ) =>
      buildRotacionExportGroups({
        perSedeGroups:
          overrides?.perSedeExportSourceGroups ?? perSedeExportSourceGroups,
        includedSedeValues,
        consolidatedFilterGroupKey,
        useConsolidatedTableFilters,
        perSedeBaseRowsByKey:
          overrides?.perSedeBaseRowsByKey ?? perSedeBaseRowsByKey,
        rowsQuickFilterByGroup,
        abcdFilterByGroup,
        ventaHastaCapByGroup,
        invMinCapByGroup,
        ceroEstadoFilterByGroup,
        ceroEstadoByKey: overrides?.ceroEstadoByKey ?? ceroEstadoByKey,
        restockEstadoByKey:
          overrides?.restockEstadoByKey ?? restockEstadoByKey,
        abcdConfig,
        dateRange,
        isAbcdFilterableRow,
        isNuevoItemInSelectedRange,
      }),
    [
      abcdConfig,
      abcdFilterByGroup,
      ceroEstadoByKey,
      restockEstadoByKey,
      ceroEstadoFilterByGroup,
      consolidatedFilterGroupKey,
      dateRange,
      invMinCapByGroup,
      isAbcdFilterableRow,
      isNuevoItemInSelectedRange,
      perSedeBaseRowsByKey,
      perSedeExportSourceGroups,
      rowsQuickFilterByGroup,
      useConsolidatedTableFilters,
      ventaHastaCapByGroup,
    ],
  );

  const exportGroups = useMemo(
    () => buildExportGroupsForSedes(defaultExportSedeValues),
    [buildExportGroupsForSedes, defaultExportSedeValues],
  );

  const exportRowCountBySedeValue = useMemo(() => {
    const counts = new Map<string, number | undefined>();
    for (const sede of allSedeOptions) {
      if (!loadedSedeValueSet.has(sede.value)) {
        counts.set(sede.value, undefined);
        continue;
      }
      const groups = buildExportGroupsForSedes(new Set([sede.value]));
      counts.set(
        sede.value,
        groups.reduce((acc, group) => acc + group.rows.length, 0),
      );
    }
    return counts;
  }, [allSedeOptions, buildExportGroupsForSedes, loadedSedeValueSet]);

  const exportSedePickerOptions = useMemo(
    () =>
      allSedeOptions.map((sede) => ({
        value: sede.value,
        label: sede.label,
      })),
    [allSedeOptions],
  );

  const canPickSedesForExport = allSedeOptions.length > 1;

  const exportRowCount = useMemo(
    () => exportGroups.reduce((acc, group) => acc + group.rows.length, 0),
    [exportGroups],
  );

  const buildRotacionPdfDocument = useCallback(() => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(12);
    doc.text("Reporte de Rotacion", 14, 12);
    doc.setFontSize(9);
    doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`, 14, 18);
    let nextStartY = 22;
    exportGroups.forEach((group, index) => {
      if (index > 0) {
        doc.addPage();
        nextStartY = 14;
      }

      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      doc.text(
        `${group.empresa} - ${group.sede} | Vista: ${
          group.isSurtidoTrackingTableView
            ? group.surTrackingExportLabel
            : "Rotacion general"
        }`,
        14,
        nextStartY,
      );

      if (group.isSurtidoTrackingTableView) {
        autoTable(doc, {
          startY: nextStartY + 4,
          styles: { fontSize: 7, cellPadding: 1.8 },
          head: [[
            "Item",
            "Cat.",
            "S.inventario",
            "Descripcion",
            "Venta periodo",
            "Inv.",
            "V. inv.",
            "DI",
            "DUV",
            "Ult. venta",
            "Ult. ingr.",
          ]],
          body: group.rows.map((row) => [
            row.item,
            row.categoria,
            row.ceroEstado,
            row.descripcion,
            formatPrice(row.ventaPeriodo),
            `${row.invCierre.toLocaleString("es-CO")} ${row.unidad}`.trim(),
            formatPrice(row.valorInventario),
            row.diDesdeIngreso,
            row.duv,
            row.fechaUltimaVenta,
            row.ultimoIngreso,
          ]),
          margin: { left: 8, right: 8 },
        });
      } else {
        autoTable(doc, {
          startY: nextStartY + 4,
          styles: { fontSize: 7, cellPadding: 1.8 },
          head: [[
            "Item",
            "Cat.",
            "Descripcion",
            "Venta",
            "Costo",
            "Margen %",
            "Inv.",
            "U. vend.",
            "V. inv.",
            "DIC",
            "DI",
            "DUV",
            "Ult. venta",
            "Ult. ingr.",
          ]],
          body: group.rows.map((row) => [
            row.item,
            row.categoria,
            row.descripcion,
            formatPrice(row.ventaPeriodo),
            formatPrice(row.costoPeriodo),
            row.margenPorcentaje,
            `${row.invCierre.toLocaleString("es-CO")} ${row.unidad}`.trim(),
            row.unidadesVendidas.toLocaleString("es-CO"),
            formatPrice(row.valorInventario),
            row.rotacion,
            row.diaInventarioEfectivo,
            row.diaVentaEfectivo,
            row.fechaUltimaVenta,
            row.ultimoIngreso,
          ]),
          margin: { left: 8, right: 8 },
        });
      }
    });
    return doc;
  }, [exportGroups]);

  const writeRotacionExcel = useCallback(async (groups: RotacionExportGroup[]) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Rotacion");
    sheet.columns = Array.from({ length: 15 }).map(() => ({ width: 18 }));
    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 40;

    const COP_NUM_FMT = '"$"#,##0;[Red]-"$"#,##0';
    const QTY_NUM_FMT = "#,##0.###";

    const SURTIDO_CURRENCY_COLS = [5, 8];
    const SURTIDO_QTY_COLS = [6];
    const GENERAL_CURRENCY_COLS = [4, 5, 10];
    const GENERAL_QTY_COLS = [7, 9];

    groups.forEach((group) => {
      const titleRow = sheet.addRow([
        `${group.empresa} - ${group.sede} | Vista: ${
          group.isSurtidoTrackingTableView
            ? group.surTrackingExportLabel
            : "Rotacion general"
        }`,
      ]);
      titleRow.font = { bold: true, size: 11 };
      titleRow.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };

      const headers = group.isSurtidoTrackingTableView
        ? [
            "Item",
            "Cat.",
            "S.inventario",
            "Descripcion",
            "Venta periodo",
            "Inv.",
            "Unid.",
            "V. inv.",
            "DI",
            "DUV",
            "Ult. venta",
            "Ult. ingr.",
          ]
        : [
            "Item",
            "Cat.",
            "Descripcion",
            "Venta",
            "Costo",
            "Margen %",
            "Inv.",
            "Unid.",
            "U. vend.",
            "V. inv.",
            "DIC",
            "DI",
            "DUV",
            "Ult. venta",
            "Ult. ingr.",
          ];
      const headerRow = sheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      });

      group.rows.forEach((row) => {
        let dataRow: ExcelJS.Row;
        if (group.isSurtidoTrackingTableView) {
          dataRow = sheet.addRow([
            row.item,
            row.categoria,
            row.ceroEstado,
            row.descripcion,
            row.ventaPeriodo,
            row.invCierre,
            row.unidad,
            row.valorInventario,
            row.diDesdeIngreso,
            row.duv,
            row.fechaUltimaVenta,
            row.ultimoIngreso,
          ]);
          SURTIDO_CURRENCY_COLS.forEach((col) => {
            dataRow.getCell(col).numFmt = COP_NUM_FMT;
          });
          SURTIDO_QTY_COLS.forEach((col) => {
            dataRow.getCell(col).numFmt = QTY_NUM_FMT;
          });
        } else {
          dataRow = sheet.addRow([
            row.item,
            row.categoria,
            row.descripcion,
            row.ventaPeriodo,
            row.costoPeriodo,
            row.margenPorcentaje,
            row.invCierre,
            row.unidad,
            row.unidadesVendidas,
            row.valorInventario,
            row.rotacion,
            row.diaInventarioEfectivo,
            row.diaVentaEfectivo,
            row.fechaUltimaVenta,
            row.ultimoIngreso,
          ]);
          GENERAL_CURRENCY_COLS.forEach((col) => {
            dataRow.getCell(col).numFmt = COP_NUM_FMT;
          });
          GENERAL_QTY_COLS.forEach((col) => {
            dataRow.getCell(col).numFmt = QTY_NUM_FMT;
          });
        }
      });
      sheet.addRow([]);
    });
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
  }, []);

  const runExcelExport = useCallback(
    async (includedSedeValues: string[]) => {
      if (includedSedeValues.length === 0 || isExportingExcel) return;
      if (!dateRange.start || !dateRange.end) return;

      setIsExportingExcel(true);
      try {
        const prepared = await prepareRotacionExportData({
          apiBasePath,
          authUserId: authUser?.id,
          dateRange: { start: dateRange.start, end: dateRange.end },
          selectedSedeValues: includedSedeValues,
          allSedeOptions,
          loadedSedeValueSet,
          inMemoryPerSedeExportGroups: perSedeExportSourceGroups,
          inMemoryPerSedeBaseRowsByKey: perSedeBaseRowsByKey,
          inMemoryCeroEstadoByKey: ceroEstadoByKey,
          inMemoryRestockEstadoByKey: restockEstadoByKey,
          filterCatalogLineasN1: filterCatalog.lineasN1,
          filterCatalogCategorias: filterCatalog.categorias,
          selectedLineaN1Values,
          selectedLineaN2Values:
            selectedLineaN1Values.length === 1 ? selectedLineaN2Values : [],
          lineasN2Catalog:
            selectedLineaN1Values.length === 1 ? lineasN2ForFilterUi : [],
          lineasN2Nombres:
            selectedLineaN1Values.length === 1 ? lineasN2NombreMap : {},
          itemLineaN2ByKey:
            selectedLineaN1Values.length === 1
              ? lineasN2Catalog.itemLineaN2ByKey
              : {},
          selectedCategoriaKeys,
          productSearchInput,
          tableSortField,
          tableSortDirection,
          onUnauthorized: () => {
            router.replace("/login");
          },
          onForbidden: (message) => {
            setError(message);
          },
        });
        if (!prepared) {
          setError("No fue posible cargar datos para exportar.");
          return;
        }

        const groups = buildExportGroupsForSedes(
          new Set(includedSedeValues),
          {
            perSedeExportSourceGroups: prepared.perSedeExportSourceGroups,
            perSedeBaseRowsByKey: prepared.perSedeBaseRowsByKey,
            ceroEstadoByKey: prepared.ceroEstadoByKey,
            restockEstadoByKey: prepared.restockEstadoByKey,
          },
        ).filter((group) => group.rows.length > 0);
        const rowCount = groups.reduce(
          (acc, group) => acc + group.rows.length,
          0,
        );
        if (rowCount === 0) {
          setError("No hay filas para exportar con los filtros actuales.");
          return;
        }

        await writeRotacionExcel(groups);
        setIsExportSedePickerOpen(false);
      } finally {
        setIsExportingExcel(false);
      }
    },
    [
      allSedeOptions,
      apiBasePath,
      authUser?.id,
      buildExportGroupsForSedes,
      ceroEstadoByKey,
      dateRange.end,
      dateRange.start,
      filterCatalog.categorias,
      filterCatalog.lineasN1,
      isExportingExcel,
      loadedSedeValueSet,
      perSedeBaseRowsByKey,
      perSedeExportSourceGroups,
      productSearchInput,
      restockEstadoByKey,
      router,
      selectedCategoriaKeys,
      selectedLineaN1Values,
      selectedLineaN2Values,
      lineasN2ForFilterUi,
      lineasN2NombreMap,
      lineasN2Catalog.itemLineaN2ByKey,
      tableSortDirection,
      tableSortField,
      writeRotacionExcel,
    ],
  );

  const handleExportExcelClick = () => {
    if (isExportingExcel) return;
    if (!dateRange.start || !dateRange.end) return;
    if (canPickSedesForExport) {
      setIsExportSedePickerOpen(true);
      return;
    }
    if (exportRowCount === 0) return;
    void runExcelExport(targetSedeSelections.map((sede) => sede.value));
  };

  const handleExportPdf = () => {
    if (exportRowCount === 0 || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      buildRotacionPdfDocument().save(
        `${exportFilePrefix}_${buildExportFileStamp()}.pdf`,
      );
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleWhatsAppShare = useCallback(
    async (format: "png" | "jpeg" | "pdf") => {
      if (exportRowCount === 0 || whatsappShareLockRef.current) return;
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
    [buildRotacionPdfDocument, exportRowCount],
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
              <div className="max-w-3xl" id={ROTACION_TOUR_ANCHOR.intro}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700">
                  Producto
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  {pageTitle}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                  {pageDescription}
                </p>
                {lineCategoryScope?.locked ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Vista restringida a la categoría{" "}
                    <span className="font-semibold">Asaderos</span>.
                  </p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                <div className="flex w-full flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="group h-9 gap-2 rounded-full border-slate-200 bg-white/90 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm backdrop-blur-xs transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900"
                    onClick={startRotacionTourGuide}
                    title="Ver tutorial interactivo de Rotación"
                  >
                    <CircleHelp
                      className="h-4 w-4 text-amber-600 transition group-hover:text-amber-700"
                      aria-hidden
                    />
                    Ayuda
                  </Button>
                  {canViewSurtidoHistorial ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !dateRange.start ||
                        !dateRange.end ||
                        targetSedeSelections.length === 0
                      }
                      title={
                        !dateRange.start || !dateRange.end
                          ? "Seleccione rango de fechas"
                          : targetSedeSelections.length === 0
                            ? "Seleccione al menos una sede"
                            : "Cambios de S.inventario en el periodo y sedes actuales"
                      }
                      className="group h-9 gap-2 rounded-full border-amber-200/70 bg-white/85 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900 shadow-sm backdrop-blur-xs transition hover:border-amber-300 hover:bg-amber-50 hover:shadow-md disabled:opacity-50 disabled:hover:border-amber-200/70 disabled:hover:bg-white/85 disabled:hover:shadow-sm"
                      onClick={() => setSurtidoAuditModalOpen(true)}
                    >
                      <History
                        className="h-4 w-4 text-amber-600 transition group-hover:text-amber-700"
                        aria-hidden
                      />
                      Historial S.inventario
                    </Button>
                  ) : null}
                  {canEditAbcdConfig ? (
                    <Button
                      id={ROTACION_TOUR_ANCHOR.abcdConfig}
                      type="button"
                      className="group h-9 gap-2 rounded-full bg-amber-600 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-[0_8px_22px_-10px_rgba(217,119,6,0.7)] transition hover:bg-amber-700 hover:shadow-[0_12px_26px_-10px_rgba(180,83,9,0.75)]"
                      onClick={() => setIsAbcdModalOpen(true)}
                    >
                      <SlidersHorizontal
                        className="h-4 w-4 transition group-hover:rotate-90"
                        aria-hidden
                      />
                      Configurar ABCD
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.32fr)_minmax(320px,1fr)]">
          <Card
            id={ROTACION_TOUR_ANCHOR.filters}
            className="h-full border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]"
          >
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
              <div
                id={ROTACION_TOUR_ANCHOR.lineFilters}
                className="rounded-2xl border border-violet-200 bg-white px-4 py-3 shadow-sm"
              >
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
                {singleSelectedLineaN1 ? (
                  <Badge className="border-pink-200 bg-pink-50 text-pink-700">
                    {lineaN2Options.length === 0
                      ? "N2 sin datos"
                      : selectedLineaN2Values.length === lineaN2Options.length
                        ? "Todas las lineas N2"
                        : `${selectedLineaN2Values.length} de ${lineaN2Options.length} lineas N2`}
                  </Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card
            id={ROTACION_TOUR_ANCHOR.dates}
            className="h-full border-slate-200/80 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]"
          >
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <CalendarDays className="h-5 w-5 text-amber-600" />
                Periodo de consulta
              </CardTitle>
              <CardDescription>
                Por defecto se muestra el{" "}
                <span className="font-medium text-slate-700">
                  mes anterior completo
                </span>{" "}
                (del dia 1 al ultimo dia, segun cuantos dias tenga ese mes),
                acotado a los datos disponibles. Puedes cambiarlo cuando
                quieras, con un maximo de 2 meses por consulta.
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
                  . Rango maximo por consulta: 2 meses.
                </div>
              )}

              {singleSelectedLineaN1 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-700">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-100 text-[10px] font-bold text-fuchsia-800">
                          N2
                        </span>
                        Sublíneas
                      </div>
                      <FilterFieldLabel
                        icon={Filter}
                        label="Lineas nivel 2"
                        accentClassName="text-fuchsia-700"
                      />
                      <p className="max-w-xl text-[11px] leading-snug text-slate-500">
                        Sublíneas de{" "}
                        <span className="font-medium text-slate-600">
                          {lineaN1Options.find(
                            (option) => option.value === singleSelectedLineaN1,
                          )?.label ?? `N1 ${singleSelectedLineaN1}`}
                        </span>
                        . Al cambiar lineas N2, la tabla se actualiza sola en
                        unos instantes.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedLineaN2Values(
                            lineaN2Options.map((option) => option.value),
                          )
                        }
                        disabled={
                          lineaN2Options.length === 0 || isLoadingLineasN2Catalog
                        }
                        className="h-8 rounded-lg border-fuchsia-200 bg-fuchsia-50 px-2.5 text-[11px] font-semibold text-fuchsia-800 hover:bg-fuchsia-100 disabled:opacity-50"
                      >
                        Seleccionar todas
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedLineaN2Values([])}
                        disabled={
                          lineaN2Options.length === 0 ||
                          selectedLineaN2Values.length === 0 ||
                          isLoadingLineasN2Catalog
                        }
                        className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Limpiar seleccion
                      </Button>
                    </div>
                  </div>
                  <div className="mb-2">
                    <Badge className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700">
                      {isLoadingLineasN2Catalog
                        ? "Cargando lineas N2..."
                        : lineaN2Options.length === 0
                          ? "Sin lineas N2 disponibles"
                          : `${selectedLineaN2Values.length} de ${lineaN2Options.length} lineas N2 seleccionadas`}
                    </Badge>
                  </div>
                  <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                    {lineaN2Options.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        {isLoadingLineasN2Catalog
                          ? "Consultando sublineas para esta linea N1..."
                          : targetSedeSelections.length === 0
                            ? "Selecciona al menos una sede para ver las sublineas."
                            : "No hay lineas N2 en este periodo para la linea N1 elegida."}
                      </p>
                    ) : (
                      lineaN2Options.map((option) => {
                        const isChecked = selectedLineaN2Set.has(option.value);
                        return (
                          <label
                            key={option.value}
                            className="flex items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedLineaN2Values((current) =>
                                  isChecked
                                    ? current.filter(
                                        (value) => value !== option.value,
                                      )
                                    : [...current, option.value],
                                );
                              }}
                              disabled={isLoadingLineasN2Catalog}
                              className="h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500 disabled:opacity-50"
                            />
                            <span>{option.label}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
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
        ) : isLoadingData && !hasLoadedItems ? (
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
                  {sourceTable}
                </span>
                . Ajusta el rango de fechas o usa el boton{" "}
                <span className="font-semibold">Venta ≤</span> en la tabla para
                filtrar por debajo de un valor.
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-5">
            {rowsAfterProductFilter.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white shadow-[0_22px_45px_-40px_rgba(15,23,42,0.55)]">
                <CardContent className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="rounded-full bg-slate-100 p-4 text-slate-600">
                    <PackageSearch className="h-7 w-7" />
                  </div>
                  {catalogFilteredRows.length === 0 &&
                  !productSearchInput.trim() ? (
                    <>
                      <h2 className="mt-4 text-xl font-bold text-slate-900">
                        Sin productos para los filtros actuales
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                        No hay items que coincidan con las lineas N1, sublineas N2
                        o categorias seleccionadas. Prueba ampliar la seleccion
                        de sublineas o lineas.
                      </p>
                      {singleSelectedLineaN1 &&
                      selectedLineaN2Values.length < lineaN2Options.length ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-4 rounded-lg border-slate-300"
                          onClick={() =>
                            setSelectedLineaN2Values(
                              lineaN2Options.map((option) => option.value),
                            )
                          }
                        >
                          Mostrar todas las sublineas N2
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <div
                  id={ROTACION_TOUR_ANCHOR.table}
                  ref={rotacionTablesExportRef}
                  className="grid gap-5 bg-white p-2"
                >
                  {rowsBySede.map((group, groupIndex) => {
                    const groupKey = `${group.empresa}-${group.sedeId}`;
                    const rowFilter =
                      rowsQuickFilterByGroup[groupKey] ?? "none";
                    const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
                    const ventaHastaCap =
                      rowFilter === "venta_hasta" || rowFilter === "both"
                        ? (ventaHastaCapByGroup[groupKey] ?? null)
                        : null;
                    const isCeroTableContext =
                      rowFilter === "cero_rotacion" || categoryFilter === "0";
                    const isRestockCategoryView =
                      categoryFilter === "S" ||
                      categoryFilter === "R" ||
                      categoryFilter === "N";
                    const isSurtidoTrackingTableView =
                      isCeroTableContext || isRestockCategoryView;
                    const estadoMapForFilter = isCeroTableContext
                      ? ceroEstadoByKey
                      : restockEstadoByKey;
                    const quickFilteredRowsBeforeInvMin = applyRowsQuickFilter(
                      group.rows,
                      rowFilter,
                      ventaHastaCap,
                      dateRange,
                    );
                    const invMinCap = invMinCapByGroup[groupKey] ?? null;
                    const quickFilteredRows =
                      invMinCap == null
                        ? quickFilteredRowsBeforeInvMin
                        : quickFilteredRowsBeforeInvMin.filter(
                            (row) => row.inventoryUnits >= invMinCap,
                          );
                    const zeroEstadoSet = normalizeGroupZeroEstadoSetFilter(
                      ceroEstadoFilterByGroup[groupKey],
                    );
                    const filterSurtidoByEstadoMulti =
                      isSurtidoTrackingTableView &&
                      zeroEstadoSet.length < CERO_ROTACION_ESTADO_VALUES.length;
                    const filteredRows = filterSurtidoByEstadoMulti
                      ? quickFilteredRows.filter((row) => {
                          const key = makeCeroRotacionEstadoKey(
                            row.empresa,
                            row.sedeId,
                            row.item,
                          );
                          const estado =
                            estadoMapForFilter[key] ??
                            DEFAULT_CERO_ROTACION_ESTADO;
                          return zeroEstadoSet.includes(estado);
                        })
                      : quickFilteredRows;
                    /** Misma regla que export: letra ABCD según ventas del conjunto filtrado arriba, sin filtros rápidos de tabla. */
                    const sourceRowsForAbcd =
                      baseRowsBySedeByKey.get(groupKey) ?? group.rows;
                    const sourceRowsForAbcdFilterable =
                      sourceRowsForAbcd.filter(isAbcdFilterableRow);
                    const categoryByItem = buildAbcdCategoryByItem(
                      sourceRowsForAbcdFilterable,
                      abcdConfig,
                    );
                    const abcdCounts = countAbcdItemsByCategory(
                      sourceRowsForAbcdFilterable,
                      categoryByItem,
                    );
                    const abcRotationTotalItems =
                      abcdCounts.A + abcdCounts.B + abcdCounts.C;
                    const categoryFilteredRows =
                      categoryFilter === "all"
                        ? filteredRows
                        : categoryFilter === "0"
                          ? filteredRows.filter((row) =>
                              isCeroRotacionExcludingNuevo(row, dateRange),
                            )
                          : categoryFilter === "S" || categoryFilter === "R" || categoryFilter === "N"
                            ? filteredRows.filter((row) =>
                                isNuevoItemInSelectedRange(row),
                              )
                            : Array.isArray(categoryFilter)
                              ? filteredRows.filter((row) => {
                                  const cat = categoryByItem.get(row.item);
                                  return (
                                    isAbcdFilterableRow(row) &&
                                    cat !== undefined &&
                                    categoryFilter.includes(cat)
                                  );
                                })
                              : filteredRows;
                    const infoTotalItems = filteredRows.length;
                    const infoTotalInv = filteredRows.reduce(
                      (acc, row) => acc + row.inventoryValue,
                      0,
                    );
                    const infoTotalInvUnits = filteredRows.reduce(
                      (acc, row) => acc + row.inventoryUnits,
                      0,
                    );
                    const infoTotalSales = filteredRows.reduce(
                      (acc, row) => acc + row.totalSales,
                      0,
                    );
                    const infoTotalUnits = filteredRows.reduce(
                      (acc, row) => acc + row.totalUnits,
                      0,
                    );
                    const selectedCategoryTotalInv =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.inventoryValue,
                        0,
                      );
                    const selectedCategoryTotalInvUnits =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.inventoryUnits,
                        0,
                      );
                    const selectedCategoryTotalSales =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.totalSales,
                        0,
                      );
                    const selectedCategoryTotalUnits =
                      categoryFilteredRows.reduce(
                        (acc, row) => acc + row.totalUnits,
                        0,
                      );
                    const rowsWithCostBasis = categoryFilteredRows.filter(
                      (row) => row.totalSales > 0 && row.totalCost > 0,
                    );
                    const selectedCategoryMarginSales = rowsWithCostBasis.reduce(
                      (acc, row) => acc + row.totalSales,
                      0,
                    );
                    const selectedCategoryMarginCost = rowsWithCostBasis.reduce(
                      (acc, row) => acc + row.totalCost,
                      0,
                    );
                    const selectedCategoryMarginPct =
                      selectedCategoryMarginSales > 0
                        ? rotationMarginPct(
                            selectedCategoryMarginSales,
                            selectedCategoryMarginCost,
                          )
                        : null;
                    const infoRowsWithCostBasis = filteredRows.filter(
                      (row) => row.totalSales > 0 && row.totalCost > 0,
                    );
                    const infoMarginSales = infoRowsWithCostBasis.reduce(
                      (acc, row) => acc + row.totalSales,
                      0,
                    );
                    const infoMarginCost = infoRowsWithCostBasis.reduce(
                      (acc, row) => acc + row.totalCost,
                      0,
                    );
                    const infoMarginPct =
                      infoMarginSales > 0
                        ? rotationMarginPct(infoMarginSales, infoMarginCost)
                        : null;
                    const infoSalesCoverageDays =
                      infoTotalUnits > 0 && daysConsulted > 0
                        ? (infoTotalInvUnits * daysConsulted) / infoTotalUnits
                        : infoTotalInvUnits > 0
                          ? NO_SALES_DI_VALUE
                          : 0;
                    const selectedCategorySalesCoverageDays =
                      selectedCategoryTotalUnits > 0 && daysConsulted > 0
                        ? (selectedCategoryTotalInvUnits * daysConsulted) /
                          selectedCategoryTotalUnits
                        : selectedCategoryTotalInvUnits > 0
                          ? NO_SALES_DI_VALUE
                          : 0;
                    const abcdSummaryRows = buildAbcdSummaryRows(
                      sourceRowsForAbcdFilterable,
                      categoryByItem,
                    );
                    const abcdSummaryTotals = abcdSummaryRows.reduce(
                      (acc, row) => ({
                        totalSales: acc.totalSales + row.totalSales,
                        totalMargin: acc.totalMargin + row.totalMargin,
                        itemCount: acc.itemCount + row.itemCount,
                      }),
                      { totalSales: 0, totalMargin: 0, itemCount: 0 },
                    );
                    const abcdRowsForMargin = sourceRowsForAbcdFilterable.filter(
                      (row) => row.totalSales > 0 && row.totalCost > 0,
                    );
                    const abcdTotalSalesForMargin = abcdRowsForMargin.reduce(
                      (acc, row) => acc + row.totalSales,
                      0,
                    );
                    const abcdTotalCostForMargin = abcdRowsForMargin.reduce(
                      (acc, row) => acc + row.totalCost,
                      0,
                    );
                    const abcdSummaryTotalMarginPct =
                      abcdTotalSalesForMargin > 0
                        ? rotationMarginPct(
                            abcdTotalSalesForMargin,
                            abcdTotalCostForMargin,
                          )
                        : null;
                    const selectedCategoryLabel =
                      formatAbcdCategoryFilterLabel(categoryFilter);
                    const nuevoItemsCount = group.rows.filter((row) =>
                      isNuevoItemInSelectedRange(row),
                    ).length;
                    const categoryFilteredCeroRotacionCount =
                      categoryFilteredRows.filter((row) =>
                        isCeroRotacionExcludingNuevo(row, dateRange),
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
                    const invMinInput = invMinInputByGroup[groupKey] ?? "";
                    const invMinDigits = sanitizeNumericInput(invMinInput);
                    const invMinParsedPreviewRaw = Number(invMinDigits);
                    const invMinParsedPreview = Math.max(
                      0,
                      invMinParsedPreviewRaw,
                    );
                    const invMinAppliedCap = invMinCapByGroup[groupKey] ?? null;
                    const invMinPreviewCount =
                      invMinDigits.length === 0 ||
                      Number.isNaN(invMinParsedPreviewRaw)
                        ? null
                        : quickFilteredRowsBeforeInvMin.filter(
                            (row) => row.inventoryUnits >= invMinParsedPreview,
                          ).length;
                    const ceroRotacionCount = group.rows.filter((row) =>
                      isCeroRotacionExcludingNuevo(row, dateRange),
                    ).length;
                    const criticalTotalItems =
                      abcdCounts.D + ceroRotacionCount + nuevoItemsCount;
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
                        className="rotacion-whatsapp-export-card gap-0 overflow-visible border-slate-200/80 bg-white py-0 shadow-[0_24px_50px_-42px_rgba(15,23,42,0.65)]"
                      >
                        <CardHeader
                          className="border-b border-slate-100 bg-slate-50/70 pt-6"
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
                              </div>
                              <Badge className="shrink-0 border-indigo-200 bg-indigo-50 text-indigo-700">
                                {group.empresa}
                              </Badge>
                            </div>

                            <div className="flex flex-wrap items-start gap-4">
                              <div className="flex min-w-44 max-w-sm flex-1 flex-col gap-3">
                                <CardDescription className="text-sm leading-6 text-slate-600">
                                  {targetSedeSelections.length > 1
                                    ? "Consolidado real de las sedes seleccionadas usando ventas sin impuesto, inventario de cierre y ultimo ingreso sobre el rango seleccionado."
                                    : "Consolidado real por sede usando ventas sin impuesto, inventario de cierre y ultimo ingreso sobre el rango seleccionado."}
                                </CardDescription>
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
                                {rowFilter === "none" ? (
                                  <div className="w-fit rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                                    <div className="space-y-1">
                                      <div className="whitespace-nowrap">
                                        Total venta:{" "}
                                        <span className="font-black text-slate-900">
                                          {formatPriceWithoutSixZeros(
                                            infoTotalSales,
                                          )}
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
                              <div
                                id={
                                  groupIndex === 0
                                    ? ROTACION_TOUR_ANCHOR.tableAbcd
                                    : undefined
                                }
                                className="flex w-fit max-w-full shrink-0 flex-wrap gap-2"
                              >
                                  <div className="flex w-fit flex-col rounded-xl border border-emerald-200/90 bg-linear-to-br from-emerald-50/95 via-white to-emerald-50/40 px-3 py-2.5 shadow-sm ring-1 ring-emerald-100/90">
                                    <div className="mb-2 space-y-0.5">
                                      <p className="text-[11px] font-bold tracking-tight text-emerald-950">
                                        A·B·C · En rotación
                                      </p>
                                      <p className="text-[10px] leading-snug text-emerald-800/85">
                                        Productos que se mueven
                                      </p>
                                    </div>
                                    <div className="grid w-fit grid-cols-3 gap-2 justify-items-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                      {abcdConfig.aUntilPercent.toFixed(0)}%
                                    </span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => {
                                        setAbcdFilterByGroup((prev) => ({
                                          ...prev,
                                          [groupKey]: toggleAbcdLetterFilter(
                                            prev[groupKey] ?? "all",
                                            "A",
                                          ),
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "A",
                                        )
                                          ? "border-emerald-700 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-200"
                                          : "border-emerald-300 bg-emerald-100 text-emerald-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">A</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {abcdCounts.A.toLocaleString("es-CO")}
                                      </span>
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-amber-600">
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
                                          [groupKey]: toggleAbcdLetterFilter(
                                            prev[groupKey] ?? "all",
                                            "B",
                                          ),
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "B",
                                        )
                                          ? "border-amber-700 bg-amber-500 text-white shadow-md ring-2 ring-amber-200"
                                          : "border-amber-300 bg-amber-100 text-amber-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">B</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {abcdCounts.B.toLocaleString("es-CO")}
                                      </span>
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-orange-600">
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
                                          [groupKey]: toggleAbcdLetterFilter(
                                            prev[groupKey] ?? "all",
                                            "C",
                                          ),
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "C",
                                        )
                                          ? "border-orange-700 bg-orange-500 text-white shadow-md ring-2 ring-orange-200"
                                          : "border-orange-300 bg-orange-100 text-orange-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">C</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {abcdCounts.C.toLocaleString("es-CO")}
                                      </span>
                                    </Button>
                                  </div>
                                    </div>
                                    <div className="mt-2 rounded-lg border border-emerald-200/80 bg-white/80 px-2.5 py-2 shadow-sm">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                                          Total A+B+C
                                        </span>
                                        <span className="text-sm font-black leading-none text-emerald-950 tabular-nums">
                                          {abcRotationTotalItems.toLocaleString(
                                            "es-CO",
                                          )}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-[10px] leading-snug text-emerald-800/70">
                                        Productos en rotaci&oacute;n
                                      </p>
                                    </div>
                                    <p className="mt-2 border-l-2 border-emerald-300/80 pl-2 pt-1.5 text-[10px] leading-snug text-emerald-900/75">
                                      Mantener disponibilidad · surtido y
                                      abastecimiento
                                    </p>
                                  </div>

                                  <div className="flex w-fit flex-col rounded-xl border border-rose-200/90 bg-linear-to-br from-rose-50/90 via-white to-rose-50/30 px-3 py-2.5 shadow-sm ring-1 ring-rose-100/90">
                                    <div className="mb-2 space-y-0.5">
                                      <p className="text-[11px] font-bold tracking-tight text-rose-950">
                                        Críticos · Requieren acción
                                      </p>
                                      <p className="text-[10px] leading-snug text-rose-800/85">
                                        Productos problemáticos
                                      </p>
                                    </div>
                                    <div className="grid w-fit grid-cols-3 gap-2 justify-items-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-rose-600">
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
                                          [groupKey]: toggleAbcdLetterFilter(
                                            prev[groupKey] ?? "all",
                                            "D",
                                          ),
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "D",
                                        )
                                          ? "border-rose-700 bg-rose-600 text-white shadow-md ring-2 ring-rose-200"
                                          : "border-rose-300 bg-rose-100 text-rose-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">D</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {abcdCounts.D.toLocaleString("es-CO")}
                                      </span>
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                      cero
                                    </span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      title="Sin ventas en el periodo y con inventario."
                                      onClick={() => {
                                        setAbcdFilterByGroup((prev) => ({
                                          ...prev,
                                          [groupKey]:
                                            categoryFilter === "0"
                                              ? "all"
                                              : "0",
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        categoryFilter === "0"
                                          ? "border-slate-700 bg-slate-600 text-white shadow-md ring-2 ring-slate-200"
                                          : "border-slate-300 bg-slate-100 text-slate-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">0</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {ceroRotacionCount.toLocaleString(
                                          "es-CO",
                                        )}
                                      </span>
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-cyan-600">
                                      restock
                                    </span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      title="Items con condicion de restock (categoria S)."
                                      onClick={() => {
                                        setAbcdFilterByGroup((prev) => ({
                                          ...prev,
                                          [groupKey]:
                                            categoryFilter === "S" ||
                                            categoryFilter === "R" ||
                                            categoryFilter === "N"
                                              ? "all"
                                              : "S",
                                        }));
                                        setPageByGroupKey((prev) => ({
                                          ...prev,
                                          [groupKey]: 1,
                                        }));
                                      }}
                                      className={`mx-auto flex aspect-square h-18 w-18 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border p-1 text-center whitespace-normal text-xs font-bold leading-tight tabular-nums shadow-sm transition-all ${
                                        categoryFilter === "S" ||
                                        categoryFilter === "R" ||
                                        categoryFilter === "N"
                                          ? "border-cyan-700 bg-cyan-600 text-white shadow-md ring-2 ring-cyan-200"
                                          : "border-cyan-300 bg-cyan-100 text-cyan-900"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">S</span>
                                      <span className="text-[11px] leading-none tabular-nums">
                                        {nuevoItemsCount.toLocaleString("es-CO")}
                                      </span>
                                    </Button>
                                  </div>
                                    </div>
                                    <div className="mt-2 rounded-lg border border-rose-200/80 bg-white/80 px-2.5 py-2 shadow-sm">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-700">
                                          Total D+0+S
                                        </span>
                                        <span className="text-sm font-black leading-none text-rose-950 tabular-nums">
                                          {criticalTotalItems.toLocaleString(
                                            "es-CO",
                                          )}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-[10px] leading-snug text-rose-800/70">
                                        Productos para revisar
                                      </p>
                                    </div>
                                    <div className="mt-1.5 space-y-1 pt-1.5">
                                      <p className="border-l-2 border-rose-200 pl-2 text-[10px] leading-snug text-rose-900/70">
                                        Demanda · descuento, descontinuar,
                                        devolver
                                      </p>
                                      <p className="border-l-2 border-cyan-200 pl-2 text-[10px] leading-snug text-cyan-900/75">
                                        Abastecimiento · pedido, lead time, ROP
                                      </p>
                                    </div>
                                  </div>
                              </div>
                            </div>

                            <div className="flex w-full flex-col gap-3 text-sm">
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
                              {isAdmin ? (
                                <div className="w-full rounded-xl border border-slate-200 bg-white/90 p-3">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    Resumen AxD
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-96 border-collapse text-sm text-slate-700">
                                      <thead>
                                        <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                          <th className="px-2 py-1 text-left">
                                            Clase
                                          </th>
                                          <th className="px-2 py-1 text-right">
                                            $ VTA
                                          </th>
                                          <th className="px-2 py-1 text-right">
                                            # ITEM
                                          </th>
                                          <th className="px-2 py-1 text-right">
                                            Margen
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {abcdSummaryRows.map((row) => (
                                          <tr
                                            key={`axd-${groupKey}-${row.categoria}`}
                                            className="border-b border-slate-100 last:border-b-0"
                                          >
                                            <td className="px-2 py-1.5 font-semibold text-slate-800">
                                              {row.categoria}:
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                              {formatPriceWithoutSixZeros(
                                                row.totalSales,
                                              )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                              {row.itemCount.toLocaleString(
                                                "es-CO",
                                              )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                              {formatPercent(row.marginPct)}
                                            </td>
                                          </tr>
                                        ))}
                                        <tr className="bg-slate-50/90 font-semibold text-slate-900">
                                          <td className="px-2 py-1.5">
                                            Totales
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums">
                                            {formatPriceWithoutSixZeros(
                                              abcdSummaryTotals.totalSales,
                                            )}
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums">
                                            {abcdSummaryTotals.itemCount.toLocaleString(
                                              "es-CO",
                                            )}
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums">
                                            {formatPercent(
                                              abcdSummaryTotalMarginPct,
                                            )}
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div
                              id={
                                groupIndex === 0
                                  ? ROTACION_TOUR_ANCHOR.tableFilters
                                  : undefined
                              }
                              className="border-t border-slate-200/90 pt-5"
                            >
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
                                  {isSurtidoTrackingTableView ? (
                                    <div
                                      className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1"
                                      role="group"
                                      aria-label="Filtrar por estado de inventario"
                                    >
                                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                        S.inventario
                                      </span>
                                      {CERO_ROTACION_ESTADO_VALUES.map((est) => {
                                        const active = zeroEstadoSet.includes(
                                          est,
                                        );
                                        return (
                                          <Button
                                            key={est}
                                            type="button"
                                            variant={active ? "default" : "outline"}
                                            title={
                                              active
                                                ? "Quitar de la vista"
                                                : "Incluir en la vista"
                                            }
                                            onClick={() =>
                                              toggleSurtidoEstadoFilterChip(
                                                groupKey,
                                                est,
                                              )
                                            }
                                            className={`h-7 rounded-full px-2.5 py-0 text-[11px] font-semibold ${
                                              active
                                                ? "bg-amber-600 text-white hover:bg-amber-700"
                                                : ""
                                            }`}
                                          >
                                            {CERO_ROTACION_ESTADO_LABELS[est]}
                                          </Button>
                                        );
                                      })}
                                      <Button
                                        type="button"
                                        variant="outline"
                                        title="Mostrar los tres estados"
                                        onClick={() =>
                                          selectAllSurtidoEstadoFilters(
                                            groupKey,
                                          )
                                        }
                                        className="h-7 rounded-full px-2.5 py-0 text-[11px] font-semibold"
                                      >
                                        Todos
                                      </Button>
                                    </div>
                                  ) : null}
                                  <label
                                    id={
                                      groupIndex === 0
                                        ? ROTACION_TOUR_ANCHOR.tableSearch
                                        : undefined
                                    }
                                    className="order-last mt-1 flex basis-full flex-col gap-1"
                                  >
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                      Buscar producto
                                    </span>
                                    <div className="relative">
                                      <PackageSearch
                                        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                                        aria-hidden
                                      />
                                      <input
                                        type="search"
                                        value={productSearchInput}
                                        onChange={(e) =>
                                          setProductSearchInput(e.target.value)
                                        }
                                        placeholder="Codigo o nombre"
                                        autoComplete="off"
                                        className="h-8 w-full rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-9 text-xs font-medium text-slate-900 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-1 focus:ring-amber-100"
                                        aria-label="Filtrar por codigo o nombre de producto"
                                      />
                                      {productSearchInput.trim() ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setProductSearchInput("")
                                          }
                                          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/80 hover:text-slate-800"
                                          aria-label="Limpiar busqueda"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </label>
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
                                  <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1">
                                    <Button
                                      type="button"
                                      variant={
                                        invMinAppliedCap != null
                                          ? "default"
                                          : "outline"
                                      }
                                      title="Mostrar solo items con unidades de inventario mayores o iguales al valor ingresado"
                                      className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${
                                        invMinAppliedCap != null
                                          ? "bg-sky-700 text-white hover:bg-sky-800"
                                          : ""
                                      }`}
                                      onClick={() =>
                                        applyOrToggleInvMinFilter(groupKey)
                                      }
                                    >
                                      {invMinAppliedCap != null
                                        ? `Inv ≥ ${invMinAppliedCap.toLocaleString("es-CO", { maximumFractionDigits: 0 })} (${categoryFilteredRows.length})`
                                        : invMinPreviewCount != null
                                          ? `Inv ≥ (${invMinPreviewCount})`
                                          : "Inv ≥"}
                                    </Button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      placeholder="UND"
                                      aria-label="Piso unidades de inventario para filtrar"
                                      value={invMinInput}
                                      onChange={(e) =>
                                        setInvMinInputByGroup((prev) => ({
                                          ...prev,
                                          [groupKey]: sanitizeNumericInput(
                                            e.target.value,
                                          ),
                                        }))
                                      }
                                      className="h-7 w-22 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-900 outline-none focus:border-sky-300 focus:ring-1 focus:ring-sky-100"
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
                                        {formatPriceWithoutSixZeros(
                                          infoTotalInv,
                                        )}
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
                          <div
                            className="flex flex-wrap items-center justify-end gap-2"
                            {...(groupIndex === 0
                              ? { id: ROTACION_TOUR_ANCHOR.export }
                              : {})}
                          >
                            <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Filas por pagina
                            </label>
                            <select
                              value={pageSize}
                              onChange={(event) =>
                                handlePageSizeChange(event.target.value)
                              }
                              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none transition-all focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                            >
                              {PAGE_SIZE_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleExportExcelClick}
                              disabled={
                                isExportingExcel ||
                                (!canPickSedesForExport && exportRowCount === 0) ||
                                (canPickSedesForExport &&
                                  (!dateRange.start || !dateRange.end))
                              }
                              className="h-8 rounded-lg border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {isExportingExcel
                                ? "Exportando..."
                                : "Descargar Excel"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleExportPdf}
                              disabled={
                                exportRowCount === 0 || isExportingPdf
                              }
                              className="h-8 rounded-lg border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                            >
                              {isExportingPdf
                                ? "Exportando..."
                                : "Descargar PDF"}
                            </Button>
                            <details
                              ref={whatsappDetailsRef}
                              className="relative group"
                            >
                              <summary
                                className="flex h-8 list-none cursor-pointer items-center gap-2 rounded-lg border border-emerald-600 bg-[#25D366] px-3 text-xs font-semibold text-white shadow-sm outline-none transition hover:bg-[#20bd5a] [&::-webkit-details-marker]:hidden disabled:pointer-events-none disabled:opacity-50"
                                aria-label="Enviar tabla por WhatsApp"
                              >
                                <WhatsAppLogo className="h-5 w-5 shrink-0 text-white" />
                                <span className="hidden sm:inline">
                                  WhatsApp
                                </span>
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
                                      exportRowCount === 0 ||
                                      isWhatsAppSharing
                                    }
                                    className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                                    onClick={() =>
                                      void handleWhatsAppShare("png")
                                    }
                                  >
                                    Imagen PNG (sin pérdida)
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={
                                      exportRowCount === 0 ||
                                      isWhatsAppSharing
                                    }
                                    className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                                    onClick={() =>
                                      void handleWhatsAppShare("jpeg")
                                    }
                                  >
                                    Imagen JPG (98% calidad)
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={
                                      exportRowCount === 0 ||
                                      isWhatsAppSharing
                                    }
                                    className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-800 transition hover:bg-emerald-50 disabled:opacity-50"
                                    onClick={() =>
                                      void handleWhatsAppShare("pdf")
                                    }
                                  >
                                    PDF
                                  </button>
                                </div>
                                <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-[11px] leading-snug text-slate-500">
                                  Imagen: solo la tabla (paginación por sede),
                                  captura ampliada y alta densidad de píxeles.
                                  JPG usa calidad 98%; WhatsApp puede volver a
                                  comprimir al enviar — si no se lee bien,
                                  prueba PNG o PDF. PDF: todas las filas
                                  filtradas, igual que &quot;Descargar
                                  PDF&quot;.{" "}
                                  {typeof navigator !== "undefined" &&
                                  typeof navigator.share === "function"
                                    ? "Con compartir, elige WhatsApp si aparece."
                                    : "Se descarga el archivo y se intenta abrir WhatsApp Desktop; si no abre, se usa WhatsApp Web (adjunta el archivo con clip)."}
                                </p>
                              </div>
                            </details>
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
                          <div ref={(node) => setTableHostRef(groupKey, node)}>
                            <Table
                              containerClassName="rotacion-table-capture-scroll min-w-0 overscroll-x-contain"
                              className="rotacion-sticky-table w-full min-w-7xl table-fixed border-collapse text-sm [&_th]:text-center! [&_td]:text-center!"
                            >
                              <colgroup>
                                {(isSurtidoTrackingTableView
                                  ? ROTACION_ZERO_TABLE_COL_WIDTHS
                                  : ROTACION_TABLE_COL_WIDTHS
                                ).map((w, i) => (
                                  <col key={i} style={{ width: w }} />
                                ))}
                              </colgroup>
                              <TableHeader>
                                <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                                  {isSurtidoTrackingTableView ? (
                                    <>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-600 backdrop-blur-sm">
                                        #
                                      </TableHead>
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
                                          field="ceroRotacionEstado"
                                          label="S.inventario"
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
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
                                              Venta período
                                            </span>
                                          }
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="inventoryUnits"
                                          align="right"
                                          label="Inv."
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="inventoryValue"
                                          align="right"
                                          label="V. inv."
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 py-2 pl-4 pr-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="lastMovementDate"
                                          align="right"
                                          label="DI"
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="duvDays"
                                          align="right"
                                          label="DUV"
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="lastPurchaseDate"
                                          align="right"
                                          label="Ult. venta"
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom backdrop-blur-sm">
                                        <SortableRotationHeader
                                          field="lastMovementDate"
                                          align="right"
                                          label="Ult. ingr."
                                          activeField={tableSortField}
                                          direction={tableSortDirection}
                                          onSort={handleTableSort}
                                        />
                                      </TableHead>
                                    </>
                                  ) : (
                                    <>
                                      <TableHead className="whitespace-nowrap border-b border-slate-200 bg-slate-50/95 px-2 py-2 text-right align-bottom text-[11px] font-semibold uppercase tracking-wide text-slate-600 backdrop-blur-sm">
                                        #
                                      </TableHead>
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
                                          field="totalCost"
                                          align="right"
                                          label={
                                            <span className="block text-[11px] leading-tight">
                                              Costo
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
                                          label="DIC"
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
                                          field="lastPurchaseDate"
                                          align="right"
                                          label={
                                            <span className="block text-[11px] leading-tight">
                                              Ult. venta
                                            </span>
                                          }
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
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {paginatedRows.map((row, rowIndex) => {
                                  const rowNumber = startIndex + rowIndex + 1;
                                  const duvDays = calculateDuvDays(
                                    row.lastPurchaseDate,
                                  );
                                  const diSinceIngresoDays =
                                    calculateDiSinceLastIngresoDays(
                                      row.lastMovementDate,
                                    );
                                  const displayCategory = isNuevoItemInSelectedRange(
                                    row,
                                  )
                                    ? "S"
                                    : isCeroRotacionExcludingNuevo(row, dateRange)
                                      ? "0"
                                      : (categoryByItem.get(row.item) ?? "D");
                                  const categoryColorClass =
                                    displayCategory === "A"
                                      ? "border-emerald-300 bg-emerald-200 text-emerald-900"
                                      : displayCategory === "B"
                                        ? "border-amber-300 bg-amber-200 text-amber-900"
                                        : displayCategory === "C"
                                          ? "border-orange-300 bg-orange-200 text-orange-900"
                                          : displayCategory === "0"
                                            ? "border-slate-300 bg-slate-200 text-slate-900"
                                          : displayCategory === "S"
                                              ? "border-cyan-300 bg-cyan-200 text-cyan-900"
                                              : "border-rose-300 bg-rose-200 text-rose-900";
                                  return (
                                    <TableRow
                                      key={`${group.sedeId}-${row.item}-${rowIndex}`}
                                    >
                                      {isSurtidoTrackingTableView ? (
                                        <>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-500">
                                            {rowNumber}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 align-top font-semibold text-slate-900">
                                            {showItemDrilldownLinks ? (
                                              <RotacionItemDrilldown
                                                itemId={row.item}
                                                date={itemDrilldownDate}
                                                dateStart={itemDrilldownDateStart}
                                              />
                                            ) : (
                                              <span className="text-xs">
                                                {row.item}
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-1 py-2 text-center align-top">
                                            <Badge
                                              className={`min-w-7 justify-center px-1.5 py-0 text-xs font-black ${categoryColorClass}`}
                                            >
                                              {displayCategory}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="min-w-0 px-1 py-2 align-top">
                                            <select
                                              className="max-w-44 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-left text-xs text-slate-800 shadow-sm"
                                              value={
                                                (isCeroTableContext
                                                  ? ceroEstadoByKey
                                                  : restockEstadoByKey)[
                                                  makeCeroRotacionEstadoKey(
                                                    row.empresa,
                                                    row.sedeId,
                                                    row.item,
                                                  )
                                                ] ?? DEFAULT_CERO_ROTACION_ESTADO
                                              }
                                              onChange={(e) => {
                                                void persistRotacionSurtidoEstado(
                                                  row,
                                                  e.target
                                                    .value as CeroRotacionEstado,
                                                  isCeroTableContext
                                                    ? "cero"
                                                    : "restock",
                                                );
                                              }}
                                            >
                                              {CERO_ROTACION_ESTADO_VALUES.map(
                                                (v) => (
                                                  <option key={v} value={v}>
                                                    {
                                                      CERO_ROTACION_ESTADO_LABELS[
                                                        v
                                                      ]
                                                    }
                                                  </option>
                                                ),
                                              )}
                                            </select>
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
                                                {row.unidad
                                                  ? ` | ${row.unidad}`
                                                  : ""}
                                              </p>
                                            </div>
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPrice(row.totalSales)}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-sm tabular-nums text-slate-700">
                                            {row.inventoryUnits.toLocaleString(
                                              "es-CO",
                                            )}{" "}
                                            {row.unidad ?? ""}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPrice(row.inventoryValue)}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top text-xs tabular-nums text-slate-600">
                                            {diSinceIngresoDays == null
                                              ? "Sin fecha"
                                              : diSinceIngresoDays.toLocaleString(
                                                  "es-CO",
                                                )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-xs tabular-nums text-slate-700">
                                            {duvDays == null
                                              ? "Sin fecha"
                                              : `${duvDays.toLocaleString("es-CO")} dias`}
                                          </TableCell>
                                          <TableCell className="px-2 py-2 text-right align-top text-xs leading-tight tabular-nums text-slate-700 whitespace-normal wrap-break-word">
                                            {row.lastPurchaseDate
                                              ? formatDateLabel(
                                                  row.lastPurchaseDate,
                                                  dateLabelOptions,
                                                )
                                              : "Sin fecha de venta"}
                                          </TableCell>
                                          <TableCell className="px-2 py-2 text-right align-top text-xs leading-tight tabular-nums text-slate-700 whitespace-normal wrap-break-word">
                                            {row.lastMovementDate
                                              ? formatDateLabel(
                                                  row.lastMovementDate,
                                                  dateLabelOptions,
                                                )
                                              : "Sin fecha de ingreso"}
                                          </TableCell>
                                        </>
                                      ) : (
                                        <>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-500">
                                            {rowNumber}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 align-top font-semibold text-slate-900">
                                            {showItemDrilldownLinks ? (
                                              <RotacionItemDrilldown
                                                itemId={row.item}
                                                date={itemDrilldownDate}
                                                dateStart={itemDrilldownDateStart}
                                              />
                                            ) : (
                                              <span className="text-xs">
                                                {row.item}
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-1 py-2 text-center align-top">
                                            <Badge
                                              className={`min-w-7 justify-center px-1.5 py-0 text-xs font-black ${categoryColorClass}`}
                                            >
                                              {displayCategory}
                                            </Badge>
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
                                                {row.unidad
                                                  ? ` | ${row.unidad}`
                                                  : ""}
                                              </p>
                                            </div>
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPrice(row.totalSales)}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPrice(row.totalCost)}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPercent(
                                              rotationMarginPct(
                                                row.totalSales,
                                                row.totalCost,
                                              ),
                                            )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-sm tabular-nums text-slate-700">
                                            {row.inventoryUnits.toLocaleString(
                                              "es-CO",
                                            )}{" "}
                                            {row.unidad ?? ""}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top text-sm tabular-nums text-slate-700">
                                            {row.totalUnits.toLocaleString(
                                              "es-CO",
                                            )}
                                            {row.unidad ? ` ${row.unidad}` : ""}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-700">
                                            {formatPrice(row.inventoryValue)}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top tabular-nums text-slate-700">
                                            {formatRotationOneDecimal(
                                              row.rotation,
                                            )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top text-xs tabular-nums text-slate-600">
                                            {row.trackedDays.toLocaleString(
                                              "es-CO",
                                            )}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap py-2 pl-4 pr-2 text-right align-top text-xs tabular-nums text-slate-600">
                                            {row.salesEffectiveDays.toLocaleString(
                                              "es-CO",
                                            )}
                                          </TableCell>
                                          <TableCell className="px-2 py-2 text-right align-top text-xs leading-tight tabular-nums text-slate-700 whitespace-normal wrap-break-word">
                                            {row.lastPurchaseDate
                                              ? formatDateLabel(
                                                  row.lastPurchaseDate,
                                                  dateLabelOptions,
                                                )
                                              : "Sin fecha de venta"}
                                          </TableCell>
                                          <TableCell className="px-2 py-2 text-right align-top text-xs leading-tight tabular-nums text-slate-700 whitespace-normal wrap-break-word">
                                            {row.lastMovementDate
                                              ? formatDateLabel(
                                                  row.lastMovementDate,
                                                  dateLabelOptions,
                                                )
                                              : "Sin fecha de ingreso"}
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-3 py-3">
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
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-md px-3 text-xs font-semibold"
                              onClick={() => scrollGroupTableToTop(groupKey)}
                            >
                              Subir al inicio
                            </Button>
                          </div>
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

      {(() => {
        const floatingRowFilter = floatingHeaderState
          ? (rowsQuickFilterByGroup[floatingHeaderState.groupKey] ?? "none")
          : "none";
        const floatingCategoryFilter = floatingHeaderState
          ? (abcdFilterByGroup[floatingHeaderState.groupKey] ?? "all")
          : "all";
        const floatingIsCeroContext =
          floatingRowFilter === "cero_rotacion" ||
          floatingCategoryFilter === "0";
        const floatingIsRestockCategory =
          floatingCategoryFilter === "S" ||
          floatingCategoryFilter === "R" ||
          floatingCategoryFilter === "N";
        const floatingIsSurtidoTrackingTableView =
          floatingIsCeroContext || floatingIsRestockCategory;
        const floatingWidths = floatingIsSurtidoTrackingTableView
          ? ROTACION_ZERO_TABLE_COL_WIDTHS
          : ROTACION_TABLE_COL_WIDTHS;
        const floatingColumns = floatingIsSurtidoTrackingTableView
          ? ROTACION_FLOATING_HEADER_COLUMNS_ZERO
          : ROTACION_FLOATING_HEADER_COLUMNS;

        return floatingHeaderState ? (
          <div
            className="fixed z-40"
            style={{
              top: ROTACION_FLOATING_HEADER_TOP_PX,
              left: floatingHeaderState.left,
              width: floatingHeaderState.width,
            }}
          >
            <div className="pointer-events-auto overflow-hidden rounded-t-lg border border-slate-200 bg-white shadow-[0_12px_28px_-20px_rgba(15,23,42,0.7)]">
              <div
                style={{
                  transform: `translateX(-${floatingHeaderState.scrollLeft}px)`,
                }}
              >
                <table className="w-full min-w-7xl table-fixed border-collapse text-sm">
                  <colgroup>
                    {floatingWidths.map((w, i) => (
                      <col key={`floating-col-${i}`} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50/95">
                      {floatingColumns.map((col, i) => (
                        <th
                          key={`floating-header-${i}`}
                          className={cn(
                            "border-b border-slate-200 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700",
                            col.align === "right"
                              ? "text-right"
                              : col.align === "center"
                                ? "text-center"
                                : "text-left",
                          )}
                        >
                          {"field" in col ? (
                            <SortableRotationHeader
                              field={col.field}
                              label={col.label}
                              activeField={tableSortField}
                              direction={tableSortDirection}
                              onSort={handleTableSort}
                              align={col.align === "right" ? "right" : "left"}
                            />
                          ) : (
                            col.label
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                </table>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {surtidoAuditModalOpen && canViewSurtidoHistorial ? (
        <SurtidoAuditModal
          onClose={() => setSurtidoAuditModalOpen(false)}
          dateRange={dateRange}
          targetSedeSelections={targetSedeSelections}
          formattedRange={formattedRange}
        />
      ) : null}

      {isAbcdModalOpen && canEditAbcdConfig ? (
        <AbcdConfigModal
          onClose={() => setIsAbcdModalOpen(false)}
          initialConfig={abcdConfig}
          singleSelectedSedeTarget={singleSelectedSedeTarget}
          isSaving={isSavingAbcdConfig}
          onSave={(draft, scope) => handleSaveAbcdConfig(draft, scope)}
        />
      ) : null}

      {isExportSedePickerOpen ? (
        <RotacionExportSedeModal
          sedeOptions={exportSedePickerOptions}
          initialSelectedValues={targetSedeSelections.map((sede) => sede.value)}
          rowCountBySedeValue={exportRowCountBySedeValue}
          isExporting={isExportingExcel}
          onClose={() => setIsExportSedePickerOpen(false)}
          onConfirm={(selectedValues) => runExcelExport(selectedValues)}
        />
      ) : null}
    </div>
  );
}

export default function RotacionPage() {
  return (
    <RotacionViewConfigProvider config={ROTACION_LEGACY_VIEW}>
      <AppTopBar backHref="/productividad" backLabel="Volver a productividad" />
      <RotacionPageInner />
    </RotacionViewConfigProvider>
  );
}
