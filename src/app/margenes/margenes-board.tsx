"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DrillPathStep } from "@/lib/margenes/drill-path";
import type { FactNavStep } from "@/lib/margenes/fact-path";
import type { DrillRow } from "@/lib/margenes/drill-queries";
import { MARGEN_SORT_COLUMNS } from "@/lib/margenes/metrics";
import {
  formatDecimals,
  formatMiles,
  formatPercent,
  marginBadgeClass,
  marginToneClass,
} from "@/lib/margenes/format";
import {
  empresaLabel,
  parseSedeKey,
  sedeKey,
  sedeLabel,
} from "@/lib/margenes/margen-final-query";
import { DRILL_LEVEL_NAMES } from "@/lib/margenes/drill-path";
import { MargenesMultiSelect } from "@/app/margenes/margenes-multi-select";

type BoardMode = "drill" | "fact" | "sede";
type FactTab = "nav" | "list";

type FilterOption = {
  value: string;
  label: string;
  code?: string;
  linea?: string;
  sublinea?: string;
};

type MargenFiltersPayload = {
  empresas: FilterOption[];
  sedes: Array<FilterOption & { empresa: string; idCo: string }>;
  fechas: FilterOption[];
  categorias: FilterOption[];
  lineas: FilterOption[];
  sublineas: FilterOption[];
  items: FilterOption[];
};

type MargenKpi = {
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
  subFacturas: string;
  subCosto: string;
  subMargen: string;
  subPct: string;
};

type TablePayload = {
  kpi: MargenKpi;
  level: number;
  levelName: string;
  rows: DrillRow[];
};

const PAGE_SIZES = [50, 100, 200];
const KPI_PLACEHOLDER = "—";

/** Columnas que el servidor sabe ordenar (las demas se ordenan en cliente sobre lo cargado). */
const SERVER_SORT_KEYS = new Set(Object.keys(MARGEN_SORT_COLUMNS));

const buildQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return search.toString();
};

type ColDef = {
  key: string;
  label: string;
  align?: "left" | "right";
  render?: (row: DrillRow) => React.ReactNode;
  sortValue?: (row: DrillRow) => number | string;
  drill?: boolean;
};

const marginBar = (pct: number) => {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span
      className="mt-0.5 block h-1 w-12 overflow-hidden rounded-sm bg-[#2a2f47]"
      aria-hidden
    >
      <span
        className="block h-full rounded-sm"
        style={{
          width: `${clamped}%`,
          backgroundColor:
            pct >= 15 ? "#34d399" : pct >= 5 ? "#fbbf24" : "#f87171",
        }}
      />
    </span>
  );
};

/** Recorrido: la factura se muestra como "Fact: 000000" (6 dígitos). */
const formatStepLabel = (step: DrillPathStep | FactNavStep): string => {
  if (step.type === "factura" && "documento" in step && step.documento) {
    const doc = String(step.documento).trim();
    const fact = `Fact: ${/^\d+$/.test(doc) ? doc.padStart(6, "0") : doc}`;
    if (step.empresa && step.idCo) {
      return `${fact} · ${sedeLabel(step.empresa, step.idCo)}`;
    }
    return fact;
  }
  return step.label;
};

const buildFacturaNavStep = (row: DrillRow): FactNavStep => {
  if (row.drillStep?.type === "factura") {
    return row.drillStep;
  }
  return {
    type: "factura",
    documento: row.documento ?? row.cod,
    tipdoc: row.tipdoc ?? "",
    label: row.label,
    empresa: row.empresa,
    idCo: row.idCo,
  };
};

type ColsForDrillLevelOptions = {
  showSede?: boolean;
  showFecha?: boolean;
};

