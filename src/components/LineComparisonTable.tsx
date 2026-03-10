"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { formatCOP, formatHours, hasLaborDataForLine } from "@/lib/calc";
import { DailyProductivity, LineMetrics } from "@/types";

interface LineComparisonTableProps {
  lines: LineMetrics[];
  dailyDataSet: DailyProductivity[];
  sedes: Array<{ id: string; name: string }>;
  dateRange: { start: string; end: string };
  defaultSedeIds: string[];
  hasData?: boolean;
}

type LineWithMetrics = LineMetrics;

type SedeMetrics = {
  sales: number;
  hours: number;
};

type LineTotals = {
  sales: number;
  hours: number;
};

type SortMetric = "sales" | "salesPerHour" | "hours";
type SortOrder = "asc" | "desc";

const buildSedeNameMap = (sedes: Array<{ id: string; name: string }>) =>
  new Map(sedes.map((sede) => [sede.id, sede.name]));

const getLineAccent = (_lineId: string) => {
  const palette: Record<
    string,
    {
      dot: string;
      chip: string;
      rowActive: string;
      rowHover: string;
      expandedBorder: string;
      expandedBg: string;
    }
  > = {
    cajas: {
      dot: "bg-blue-500",
      chip: "text-blue-700 bg-blue-50 border-blue-200",
      rowActive: "bg-blue-50/70 ring-1 ring-blue-200",
      rowHover: "hover:bg-blue-50/40",
      expandedBorder: "border-blue-200/70",
      expandedBg: "bg-blue-50/35",
    },
    fruver: {
      dot: "bg-emerald-500",
      chip: "text-emerald-700 bg-emerald-50 border-emerald-200",
      rowActive: "bg-emerald-50/70 ring-1 ring-emerald-200",
      rowHover: "hover:bg-emerald-50/40",
      expandedBorder: "border-emerald-200/70",
      expandedBg: "bg-emerald-50/35",
    },
    carnes: {
      dot: "bg-rose-500",
      chip: "text-rose-700 bg-rose-50 border-rose-200",
      rowActive: "bg-rose-50/70 ring-1 ring-rose-200",
      rowHover: "hover:bg-rose-50/40",
      expandedBorder: "border-rose-200/70",
      expandedBg: "bg-rose-50/35",
    },
    industria: {
      dot: "bg-amber-500",
      chip: "text-amber-700 bg-amber-50 border-amber-200",
      rowActive: "bg-amber-50/70 ring-1 ring-amber-200",
      rowHover: "hover:bg-amber-50/40",
      expandedBorder: "border-amber-200/70",
      expandedBg: "bg-amber-50/35",
    },
    "pollo y pescado": {
      dot: "bg-cyan-500",
      chip: "text-cyan-700 bg-cyan-50 border-cyan-200",
      rowActive: "bg-cyan-50/70 ring-1 ring-cyan-200",
      rowHover: "hover:bg-cyan-50/40",
      expandedBorder: "border-cyan-200/70",
      expandedBg: "bg-cyan-50/35",
    },
    asadero: {
      dot: "bg-violet-500",
      chip: "text-violet-700 bg-violet-50 border-violet-200",
      rowActive: "bg-violet-50/70 ring-1 ring-violet-200",
      rowHover: "hover:bg-violet-50/40",
      expandedBorder: "border-violet-200/70",
      expandedBg: "bg-violet-50/35",
    },
  };
  return (
    palette[_lineId] ?? {
      dot: "bg-slate-500",
      chip: "text-slate-700 bg-slate-50 border-slate-200",
      rowActive: "bg-slate-100/80 ring-1 ring-slate-200",
      rowHover: "hover:bg-slate-100/70",
      expandedBorder: "border-slate-200/70",
      expandedBg: "bg-slate-50/35",
    }
  );
};

