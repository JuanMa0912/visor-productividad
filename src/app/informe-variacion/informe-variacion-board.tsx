"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import {
  aggregateBySede,
  aggregateMarginBySede,
  aggregateVentasBySede,
  compileInformeRowFilter,
  hasActiveInformeFilters,
  sumFilteredRows,
  type PeriodTriple,
  type prepareInformeData,
} from "@/lib/informe-variacion/aggregate";
import { usePreparedInformeData } from "@/lib/informe-variacion/use-prepared-informe-data";
import { getUnfilteredBoardWarm } from "@/lib/informe-variacion/board-warm-cache";
import { formatInformeValue, comparePeriodTriple, formatMargenPct } from "@/lib/informe-variacion/format";
import {
  buildSedeSummaryExportRows,
  sedeSummaryExportFilename,
} from "@/lib/informe-variacion/export-sede-summary";
import { downloadInformeSedeSummaryExcel } from "@/lib/informe-variacion/export-sede-summary-excel";
import { matrixExportFilename } from "@/lib/informe-variacion/export-matrix";
import { downloadInformeMatrixExcel } from "@/lib/informe-variacion/export-matrix-excel";
import { downloadInformeMatrixPdf } from "@/lib/informe-variacion/export-matrix-pdf";
import { logExportDownload } from "@/lib/client/log-export-download";
import {
  EMPTY_INFORME_FILTERS,
  INFORME_EMPRESA_ORDER,
  type InformeGlobalFilters,
  type InformeMetric,
  type InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import { cn } from "@/lib/shared/utils";
import { VariationChip } from "@/app/informe-variacion/informe-variacion-chips";
import { MatrixTable } from "@/app/informe-variacion/informe-variacion-matrix";
import { InformeEmpresaSummaryCards, InformeRankingTable } from "@/app/informe-variacion/informe-variacion-ranking";
import { DiMultiSelect } from "@/app/analisis-de-inventario/di-multi-select";
import type {
  InformeRankingDimension,
  InformeRankingSort,
} from "@/lib/informe-variacion/ranking";

type Prepared = ReturnType<typeof prepareInformeData>;

type InformeBoardTab = "resumen" | "ranking" | "matriz";

const BOARD_TABS: Array<{ id: InformeBoardTab; label: string }> = [
  { id: "resumen", label: "Empresa y sede" },
  { id: "ranking", label: "Ranking" },
  { id: "matriz", label: "Matriz" },
];

type Props = {
  payload: InformeVariacionPayload;
  dataPending?: boolean;
  categoryScopeLocked?: boolean;
  lineScopeLocked?: boolean;
};

const EMP_DOT_CLASS: Record<string, string> = {
  Comercializadora: "bg-blue-600",
  Mercamio: "bg-amber-600",
  Merkmios: "bg-violet-600",
};

export function InformeVariacionBoard(props: Props) {
  const prepared = usePreparedInformeData(props.payload);
  return <InformeVariacionBoardReady {...props} prepared={prepared} />;
}

function InformeVariacionBoardReady({
  payload,
  prepared,
  dataPending = false,
  categoryScopeLocked = false,
  lineScopeLocked = false,
}: Props & { prepared: Prepared }) {
  const [kpiMetric, setKpiMetric] = useState<InformeMetric>("v");
  const [sedeMetric, setSedeMetric] = useState<InformeMetric>("v");
  const [matrixMetric, setMatrixMetric] = useState<InformeMetric>("v");
  const [rankingMetric, setRankingMetric] = useState<InformeMetric>("v");
  const [rankingDimension, setRankingDimension] =
    useState<InformeRankingDimension>("item");
  const [rankingSort, setRankingSort] = useState<InformeRankingSort>("cur");
  const rankingMode = "mom" as const;
  const [filters, setFilters] = useState<InformeGlobalFilters>(EMPTY_INFORME_FILTERS);
  const deferredFilters = useDeferredValue(filters);
  const matrixMode = "mom" as const;
  const [matrixDisplay, setMatrixDisplay] = useState<"pct" | "value">("pct");
  const [matrixDepth, setMatrixDepth] = useState<"cat" | "lin">("cat");
  const [matrixOpen, setMatrixOpen] = useState<Set<string>>(() => new Set());
  const [sedeSort, setSedeSort] = useState({ col: "name", dir: 1 });
  const [matrixSort, setMatrixSort] = useState({ col: -1, dir: 1 });
  const [boardTab, setBoardTab] = useState<InformeBoardTab>("resumen");

  const filtersPending =
    deferredFilters !== filters && hasActiveInformeFilters(filters);

  const pass = useMemo(
    () =>
      compileInformeRowFilter(
        deferredFilters,
        prepared.sedeEmpresas,
        prepared.itemsLow,
        prepared.itemProv,
      ),
    [deferredFilters, prepared],
  );

  const handleMatrixMetricChange = useCallback((value: InformeMetric) => {
    // Sync: el click debe pintar el toggle al instante. La matriz usa caché dual
    // (u/v); si la otra metrica ya esta caliente, el cambio es barato.
    setMatrixMetric(value);
  }, []);

  const filtersActive = hasActiveInformeFilters(deferredFilters);
  const boardWarm = !filtersActive
    ? getUnfilteredBoardWarm(prepared.rows)
    : undefined;

  const filteredTag = filtersActive ? (
    <span className="text-blue-600"> (filtrado)</span>
  ) : null;

  const kpiTotals = useMemo(() => {
    if (boardWarm) return boardWarm.kpi[kpiMetric];
    return sumFilteredRows(prepared.rows, kpiMetric, pass, prepared.metricCtx);
  }, [boardWarm, kpiMetric, pass, prepared.metricCtx, prepared.rows]);

  const growthSedes = useMemo(() => {
    if (boardWarm) return boardWarm.growthSedes[kpiMetric];
    const perSede = aggregateBySede(
      prepared.rows,
      kpiMetric,
      prepared.sedes.length,
      pass,
      prepared.metricCtx,
    );
    let count = 0;
    perSede.forEach((values) => {
      if (values[1] > 0 && values[0] > values[1]) count += 1;
    });
    return count;
  }, [boardWarm, kpiMetric, pass, prepared.metricCtx, prepared.rows, prepared.sedes.length]);

  const updateFilter = (patch: Partial<InformeGlobalFilters>) => {
    startTransition(() => {
      setFilters((current) => ({ ...current, ...patch }));
      setMatrixSort({ col: -1, dir: 1 });
    });
  };

  const clearFilters = () => {
    startTransition(() => {
      setFilters(EMPTY_INFORME_FILTERS);
      setMatrixSort({ col: -1, dir: 1 });
    });
  };

  /**
   * Alias de `payload.periods.current` con un nombre que NO termina en `current`.
   *
   * El React Compiler trata cualquier acceso `.current` con su heuristica de refs. Como
   * este es un objeto de datos normal (label/from/to), sus dependencias inferidas
   * (`...current.to`) no cuadraban con las declaradas a mano (`...periods.current`) y
   * abortaba la optimizacion del componente ENTERO con
   * "Differences in ref.current access". Leyendo por el alias desaparece el problema.
   */
  const periodoActual = payload.periods.current;

  const curLabel = "Actual";
  const momLabel = "Anterior";
  const yoyLabel = momLabel;

  const matrixSortKeys = (
    keys: number[],
    agg: Map<number, PeriodTriple[]>,
    labels: string[],
  ) => {
    if (matrixSort.col < 0) {
      const sorted = [...keys].sort((a, b) => labels[a].localeCompare(labels[b], "es"));
      if (matrixSort.dir < 0) sorted.reverse();
      return sorted;
    }
    const val = (key: number) => {
      const per = agg.get(key);
      const values = per?.[matrixSort.col];
      if (!values) return matrixSort.dir > 0 ? -Infinity : Infinity;
      if (matrixDisplay === "value") return values[0];
      const base = values[1];
      return base > 0 ? values[0] / base - 1 : values[0] > 0 ? Infinity : -Infinity;
    };
    return [...keys].sort((a, b) => (val(b) - val(a)) * matrixSort.dir);
  };

  const exportSedeSummary = useCallback(async () => {
    const rows = buildSedeSummaryExportRows(prepared, sedeMetric, pass);
    const filename = sedeSummaryExportFilename(
      periodoActual.label,
      sedeMetric,
    );
    await downloadInformeSedeSummaryExcel({
      rows,
      metric: sedeMetric,
      periodLabel: periodoActual.label,
      yoyLabel,
      momLabel,
      filename,
    });
    logExportDownload({
      panelPath: "/informe-variacion",
      exportKind: "informe-sede-summary",
      format: "xlsx",
      fileName: filename,
      dateFrom: periodoActual.from,
      dateTo: periodoActual.to,
      filters: { metric: sedeMetric },
      rowCount: rows.length,
    });
  }, [momLabel, pass, prepared, periodoActual, sedeMetric, yoyLabel]);

  const matrixExportOptions = useMemo(
    () => ({
      payload: prepared,
      metric: matrixMetric,
      pass,
      matrixMode,
      matrixDisplay,
      matrixOpen,
      matrixSort,
      periodLabel: periodoActual.label,
    }),
    [
      matrixDisplay,
      matrixMetric,
      matrixMode,
      matrixOpen,
      matrixSort,
      pass,
      prepared,
      periodoActual.label,
    ],
  );

  const exportMatrixExcel = useCallback(async () => {
    const filename = matrixExportFilename(
      periodoActual.label,
      matrixMetric,
      matrixMode,
      matrixDisplay,
      "xlsx",
    );
    await downloadInformeMatrixExcel({
      ...matrixExportOptions,
      filename,
    });
    logExportDownload({
      panelPath: "/informe-variacion",
      exportKind: "informe-matriz",
      format: "xlsx",
      fileName: filename,
      dateFrom: periodoActual.from,
      dateTo: periodoActual.to,
      filters: { metric: matrixMetric, mode: matrixMode, display: matrixDisplay },
    });
  }, [
    matrixDisplay,
    matrixExportOptions,
    matrixMetric,
    matrixMode,
    periodoActual,
  ]);

  const exportMatrixPdf = useCallback(() => {
    const filename = matrixExportFilename(
      periodoActual.label,
      matrixMetric,
      matrixMode,
      matrixDisplay,
      "pdf",
    );
    downloadInformeMatrixPdf({
      ...matrixExportOptions,
      filename,
    });
    logExportDownload({
      panelPath: "/informe-variacion",
      exportKind: "informe-matriz",
      format: "pdf",
      fileName: filename,
      dateFrom: periodoActual.from,
      dateTo: periodoActual.to,
      filters: { metric: matrixMetric, mode: matrixMode, display: matrixDisplay },
    });
  }, [
    matrixDisplay,
    matrixExportOptions,
    matrixMetric,
    matrixMode,
    periodoActual,
  ]);

  return (
    <div className="space-y-5" aria-busy={dataPending}>
      {dataPending ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/90 px-3 py-2 text-xs text-blue-800">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Actualizando cifras del periodo seleccionado…
        </div>
      ) : null}
      {payload.meta.comparisonAvailable === false ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No hay datos reales de comparacion en el periodo anterior. Los
          porcentajes y heatmaps quedaran vacios hasta que existan bases en la base de datos.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-600">
          Periodo actual:{" "}
          <b className="text-slate-900">
            {dataPending ? (
              <span className="inline-block h-3.5 w-32 animate-pulse rounded bg-slate-200 align-middle" />
            ) : (
              periodoActual.label
            )}
          </b>
        </span>
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-600">
          Periodo anterior:{" "}
          <b className="text-slate-900">
            {dataPending ? (
              <span className="inline-block h-3.5 w-28 animate-pulse rounded bg-slate-200 align-middle" />
            ) : (
              payload.periods.mom.label
            )}
          </b>
        </span>
      </div>

      <InformeFilters
        payload={prepared}
        filters={filters}
        onChange={updateFilter}
        onClear={clearFilters}
        categoryScopeLocked={categoryScopeLocked}
        lineScopeLocked={lineScopeLocked}
      />

      <Section
        title="Indicadores del periodo"
        actions={<MetricToggle value={kpiMetric} onChange={setKpiMetric} />}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title={`${kpiMetric === "u" ? "Unidades" : "Ventas miles $"} ${curLabel}`}
            value={formatInformeValue(kpiTotals[0], kpiMetric)}
            tag={filteredTag}
            loading={dataPending}
          />
          <KpiCard
            title={`${momLabel} (base anterior)`}
            value={formatInformeValue(kpiTotals[1], kpiMetric)}
            tag={filteredTag}
            loading={dataPending}
            footer={
              <>
                <VariationChip current={kpiTotals[0]} previous={kpiTotals[1]} /> vs anterior
              </>
            }
          />
          <KpiCard
            title={`Sedes con crecimiento`}
            value={String(growthSedes)}
            tag={filteredTag}
            loading={dataPending}
            footer={
              <span className="text-slate-500">
                de las sedes con base {momLabel.toLowerCase()}
              </span>
            }
          />
        </div>
        {kpiMetric === "u" ? (
          <p className="mt-3 text-xs text-slate-500">
            En unidades, totales de sede/empresa/categoría (matriz y resumen)
            convierten kilos/litros/pollos/huevos con reglas de{" "}
            <span className="font-medium text-slate-700">rollup</span> (en
            asadero las porciones excluidas siguen en crudo para no romper
            padre≥hijo). En el resumen por empresa/sede, los pollos und se
            muestran solo enteros (se descartan fracciones). Línea y sublínea
            usan sus reglas propias; los ítems siguen en unidades de la BD.
          </p>
        ) : null}
      </Section>

      <div
        className={cn(
          "relative space-y-5 transition-opacity",
          (filtersPending || dataPending) && "opacity-60",
          dataPending && "pointer-events-none",
        )}
      >
      {dataPending ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-white/30"
          aria-hidden
        />
      ) : null}
      <div
        role="tablist"
        aria-label="Tablas del informe"
        className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        {BOARD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={boardTab === tab.id}
            onClick={() => setBoardTab(tab.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
              boardTab === tab.id
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {boardTab === "resumen" ? (
        <>
      <Section
        title="Resumen por empresa y sede"
        actions={
          <>
            <MetricToggle value={sedeMetric} onChange={setSedeMetric} />
            <button
              type="button"
              onClick={() => void exportSedeSummary()}
              disabled={dataPending}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar Excel
            </button>
          </>
        }
      >
        <SedeSummaryTable
          payload={prepared}
          metric={sedeMetric}
          pass={pass}
          preferWarm={!filtersActive}
          curLabel={curLabel}
          momLabel={momLabel}
          sort={sedeSort}
          onSort={(col) =>
            setSedeSort((current) => ({
              col,
              dir: current.col === col ? current.dir * -1 : 1,
            }))
          }
        />
      </Section>
      <Section title="Resumen por empresa">
        <InformeEmpresaSummaryCards
          payload={prepared}
          metric={rankingMetric}
          pass={pass}
        />
      </Section>
        </>
      ) : null}

      {boardTab === "ranking" ? (
      <Section
        title="Ranking producto × sede"
        actions={null}
      >
        <InformeRankingTable
          payload={prepared}
          metric={rankingMetric}
          onMetricChange={setRankingMetric}
          dimension={rankingDimension}
          onDimensionChange={setRankingDimension}
          sort={rankingSort}
          onSortChange={setRankingSort}
          mode={rankingMode}
          onModeChange={() => undefined}
          pass={pass}
        />
      </Section>
      ) : null}

      {boardTab === "matriz" ? (
      <Section
        title="Matriz comparativa entre sedes"
        actions={
          <>
            <MetricToggle value={matrixMetric} onChange={handleMatrixMetricChange} />
            <ToggleGroup
              value={matrixDisplay}
              options={[
                { id: "pct", label: "%" },
                { id: "value", label: matrixMetric === "u" ? "Unidades" : "$" },
              ]}
              onChange={(value) => setMatrixDisplay(value as "pct" | "value")}
            />
            <ToggleGroup
              value={matrixDepth}
              options={[
                { id: "cat", label: "Categoria" },
                { id: "lin", label: "+ Linea" },
              ]}
              onChange={(value) => {
                const depth = value as "cat" | "lin";
                setMatrixDepth(depth);
                // No abrir todas las categorías a la vez: el DOM × sedes congela.
                // El usuario expande categoría por categoría.
                setMatrixOpen(new Set());
              }}
            />
            <MatrixExportMenu
              disabled={dataPending}
              onExcel={() => void exportMatrixExcel()}
              onPdf={() => exportMatrixPdf()}
            />
          </>
        }
      >
        <MatrixTable
          payload={prepared}
          metric={matrixMetric}
          pass={pass}
          matrixMode={matrixMode}
          matrixDisplay={matrixDisplay}
          matrixDepth={matrixDepth}
          matrixOpen={matrixOpen}
          setMatrixOpen={setMatrixOpen}
          matrixSort={matrixSort}
          setMatrixSort={setMatrixSort}
          matrixSortKeys={matrixSortKeys}
        />
      </Section>
      ) : null}

      <footer className="text-xs text-slate-500">
        Fuente: margen_final (movimiento unificado). Valor = ventas netas (vlrtot_bru) en miles de
        $.{" "}
        {dataPending ? (
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-slate-200 align-middle" />
        ) : (
          <>{payload.meta.rowCount.toLocaleString("es-CO")} combinaciones sede/item cargadas.</>
        )}
      </footer>
      </div>
    </div>
  );
}

function MatrixExportMenu({
  disabled,
  onExcel,
  onPdf,
}: {
  disabled?: boolean;
  onExcel: () => void;
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        Exportar
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[9.5rem] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExcel();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
            Excel
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPdf();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            PDF
          </button>
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({
  title,
  value,
  tag,
  footer,
  loading = false,
}: {
  title: string;
  value: string;
  tag?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
        {tag}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">
        {loading ? (
          <span
            className="inline-block h-8 w-36 max-w-full animate-pulse rounded-lg bg-slate-200/90"
            aria-hidden
          />
        ) : (
          value
        )}
      </div>
      {loading ? (
        footer ? (
          <div className="mt-2">
            <span
              className="inline-block h-5 w-24 animate-pulse rounded bg-slate-200/80"
              aria-hidden
            />
          </div>
        ) : null
      ) : footer ? (
        <div className="mt-2 text-sm">{footer}</div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ToggleGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-slate-200">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "px-3 py-1 text-xs font-semibold",
            value === option.id ? "bg-blue-600 text-white" : "bg-white text-slate-500",
          )}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

function MetricToggle({
  value,
  onChange,
}: {
  value: InformeMetric;
  onChange: (value: InformeMetric) => void;
}) {
  return (
    <ToggleGroup
      value={value}
      options={[
        { id: "u", label: "Unidades" },
        { id: "v", label: "Valor $" },
      ]}
      onChange={(next) => onChange(next as InformeMetric)}
    />
  );
}

function InformeFilters({
  payload,
  filters,
  onChange,
  onClear,
  categoryScopeLocked = false,
  lineScopeLocked = false,
}: {
  payload: Prepared;
  filters: InformeGlobalFilters;
  onChange: (patch: Partial<InformeGlobalFilters>) => void;
  onClear: () => void;
  categoryScopeLocked?: boolean;
  lineScopeLocked?: boolean;
}) {
  const keep = (selected: string[], allowed: Array<string | number>) => {
    const set = new Set(allowed.map(String));
    return selected.filter((value) => set.has(value));
  };

  const empOptions = INFORME_EMPRESA_ORDER.filter((entry) =>
    payload.sedes.some((sede) => sede.e === entry.label),
  ).map((entry) => ({ value: entry.label, label: entry.label }));

  const sedeOptions = payload.sedes
    .map((sede, index) => ({ index, sede }))
    .filter(
      ({ sede }) =>
        filters.emp.length === 0 || filters.emp.includes(sede.e),
    )
    .map(({ index, sede }) => ({
      value: String(index),
      label: `${sede.e} · ${sede.s}`,
    }));

  const catOptions = useMemo(
    () =>
      payload.rowIndex.allCats
        .slice()
        .sort((a, b) => payload.cats[a]!.localeCompare(payload.cats[b]!, "es"))
        .map((value) => ({ value: String(value), label: payload.cats[value]! })),
    [payload.cats, payload.rowIndex.allCats],
  );

  const linOptions = useMemo(() => {
    if (filters.cat.length === 0) return [];
    const ids = new Set<number>();
    for (const cat of filters.cat) {
      for (const lin of payload.rowIndex.linsByCat.get(Number(cat)) ?? []) {
        ids.add(lin);
      }
    }
    return [...ids]
      .sort((a, b) => payload.lins[a]!.localeCompare(payload.lins[b]!, "es"))
      .map((value) => ({ value: String(value), label: payload.lins[value]! }));
  }, [filters.cat, payload]);

  const subOptions = useMemo(() => {
    if (filters.cat.length === 0 || filters.lin.length === 0) return [];
    const ids = new Set<number>();
    for (const cat of filters.cat) {
      for (const lin of filters.lin) {
        for (const sub of payload.rowIndex.subsByCatLin.get(`${cat}|${lin}`) ?? []) {
          ids.add(sub);
        }
      }
    }
    return [...ids]
      .sort((a, b) => payload.subs[a]!.localeCompare(payload.subs[b]!, "es"))
      .map((value) => ({ value: String(value), label: payload.subs[value]! }));
  }, [filters.cat, filters.lin, payload]);

  const itemOptions = useMemo(() => {
    if (
      filters.cat.length === 0 ||
      filters.lin.length === 0 ||
      filters.sub.length === 0
    ) {
      return [];
    }
    const ids = new Set<number>();
    for (const cat of filters.cat) {
      for (const lin of filters.lin) {
        for (const sub of filters.sub) {
          for (const item of payload.rowIndex.itemsByCatLinSub.get(
            `${cat}|${lin}|${sub}`,
          ) ?? []) {
            ids.add(item);
          }
        }
      }
    }
    const matcher = compileInformeRowFilter(
      { ...filters, item: [], prov: [] },
      payload.sedeEmpresas,
      payload.itemsLow,
      payload.itemProv,
    );
    const allowed = new Set<number>();
    for (const row of payload.rows) {
      if (matcher(row)) allowed.add(row[4]);
    }
    return [...ids]
      .filter((item) => allowed.has(item))
      .sort((a, b) => payload.items[a]!.localeCompare(payload.items[b]!, "es"))
      .slice(0, 6000)
      .map((value) => ({ value: String(value), label: payload.items[value]! }));
  }, [filters, payload]);

  const provOptions = useMemo(() => {
    const labels = payload.provs ?? [];
    if (labels.length === 0) return [];
    const matcher = compileInformeRowFilter(
      { ...filters, prov: [] },
      payload.sedeEmpresas,
      payload.itemsLow,
      payload.itemProv,
    );
    const allowed = new Set<number>();
    for (const row of payload.rows) {
      if (matcher(row)) allowed.add(payload.itemProv?.[row[4]] ?? 0);
    }
    return [...allowed]
      .sort((a, b) => (labels[a] ?? "").localeCompare(labels[b] ?? "", "es"))
      .map((value) => ({
        value: String(value),
        label: labels[value] ?? `Proveedor ${value}`,
      }));
  }, [filters, payload]);

  return (
    <section className="rounded-xl border border-l-4 border-l-blue-600 border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">Filtros de analisis</h2>
        <button type="button" onClick={onClear} className="text-xs font-semibold text-blue-600">
          Limpiar filtros
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <DiMultiSelect
          label="Empresas"
          values={filters.emp}
          options={empOptions}
          emptyLabel="Todas"
          onChange={(emp) =>
            onChange({
              emp,
              sede: keep(
                filters.sede,
                payload.sedes.flatMap((sede, index) =>
                  emp.length === 0 || emp.includes(sede.e) ? [String(index)] : [],
                ),
              ),
            })
          }
        />
        <DiMultiSelect
          label="Sedes"
          values={filters.sede}
          options={sedeOptions}
          emptyLabel="Todas"
          searchable
          onChange={(sede) => onChange({ sede })}
        />
        <DiMultiSelect
          label="Categoria"
          values={filters.cat}
          options={catOptions}
          emptyLabel="Todas"
          searchable
          disabled={categoryScopeLocked}
          onChange={(cat) => {
            const nextLins = new Set<number>();
            for (const id of cat) {
              for (const lin of payload.rowIndex.linsByCat.get(Number(id)) ?? []) {
                nextLins.add(lin);
              }
            }
            const lin = keep(filters.lin, [...nextLins]);
            const nextSubs = new Set<number>();
            for (const catId of cat) {
              for (const linId of lin) {
                for (const sub of payload.rowIndex.subsByCatLin.get(
                  `${catId}|${linId}`,
                ) ?? []) {
                  nextSubs.add(sub);
                }
              }
            }
            const sub = keep(filters.sub, [...nextSubs]);
            onChange({ cat, lin, sub, item: [] });
          }}
        />
        {payload.provs && payload.provs.length > 0 ? (
          <DiMultiSelect
            label="Proveedores"
            values={filters.prov}
            options={provOptions}
            emptyLabel="Todos"
            searchable
            onChange={(prov) => onChange({ prov })}
          />
        ) : null}
        <DiMultiSelect
          label="Lineas"
          values={filters.lin}
          options={linOptions}
          emptyLabel={filters.cat.length === 0 ? "Elige categoria" : "Todas"}
          searchable
          disabled={lineScopeLocked || filters.cat.length === 0}
          onChange={(lin) => {
            const nextSubs = new Set<number>();
            for (const catId of filters.cat) {
              for (const linId of lin) {
                for (const sub of payload.rowIndex.subsByCatLin.get(
                  `${catId}|${linId}`,
                ) ?? []) {
                  nextSubs.add(sub);
                }
              }
            }
            onChange({
              lin,
              sub: keep(filters.sub, [...nextSubs]),
              item: [],
            });
          }}
        />
        <DiMultiSelect
          label="Sublineas"
          values={filters.sub}
          options={subOptions}
          emptyLabel={
            filters.lin.length === 0 ? "Elige linea" : "Todas"
          }
          searchable
          disabled={filters.lin.length === 0}
          onChange={(sub) => onChange({ sub, item: [] })}
        />
        <DiMultiSelect
          label="Items"
          values={filters.item}
          options={itemOptions}
          emptyLabel={
            filters.sub.length === 0 ? "Elige sublinea" : "Todos"
          }
          searchable
          disabled={filters.sub.length === 0}
          onChange={(item) => onChange({ item })}
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Buscar item
          </span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) =>
              onChange({ q: event.target.value.trim().toLowerCase() })
            }
            placeholder="Buscar item por texto..."
            className="h-9 rounded-lg border border-slate-200 px-3 text-sm"
          />
        </label>
      </div>
    </section>
  );
}

function SedeSummaryTable({
  payload,
  metric,
  pass,
  preferWarm,
  curLabel,
  momLabel,
  sort,
  onSort,
}: {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: (typeof payload.rows)[number]) => boolean;
  preferWarm: boolean;
  curLabel: string;
  momLabel: string;
  sort: { col: string; dir: number };
  onSort: (col: string) => void;
}) {
  const boardWarm = preferWarm ? getUnfilteredBoardWarm(payload.rows) : undefined;

  const perSede = useMemo(() => {
    if (boardWarm) return boardWarm.perSedeSummary[metric];
    return aggregateBySede(
      payload.rows,
      metric,
      payload.sedes.length,
      pass,
      payload.metricCtx,
      { floorCompletePollosUnd: true },
    );
  }, [boardWarm, metric, pass, payload.metricCtx, payload.rows, payload.sedes.length]);

  const perSedeVentas = useMemo(() => {
    if (boardWarm) return boardWarm.perSedeVentas;
    return aggregateVentasBySede(payload.rows, payload.sedes.length, pass);
  }, [boardWarm, pass, payload.rows, payload.sedes.length]);

  const perSedeMargin = useMemo(() => {
    if (boardWarm) return boardWarm.perSedeMargin;
    return aggregateMarginBySede(payload.rows, payload.sedes.length, pass);
  }, [boardWarm, pass, payload.rows, payload.sedes.length]);
  const marginPct = (ventas: PeriodTriple, margin: PeriodTriple, index: 0 | 1 | 2) =>
    formatMargenPct(ventas[index], margin[index]);

  const sumTriple = (indices: number[], source: PeriodTriple[]) =>
    indices.reduce<PeriodTriple>(
      (acc, index) => [
        acc[0] + source[index][0],
        acc[1] + source[index][1],
        acc[2] + source[index][2],
      ],
      [0, 0, 0],
    );

  const total = perSede.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );

  const totalVentas = perSedeVentas.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );
  const totalMargin = perSedeMargin.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );

  const arrow = (col: string) =>
    sort.col === col ? (sort.dir > 0 ? " ▼" : " ▲") : "";

  const thClass = (align: "left" | "right") =>
    cn(
      "cursor-pointer border-b-2 border-slate-200 px-2 py-2 whitespace-nowrap",
      align === "left" ? "text-left" : "text-right",
    );

  const tdClass = (align: "left" | "right", extra?: string) =>
    cn(
      "px-2 py-2 whitespace-nowrap",
      align === "left" ? "text-left" : "text-right tabular-nums",
      extra,
    );

  const headerColumns: Array<{ id: string; label: string; align: "left" | "right" }> = [
    { id: "name", label: "Empresa / Sede", align: "left" },
    { id: "cur", label: curLabel, align: "right" },
    { id: "curMarg", label: "Marg %", align: "right" },
    { id: "mom", label: momLabel, align: "right" },
    { id: "momMarg", label: "Marg %", align: "right" },
    { id: "mompct", label: "Var. %", align: "right" },
    { id: "part", label: "Participacion", align: "right" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            {headerColumns.map(({ id, label, align }) => (
              <th key={id} className={thClass(align)} onClick={() => onSort(id)}>
                {label}
                {arrow(id)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INFORME_EMPRESA_ORDER.map((empresa) => {
            const indices = payload.sedes
              .map((sede, index) => (sede.e === empresa.label ? index : -1))
              .filter((index) => index >= 0);
            if (indices.length === 0) return null;

            const sorted = [...indices];
            if (sort.col === "name") {
              if (sort.dir < 0) sorted.reverse();
            } else {
              sorted.sort(
                (a, b) =>
                  (comparePeriodTriple(perSede[b], sort.col) -
                    comparePeriodTriple(perSede[a], sort.col)) *
                  sort.dir,
              );
            }

            const empresaSum = sorted.reduce<PeriodTriple>(
              (acc, index) => [
                acc[0] + perSede[index][0],
                acc[1] + perSede[index][1],
                acc[2] + perSede[index][2],
              ],
              [0, 0, 0],
            );
            const empresaVentas = sumTriple(sorted, perSedeVentas);
            const empresaMargin = sumTriple(sorted, perSedeMargin);

            return (
              <FragmentBlock key={empresa.label}>
                <tr className="bg-slate-100 font-semibold">
                  <td className={tdClass("left")}>
                    <span
                      className={cn(
                        "mr-2 inline-block h-2.5 w-2.5 rounded-full",
                        EMP_DOT_CLASS[empresa.label],
                      )}
                    />
                    {empresa.label}
                  </td>
                  <td className={tdClass("right")}>{formatInformeValue(empresaSum[0], metric)}</td>
                  <td className={tdClass("right", "text-slate-600")}>
                    {marginPct(empresaVentas, empresaMargin, 0)}
                  </td>
                  <td className={tdClass("right")}>{formatInformeValue(empresaSum[1], metric)}</td>
                  <td className={tdClass("right", "text-slate-600")}>
                    {marginPct(empresaVentas, empresaMargin, 1)}
                  </td>
                  <td className={tdClass("right")}>
                    <div className="flex justify-end">
                      <VariationChip current={empresaSum[0]} previous={empresaSum[1]} />
                    </div>
                  </td>
                  <td className={tdClass("right")}>
                    {total[0] > 0 ? `${((empresaSum[0] / total[0]) * 100).toFixed(1)}%` : "0%"}
                  </td>
                </tr>
                {sorted.map((index) => {
                  const values = perSede[index];
                  const part = total[0] > 0 ? (values[0] / total[0]) * 100 : 0;
                  return (
                    <tr key={index} className="border-b border-slate-100">
                      <td className={cn(tdClass("left"), "pl-8")}>{payload.sedes[index].s}</td>
                      <td className={tdClass("right", "font-semibold")}>
                        {formatInformeValue(values[0], metric)}
                      </td>
                      <td className={tdClass("right", "text-slate-600")}>
                        {marginPct(perSedeVentas[index], perSedeMargin[index], 0)}
                      </td>
                      <td className={tdClass("right")}>
                        {formatInformeValue(values[1], metric)}
                      </td>
                      <td className={tdClass("right", "text-slate-600")}>
                        {marginPct(perSedeVentas[index], perSedeMargin[index], 1)}
                      </td>
                      <td className={tdClass("right")}>
                        <div className="flex justify-end">
                          <VariationChip current={values[0]} previous={values[1]} />
                        </div>
                      </td>
                      <td className={tdClass("right", "text-slate-500")}>{part.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </FragmentBlock>
            );
          })}
          <tr className="bg-slate-200 font-bold">
            <td className={tdClass("left")}>TOTAL COMPANIAS</td>
            <td className={tdClass("right")}>{formatInformeValue(total[0], metric)}</td>
            <td className={tdClass("right", "text-slate-700")}>
              {marginPct(totalVentas, totalMargin, 0)}
            </td>
            <td className={tdClass("right")}>{formatInformeValue(total[1], metric)}</td>
            <td className={tdClass("right", "text-slate-700")}>
              {marginPct(totalVentas, totalMargin, 1)}
            </td>
            <td className={tdClass("right")}>
              <div className="flex justify-end">
                <VariationChip current={total[0]} previous={total[1]} />
              </div>
            </td>
            <td className={tdClass("right")} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FragmentBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
