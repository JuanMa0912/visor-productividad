"use client";

import { useCallback, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  aggregateBySede,
  filterRowIndices,
  hasActiveInformeFilters,
  passInformeRowFilter,
  prepareInformeData,
  sumFilteredRows,
  sumRowIndices,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import { formatInformeValue, comparePeriodTriple } from "@/lib/informe-variacion/format";
import {
  buildSedeSummaryExportRows,
  sedeSummaryExportFilename,
} from "@/lib/informe-variacion/export-sede-summary";
import { downloadInformeSedeSummaryExcel } from "@/lib/informe-variacion/export-sede-summary-excel";
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
import { TreeTable } from "@/app/informe-variacion/informe-variacion-tree";

type Props = {
  payload: InformeVariacionPayload;
};

const EMP_DOT_CLASS: Record<string, string> = {
  Comercializadora: "bg-blue-600",
  Mercamio: "bg-amber-600",
  Merkmios: "bg-violet-600",
};

export function InformeVariacionBoard({ payload }: Props) {
  const prepared = useMemo(() => prepareInformeData(payload), [payload]);
  const [metric, setMetric] = useState<InformeMetric>("v");
  const [filters, setFilters] = useState<InformeGlobalFilters>(EMPTY_INFORME_FILTERS);
  const [matrixMode, setMatrixMode] = useState<"yoy" | "mom">("yoy");
  const [matrixDisplay, setMatrixDisplay] = useState<"pct" | "value">("pct");
  const [matrixDepth, setMatrixDepth] = useState<"cat" | "lin">("cat");
  const [matrixOpen, setMatrixOpen] = useState<Set<string>>(() => new Set());
  const [treeOpen, setTreeOpen] = useState<Set<string>>(() => new Set());
  const [treeShown, setTreeShown] = useState<Record<string, number>>({});
  const [sedeSort, setSedeSort] = useState({ col: "name", dir: 1 });
  const [treeSort, setTreeSort] = useState({ col: "name", dir: 1 });
  const [matrixSort, setMatrixSort] = useState({ col: -1, dir: 1 });

  const pass = useCallback(
    (row: (typeof prepared.rows)[number]) =>
      passInformeRowFilter(
        row,
        filters,
        prepared.sedeEmpresas,
        prepared.itemsLow,
      ),
    [filters, prepared],
  );

  const filteredTag = hasActiveInformeFilters(filters) ? (
    <span className="text-blue-600"> (filtrado)</span>
  ) : null;

  const kpiTotals = useMemo(
    () => sumFilteredRows(prepared.rows, metric, pass),
    [metric, pass, prepared.rows],
  );

  const kpiYoyComparable = useMemo(() => {
    const indices = filterRowIndices(prepared.rows, pass).filter(
      (index) => prepared.sedeYoy[prepared.rows[index]![0]],
    );
    return sumRowIndices(prepared.rows, indices, metric);
  }, [metric, pass, prepared.rows, prepared.sedeYoy]);

  const growthSedes = useMemo(() => {
    const perSede = aggregateBySede(
      prepared.rows,
      metric,
      prepared.sedes.length,
      pass,
    );
    let count = 0;
    perSede.forEach((values, index) => {
      if (prepared.sedeYoy[index] && values[2] > 0 && values[0] > values[2]) {
        count += 1;
      }
    });
    return count;
  }, [metric, pass, prepared.rows, prepared.sedeYoy, prepared.sedes.length]);

  const updateFilter = (patch: Partial<InformeGlobalFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setMatrixSort({ col: -1, dir: 1 });
  };

  const clearFilters = () => {
    setFilters(EMPTY_INFORME_FILTERS);
    setMatrixSort({ col: -1, dir: 1 });
  };

  const periodShort = (compactFrom: string) => {
    const month = Number(compactFrom.slice(4, 6));
    const year = compactFrom.slice(2, 4);
    const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${names[month - 1] ?? "??"}-${year}`;
  };

  const curLabel = periodShort(payload.periods.current.from);
  const momLabel = periodShort(payload.periods.mom.from);
  const yoyLabel = periodShort(payload.periods.yoy.from);

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
      if (matrixMode === "yoy" && !prepared.sedeYoy[matrixSort.col]) return 0;
      const base = matrixMode === "mom" ? values[1] : values[2];
      return base > 0 ? values[0] / base - 1 : values[0] > 0 ? Infinity : -Infinity;
    };
    return [...keys].sort((a, b) => (val(b) - val(a)) * matrixSort.dir);
  };

  const exportSedeSummary = useCallback(async () => {
    const rows = buildSedeSummaryExportRows(prepared, metric, pass);
    await downloadInformeSedeSummaryExcel({
      rows,
      metric,
      periodLabel: payload.periods.current.label,
      yoyLabel,
      momLabel,
      mockBases: payload.meta.mockBases,
      filename: sedeSummaryExportFilename(payload.periods.current.label, metric),
    });
  }, [metric, momLabel, pass, prepared, payload.meta.mockBases, payload.periods.current.label, yoyLabel]);

  return (
    <div className="space-y-5">
      {payload.meta.mockBases ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <b>Modo demo activo:</b>{" "}
          {payload.meta.demoData
            ? "datos sinteticos de ejemplo (sin consulta a margen_final)."
            : "las bases de mayo y junio del ano anterior se sintetizaron a partir del periodo actual."}{" "}
          No usar en reportes oficiales.
        </div>
      ) : payload.meta.comparisonAvailable === false ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No hay datos reales de comparacion (MoM / YoY) en margen para este mes. Activa
          <b> Simular MoM / YoY (demo)</b> arriba para ver porcentajes y heatmaps.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-600">
          Periodo actual: <b className="text-slate-900">{payload.periods.current.label}</b>
        </span>
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-600">
          MoM vs: <b className="text-slate-900">{payload.periods.mom.label}</b>
        </span>
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-600">
          YoY vs: <b className="text-slate-900">{payload.periods.yoy.label}</b>
        </span>
      </div>

      <div className="flex border-b-2 border-slate-200">
        {(["u", "v"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMetric(tab)}
            className={cn(
              "-mb-0.5 border-b-2 px-6 py-2 text-sm font-semibold",
              metric === tab
                ? "border-blue-600 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {tab === "u" ? "Unidades" : "Valor $ (miles)"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={`${metric === "u" ? "Unidades" : "Ventas miles $"} ${curLabel}`}
          value={formatInformeValue(kpiTotals[0], metric)}
          tag={filteredTag}
        />
        <KpiCard
          title={`${yoyLabel} (base YoY)`}
          value={formatInformeValue(kpiYoyComparable[2], metric)}
          tag={filteredTag}
          footer={
            <>
              <VariationChip current={kpiYoyComparable[0]} previous={kpiYoyComparable[2]} /> YoY
            </>
          }
        />
        <KpiCard
          title={`${momLabel} (base MoM)`}
          value={formatInformeValue(kpiTotals[1], metric)}
          tag={filteredTag}
          footer={
            <>
              <VariationChip current={kpiTotals[0]} previous={kpiTotals[1]} /> MoM
            </>
          }
        />
        <KpiCard
          title={`Sedes con crecimiento YoY`}
          value={String(growthSedes)}
          tag={filteredTag}
          footer={<span className="text-slate-500">de las sedes con base {yoyLabel.toLowerCase()}</span>}
        />
      </div>

      <InformeFilters
        payload={prepared}
        filters={filters}
        onChange={updateFilter}
        onClear={clearFilters}
      />

      <Section
        title="Resumen por empresa y sede"
        actions={
          <button
            type="button"
            onClick={() => void exportSedeSummary()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Excel
          </button>
        }
      >
        <SedeSummaryTable
          payload={prepared}
          metric={metric}
          pass={pass}
          curLabel={curLabel}
          momLabel={momLabel}
          yoyLabel={yoyLabel}
          sort={sedeSort}
          onSort={(col) =>
            setSedeSort((current) => ({
              col,
              dir: current.col === col ? current.dir * -1 : 1,
            }))
          }
        />
      </Section>

      <Section
        title="Matriz comparativa entre sedes"
        actions={
          <>
            <ToggleGroup
              value={matrixDisplay}
              options={[
                { id: "pct", label: "%" },
                { id: "value", label: metric === "u" ? "Unidades" : "$" },
              ]}
              onChange={(value) => setMatrixDisplay(value as "pct" | "value")}
            />
            <span className={cn(matrixDisplay === "value" && "opacity-50")}>
              <ToggleGroup
                value={matrixMode}
                options={[
                  { id: "yoy", label: "YoY %" },
                  { id: "mom", label: "MoM %" },
                ]}
                onChange={(value) => setMatrixMode(value as "yoy" | "mom")}
              />
            </span>
            <ToggleGroup
              value={matrixDepth}
              options={[
                { id: "cat", label: "Categoria" },
                { id: "lin", label: "+ Linea" },
              ]}
              onChange={(value) => {
                const depth = value as "cat" | "lin";
                setMatrixDepth(depth);
                setMatrixOpen(new Set());
                if (depth === "lin") {
                  setMatrixOpen(
                    new Set(prepared.rowIndex.allCats.map((cat) => `c${cat}`)),
                  );
                }
              }}
            />
          </>
        }
      >
        <MatrixTable
          payload={prepared}
          metric={metric}
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

      <Section title="Explorador jerarquico">
        <TreeTable
          payload={prepared}
          metric={metric}
          pass={pass}
          treeOpen={treeOpen}
          setTreeOpen={setTreeOpen}
          treeShown={treeShown}
          setTreeShown={setTreeShown}
          sort={treeSort}
          onSort={(col) =>
            setTreeSort((current) => ({
              col,
              dir: current.col === col ? current.dir * -1 : 1,
            }))
          }
          curLabel={curLabel}
          momLabel={momLabel}
          yoyLabel={yoyLabel}
        />
        <p className="mt-3 text-xs text-slate-500">
          Participacion % = peso del nodo dentro del total filtrado del periodo actual. «Nuevo» =
          sin venta en el periodo base.
        </p>
      </Section>

      <footer className="text-xs text-slate-500">
        Fuente: margen_final (movimiento unificado). Valor = ventas netas (vlrtot_bru) en miles de
        $. {payload.meta.rowCount.toLocaleString("es-CO")} combinaciones sede/item cargadas.
      </footer>
    </div>
  );
}

function KpiCard({
  title,
  value,
  tag,
  footer,
}: {
  title: string;
  value: string;
  tag?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
        {tag}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      {footer ? <div className="mt-2 text-sm">{footer}</div> : null}
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

function InformeFilters({
  payload,
  filters,
  onChange,
  onClear,
}: {
  payload: ReturnType<typeof prepareInformeData>;
  filters: InformeGlobalFilters;
  onChange: (patch: Partial<InformeGlobalFilters>) => void;
  onClear: () => void;
}) {
  const sedeOptions = payload.sedes
    .map((sede, index) => ({ index, sede }))
    .filter(({ sede }) => !filters.emp || sede.e === filters.emp);

  const catOptions = useMemo(
    () =>
      payload.rowIndex.allCats
        .slice()
        .sort((a, b) => payload.cats[a]!.localeCompare(payload.cats[b]!, "es")),
    [payload.cats, payload.rowIndex.allCats],
  );

  const linOptions = useMemo(() => {
    if (filters.cat === "") return [];
    return (payload.rowIndex.linsByCat.get(Number(filters.cat)) ?? []).slice().sort((a, b) =>
      payload.lins[a]!.localeCompare(payload.lins[b]!, "es"),
    );
  }, [filters.cat, payload.lins, payload.rowIndex.linsByCat]);

  const subOptions = useMemo(() => {
    if (filters.cat === "" || filters.lin === "") return [];
    const key = `${filters.cat}|${filters.lin}`;
    return (payload.rowIndex.subsByCatLin.get(key) ?? []).slice().sort((a, b) =>
      payload.subs[a]!.localeCompare(payload.subs[b]!, "es"),
    );
  }, [filters.cat, filters.lin, payload.rowIndex.subsByCatLin, payload.subs]);

  const itemOptions = useMemo(() => {
    if (filters.cat === "" || filters.lin === "" || filters.sub === "") return [];
    const key = `${filters.cat}|${filters.lin}|${filters.sub}`;
    let items = payload.rowIndex.itemsByCatLinSub.get(key) ?? [];
    if (filters.emp || filters.sede || filters.q) {
      const allowed = new Set<number>();
      for (const row of payload.rows) {
        if (filters.emp && payload.sedeEmpresas[row[0]] !== filters.emp) continue;
        if (filters.sede !== "" && row[0] !== Number(filters.sede)) continue;
        if (row[1] !== Number(filters.cat)) continue;
        if (row[2] !== Number(filters.lin)) continue;
        if (row[3] !== Number(filters.sub)) continue;
        if (filters.q && !payload.itemsLow[row[4]]?.includes(filters.q)) continue;
        allowed.add(row[4]);
      }
      items = items.filter((item) => allowed.has(item));
    }
    return items
      .slice()
      .sort((a, b) => payload.items[a]!.localeCompare(payload.items[b]!, "es"))
      .slice(0, 6000);
  }, [filters, payload]);

  const activeLabel =
    filters.item !== ""
      ? payload.items[Number(filters.item)]
      : filters.sub !== ""
        ? payload.subs[Number(filters.sub)]
        : filters.lin !== ""
          ? payload.lins[Number(filters.lin)]
          : filters.cat !== ""
            ? payload.cats[Number(filters.cat)]
            : "";

  return (
    <section className="rounded-xl border border-l-4 border-l-blue-600 border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">Filtros de analisis</h2>
        <button type="button" onClick={onClear} className="text-xs font-semibold text-blue-600">
          Limpiar filtros
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterSelect
          value={filters.emp}
          onChange={(value) => onChange({ emp: value, sede: "" })}
          placeholder="Todas las empresas"
          options={INFORME_EMPRESA_ORDER.map((entry) => ({
            value: entry.label,
            label: entry.label,
          }))}
        />
        <FilterSelect
          value={filters.sede}
          onChange={(value) => onChange({ sede: value })}
          placeholder="Todas las sedes"
          options={sedeOptions.map(({ index, sede }) => ({
            value: String(index),
            label: `${sede.e} · ${sede.s}`,
          }))}
        />
        <FilterSelect
          value={filters.cat}
          onChange={(value) => onChange({ cat: value, lin: "", sub: "", item: "" })}
          placeholder="Todas las categorias"
          options={catOptions.map((value) => ({ value: String(value), label: payload.cats[value] }))}
        />
        <FilterSelect
          value={filters.lin}
          onChange={(value) => onChange({ lin: value, sub: "", item: "" })}
          placeholder="Todas las lineas"
          options={linOptions.map((value) => ({ value: String(value), label: payload.lins[value] }))}
        />
        <FilterSelect
          value={filters.sub}
          onChange={(value) => onChange({ sub: value, item: "" })}
          placeholder="Todas las sublineas"
          options={subOptions.map((value) => ({ value: String(value), label: payload.subs[value] }))}
        />
        <FilterSelect
          value={filters.item}
          onChange={(value) => onChange({ item: value })}
          placeholder="Todos los items"
          options={itemOptions.map((value) => ({
            value: String(value),
            label: payload.items[value],
          }))}
        />
        <input
          type="search"
          value={filters.q}
          onChange={(event) => onChange({ q: event.target.value.trim().toLowerCase(), item: "" })}
          placeholder="Buscar item por texto..."
          className="min-w-[240px] rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      {activeLabel ? (
        <div className="mt-3 inline-flex max-w-xl rounded-xl bg-gradient-to-r from-blue-700 to-violet-600 px-4 py-3 text-white shadow">
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-85">Filtro activo</div>
            <div className="text-lg font-bold">{activeLabel}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SedeSummaryTable({
  payload,
  metric,
  pass,
  curLabel,
  momLabel,
  yoyLabel,
  sort,
  onSort,
}: {
  payload: ReturnType<typeof prepareInformeData>;
  metric: InformeMetric;
  pass: (row: (typeof payload.rows)[number]) => boolean;
  curLabel: string;
  momLabel: string;
  yoyLabel: string;
  sort: { col: string; dir: number };
  onSort: (col: string) => void;
}) {
  const perSede = aggregateBySede(payload.rows, metric, payload.sedes.length, pass);
  const total = perSede.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );

  const arrow = (col: string) =>
    sort.col === col ? (sort.dir > 0 ? " ▼" : " ▲") : "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            {[
              ["name", "Empresa / Sede"],
              ["cur", curLabel],
              ["yoy", yoyLabel],
              ["yoypct", "YoY %"],
              ["mom", momLabel],
              ["mompct", "MoM %"],
              ["part", "Participacion"],
            ].map(([col, label]) => (
              <th
                key={col}
                className="cursor-pointer border-b-2 border-slate-200 px-2 py-2 text-left first:text-left last:text-left"
                onClick={() => onSort(col)}
              >
                {label}
                {arrow(col)}
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

            return (
              <FragmentBlock key={empresa.label}>
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-2 py-2">
                    <span
                      className={cn(
                        "mr-2 inline-block h-2.5 w-2.5 rounded-full",
                        EMP_DOT_CLASS[empresa.label],
                      )}
                    />
                    {empresa.label}
                  </td>
                  <td className="px-2 py-2 text-right">{formatInformeValue(empresaSum[0], metric)}</td>
                  <td className="px-2 py-2 text-right">
                    {payload.empYoy[empresa.label]
                      ? formatInformeValue(empresaSum[2], metric)
                      : "N/D"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <VariationChip
                      current={empresaSum[0]}
                      previous={empresaSum[2]}
                      yoyOk={payload.empYoy[empresa.label]}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">{formatInformeValue(empresaSum[1], metric)}</td>
                  <td className="px-2 py-2 text-right">
                    <VariationChip current={empresaSum[0]} previous={empresaSum[1]} />
                  </td>
                  <td className="px-2 py-2">
                    {total[0] > 0 ? `${((empresaSum[0] / total[0]) * 100).toFixed(1)}%` : "0%"}
                  </td>
                </tr>
                {sorted.map((index) => {
                  const values = perSede[index];
                  const part = total[0] > 0 ? (values[0] / total[0]) * 100 : 0;
                  return (
                    <tr key={index} className="border-b border-slate-100">
                      <td className="px-2 py-2 pl-8">{payload.sedes[index].s}</td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {formatInformeValue(values[0], metric)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {payload.sedeYoy[index]
                          ? formatInformeValue(values[2], metric)
                          : "N/D"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <VariationChip
                          current={values[0]}
                          previous={values[2]}
                          yoyOk={payload.sedeYoy[index]}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatInformeValue(values[1], metric)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <VariationChip current={values[0]} previous={values[1]} />
                      </td>
                      <td className="px-2 py-2 text-slate-500">{part.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </FragmentBlock>
            );
          })}
          <tr className="bg-slate-200 font-bold">
            <td className="px-2 py-2">TOTAL COMPANIAS</td>
            <td className="px-2 py-2 text-right">{formatInformeValue(total[0], metric)}</td>
            <td className="px-2 py-2 text-right">
              {formatInformeValue(
                perSede.reduce((sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0), 0),
                metric,
              )}
            </td>
            <td className="px-2 py-2 text-right">
              <VariationChip
                current={total[0]}
                previous={perSede.reduce(
                  (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
                  0,
                )}
              />
            </td>
            <td className="px-2 py-2 text-right">{formatInformeValue(total[1], metric)}</td>
            <td className="px-2 py-2 text-right">
              <VariationChip current={total[0]} previous={total[1]} />
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FragmentBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
