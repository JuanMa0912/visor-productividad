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
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  canAccessRotacionBoard,
  canEditRotacionAbcdConfig,
} from "@/lib/shared/special-role-features";
import {
  CERO_ROTACION_ESTADO_LABELS,
  CERO_ROTACION_ESTADO_SORT_ORDER,
  CERO_ROTACION_ESTADO_VALUES,
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
  type CeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import { cn, formatDateLabel } from "@/lib/shared/utils";
import {
  FilterFieldLabel,
  FilterSelectField,
  SortableRotationHeader,
  WhatsAppLogo,
} from "./rotation-filter-widgets";
import type { DateRange, RotationRow, RotationCategoriaFilterOption, RotationApiResponse, RotationCatalogSnapshot, LineaN1Option, LineaN1FamilyKey, AbcdConfig, GroupAbcdFilter, RotationSortField, RotationSortDirection, PageSize, GroupRowsQuickFilter, GroupZeroEstadoFilter } from "./rotacion-preamble";
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
  bestLineaDisplayFromRow,
  compareLineaN1FilterCodes,
  normalizeLineaN1CodeForFilter,
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
  appendCategoriaParams,
  buildLineasN1QueryValues,
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
  ROTACION_LAST_SEDE_STORAGE_KEY,
  readRotationApiForbiddenMessage,
} from "./rotacion-preamble";

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
  const [ceroEstadoFilterByGroup, setCeroEstadoFilterByGroup] = useState<
    Record<string, GroupZeroEstadoFilter>
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
  const [ceroEstadoByKey, setCeroEstadoByKey] = useState<
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
  const selectedSedeSet = useMemo(
    () => new Set(selectedSedes),
    [selectedSedes],
  );

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
            allowedSubdashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        setIsAdmin(Boolean(isAdmin));
        setSpecialRoles(payload.user?.specialRoles ?? null);
        if (
          !isAdmin &&
          (!canAccessPortalSection(
            payload.user?.allowedDashboards,
            "producto",
          ) ||
            !canAccessPortalSubsection(
              payload.user?.allowedSubdashboards,
              "rotacion",
            ))
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
      const allSedeOptionsForQuery = mapRotationSedeOptions(
        filterCatalog.sedes,
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
          throw new Error(
            payload.error ?? "No fue posible consultar la rotacion.",
          );
        }

        setRows(normalizeRotationRows(payload.rows ?? []));
        setHasLoadedItems(true);
        if (
          targetSedeSelectionsForQuery.length === 1 &&
          payload.meta?.abcdConfig
        ) {
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
    /** No exigir ref previo: si el primer fetch se aborta o falla, el ref queda null y antes el efecto
     *  nunca volvia a disparar la recarga (tabla vacia hasta recargar la pagina). */
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
            meta: payloadFromCache.meta ?? {
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
  const targetSedeSelections = useMemo(() => {
    if (selectedSedeMetas.length > 0) return selectedSedeMetas;
    if (selectedCompanySet.size === 0) return [];
    return allSedeOptions.filter((option) =>
      selectedCompanySet.has(option.empresa),
    );
  }, [allSedeOptions, selectedCompanySet, selectedSedeMetas]);
  const singleSelectedSedeTarget = useMemo(
    () => (targetSedeSelections.length === 1 ? targetSedeSelections[0] : null),
    [targetSedeSelections],
  );

  const getCeroEstadoSortRank = useCallback(
    (row: RotationRow) => {
      const key = makeCeroRotacionEstadoKey(row.sedeId, row.item);
      const estado = ceroEstadoByKey[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
      return CERO_ROTACION_ESTADO_SORT_ORDER[estado];
    },
    [ceroEstadoByKey],
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
        };
        const next = data.estados ?? {};
        setCeroEstadoByKey((prev) => ({ ...prev, ...next }));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    })();
    return () => controller.abort();
  }, [ready, router, dateRange.start, dateRange.end, targetSedeSelections]);

  const persistCeroRotacionEstado = useCallback(
    async (row: RotationRow, estado: CeroRotacionEstado) => {
      const key = makeCeroRotacionEstadoKey(row.sedeId, row.item);
      const rollback = ceroEstadoByKey[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
      setCeroEstadoByKey((prev) => ({ ...prev, [key]: estado }));
      const csrf = getCookieValue("vp_csrf");
      if (!csrf) {
        setCeroEstadoByKey((prev) => ({ ...prev, [key]: rollback }));
        setError("No se pudo validar la sesion. Recargue la pagina.");
        return;
      }
      if (!dateRange.start || !dateRange.end) {
        setCeroEstadoByKey((prev) => ({ ...prev, [key]: rollback }));
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
        setCeroEstadoByKey((prev) => ({ ...prev, [key]: rollback }));
        setError(
          err instanceof Error ? err.message : "Error guardando estado.",
        );
      }
    },
    [ceroEstadoByKey, dateRange.end, dateRange.start, router],
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
  }, [ready, isLoadingLineCatalog, selectedSedes, allSedeOptions]);

  const sortedRows = useMemo(
    () =>
      sortRotationRows(
        rows,
        tableSortField,
        tableSortDirection,
        tableSortField === "ceroRotacionEstado"
          ? getCeroEstadoSortRank
          : undefined,
      ),
    [rows, tableSortDirection, tableSortField, getCeroEstadoSortRank],
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
  const rowsBySedeKeys = useMemo(
    () => rowsBySede.map((group) => `${group.empresa}-${group.sedeId}`),
    [rowsBySede],
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

  const exportGroups = useMemo(
    () =>
      rowsBySede
        .map((group) => {
        const groupKey = `${group.empresa}-${group.sedeId}`;
        const rowFilter = rowsQuickFilterByGroup[groupKey] ?? "none";
        const zeroEstadoFilter = ceroEstadoFilterByGroup[groupKey] ?? "all";
        const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
        const ventaHastaCap =
          rowFilter === "venta_hasta" || rowFilter === "both"
            ? (ventaHastaCapByGroup[groupKey] ?? null)
            : null;
        const isZeroRotationTableView =
          rowFilter === "cero_rotacion" || categoryFilter === "0";
        const quickFilteredRows = applyRowsQuickFilter(
          group.rows,
          rowFilter,
          ventaHastaCap,
          dateRange,
        );
        const filteredRows =
          isZeroRotationTableView && zeroEstadoFilter !== "all"
            ? quickFilteredRows.filter((row) => {
                const key = makeCeroRotacionEstadoKey(row.sedeId, row.item);
                const estado =
                  ceroEstadoByKey[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
                return estado === zeroEstadoFilter;
              })
            : quickFilteredRows;
        /** Pareto ABCD sobre el universo del periodo + filtros superiores; no aplica filtros de tabla (cero rot., venta ≤). */
        const sourceRowsForAbcd =
          baseRowsBySedeByKey.get(groupKey) ?? group.rows;
        const categoryByItem = buildAbcdCategoryByItem(
          sourceRowsForAbcd,
          abcdConfig,
        );
        const categoryFilteredRows =
          categoryFilter === "all"
            ? filteredRows
            : categoryFilter === "0"
              ? filteredRows.filter((row) =>
                  isCeroRotacionExcludingNuevo(row, dateRange),
                )
              : categoryFilter === "S" || categoryFilter === "R" || categoryFilter === "N"
                ? filteredRows.filter((row) => isNuevoItemInSelectedRange(row))
                : Array.isArray(categoryFilter)
                  ? filteredRows.filter((row) => {
                      const cat = categoryByItem.get(row.item);
                      return (
                        cat !== undefined && categoryFilter.includes(cat)
                      );
                    })
                  : filteredRows;
        const rows = categoryFilteredRows.map((row) => {
          const displayCategory = isNuevoItemInSelectedRange(row)
            ? "S"
            : isCeroRotacionExcludingNuevo(row, dateRange)
              ? "0"
              : (categoryByItem.get(row.item) ?? "D");
          const ceroEstadoKey = makeCeroRotacionEstadoKey(row.sedeId, row.item);
          const ceroEstado =
            ceroEstadoByKey[ceroEstadoKey] ?? DEFAULT_CERO_ROTACION_ESTADO;
          const duvDays = calculateDuvDays(row.lastPurchaseDate);
          const diSinceIngresoDays = calculateDiSinceLastIngresoDays(
            row.lastMovementDate,
          );
          return {
            empresa: formatCompanyLabel(row.empresa),
            sede: displayRotationSedeName(row.sedeName),
            item: row.item,
            categoria: displayCategory,
            ceroEstado: CERO_ROTACION_ESTADO_LABELS[ceroEstado],
            descripcion: row.descripcion,
            ventaPeriodo: row.totalSales,
            costoPeriodo: row.totalCost,
            margenPorcentaje: formatPercent(
              rotationMarginPct(row.totalSales, row.totalCost),
            ),
            invCierre: row.inventoryUnits,
            unidadesVendidas: row.totalUnits,
            unidad: row.unidad ?? "",
            valorInventario: row.inventoryValue,
            rotacion: formatRotationOneDecimal(row.rotation),
            diDesdeIngreso:
              diSinceIngresoDays == null
                ? "Sin fecha"
                : diSinceIngresoDays.toLocaleString("es-CO"),
            diaInventarioEfectivo: row.trackedDays.toLocaleString("es-CO"),
            diaVentaEfectivo: row.salesEffectiveDays.toLocaleString("es-CO"),
            duv:
              duvDays == null ? "Sin fecha" : `${duvDays.toLocaleString("es-CO")} dias`,
            ultimoIngreso: row.lastMovementDate
              ? formatDateLabel(row.lastMovementDate, dateLabelOptions)
              : "Sin fecha de ingreso",
            fechaUltimaVenta: row.lastPurchaseDate
              ? formatDateLabel(row.lastPurchaseDate, dateLabelOptions)
              : "Sin fecha",
          };
        });
        return {
          groupKey,
          isZeroRotationTableView,
          empresa: formatCompanyLabel(group.empresa),
          sede: displayRotationSedeName(group.sedeName),
          rows,
        };
      })
      .filter((group) => group.rows.length > 0),
    [
      abcdConfig,
      abcdFilterByGroup,
      baseRowsBySedeByKey,
      ceroEstadoByKey,
      ceroEstadoFilterByGroup,
      dateRange,
      isNuevoItemInSelectedRange,
      rowsBySede,
      rowsQuickFilterByGroup,
      ventaHastaCapByGroup,
    ],
  );

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
          group.isZeroRotationTableView ? "Cero rotacion" : "Rotacion general"
        }`,
        14,
        nextStartY,
      );

      if (group.isZeroRotationTableView) {
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

  const handleExportExcel = async () => {
    if (exportRowCount === 0 || isExportingExcel) return;
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Rotacion");
      sheet.columns = Array.from({ length: 14 }).map(() => ({ width: 18 }));
      sheet.getColumn(1).width = 14;
      sheet.getColumn(2).width = 8;
      sheet.getColumn(3).width = 40;

      exportGroups.forEach((group) => {
        const titleRow = sheet.addRow([
          `${group.empresa} - ${group.sede} | Vista: ${
            group.isZeroRotationTableView ? "Cero rotacion" : "Rotacion general"
          }`,
        ]);
        titleRow.font = { bold: true, size: 11 };
        titleRow.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2E8F0" },
        };

        const headers = group.isZeroRotationTableView
          ? [
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
            ]
          : [
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
          if (group.isZeroRotationTableView) {
            sheet.addRow([
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
            ]);
          } else {
            sheet.addRow([
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
            ]);
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
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPdf = () => {
    if (exportRowCount === 0 || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      buildRotacionPdfDocument().save(`rotacion_${buildExportFileStamp()}.pdf`);
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
                <div
                  ref={rotacionTablesExportRef}
                  className="grid gap-5 bg-white p-2"
                >
                  {rowsBySede.map((group) => {
                    const groupKey = `${group.empresa}-${group.sedeId}`;
                    const rowFilter =
                      rowsQuickFilterByGroup[groupKey] ?? "none";
                    const zeroEstadoFilter =
                      ceroEstadoFilterByGroup[groupKey] ?? "all";
                    const categoryFilter = abcdFilterByGroup[groupKey] ?? "all";
                    const ventaHastaCap =
                      rowFilter === "venta_hasta" || rowFilter === "both"
                        ? (ventaHastaCapByGroup[groupKey] ?? null)
                        : null;
                    const isZeroRotationTableView =
                      rowFilter === "cero_rotacion" || categoryFilter === "0";
                    const quickFilteredRows = applyRowsQuickFilter(
                      group.rows,
                      rowFilter,
                      ventaHastaCap,
                      dateRange,
                    );
                    const filteredRows =
                      isZeroRotationTableView && zeroEstadoFilter !== "all"
                        ? quickFilteredRows.filter((row) => {
                            const key = makeCeroRotacionEstadoKey(
                              row.sedeId,
                              row.item,
                            );
                            const estado =
                              ceroEstadoByKey[key] ??
                              DEFAULT_CERO_ROTACION_ESTADO;
                            return estado === zeroEstadoFilter;
                          })
                        : quickFilteredRows;
                    /** Misma regla que export: letra ABCD según ventas del conjunto filtrado arriba, sin filtros rápidos de tabla. */
                    const sourceRowsForAbcd =
                      baseRowsBySedeByKey.get(groupKey) ?? group.rows;
                    const categoryByItem = buildAbcdCategoryByItem(
                      sourceRowsForAbcd,
                      abcdConfig,
                    );
                    const abcdCounts = countAbcdItemsByCategory(
                      sourceRowsForAbcd,
                      categoryByItem,
                    );
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
                      sourceRowsForAbcd,
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
                    const abcdRowsForMargin = sourceRowsForAbcd.filter(
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
                    const ceroRotacionCount = group.rows.filter((row) =>
                      isCeroRotacionExcludingNuevo(row, dateRange),
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
                        className="rotacion-whatsapp-export-card gap-0 overflow-visible border-slate-200/80 bg-white py-0 shadow-[0_24px_50px_-42px_rgba(15,23,42,0.65)]"
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "A",
                                        )
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "B",
                                        )
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "C",
                                        )
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        isAbcdLetterFilterActive(
                                          categoryFilter,
                                          "D",
                                        )
                                          ? "border-rose-700 bg-rose-600 text-white shadow-md ring-2 ring-rose-200"
                                          : "border-rose-300 bg-rose-100 text-rose-900"
                                      }`}
                                    >
                                      D: {abcdCounts.D.toLocaleString("es-CO")}
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[10px] font-semibold text-slate-500">
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        categoryFilter === "0"
                                          ? "border-slate-700 bg-slate-600 text-white shadow-md ring-2 ring-slate-200"
                                          : "border-slate-300 bg-slate-100 text-slate-900"
                                      }`}
                                    >
                                      0:{" "}
                                      {ceroRotacionCount.toLocaleString(
                                        "es-CO",
                                      )}
                                    </Button>
                                  </div>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[10px] font-semibold text-cyan-600">
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
                                      className={`h-7 rounded-full border px-2.5 py-0 text-xs font-bold transition-all ${
                                        categoryFilter === "S" ||
                                        categoryFilter === "R" ||
                                        categoryFilter === "N"
                                          ? "border-cyan-700 bg-cyan-600 text-white shadow-md ring-2 ring-cyan-200"
                                          : "border-cyan-300 bg-cyan-100 text-cyan-900"
                                      }`}
                                    >
                                      S:{" "}
                                      {nuevoItemsCount.toLocaleString("es-CO")}
                                    </Button>
                                  </div>
                                </div>
                                {rowFilter === "none" ? (
                                  <div className="ml-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
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
                                  {isZeroRotationTableView ? (
                                    <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                                        S.inventario
                                      </span>
                                      <select
                                        value={zeroEstadoFilter}
                                        onChange={(event) => {
                                          const next = event.target
                                            .value as GroupZeroEstadoFilter;
                                          setCeroEstadoFilterByGroup(
                                            (prev) => ({
                                              ...prev,
                                              [groupKey]: next,
                                            }),
                                          );
                                          setPageByGroupKey((prev) => ({
                                            ...prev,
                                            [groupKey]: 1,
                                          }));
                                        }}
                                        className="h-7 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none transition focus:border-amber-300 focus:ring-1 focus:ring-amber-100"
                                      >
                                        <option value="all">Todos</option>
                                        <option value="sin_verificar">
                                          Sin verificar
                                        </option>
                                        <option value="seguimiento">
                                          Seguimiento
                                        </option>
                                        <option value="surtido">Surtido</option>
                                      </select>
                                    </label>
                                  ) : null}
                                  <label className="order-last mt-1 flex basis-full flex-col gap-1">
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
                          <div className="flex flex-wrap items-center justify-end gap-2">
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
                              onClick={handleExportExcel}
                              disabled={
                                exportRowCount === 0 || isExportingExcel
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
                                  comprimir al enviar — si no se lee bien,
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
                                {(isZeroRotationTableView
                                  ? ROTACION_ZERO_TABLE_COL_WIDTHS
                                  : ROTACION_TABLE_COL_WIDTHS
                                ).map((w, i) => (
                                  <col key={i} style={{ width: w }} />
                                ))}
                              </colgroup>
                              <TableHeader>
                                <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                                  {isZeroRotationTableView ? (
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
                                      key={`${group.sedeId}-${row.item}`}
                                    >
                                      {isZeroRotationTableView ? (
                                        <>
                                          <TableCell className="whitespace-nowrap px-2 py-2 text-right align-top tabular-nums text-slate-500">
                                            {rowNumber}
                                          </TableCell>
                                          <TableCell className="whitespace-nowrap px-2 py-2 align-top font-semibold text-slate-900">
                                            <span className="text-xs">
                                              {row.item}
                                            </span>
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
                                                ceroEstadoByKey[
                                                  makeCeroRotacionEstadoKey(
                                                    row.sedeId,
                                                    row.item,
                                                  )
                                                ] ??
                                                DEFAULT_CERO_ROTACION_ESTADO
                                              }
                                              onChange={(e) => {
                                                void persistCeroRotacionEstado(
                                                  row,
                                                  e.target
                                                    .value as CeroRotacionEstado,
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
                                            <span className="text-xs">
                                              {row.item}
                                            </span>
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
        const floatingIsZeroRotationTableView =
          floatingRowFilter === "cero_rotacion";
        const floatingWidths = floatingIsZeroRotationTableView
          ? ROTACION_ZERO_TABLE_COL_WIDTHS
          : ROTACION_TABLE_COL_WIDTHS;
        const floatingColumns = floatingIsZeroRotationTableView
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