export const LineComparisonTable = ({
  lines,
  dailyDataSet,
  sedes,
  dateRange,
  defaultSedeIds,
  hasData = true,
}: LineComparisonTableProps) => {
  const allSedeIds = useMemo(() => sedes.map((sede) => sede.id), [sedes]);
  const sedeNameMap = useMemo(() => buildSedeNameMap(sedes), [sedes]);

  const [selectedSedeIds, setSelectedSedeIds] = useState<string[]>([]);
  const [expandedLineIds, setExpandedLineIds] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [sortMetric, setSortMetric] = useState<SortMetric>("sales");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    const validDefault = defaultSedeIds.filter((id) => allSedeIds.includes(id));
    if (validDefault.length > 0) {
      setSelectedSedeIds(validDefault);
      return;
    }
    setSelectedSedeIds(allSedeIds);
  }, [allSedeIds, defaultSedeIds]);

  const selectedSedeIdSet = useMemo(
    () => new Set(selectedSedeIds),
    [selectedSedeIds],
  );

  const lineSedeMetrics = useMemo(() => {
    const byLine = new Map<string, Map<string, SedeMetrics>>();
    dailyDataSet.forEach((item) => {
      if (!selectedSedeIdSet.has(item.sede)) return;
      if (dateRange.start && item.date < dateRange.start) return;
      if (dateRange.end && item.date > dateRange.end) return;

      item.lines.forEach((line) => {
        const bySede = byLine.get(line.id) ?? new Map<string, SedeMetrics>();
        const current = bySede.get(item.sede) ?? { sales: 0, hours: 0 };
        const hours = hasLaborDataForLine(line.id) ? line.hours : 0;
        bySede.set(item.sede, {
          sales: current.sales + line.sales,
          hours: current.hours + hours,
        });
        byLine.set(line.id, bySede);
      });
    });
    return byLine;
  }, [dailyDataSet, dateRange.end, dateRange.start, selectedSedeIdSet]);

  const totalsByLine = useMemo(() => {
    const totals = new Map<string, LineTotals>();
    lines.forEach((line) => {
      const bySede = lineSedeMetrics.get(line.id);
      if (!bySede) {
        totals.set(line.id, { sales: 0, hours: 0 });
        return;
      }
      let sales = 0;
      let hours = 0;
      bySede.forEach((value) => {
        sales += value.sales;
        hours += value.hours;
      });
      totals.set(line.id, { sales, hours });
    });
    return totals;
  }, [lineSedeMetrics, lines]);

  const enrichedLines = useMemo(() => lines.map((line) => ({ ...line })), [lines]);

  const sortedLines = useMemo(() => {
    const source = customOrder
      ? customOrder
          .map((id) => enrichedLines.find((line) => line.id === id))
          .filter((line): line is LineWithMetrics => line !== undefined)
      : [...enrichedLines];

    return [...source].sort((a, b) => {
      const aTotals = totalsByLine.get(a.id) ?? { sales: 0, hours: 0 };
      const bTotals = totalsByLine.get(b.id) ?? { sales: 0, hours: 0 };
      const aSalesPerHour =
        hasLaborDataForLine(a.id) && aTotals.hours > 0
          ? aTotals.sales / 1_000_000 / aTotals.hours
          : 0;
      const bSalesPerHour =
        hasLaborDataForLine(b.id) && bTotals.hours > 0
          ? bTotals.sales / 1_000_000 / bTotals.hours
          : 0;

      const aValue =
        sortMetric === "sales"
          ? aTotals.sales
          : sortMetric === "hours"
            ? aTotals.hours
            : aSalesPerHour;
      const bValue =
        sortMetric === "sales"
          ? bTotals.sales
          : sortMetric === "hours"
            ? bTotals.hours
            : bSalesPerHour;

      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [customOrder, enrichedLines, sortMetric, sortOrder, totalsByLine]);

  const toggleSede = useCallback((sedeId: string) => {
    setSelectedSedeIds((prev) =>
      prev.includes(sedeId)
        ? prev.filter((id) => id !== sedeId)
        : [...prev, sedeId],
    );
  }, []);

  const toggleAllSedes = useCallback(() => {
    setSelectedSedeIds((prev) =>
      prev.length === allSedeIds.length ? [] : allSedeIds,
    );
  }, [allSedeIds]);

  const toggleLineExpanded = useCallback((lineId: string) => {
    setExpandedLineIds((prev) =>
      prev.includes(lineId)
        ? prev.filter((id) => id !== lineId)
        : [...prev, lineId],
    );
  }, []);

  const handleDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== index) {
        setDragOverIndex(index);
      }
    },
    [draggedIndex],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (targetIndex: number) => {
      if (draggedIndex === null || draggedIndex === targetIndex) return;
      const currentOrder = customOrder || sortedLines.map((line) => line.id);
      const nextOrder = [...currentOrder];
      const [draggedItem] = nextOrder.splice(draggedIndex, 1);
      nextOrder.splice(targetIndex, 0, draggedItem);
      setCustomOrder(nextOrder);
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [customOrder, draggedIndex, sortedLines],
  );

  const handleResetOrder = useCallback(() => {
    setCustomOrder(null);
  }, []);

  const handleSortToggle = useCallback((metric: SortMetric) => {
    if (sortMetric === metric) {
      setSortOrder((prevOrder) => (prevOrder === "asc" ? "desc" : "asc"));
    } else {
      setSortMetric(metric);
      setSortOrder("desc");
    }
    setCustomOrder(null);
  }, [sortMetric]);

  if (sortedLines.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] sm:rounded-3xl">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-700">Sin datos</p>
        <p className="mt-2 text-slate-700">No hay lineas para comparar</p>
      </section>
    );
  }

  return (
    <section
      data-animate="comparison-card"
      className="rounded-2xl border border-slate-200/70 bg-linear-to-b from-white to-slate-50/50 p-3 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] transition-all hover:shadow-[0_20px_70px_-35px_rgba(15,23,42,0.2)] sm:rounded-3xl sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-slate-800 sm:text-sm sm:tracking-[0.2em]">
            Comparativo de lineas
          </p>
          <h3 className="text-lg font-semibold text-slate-900 sm:text-2xl">
            Ventas en comparacion
          </h3>
          <p className="mt-1 text-xs text-slate-700 sm:text-sm">
            Selecciona varias sedes y expande cada linea para ver el detalle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {customOrder && (
            <button
              type="button"
              onClick={handleResetOrder}
              className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100"
            >
              Restaurar
            </button>
          )}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
            {sortedLines.length} {sortedLines.length === 1 ? "linea" : "lineas"}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
            Filtro de sedes
          </p>
          <button
            type="button"
            onClick={toggleAllSedes}
            className="rounded-full border border-blue-200/70 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-700 transition-all hover:border-blue-300"
          >
            {selectedSedeIds.length === allSedeIds.length
              ? "Deseleccionar todas"
              : "Seleccionar todas"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {sedes.map((sede) => {
            const selected = selectedSedeIds.includes(sede.id);
            return (
              <button
                key={sede.id}
                type="button"
                onClick={() => toggleSede(sede.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                  selected
                    ? "border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-300 shadow-sm"
                    : "border-slate-200/70 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {sede.name}
              </button>
            );
          })}
        </div>

      </div>

      <div className="-mx-1 mt-3 overflow-x-auto sm:mx-0 sm:mt-6">
        <table className="w-full min-w-100 border-separate border-spacing-y-1 text-left text-xs sm:min-w-175 sm:border-spacing-y-2 sm:text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-slate-700 sm:text-xs sm:tracking-[0.2em]">
              <th className="w-6 px-1 py-1.5 sm:w-8 sm:px-2 sm:py-2"></th>
              <th className="w-8 px-1 py-1.5 sm:w-10 sm:px-2 sm:py-2"></th>
              <th className="sticky left-0 bg-white px-2 py-1.5 text-left font-semibold sm:px-4 sm:py-2">
                Linea
              </th>
              <th className="px-2 py-1.5 text-left font-semibold sm:px-4 sm:py-2">
                <div className="flex items-center gap-2">
                  <span>Ventas</span>
                  <button
                    type="button"
                    onClick={() => handleSortToggle("sales")}
                    className={`rounded p-0.5 ${sortMetric === "sales" ? "text-blue-700" : "text-slate-400 hover:text-slate-700"}`}
                    aria-label="Cambiar orden de ventas"
                  >
                    {sortMetric === "sales" && sortOrder === "asc" ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </th>
              <th className="px-2 py-1.5 text-left font-semibold sm:px-4 sm:py-2">
                <div className="flex items-center gap-2">
                  <span>Vta/Hr</span>
                  <button
                    type="button"
                    onClick={() => handleSortToggle("salesPerHour")}
                    className={`rounded p-0.5 ${sortMetric === "salesPerHour" ? "text-blue-700" : "text-slate-400 hover:text-slate-700"}`}
                    aria-label="Cambiar orden de Vta/Hr"
                  >
                    {sortMetric === "salesPerHour" && sortOrder === "asc" ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </th>
              <th className="px-2 py-1.5 text-left font-semibold sm:px-4 sm:py-2">
                <div className="flex items-center gap-2">
                  <span>Horas</span>
                  <button
                    type="button"
                    onClick={() => handleSortToggle("hours")}
                    className={`rounded p-0.5 ${sortMetric === "hours" ? "text-blue-700" : "text-slate-400 hover:text-slate-700"}`}
                    aria-label="Cambiar orden de horas"
                  >
                    {sortMetric === "hours" && sortOrder === "asc" ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((line, index) => {
              const accent = getLineAccent(line.id);
              const totals = totalsByLine.get(line.id) ?? { sales: 0, hours: 0 };
              const salesPerHour =
                hasLaborDataForLine(line.id) && totals.hours > 0
                  ? totals.sales / 1_000_000 / totals.hours
                  : 0;
              const isExpanded = expandedLineIds.includes(line.id);
              const bySede = lineSedeMetrics.get(line.id) ?? new Map<string, SedeMetrics>();
              const orderedSedeDetails = selectedSedeIds
                .map((sedeId) => {
                  const metrics = bySede.get(sedeId) ?? { sales: 0, hours: 0 };
                  return {
                    sedeId,
                    sedeName: sedeNameMap.get(sedeId) ?? sedeId,
                    sales: metrics.sales,
                    hours: metrics.hours,
                    salesPerHour:
                      hasLaborDataForLine(line.id) && metrics.hours > 0
                        ? metrics.sales / 1_000_000 / metrics.hours
                        : 0,
                  };
                })
                .sort((a, b) => b.sales - a.sales);
              const selectedSedeCount = orderedSedeDetails.length;
              const averageSales =
                selectedSedeCount > 0
                  ? orderedSedeDetails.reduce((sum, detail) => sum + detail.sales, 0) /
                    selectedSedeCount
                  : 0;
              const averageHours =
                selectedSedeCount > 0
                  ? orderedSedeDetails.reduce((sum, detail) => sum + detail.hours, 0) /
                    selectedSedeCount
                  : 0;
              const averageSalesPerHour =
                selectedSedeCount > 0
                  ? orderedSedeDetails.reduce(
                      (sum, detail) => sum + detail.salesPerHour,
                      0,
                    ) / selectedSedeCount
                  : 0;

              return (
                <Fragment key={line.id}>
                  <tr
                    data-animate="comparison-row"
                    draggable
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleLineExpanded(line.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleLineExpanded(line.id);
                      }
                    }}
                    onDragStart={() => handleDragStart(index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop(index)}
                    className={`cursor-grab rounded-xl transition-all active:cursor-grabbing sm:rounded-2xl ${
                      draggedIndex === index
                        ? "bg-mercamio-100 opacity-50"
                        : dragOverIndex === index
                          ? "bg-mercamio-50 ring-2 ring-mercamio-300"
                          : `bg-white ${accent.rowHover}`
                    }`}
                  >
                    <td className="rounded-l-xl px-1 py-2 text-slate-700 sm:rounded-l-2xl sm:px-2 sm:py-3">
                      <GripVertical className="h-3 w-3 sm:h-4 sm:w-4" />
                    </td>
                    <td className="px-1 py-2 sm:px-2 sm:py-3">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/70 bg-white text-slate-600 transition-all">
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </span>
                    </td>
                    <td className="sticky left-0 bg-inherit px-2 py-2 sm:px-4 sm:py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
                        <p className="text-xs font-semibold text-slate-900 sm:text-sm">
                          {line.name}
                        </p>
                      </div>
                      <p className="hidden text-xs text-slate-700 sm:block">{line.id}</p>
                    </td>
                    <td className="px-2 py-2 text-xs font-semibold text-slate-900 sm:px-4 sm:py-3 sm:text-sm">
                      {hasData ? formatCOP(totals.sales) : "-"}
                    </td>
                    <td className="px-2 py-2 text-xs font-semibold text-slate-900 sm:px-4 sm:py-3 sm:text-sm">
                      {hasData ? salesPerHour.toFixed(3) : "-"}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-700 sm:px-4 sm:py-3 sm:text-sm">
                      {hasData ? `${formatHours(totals.hours)}h` : "0h"}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${line.id}-expanded`}>
                      <td colSpan={6} className="px-2 pb-3 pt-0 sm:px-4">
                        <div
                          className={`rounded-2xl border p-3 ${accent.expandedBorder} ${accent.expandedBg}`}
                        >
                          <div className="mb-2 grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            <span>Sede</span>
                            <span className="text-right">Ventas</span>
                            <span className="text-right">Vta/Hr</span>
                            <span className="text-right">Horas</span>
                          </div>
                          <div className="space-y-1">
                            {orderedSedeDetails.map((detail) => (
                              <div
                                key={`${line.id}-${detail.sedeId}`}
                                className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 rounded-xl border border-white/70 bg-white/75 px-3 py-2 text-xs"
                              >
                                <span className="font-semibold text-slate-900">
                                  {detail.sedeName}
                                </span>
                                <span className="text-right font-semibold text-slate-900">
                                  {formatCOP(detail.sales)}
                                </span>
                                <span className="text-right font-semibold text-slate-800">
                                  {detail.salesPerHour.toFixed(3)}
                                </span>
                                <span className="text-right text-slate-700">
                                  {formatHours(detail.hours)}h
                                </span>
                              </div>
                            ))}
                            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 rounded-xl border border-slate-300/80 bg-slate-100 px-3 py-2 text-xs font-semibold">
                              <span className="text-slate-800">Promedio ({selectedSedeCount} sedes)</span>
                              <span className="text-right text-slate-900">
                                {formatCOP(averageSales)}
                              </span>
                              <span className="text-right text-slate-900">
                                {averageSalesPerHour.toFixed(3)}
                              </span>
                              <span className="text-right text-slate-800">
                                {formatHours(averageHours)}h
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
