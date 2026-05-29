"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
} from "react";
import {
  calcLineMargin,
  formatCOP,
  getSedeM2,
  hasLaborDataForLine,
} from "@/lib/shared/calc";
import {
  escapeCsvValue,
  sanitizeExportText,
} from "@/lib/shared/export-utils";
import type { Sede } from "@/lib/shared/constants";
import type { DailyProductivity } from "@/types";
import type { DateRange, ViewExportHandle } from "./types";
import { formatM2Value } from "./formatters";

const loadExcelJs = () => import("exceljs");

export type M2MetricsSectionProps = {
  dailyDataSet: DailyProductivity[];
  sedes: Sede[];
  selectedSedeIds: string[];
  dateRange: DateRange;
};

export const M2MetricsSection = forwardRef<ViewExportHandle, M2MetricsSectionProps>(({
  dailyDataSet,
  sedes,
  selectedSedeIds,
  dateRange,
}, ref) => {
  const selectedSedeIdSet = useMemo(
    () => new Set(selectedSedeIds),
    [selectedSedeIds],
  );
  const filteredSedes = useMemo(() => {
    if (selectedSedeIds.length === 0) return sedes;
    return sedes.filter((sede) => selectedSedeIdSet.has(sede.id));
  }, [selectedSedeIds.length, sedes, selectedSedeIdSet]);
  const metrics = useMemo(() => {
    const bySede = new Map<
      string,
      { sales: number; hours: number; margin: number }
    >();

    dailyDataSet.forEach((item) => {
      if (dateRange.start && item.date < dateRange.start) return;
      if (dateRange.end && item.date > dateRange.end) return;
      if (selectedSedeIds.length > 0 && !selectedSedeIdSet.has(item.sede)) return;

      const entry = bySede.get(item.sede) ?? { sales: 0, hours: 0, margin: 0 };
      item.lines.forEach((line) => {
        const hasLabor = hasLaborDataForLine(line.id);
        const hours = hasLabor ? line.hours : 0;
        entry.sales += line.sales;
        entry.hours += hours;
        entry.margin += calcLineMargin(line);
      });
      bySede.set(item.sede, entry);
    });

    return filteredSedes.map((sede) => {
      const totals = bySede.get(sede.id) ?? { sales: 0, hours: 0, margin: 0 };
      const m2 = getSedeM2(sede.name) ?? getSedeM2(sede.id);
      const salesPerM2 = m2 ? totals.sales / m2 : null;
      const hoursPerM2 = m2 ? totals.hours / m2 : null;
      const marginPerM2 = m2 ? totals.margin / m2 : null;

      return {
        sedeId: sede.id,
        sedeName: sede.name,
        m2,
        salesPerM2,
        hoursPerM2,
        marginPerM2,
      };
    });
  }, [
    dailyDataSet,
    dateRange.end,
    dateRange.start,
    filteredSedes,
    selectedSedeIdSet,
    selectedSedeIds.length,
  ]);

  const handleExportM2Csv = useCallback(() => {
    if (metrics.length === 0) return false;
    const rows = [
      ["Sede", "m2", "Ventas/m2", "Horas/m2", "Margen/m2"],
      ...metrics.map((item) => [
        item.sedeName,
        item.m2 ?? "",
        item.salesPerM2 ?? "",
        item.hoursPerM2 ?? "",
        item.marginPerM2 ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `indicadores-m2-${dateRange.start || "sin-fecha"}-${dateRange.end || "sin-fecha"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }, [dateRange.end, dateRange.start, metrics]);

  const handleExportM2Xlsx = useCallback(async () => {
    if (metrics.length === 0) return false;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Indicadores m2");
    sheet.columns = [
      { key: "sede", width: 22 },
      { key: "m2", width: 10 },
      { key: "sales", width: 16 },
      { key: "hours", width: 12 },
      { key: "margin", width: 16 },
    ];
    sheet.addRow(["Sede", "m2", "Ventas/m2", "Horas/m2", "Margen/m2"]);
    metrics.forEach((item) => {
      sheet.addRow([
        sanitizeExportText(item.sedeName),
        item.m2 ?? null,
        item.salesPerM2 ?? null,
        item.hoursPerM2 ?? null,
        item.marginPerM2 ?? null,
      ]);
    });
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `indicadores-m2-${dateRange.start || "sin-fecha"}-${dateRange.end || "sin-fecha"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }, [dateRange.end, dateRange.start, metrics]);

  useImperativeHandle(
    ref,
    () => ({
      exportCsv: handleExportM2Csv,
      exportXlsx: handleExportM2Xlsx,
    }),
    [handleExportM2Csv, handleExportM2Xlsx],
  );

  if (metrics.length === 0) return null;

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-700">
          Indicadores por m2
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900">
          Ventas, horas y margen por m2
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-slate-700">
          <thead className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Sede</th>
              <th className="px-3 py-2 text-right font-semibold">m2</th>
              <th className="px-3 py-2 text-right font-semibold">Ventas/m2</th>
              <th className="px-3 py-2 text-right font-semibold">Horas/m2</th>
              <th className="px-3 py-2 text-right font-semibold">Margen/m2</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((item) => (
              <tr key={item.sedeId} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold text-slate-900">
                  {item.sedeName}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatM2Value(item.m2)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {item.salesPerM2 == null ? "--" : formatCOP(item.salesPerM2)}
                </td>
                <td className="px-3 py-2 text-right">
                  {item.hoursPerM2 == null ? "--" : item.hoursPerM2.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">
                  {item.marginPerM2 == null ? "--" : formatCOP(item.marginPerM2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

M2MetricsSection.displayName = "M2MetricsSection";