const colsForDrillLevel = (
  level: number,
  options: ColsForDrillLevelOptions = {},
): ColDef[] => {
  const base: ColDef[] = [
    {
      key: "ventasNetas",
      label: "Venta (miles)",
      align: "right",
      sortValue: (row) => row.ventasNetas,
      render: (row) => formatMiles(row.ventasNetas),
    },
    {
      key: "costoTotal",
      label: "Costo (miles)",
      align: "right",
      sortValue: (row) => row.costoTotal,
      render: (row) => formatMiles(row.costoTotal),
    },
    {
      key: "margenPesos",
      label: "Margen $ (miles)",
      align: "right",
      sortValue: (row) => row.margenPesos,
      render: (row) => (
        <span className={marginToneClass(row.margenPct)}>
          {formatMiles(row.margenPesos)}
        </span>
      ),
    },
    {
      key: "margenPct",
      label: "Margen %",
      align: "right",
      sortValue: (row) => row.margenPct,
      render: (row) => (
        <span className="inline-flex min-w-[4.5rem] flex-col items-end">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap ${marginBadgeClass(row.margenPct)}`}
          >
            {formatPercent(row.margenPct)}
          </span>
          {marginBar(row.margenPct)}
        </span>
      ),
    },
  ];

  const metricsTail: ColDef[] = [
    {
      key: "facturas",
      label: "Facturas",
      align: "right",
      sortValue: (row) => row.facturas,
      render: (row) => row.facturas.toLocaleString("es-CO"),
    },
    {
      key: "cantidad",
      label: "Cant.",
      align: "right",
      sortValue: (row) => row.cantidad,
      render: (row) => formatDecimals(row.cantidad),
    },
    {
      key: "pvuIva",
      label: "P.Vta/Und c/IVA",
      align: "right",
      sortValue: (row) => row.pvuIva,
      render: (row) => formatDecimals(row.pvuIva),
    },
    {
      key: "pcu",
      label: "Costo X Unidad",
      align: "right",
      sortValue: (row) => row.pcu,
      render: (row) => formatDecimals(row.pcu),
    },
  ];

  if (level === -1) {
    return [
      {
        key: "empresa",
        label: "Empresa",
        sortValue: (row) => (row as DrillRow & { empresa?: string }).empresa ?? "",
        render: (row) => (row as DrillRow & { empresa?: string }).empresa ?? "—",
      },
      {
        key: "cod",
        label: "Cód.",
        sortValue: (row) => row.cod,
        render: (row) => (
          <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">
            {row.cod}
          </span>
        ),
      },
      {
        key: "sede",
        label: "Sede",
        drill: true,
        sortValue: (row) => (row as DrillRow & { sede?: string }).sede ?? row.label,
        render: (row) => (row as DrillRow & { sede?: string }).sede ?? row.label,
      },
      {
        key: "dias",
        label: "Días",
        align: "right",
        sortValue: (row) => (row as DrillRow & { dias?: number }).dias ?? 0,
        render: (row) => (row as DrillRow & { dias?: number }).dias ?? 0,
      },
      {
        key: "items",
        label: "Ítems",
        align: "right",
        sortValue: (row) => row.items ?? 0,
        render: (row) => row.items ?? 0,
      },
      ...metricsTail,
      ...base,
    ];
  }

  if (level === 0) {
    return [
      {
        key: "label",
        label: "Fecha",
        drill: true,
        sortValue: (row) => row.cod,
        render: (row) =>
          row.isAcum ? (
            <span>
              ACUMULADO{" "}
              <span className="font-extrabold tracking-wide text-[#fbbf24]">
                {row.acumMes ?? ""}
              </span>
            </span>
          ) : (
            row.label
          ),
      },
      { key: "categorias", label: "Categ.", align: "right", sortValue: (row) => row.categorias ?? 0, render: (row) => row.categorias ?? 0 },
      { key: "lineas", label: "Líneas", align: "right", sortValue: (row) => row.lineas ?? 0, render: (row) => row.lineas ?? 0 },
      { key: "sublineas", label: "Sublín.", align: "right", sortValue: (row) => row.sublineas ?? 0, render: (row) => row.sublineas ?? 0 },
      { key: "items", label: "Ítems", align: "right", sortValue: (row) => row.items ?? 0, render: (row) => row.items ?? 0 },
      ...metricsTail,
      ...base,
    ];
  }
  if (level === 1) {
    return [
      { key: "cod", label: "Cód.", sortValue: (row) => row.cod, render: (row) => <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">{row.cod}</span> },
      { key: "label", label: "Categoría", drill: true, sortValue: (row) => row.label, render: (row) => row.label },
      { key: "lineas", label: "Líneas", align: "right", sortValue: (row) => row.lineas ?? 0, render: (row) => row.lineas ?? 0 },
      { key: "sublineas", label: "Sublín.", align: "right", sortValue: (row) => row.sublineas ?? 0, render: (row) => row.sublineas ?? 0 },
      { key: "items", label: "Ítems", align: "right", sortValue: (row) => row.items ?? 0, render: (row) => row.items ?? 0 },
      ...metricsTail,
      ...base,
    ];
  }
  if (level === 2) {
    return [
      { key: "cod", label: "Cód.", sortValue: (row) => row.cod, render: (row) => <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">{row.cod}</span> },
      { key: "label", label: "Línea", drill: true, sortValue: (row) => row.label, render: (row) => row.label },
      { key: "sublineas", label: "Sublín.", align: "right", sortValue: (row) => row.sublineas ?? 0, render: (row) => row.sublineas ?? 0 },
      { key: "items", label: "Ítems", align: "right", sortValue: (row) => row.items ?? 0, render: (row) => row.items ?? 0 },
      ...metricsTail,
      ...base,
    ];
  }
  if (level === 3) {
    return [
      { key: "cod", label: "Cód.", sortValue: (row) => row.cod, render: (row) => <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">{row.cod}</span> },
      { key: "label", label: "Sublínea", drill: true, sortValue: (row) => row.label, render: (row) => row.label },
      { key: "items", label: "Ítems", align: "right", sortValue: (row) => row.items ?? 0, render: (row) => row.items ?? 0 },
      ...metricsTail,
      ...base,
    ];
  }
  if (level === 4) {
    return [
      { key: "cod", label: "Cód. Ítem", sortValue: (row) => row.cod, render: (row) => <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">{row.cod}</span> },
      { key: "label", label: "Descripción", drill: true, sortValue: (row) => row.label, render: (row) => <span className="max-w-[240px] truncate">{row.label}</span> },
      ...metricsTail,
      ...base,
    ];
  }
  if (level === 5) {
    const cols: ColDef[] = [];
    if (options.showSede) {
      cols.push({
        key: "sede",
        label: "Sede",
        sortValue: (row) => row.sede ?? "",
        render: (row) => row.sede ?? "—",
      });
    }
    if (options.showFecha) {
      cols.push({
        key: "fecha",
        label: "Fecha",
        sortValue: (row) => row.fecha ?? row.cod,
        render: (row) => row.fecha ?? "—",
      });
    }
    cols.push({
      key: "label",
      label: "# Factura",
      drill: true,
      sortValue: (row) => row.label,
      render: (row) => row.label,
    });
    return [...cols, ...metricsTail.slice(1), ...base];
  }
  return [
    { key: "cod", label: "Cód.", sortValue: (row) => row.cod, render: (row) => <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[11px] text-[#6b7590]">{row.cod}</span> },
    { key: "label", label: "Descripción", sortValue: (row) => row.label, render: (row) => <span className="max-w-[240px] truncate">{row.label}</span> },
    { key: "linea", label: "Línea", sortValue: (row) => row.linea ?? "", render: (row) => row.linea ?? "—" },
    ...metricsTail.slice(0, 3),
    ...base,
  ];
};

export const MargenesBoard = ({
  dateStart,
  dateEnd,
  selectedSedes,
  dataCommitted,
  onSedeDrill,
  allowedSedeKeys = null,
  lockedCategorias = null,
  categoryScopeLocked = false,
}: {
  dateStart: string;
  dateEnd: string;
  selectedSedes: string[];
  dataCommitted: boolean;
  onSedeDrill?: (sede: string) => void;
  /** null = todas las sedes del catálogo (admin / Todas). */
  allowedSedeKeys?: string[] | null;
  lockedCategorias?: string[] | null;
  categoryScopeLocked?: boolean;
}) => {
  const [filterOptions, setFilterOptions] = useState<MargenFiltersPayload | null>(null);
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [sedes, setSedes] = useState<string[]>([]);
  const [fechas, setFechas] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [lineas, setLineas] = useState<string[]>([]);
  const [sublineas, setSublineas] = useState<string[]>([]);
  const [items, setItems] = useState<string[]>([]);
  const [itemSearchOptions, setItemSearchOptions] = useState<FilterOption[]>([]);
  const [itemSearchLoading, setItemSearchLoading] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState("");

  const [mode, setMode] = useState<BoardMode>("drill");
  const [factTab, setFactTab] = useState<FactTab>("nav");
  const [drillPath, setDrillPath] = useState<DrillPathStep[]>([]);
  const [factPath, setFactPath] = useState<FactNavStep[]>([]);
  const [drillSearch, setDrillSearch] = useState("");
  const [factSearch, setFactSearch] = useState("");
  const [mgSortDir, setMgSortDir] = useState<"asc" | "desc">("asc");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const [payload, setPayload] = useState<TablePayload | null>(null);
  const [sedeRows, setSedeRows] = useState<DrillRow[]>([]);
  const [sedeKpi, setSedeKpi] = useState<MargenKpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSedes = useMemo(
    () => (sedes.length > 0 ? sedes : selectedSedes),
    [sedes, selectedSedes],
  );

  useEffect(() => {
    if (!lockedCategorias?.length) return;
    setCategorias(lockedCategorias);
  }, [lockedCategorias]);

  const queryBase = useMemo(
    () =>
      buildQuery({
        from: dateStart,
        to: dateEnd,
        sede: effectiveSedes.join(","),
        empresa: empresas.join(",") || undefined,
        fecha: fechas.join(",") || undefined,
        categoria: categorias.join(",") || undefined,
        linea: lineas.join(",") || undefined,
        sublinea: sublineas.join(",") || undefined,
        item: items.join(",") || undefined,
      }),
    [
      dateStart,
      dateEnd,
      effectiveSedes,
      empresas,
      fechas,
      categorias,
      lineas,
      sublineas,
      items,
    ],
  );

  const filterCatalogQueryBase = useMemo(
    () =>
      buildQuery({
        from: dateStart,
        to: dateEnd,
        sede: effectiveSedes.join(","),
        empresa: empresas.join(",") || undefined,
        fecha: fechas.join(",") || undefined,
        categoria: categorias.join(",") || undefined,
        linea: lineas.join(",") || undefined,
        sublinea: sublineas.join(",") || undefined,
      }),
    [
      dateStart,
      dateEnd,
      effectiveSedes,
      empresas,
      fechas,
      categorias,
      lineas,
      sublineas,
    ],
  );

  const orderParam = useMemo(() => {
    const parts = [`orderDir=${mgSortDir}`];
    if (sortKey && SERVER_SORT_KEYS.has(sortKey)) {
      parts.unshift(`orderBy=${encodeURIComponent(sortKey)}`);
    }
    return parts.join("&");
  }, [sortKey, mgSortDir]);

  const resetFilters = useCallback(() => {
    setEmpresas([]);
    setSedes([]);
    setFechas([]);
    setCategorias([]);
    setLineas([]);
    setSublineas([]);
    setItems([]);
  }, []);

  const seededFilterOptions = useMemo<MargenFiltersPayload>(() => {
    const empresas = [
      ...new Set(
        selectedSedes
          .map((value) => parseSedeKey(value)?.empresa)
          .filter((value): value is string => Boolean(value)),
      ),
    ].map((value) => ({ value, label: empresaLabel(value) }));

    const sedes = selectedSedes
      .map((value) => {
        const parsed = parseSedeKey(value);
        if (!parsed) return null;
        return {
          value,
          label: sedeLabel(parsed.empresa, parsed.idCo),
          empresa: parsed.empresa,
          idCo: parsed.idCo,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      empresas,
      sedes,
      fechas: [],
      categorias: [],
      lineas: [],
      sublineas: [],
      items: [],
    };
  }, [selectedSedes]);

  const activeFilterOptions = filterOptions ?? seededFilterOptions;

  const scopedFilterOptions = useMemo(() => {
    if (!allowedSedeKeys || allowedSedeKeys.length === 0) {
      return activeFilterOptions;
    }
    const allowed = new Set(allowedSedeKeys);
    return {
      ...activeFilterOptions,
      sedes: activeFilterOptions.sedes.filter((option) =>
        allowed.has(option.value),
      ),
    };
  }, [activeFilterOptions, allowedSedeKeys]);

  const cascadedFilterOptions = useMemo(() => {
    const sublineaOptions =
      lineas.length === 0
        ? scopedFilterOptions.sublineas
        : scopedFilterOptions.sublineas.filter(
            (option) => option.linea && lineas.includes(option.linea),
          );

    let itemOptions = scopedFilterOptions.items;
    if (sublineas.length > 0) {
      const selectedSublineas = new Set(sublineas);
      itemOptions = itemOptions.filter((option) => {
        if (!option.sublinea || !selectedSublineas.has(option.sublinea)) {
          return false;
        }
        if (lineas.length > 0) {
          return Boolean(option.linea && lineas.includes(option.linea));
        }
        return true;
      });
    } else if (lineas.length > 0) {
      itemOptions = itemOptions.filter(
        (option) => option.linea && lineas.includes(option.linea),
      );
    }

    return {
      ...scopedFilterOptions,
      sublineas: sublineaOptions,
      items: itemOptions,
    };
  }, [scopedFilterOptions, lineas, sublineas]);

  const loadItemSearch = useCallback(
    async (query: string) => {
      const q = query.trim();
      setItemSearchQuery(query);
      if (!q) {
        setItemSearchOptions([]);
        setItemSearchLoading(false);
        return;
      }
      setItemSearchLoading(true);
      try {
        const params = new URLSearchParams(filterCatalogQueryBase);
        params.set("itemSearch", q);
        const response = await fetch(
          `/api/margenes/data?mode=filter-items&${params.toString()}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          setItemSearchOptions([]);
          return;
        }
        const data = (await response.json()) as { items?: FilterOption[] };
        setItemSearchOptions(data.items ?? []);
      } finally {
        setItemSearchLoading(false);
      }
    },
    [filterCatalogQueryBase],
  );

  const itemSelectOptions = useMemo(() => {
    const catalog = cascadedFilterOptions.items.map((option) => ({
      value: option.value,
      label: option.label,
      code: option.code ?? option.value,
    }));

    const mergeSelected = (
      list: Array<{ value: string; label: string; code: string }>,
    ) => {
      const merged = new Map(list.map((option) => [option.value, option]));
      for (const value of items) {
        if (merged.has(value)) continue;
        const fromCatalog = catalog.find((option) => option.value === value);
        if (fromCatalog) merged.set(value, fromCatalog);
      }
      return [...merged.values()];
    };

    if (!itemSearchQuery.trim()) {
      return mergeSelected(catalog);
    }

    const q = itemSearchQuery.trim().toLowerCase();
    const fromServer = itemSearchOptions.map((option) => ({
      value: option.value,
      label: option.label,
      code: option.code ?? option.value,
    }));

    if (fromServer.length > 0) {
      return mergeSelected(fromServer);
    }

    return mergeSelected(
      catalog.filter(
        (option) =>
          option.label.toLowerCase().includes(q) ||
          option.value.toLowerCase().includes(q) ||
          option.code.toLowerCase().includes(q),
      ),
    );
  }, [
    cascadedFilterOptions.items,
    itemSearchOptions,
    itemSearchQuery,
    items,
  ]);

  useEffect(() => {
    setItemSearchOptions([]);
  }, [filterCatalogQueryBase]);

  const handleLineasChange = useCallback(
    (next: string[]) => {
      setLineas(next);
      if (next.length === 0) return;

      const allowedSublineas = new Set(
        scopedFilterOptions.sublineas
          .filter((option) => option.linea && next.includes(option.linea))
          .map((option) => option.value),
      );
      setSublineas((current) => current.filter((value) => allowedSublineas.has(value)));

      const allowedItems = new Set(
        scopedFilterOptions.items
          .filter((option) => option.linea && next.includes(option.linea))
          .map((option) => option.value),
      );
      setItems((current) => current.filter((value) => allowedItems.has(value)));
    },
    [scopedFilterOptions.items, scopedFilterOptions.sublineas],
  );

  const handleSublineasChange = useCallback(
    (next: string[]) => {
      setSublineas(next);
      if (next.length === 0) return;

      const selectedSublineas = new Set(next);
      const allowedItems = new Set(
        scopedFilterOptions.items
          .filter((option) => {
            if (!option.sublinea || !selectedSublineas.has(option.sublinea)) {
              return false;
            }
            if (lineas.length > 0) {
              return Boolean(option.linea && lineas.includes(option.linea));
            }
            return true;
          })
          .map((option) => option.value),
      );
      setItems((current) => current.filter((value) => allowedItems.has(value)));
    },
    [lineas, scopedFilterOptions.items],
  );

  const loadFilters = useCallback(async () => {
    setFiltersLoading(true);
    try {
      const response = await fetch(`/api/margenes/data?mode=filters&${queryBase}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as MargenFiltersPayload;
      setFilterOptions(data);
    } finally {
      setFiltersLoading(false);
    }
  }, [queryBase]);

  const ensureFilters = useCallback(() => {
    if (filtersLoading) return;
    void loadFilters();
  }, [filtersLoading, loadFilters]);

  const loadBoard = useCallback(async () => {
    if (!dataCommitted || selectedSedes.length === 0) return;
    setLoading(true);
    setFilterOptions(null);
    setError(null);
    try {
      if (mode === "sede") {
        const sedeUrl = `/api/margenes/data?mode=sede&${queryBase}${orderParam ? `&${orderParam}` : ""}`;
        const response = await fetch(sedeUrl, {
          cache: "no-store",
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Error cargando sedes.");
        }
        const data = (await response.json()) as { kpi: MargenKpi; rows: DrillRow[] };
        setSedeKpi(data.kpi);
        setSedeRows(data.rows);
        setPayload(null);
        return;
      }

      let url = "";
      if (mode === "drill") {
        url = `/api/margenes/data?mode=drill&drillPath=${encodeURIComponent(JSON.stringify(drillPath))}&${queryBase}`;
        if (drillSearch.trim()) url += `&search=${encodeURIComponent(drillSearch.trim())}`;
      } else if (factTab === "nav") {
        url = `/api/margenes/data?mode=fact-nav&factPath=${encodeURIComponent(JSON.stringify(factPath))}&${queryBase}`;
        if (factSearch.trim()) url += `&search=${encodeURIComponent(factSearch.trim())}`;
      } else {
        url = `/api/margenes/data?mode=fact-list&factPath=${encodeURIComponent(JSON.stringify(factPath))}&${queryBase}`;
        if (factSearch.trim()) url += `&search=${encodeURIComponent(factSearch.trim())}`;
      }

      if (orderParam) url += `&${orderParam}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Error cargando datos.");
      }
      const data = (await response.json()) as TablePayload;
      setPayload(data);
      setSedeKpi(null);
      setSedeRows([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Error cargando datos.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [
    dataCommitted,
    selectedSedes,
    mode,
    factTab,
    drillPath,
    factPath,
    drillSearch,
    factSearch,
    queryBase,
    orderParam,
  ]);

  useEffect(() => {
    if (mode !== "drill") return;
    const level = drillPath.length;
    if (level >= 1 && level <= 4) {
      setSortKey("cod");
      setMgSortDir("asc");
    } else if (level === 0) {
      setSortKey(null);
      setMgSortDir("asc");
    }
  }, [mode, drillPath]);

  useEffect(() => {
    setPage(0);
  }, [mode, factTab, drillPath, factPath, drillSearch, factSearch, queryBase, sortKey, mgSortDir]);

  useEffect(() => {
    if (!dataCommitted) return;
    void loadBoard();
  }, [dataCommitted, loadBoard]);

  const kpi = mode === "sede" ? sedeKpi : payload?.kpi;

  const activeLevel = mode === "sede" ? -1 : (payload?.level ?? 0);

  const viewingInvoiceDetail =
    (mode === "fact" && factPath.some((step) => step.type === "factura")) ||
    (mode === "drill" && drillPath[drillPath.length - 1]?.type === "factura");

  const showSedeInFacturas = effectiveSedes.length > 1;

  const columns = useMemo(() => {
    if (mode === "sede") return colsForDrillLevel(-1);
    if (viewingInvoiceDetail) return colsForDrillLevel(6);
    const isFacturaList =
      (mode === "drill" && activeLevel === 5) ||
      (mode === "fact" && factTab === "nav" && activeLevel === 2) ||
      (mode === "fact" && factTab === "list");
    if (isFacturaList) {
      return colsForDrillLevel(5, {
        showSede: showSedeInFacturas,
        showFecha: mode === "fact" && factTab === "list",
      });
    }
    return colsForDrillLevel(activeLevel);
  }, [
    mode,
    activeLevel,
    factTab,
    viewingInvoiceDetail,
    showSedeInFacturas,
  ]);

  const rawRows = useMemo(
    () => (mode === "sede" ? sedeRows : (payload?.rows ?? [])),
    [mode, sedeRows, payload?.rows],
  );

  // El ACUMULADO va FIJO arriba: se saca de las filas, no lo tocan orden/paginacion/filtros.
  const acumRow = useMemo(() => rawRows.find((row) => row.isAcum) ?? null, [rawRows]);
  const dataRows = useMemo(() => rawRows.filter((row) => !row.isAcum), [rawRows]);

  // El orden por columnas-metrica lo hace el SERVIDOR (orderParam -> refetch, respeta el LIMIT).
  // Aqui solo ordenamos en cliente las columnas de dimension (no estan en SERVER_SORT_KEYS).
  const sortedRows = useMemo(() => {
    const rows = [...dataRows];
    if (sortKey && !SERVER_SORT_KEYS.has(sortKey)) {
      const col = columns.find((column) => column.key === sortKey);
      if (col?.sortValue) {
        const factor = mgSortDir === "desc" ? -1 : 1;
        rows.sort((a, b) => {
          const av = col.sortValue!(a);
          const bv = col.sortValue!(b);
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
          return (
            String(av).localeCompare(String(bv), "es", { numeric: true }) * factor
          );
        });
      }
    }
    return rows;
  }, [dataRows, sortKey, columns, mgSortDir]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const pageRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  const handleDrillRow = (row: DrillRow) => {
    if (!row.drillable) return;

    if (mode === "sede") {
      const extended = row as DrillRow & { empresa?: string; cod?: string };
      const key =
        extended.empresa && extended.cod
          ? sedeKey(extended.empresa, extended.cod)
          : null;
      if (key) onSedeDrill?.(key);
      setMode("drill");
      setDrillPath([]);
      return;
    }

    if (mode === "drill") {
      if (row.drillStep) {
        setDrillPath((current) => [...current, row.drillStep!]);
      }
      return;
    }

    if (factTab === "nav") {
      if (activeLevel === 0) {
        setFactPath([{ type: "fecha", fecha: row.cod, label: row.label }]);
      } else if (activeLevel === 1) {
        setFactPath((current) => [
          ...current,
          { type: "tipo", id: row.cod, label: row.label },
        ]);
      } else if (activeLevel === 2) {
        setFactPath((current) => [...current, buildFacturaNavStep(row)]);
      }
      return;
    }

    if (row.documento) {
      setFactPath([buildFacturaNavStep(row)]);
    }
  };

  const showSearch =
    dataCommitted &&
    ((mode === "drill" && (activeLevel === 4 || drillSearch.trim() !== "")) ||
      (mode === "fact" && !viewingInvoiceDetail));

  const showSortBar =
    dataCommitted &&
    (mode === "sede" ||
      activeLevel >= 5 ||
      mode === "fact" ||
      (mode === "drill" && drillSearch.trim() !== ""));

  const sortLabel =
    mode === "sede" ? "Ordenar por ventas:" : "Ordenar por margen:";

  if (!dataCommitted) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
        Elige una o más sedes en el modal para cargar el análisis de margen.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col md:min-h-0">
      {categoryScopeLocked ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
          Vista restringida a la categoría <span className="font-semibold">Asaderos</span>.
        </div>
      ) : null}
      <div className="flex shrink-0 flex-wrap items-end gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2">
        <MargenesMultiSelect
          label="Empresa"
          values={empresas}
          options={scopedFilterOptions.empresas}
          onChange={setEmpresas}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
        />
        <MargenesMultiSelect
          label="Sede"
          values={sedes}
          options={
            scopedFilterOptions.sedes.map((option) => ({
              value: option.value,
              label: option.label,
              code: option.idCo,
            }))
          }
          onChange={setSedes}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
        />
        <MargenesMultiSelect
          label="Fecha"
          values={fechas}
          options={scopedFilterOptions.fechas}
          onChange={setFechas}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
        />
        <MargenesMultiSelect
          label="Categoría"
          values={categorias}
          options={scopedFilterOptions.categorias}
          onChange={setCategorias}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
          disabled={categoryScopeLocked}
        />
        <MargenesMultiSelect
          label="Línea"
          values={lineas}
          options={cascadedFilterOptions.lineas}
          onChange={handleLineasChange}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
        />
        <MargenesMultiSelect
          label="Sublínea"
          values={sublineas}
          options={cascadedFilterOptions.sublineas}
          onChange={handleSublineasChange}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
        />
        <MargenesMultiSelect
          label="Ítem"
          values={items}
          options={itemSelectOptions}
          onChange={setItems}
          onOpen={ensureFilters}
          loading={filtersLoading && !filterOptions}
          searchLoading={itemSearchLoading}
          onDebouncedSearch={loadItemSearch}
          searchPlaceholder="Buscar por nombre o código…"
          codeBeforeLabel
        />
        <button
          type="button"
          onClick={resetFilters}
          className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-3 py-1.5 text-xs text-[#6b7590] hover:border-[#6b7590] hover:text-[#dde3f0]"
        >
          ↺ Limpiar
        </button>
      </div>

      <div className="flex shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4">
        {[
          { id: "drill" as const, label: "📦 Producto" },
          { id: "fact" as const, label: "📋 Por Factura" },
          { id: "sede" as const, label: "🏢 Por Sede" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setDrillPath([]);
              setFactPath([]);
            }}
            className={`border-b-2 px-4 py-2 text-xs font-semibold whitespace-nowrap ${
              mode === tab.id
                ? "border-[#4f8ef7] text-[#4f8ef7]"
                : "border-transparent text-[#6b7590] hover:text-[#dde3f0]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "fact" ? (
        <div className="flex shrink-0 border-b border-[#2a2f47] bg-[#1b1e2e] px-4">
          {[
            { id: "nav" as const, label: "📅 Fecha › Categoría › Facturas" },
            { id: "list" as const, label: "📃 Lista completa" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setFactTab(tab.id);
                setFactPath([]);
              }}
              className={`border-b-2 px-3.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${
                factTab === tab.id
                  ? "border-[#a78bfa] text-[#a78bfa]"
                  : "border-transparent text-[#6b7590] hover:text-[#dde3f0]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid shrink-0 grid-cols-2 border-b border-[#2a2f47] bg-[#141720] sm:flex sm:flex-nowrap">
        {[
          { label: "Ventas netas (miles)", value: kpi ? formatMiles(kpi.ventasNetas) : KPI_PLACEHOLDER, sub: kpi?.subFacturas, tone: "text-[#4f8ef7]" },
          { label: "Costo total (miles)", value: kpi ? formatMiles(kpi.costoTotal) : KPI_PLACEHOLDER, sub: kpi?.subCosto, tone: "text-[#dde3f0]" },
          { label: "Margen $ (miles)", value: kpi ? formatMiles(kpi.margenPesos) : KPI_PLACEHOLDER, sub: kpi?.subMargen, tone: marginToneClass(kpi?.margenPct ?? 0) },
          { label: "Margen %", value: kpi ? formatPercent(kpi.margenPct) : KPI_PLACEHOLDER, sub: kpi?.subPct, tone: marginToneClass(kpi?.margenPct ?? 0) },
        ].map((item, index) => (
          <div
            key={item.label}
            className={`px-3.5 py-2.5 sm:flex-1 ${
              index % 2 === 0 ? "border-r border-[#2a2f47]" : ""
            } ${index < 2 ? "border-b border-[#2a2f47] sm:border-b-0" : ""} ${
              index < 3 ? "sm:border-r sm:border-[#2a2f47]" : ""
            }`}
          >
            <div className="mb-0.5 text-[10px] tracking-wide text-[#6b7590] uppercase">
              {item.label}
            </div>
            <div className={`text-lg font-bold ${item.tone}`}>
              {loading && !kpi ? <Loader2 className="h-4 w-4 animate-spin" /> : item.value}
            </div>
            {item.sub ? <div className="mt-0.5 text-[10px] text-[#6b7590]">{item.sub}</div> : null}
          </div>
        ))}
      </div>

      {showSearch ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2f47] bg-[#1b1e2e] px-4 py-2">
          <span className="text-[11px] text-[#6b7590] whitespace-nowrap">
            {mode === "drill" ? "🔍 Buscar ítem:" : "🔍 Buscar factura:"}
          </span>
          <input
            value={mode === "drill" ? drillSearch : factSearch}
            onChange={(event) =>
              mode === "drill"
                ? setDrillSearch(event.target.value)
                : setFactSearch(event.target.value)
            }
            placeholder={
              mode === "drill" ? "Código o nombre de ítem…" : "Número de factura…"
            }
            className="min-w-0 flex-1 rounded-md border border-[#2a2f47] bg-[#232740] px-3 py-1.5 text-xs text-[#dde3f0] outline-none focus:border-[#4f8ef7]"
          />
          {(mode === "drill" ? drillSearch : factSearch) ? (
            <button
              type="button"
              className="rounded border border-[#2a2f47] px-2 py-1 text-[11px] text-[#6b7590] hover:text-[#dde3f0]"
              onClick={() => (mode === "drill" ? setDrillSearch("") : setFactSearch(""))}
            >
              ✕ Limpiar
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "drill" ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#2a2f47] bg-[#141720] px-4 py-1.5 text-xs">
          <button
            type="button"
            className="text-[#4f8ef7] hover:underline"
            onClick={() => setDrillPath([])}
          >
            Inicio
          </button>
          {drillPath.map((step, index) => (
            <span key={`${step.type}-${index}`} className="flex items-center gap-1">
              <span className="text-[#2a2f47]">›</span>
              <button
                type="button"
                className="text-[#4f8ef7] hover:underline"
                onClick={() => setDrillPath(drillPath.slice(0, index + 1))}
              >
                {formatStepLabel(step)}
              </button>
            </span>
          ))}
          <span className="ml-auto rounded-full border border-[#2a2f47] bg-[#232740] px-2 py-0.5 text-[10px] text-[#6b7590]">
            Nivel: {payload?.levelName ?? DRILL_LEVEL_NAMES[drillPath.length] ?? "—"}
          </span>
        </div>
      ) : null}

      {mode === "fact" && (factTab === "nav" || viewingInvoiceDetail) ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#2a2f47] bg-[#141720] px-4 py-1.5 text-xs">
          <button
            type="button"
            className="text-[#4f8ef7] hover:underline"
            onClick={() => setFactPath([])}
          >
            {factTab === "list" ? "Lista de facturas" : "Inicio"}
          </button>
          {factPath.map((step, index) => (
            <span key={`${step.type}-${index}`} className="flex items-center gap-1">
              <span className="text-[#2a2f47]">›</span>
              <button
                type="button"
                className="text-[#4f8ef7] hover:underline"
                onClick={() => setFactPath(factPath.slice(0, index + 1))}
              >
                {formatStepLabel(step)}
              </button>
            </span>
          ))}
          <span className="ml-auto rounded-full border border-[#2a2f47] bg-[#232740] px-2 py-0.5 text-[10px] text-[#6b7590]">
            Nivel: {payload?.levelName ?? "Fecha"}
          </span>
        </div>
      ) : null}

      {showSortBar ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2f47] bg-[#141720] px-4 py-1.5">
          <span className="text-[11px] text-[#6b7590]">{sortLabel}</span>
          <div className="flex overflow-hidden rounded-md border border-[#2a2f47]">
            <button
              type="button"
              onClick={() => {
                setMgSortDir("desc");
                setSortKey(null);
              }}
              className={`px-3 py-1 text-[11px] font-semibold ${mgSortDir === "desc" && !sortKey ? "bg-[#4f8ef7] text-white" : "text-[#6b7590] hover:bg-[#232740]"}`}
            >
              ↓ Mayor primero
            </button>
            <button
              type="button"
              onClick={() => {
                setMgSortDir("asc");
                setSortKey(null);
              }}
              className={`px-3 py-1 text-[11px] font-semibold ${mgSortDir === "asc" && !sortKey ? "bg-[#4f8ef7] text-white" : "text-[#6b7590] hover:bg-[#232740]"}`}
            >
              ↑ Menor primero
            </button>
          </div>
          {drillPath.length > 0 && mode === "drill" && activeLevel >= 5 ? (
            <button
              type="button"
              className="ml-auto rounded border border-[#2a2f47] px-2.5 py-1 text-[11px] text-[#4f8ef7] hover:bg-[#4f8ef7]/10"
              onClick={() => setDrillPath(drillPath.slice(0, -1))}
            >
              ← Atrás
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 text-xs text-[#f87171]">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto md:min-h-0 md:flex-1 md:overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#1b1e2e] text-[#6b7590]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`cursor-pointer px-2.5 py-2 text-[10px] font-semibold tracking-wide uppercase select-none hover:text-[#dde3f0] ${column.align === "right" ? "text-right" : ""}`}
                  onClick={() => {
                    setSortKey(column.key);
                    setMgSortDir((current) => (sortKey === column.key && current === "desc" ? "asc" : "desc"));
                  }}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {column.label}
                    {sortKey === column.key ? (
                      <span className="text-[#4f8ef7]">{mgSortDir === "desc" ? "↓" : "↑"}</span>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-[#6b7590]">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#4f8ef7]" />
                </td>
              </tr>
            ) : null}
            {!loading && pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-[#6b7590]">
                  Sin filas para el rango y filtros seleccionados.
                </td>
              </tr>
            ) : null}
            {!loading && acumRow ? (
              <tr
                key="acum-fijo"
                className="cursor-pointer border-t border-[#4f8ef7]/30 bg-[#232740] font-semibold hover:bg-[#2a3050]"
                onClick={() => handleDrillRow(acumRow)}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-2.5 py-1.5 ${column.align === "right" ? "text-right" : ""} ${column.drill ? "text-[#dde3f0] after:ml-0.5 after:opacity-40 after:content-['›']" : ""}`}
                  >
                    {column.render ? column.render(acumRow) : null}
                  </td>
                ))}
              </tr>
            ) : null}
            {pageRows.map((row) => (
              <tr
                key={row.key}
                className={`border-t border-[#2a2f47]/70 ${row.drillable ? "cursor-pointer hover:bg-[#4f8ef7]/5" : ""}`}
                onClick={() => handleDrillRow(row)}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-2.5 py-1.5 ${column.align === "right" ? "text-right" : ""} ${column.drill ? "text-[#dde3f0] after:ml-0.5 after:opacity-40 after:content-['›']" : ""}`}
                  >
                    {column.render ? column.render(row) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[#2a2f47] bg-[#141720] px-4 py-1.5 text-xs">
        <span className="text-[#6b7590]">
          {sortedRows.length === 0
            ? "0 filas"
            : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, sortedRows.length)} de ${sortedRows.length}`}
        </span>
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          className="rounded border border-[#2a2f47] px-2.5 py-1 disabled:opacity-30"
        >
          ‹ Ant.
        </button>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          className="rounded border border-[#2a2f47] px-2.5 py-1 disabled:opacity-30"
        >
          Sig. ›
        </button>
        <select
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(0);
          }}
          className="ml-auto rounded border border-[#2a2f47] bg-[#1b1e2e] px-2 py-1 text-xs text-[#dde3f0]"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}/pág
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
