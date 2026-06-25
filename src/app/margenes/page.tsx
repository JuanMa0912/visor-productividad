"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2, RefreshCcw } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { PortalTourHelpButton } from "@/components/portal/portal-tour-help-button";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { formatMiles, formatPercent, formatPesos } from "@/lib/margenes/format";
import { compactDateToIso, parseSedeKey } from "@/lib/margenes/margen-final-query";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { TUTORIAL_LOCAL_STORAGE_KEYS, TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import { MARGENES_TOUR_ANCHOR } from "@/lib/ui/portal-tours/margenes-tour-anchors";
import { MARGENES_TOUR_STEPS } from "@/lib/ui/portal-tours/margenes-tour-steps";
import {
  MargenesSedePickerModal,
  type MargenSedePickerOption,
} from "@/app/margenes/margenes-sede-picker-modal";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

type MargenMeta = {
  ready: boolean;
  table: string;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
  sedeCount: number;
  message?: string | null;
  error?: string;
};

type FilterOption = { value: string; label: string };

type MargenFiltersPayload = {
  empresas: FilterOption[];
  sedes: Array<FilterOption & { empresa: string; idCo: string }>;
  fechas: FilterOption[];
  categorias: FilterOption[];
  lineas: FilterOption[];
  sublineas: FilterOption[];
  items: FilterOption[];
};

type MargenSummary = {
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
  rowCount: number;
};

type MargenTab = "producto" | "factura" | "sede";

type ProductoRow = {
  idItem: string;
  descripcion: string;
  linea: string;
  cantidad: number;
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
};

type FacturaRow = {
  documento: string;
  tipdoc: string;
  fecha: string;
  sede: string;
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
};

type SedeRow = {
  sede: string;
  lineas: number;
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
};

const KPI_PLACEHOLDER = "—";

const buildQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
};

const FilterSelect = ({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) => (
  <div className="flex min-w-[105px] flex-col gap-0.5">
    <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#dde3f0] disabled:opacity-50"
    >
      <option value="">Todos</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

export default function MargenesPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { hasSection, hasSubsection } = usePermissions();
  const boardReady = status === "authenticated" && Boolean(user);

  const [meta, setMeta] = useState<MargenMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [anchorsReady, setAnchorsReady] = useState(false);

  const [filterOptions, setFilterOptions] = useState<MargenFiltersPayload | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [sede, setSede] = useState("");
  const [categoria, setCategoria] = useState("");
  const [linea, setLinea] = useState("");
  const [sublinea, setSublinea] = useState("");
  const [item, setItem] = useState("");
  const [activeTab, setActiveTab] = useState<MargenTab>("producto");

  const [summary, setSummary] = useState<MargenSummary | null>(null);
  const [productoRows, setProductoRows] = useState<ProductoRow[]>([]);
  const [facturaRows, setFacturaRows] = useState<FacturaRow[]>([]);
  const [sedeRows, setSedeRows] = useState<SedeRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataCommitted, setDataCommitted] = useState(false);
  const [sedePickerOpen, setSedePickerOpen] = useState(false);
  const [pendingSede, setPendingSede] = useState("");
  const [catalogSedes, setCatalogSedes] = useState<MargenSedePickerOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const { startTour: startMargenesTour } = useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.margenes,
    stateKey: TUTORIAL_STATE_KEYS.margenes,
    steps: MARGENES_TOUR_STEPS,
    theme: "producto",
    userId: user?.id,
    ready: boardReady,
    contentReady: anchorsReady && dataCommitted,
  });

  useEffect(() => {
    if (!boardReady) return;
    if (!hasSection("producto") || !hasSubsection("margenes")) {
      router.replace("/secciones");
    }
  }, [boardReady, hasSection, hasSubsection, router]);

  useEffect(() => {
    if (!boardReady) return;

    let cancelled = false;
    const load = async () => {
      setLoadingMeta(true);
      try {
        const response = await fetch("/api/margenes/meta", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as MargenMeta;
        if (!cancelled) {
          setMeta(payload);
          if (payload.minDate && payload.maxDate) {
            const from = compactDateToIso(payload.minDate);
            const to = compactDateToIso(payload.maxDate);
            if (from) setDateStart(from);
            if (to) setDateEnd(to);
          }
          if (payload.ready) {
            setSedePickerOpen(true);
          }
        }
      } catch {
        if (!cancelled) {
          setMeta({
            ready: false,
            table: "margen_final",
            rowCount: 0,
            minDate: null,
            maxDate: null,
            sedeCount: 0,
            error: "No se pudo consultar el estado de la tabla.",
          });
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [boardReady, router]);

  const queryBase = useMemo(
    () =>
      buildQuery({
        from: dateStart,
        to: dateEnd,
        empresa: empresa || undefined,
        sede: sede || undefined,
        categoria: categoria || undefined,
        linea: linea || undefined,
        sublinea: sublinea || undefined,
        item: item || undefined,
      }),
    [dateStart, dateEnd, empresa, sede, categoria, linea, sublinea, item],
  );

  const loadSedeCatalog = useCallback(async () => {
    if (!dateStart || !dateEnd || !meta?.ready) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const query = buildQuery({ from: dateStart, to: dateEnd });
      const response = await fetch(`/api/margenes/data?mode=sedes&${query}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "No se pudo listar las sedes.");
      }
      const payload = (await response.json()) as { sedes: MargenSedePickerOption[] };
      setCatalogSedes(payload.sedes);
      if (
        pendingSede &&
        !payload.sedes.some((option) => option.value === pendingSede)
      ) {
        setPendingSede("");
      }
    } catch (error) {
      setCatalogSedes([]);
      setCatalogError(
        error instanceof Error ? error.message : "No se pudo listar las sedes.",
      );
    } finally {
      setLoadingCatalog(false);
    }
  }, [dateStart, dateEnd, meta?.ready, pendingSede, router]);

  useEffect(() => {
    if (!sedePickerOpen || !meta?.ready || !dateStart || !dateEnd) return;
    void loadSedeCatalog();
  }, [sedePickerOpen, meta?.ready, dateStart, dateEnd, loadSedeCatalog]);

  const openSedePicker = useCallback(() => {
    setDataCommitted(false);
    setSummary(null);
    setProductoRows([]);
    setFacturaRows([]);
    setSedeRows([]);
    setFilterOptions(null);
    setDataError(null);
    setPendingSede(sede);
    setSedePickerOpen(true);
  }, [sede]);

  const confirmSedeSelection = useCallback(() => {
    if (!pendingSede) return;
    const parsed = parseSedeKey(pendingSede);
    if (!parsed) return;
    setSede(pendingSede);
    setEmpresa(parsed.empresa);
    setCategoria("");
    setLinea("");
    setSublinea("");
    setItem("");
    setDataCommitted(true);
    setSedePickerOpen(false);
  }, [pendingSede]);

  const loadData = useCallback(async () => {
    if (!dateStart || !dateEnd || !meta?.ready || !sede || !dataCommitted) return;
    setLoadingData(true);
    setDataError(null);
    try {
      const [filtersRes, summaryRes, productoRes, facturaRes, sedeRes] =
        await Promise.all([
          fetch(`/api/margenes/data?mode=filters&${queryBase}`, { cache: "no-store" }),
          fetch(`/api/margenes/data?mode=summary&${queryBase}`, { cache: "no-store" }),
          fetch(`/api/margenes/data?mode=producto&${queryBase}`, { cache: "no-store" }),
          fetch(`/api/margenes/data?mode=factura&${queryBase}`, { cache: "no-store" }),
          fetch(`/api/margenes/data?mode=sede&${queryBase}`, { cache: "no-store" }),
        ]);

      if (
        [filtersRes, summaryRes, productoRes, facturaRes, sedeRes].some(
          (response) => response.status === 401,
        )
      ) {
        router.replace("/login");
        return;
      }

      const failed = [filtersRes, summaryRes, productoRes, facturaRes, sedeRes].find(
        (response) => !response.ok,
      );
      if (failed) {
        const body = (await failed.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Error cargando datos de margen.");
      }

      const [filtersPayload, summaryPayload, productoPayload, facturaPayload, sedePayload] =
        await Promise.all([
          filtersRes.json() as Promise<MargenFiltersPayload>,
          summaryRes.json() as Promise<MargenSummary>,
          productoRes.json() as Promise<{ rows: ProductoRow[] }>,
          facturaRes.json() as Promise<{ rows: FacturaRow[] }>,
          sedeRes.json() as Promise<{ rows: SedeRow[] }>,
        ]);

      setFilterOptions(filtersPayload);
      setSummary(summaryPayload);
      setProductoRows(productoPayload.rows);
      setFacturaRows(facturaPayload.rows);
      setSedeRows(sedePayload.rows);
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : "No se pudieron cargar los datos.",
      );
      setSummary(null);
      setProductoRows([]);
      setFacturaRows([]);
      setSedeRows([]);
    } finally {
      setLoadingData(false);
    }
  }, [dateStart, dateEnd, meta?.ready, dataCommitted, sede, queryBase, router]);

  useEffect(() => {
    if (!boardReady || !meta?.ready || !dataCommitted || !sede || !dateStart || !dateEnd) {
      return;
    }
    void loadData();
  }, [boardReady, meta?.ready, dataCommitted, sede, dateStart, dateEnd, queryBase, loadData]);

  useLayoutEffect(() => {
    if (!boardReady) {
      setAnchorsReady(false);
      return;
    }
    setAnchorsReady(Boolean(document.getElementById(MARGENES_TOUR_ANCHOR.intro)));
  }, [boardReady, loadingMeta, loadingData, dataCommitted]);

  const rangeLabel =
    dateStart && dateEnd ? `${dateStart} → ${dateEnd}` : "Sin rango cargado";

  const selectedSedeLabel = useMemo(() => {
    if (!sede) return null;
    const fromCatalog = catalogSedes.find((option) => option.value === sede);
    if (fromCatalog) return fromCatalog.label;
    const fromFilters = filterOptions?.sedes.find((option) => option.value === sede);
    return fromFilters?.label ?? sede;
  }, [sede, catalogSedes, filterOptions?.sedes]);

  const sedeOptions = useMemo(() => {
    if (!filterOptions) return [];
    if (!empresa) return filterOptions.sedes;
    return filterOptions.sedes.filter((option) => option.empresa === empresa);
  }, [filterOptions, empresa]);

  const activeRows =
    activeTab === "producto"
      ? productoRows
      : activeTab === "factura"
        ? facturaRows
        : sedeRows;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0f18] text-[#dde3f0]">
      <AppTopBar
        backHref="/productividad"
        backLabel="Volver a productividad"
        onTourHelp={startMargenesTour}
      />
      {!boardReady ? (
        <div className="flex flex-1 items-center justify-center bg-[#0d0f18] text-[#dde3f0]">
          <Loader2 className="h-6 w-6 animate-spin text-[#4f8ef7]" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d0f18] text-[13px] text-[#dde3f0]">
          <header
            id={MARGENES_TOUR_ANCHOR.intro}
            className="flex shrink-0 items-center gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2.5"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-[#4f8ef7] to-[#a78bfa]">
              <BarChart3 className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-sm font-bold">Análisis de Margen</h1>
            <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
              margen_final · dark
            </span>
            <button
              type="button"
              onClick={openSedePicker}
              disabled={!meta?.ready || loadingData}
              className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-3 py-1.5 text-xs text-[#dde3f0] hover:border-[#4f8ef7]/60 disabled:opacity-50"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loadingData ? "animate-spin" : ""}`} />
              Cambiar selección
            </button>
            {selectedSedeLabel ? (
              <span className="rounded-full border border-[#4f8ef7]/40 bg-[#4f8ef7]/10 px-2.5 py-0.5 text-[11px] text-[#4f8ef7]">
                {selectedSedeLabel}
              </span>
            ) : null}
            <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
              {rangeLabel}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <PortalTourHelpButton
                onClick={startMargenesTour}
                className="border-[#2a2f47] bg-[#1b1e2e]/90 text-[#dde3f0] hover:border-[#4f8ef7]/60 hover:bg-[#232740] hover:text-[#dde3f0]"
              />
              <span className="whitespace-nowrap text-[11px] text-[#6b7590]">
                {loadingMeta
                  ? "Consultando tabla…"
                  : meta?.ready
                    ? `${meta.rowCount.toLocaleString("es-CO")} filas · ${meta.sedeCount} sede(s)`
                    : "Pendiente ETL"}
              </span>
            </span>
          </header>

          <div
            id={MARGENES_TOUR_ANCHOR.filters}
            className={`flex shrink-0 flex-wrap items-end gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 ${!dataCommitted ? "pointer-events-none opacity-50" : ""}`}
          >
            <div className="flex min-w-[120px] flex-col gap-0.5">
              <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">Desde</span>
              <input
                type="date"
                value={dateStart}
                min={compactDateToIso(meta?.minDate ?? "") ?? undefined}
                max={dateEnd || compactDateToIso(meta?.maxDate ?? "") || undefined}
                onChange={(event) => setDateStart(event.target.value)}
                className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#dde3f0]"
              />
            </div>
            <div className="flex min-w-[120px] flex-col gap-0.5">
              <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">Hasta</span>
              <input
                type="date"
                value={dateEnd}
                min={dateStart || compactDateToIso(meta?.minDate ?? "") || undefined}
                max={compactDateToIso(meta?.maxDate ?? "") ?? undefined}
                onChange={(event) => setDateEnd(event.target.value)}
                className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#dde3f0]"
              />
            </div>
            <FilterSelect
              label="Empresa"
              value={empresa}
              options={filterOptions?.empresas ?? []}
              onChange={(value) => {
                setEmpresa(value);
                setSede("");
              }}
              disabled={!meta?.ready || dataCommitted}
            />
            <FilterSelect
              label="Sede"
              value={sede}
              options={sedeOptions}
              onChange={setSede}
              disabled={!meta?.ready || dataCommitted}
            />
            <FilterSelect
              label="Categoría"
              value={categoria}
              options={filterOptions?.categorias ?? []}
              onChange={setCategoria}
              disabled={!meta?.ready || !dataCommitted}
            />
            <FilterSelect
              label="Línea"
              value={linea}
              options={filterOptions?.lineas ?? []}
              onChange={setLinea}
              disabled={!meta?.ready || !dataCommitted}
            />
            <FilterSelect
              label="Sublínea"
              value={sublinea}
              options={filterOptions?.sublineas ?? []}
              onChange={setSublinea}
              disabled={!meta?.ready || !dataCommitted}
            />
            <FilterSelect
              label="Ítem"
              value={item}
              options={filterOptions?.items ?? []}
              onChange={setItem}
              disabled={!meta?.ready || !dataCommitted}
            />
          </div>

          <div
            id={MARGENES_TOUR_ANCHOR.tabs}
            className="flex shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4"
          >
            {[
              { id: "producto" as const, label: "📦 Producto" },
              { id: "factura" as const, label: "📋 Por Factura" },
              { id: "sede" as const, label: "🏢 Por Sede" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-4 py-2 text-xs font-semibold whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-[#4f8ef7] text-[#4f8ef7]"
                    : "border-transparent text-[#6b7590] hover:text-[#dde3f0]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            id={MARGENES_TOUR_ANCHOR.kpi}
            className="flex shrink-0 border-b border-[#2a2f47] bg-[#141720]"
          >
            {[
              {
                label: "Ventas netas (miles)",
                value: summary ? formatMiles(summary.ventasNetas) : KPI_PLACEHOLDER,
                valueClass: "text-[#4f8ef7]",
              },
              {
                label: "Costo total (miles)",
                value: summary ? formatMiles(summary.costoTotal) : KPI_PLACEHOLDER,
                valueClass: "text-[#dde3f0]",
              },
              {
                label: "Margen $ (miles)",
                value: summary ? formatMiles(summary.margenPesos) : KPI_PLACEHOLDER,
                valueClass: "text-[#dde3f0]",
              },
              {
                label: "Margen %",
                value: summary ? formatPercent(summary.margenPct) : KPI_PLACEHOLDER,
                valueClass: "text-[#34d399]",
              },
            ].map((kpi, index, arr) => (
              <div
                key={kpi.label}
                className={`flex-1 px-3.5 py-2.5 ${index < arr.length - 1 ? "border-r border-[#2a2f47]" : ""}`}
              >
                <div className="mb-0.5 text-[10px] tracking-wide text-[#6b7590] uppercase">
                  {kpi.label}
                </div>
                <div className={`text-lg font-bold ${kpi.valueClass}`}>
                  {loadingData && !summary ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    kpi.value
                  )}
                </div>
              </div>
            ))}
          </div>

          <main
            id={MARGENES_TOUR_ANCHOR.main}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {meta?.message ? (
              <p className="shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 text-xs text-[#fbbf24]">
                {meta.message}
              </p>
            ) : null}
            {dataError ? (
              <p className="shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 text-xs text-[#f87171]">
                {dataError}
              </p>
            ) : null}
            {!meta?.ready ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
                Tabla margen_final sin datos. Aplica la migración y carga el CSV/ETL.
              </div>
            ) : !dataCommitted ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
                Elige una sede en el modal para cargar el análisis de margen.
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#1b1e2e] text-[#6b7590]">
                    {activeTab === "producto" ? (
                      <tr>
                        <th className="px-3 py-2 font-semibold">Ítem</th>
                        <th className="px-3 py-2 font-semibold">Descripción</th>
                        <th className="px-3 py-2 font-semibold">Línea</th>
                        <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                        <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                        <th className="px-3 py-2 text-right font-semibold">Costo</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen $</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen %</th>
                      </tr>
                    ) : null}
                    {activeTab === "factura" ? (
                      <tr>
                        <th className="px-3 py-2 font-semibold">Documento</th>
                        <th className="px-3 py-2 font-semibold">Tipo</th>
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Sede</th>
                        <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                        <th className="px-3 py-2 text-right font-semibold">Costo</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen $</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen %</th>
                      </tr>
                    ) : null}
                    {activeTab === "sede" ? (
                      <tr>
                        <th className="px-3 py-2 font-semibold">Sede</th>
                        <th className="px-3 py-2 text-right font-semibold">Líneas</th>
                        <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                        <th className="px-3 py-2 text-right font-semibold">Costo</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen $</th>
                        <th className="px-3 py-2 text-right font-semibold">Margen %</th>
                      </tr>
                    ) : null}
                  </thead>
                  <tbody>
                    {loadingData && activeRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-[#6b7590]">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-[#4f8ef7]" />
                        </td>
                      </tr>
                    ) : null}
                    {!loadingData && activeRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-[#6b7590]">
                          Sin filas para el rango y filtros seleccionados.
                        </td>
                      </tr>
                    ) : null}
                    {activeTab === "producto"
                      ? productoRows.map((row) => (
                          <tr
                            key={`${row.idItem}-${row.descripcion}`}
                            className="border-t border-[#2a2f47] hover:bg-[#141720]"
                          >
                            <td className="px-3 py-2 font-mono">{row.idItem}</td>
                            <td className="px-3 py-2">{row.descripcion}</td>
                            <td className="px-3 py-2">{row.linea}</td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.cantidad)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.ventasNetas)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.costoTotal)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.margenPesos)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPercent(row.margenPct)}
                            </td>
                          </tr>
                        ))
                      : null}
                    {activeTab === "factura"
                      ? facturaRows.map((row) => (
                          <tr
                            key={`${row.documento}-${row.tipdoc}-${row.fecha}`}
                            className="border-t border-[#2a2f47] hover:bg-[#141720]"
                          >
                            <td className="px-3 py-2 font-mono">{row.documento}</td>
                            <td className="px-3 py-2">{row.tipdoc}</td>
                            <td className="px-3 py-2">{row.fecha}</td>
                            <td className="px-3 py-2">{row.sede}</td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.ventasNetas)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.costoTotal)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.margenPesos)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPercent(row.margenPct)}
                            </td>
                          </tr>
                        ))
                      : null}
                    {activeTab === "sede"
                      ? sedeRows.map((row) => (
                          <tr
                            key={row.sede}
                            className="border-t border-[#2a2f47] hover:bg-[#141720]"
                          >
                            <td className="px-3 py-2">{row.sede}</td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.lineas)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.ventasNetas)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.costoTotal)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPesos(row.margenPesos)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatPercent(row.margenPct)}
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        </div>
      )}
      <MargenesSedePickerModal
        open={Boolean(meta?.ready && sedePickerOpen)}
        rangeLabel={rangeLabel}
        sedes={catalogSedes}
        selectedSede={pendingSede}
        loading={loadingCatalog}
        error={catalogError}
        onSelect={setPendingSede}
        onConfirm={confirmSedeSelection}
      />
    </div>
  );
}
