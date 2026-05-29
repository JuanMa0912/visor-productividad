import { ChevronDown, Users } from "lucide-react";
import type { HourlyAnalysisData } from "@/types";
import {
  calcVtaHr,
  formatCurrency,
  formatProductivity,
} from "./hourly-formatters";

interface HourBarProps {
  label: string;
  productivity: number;
  totalSales: number;
  employeesPresent: number;
  maxProductivity: number;
  isExpanded: boolean;
  onToggle: () => void;
  lines: HourlyAnalysisData["hours"][number]["lines"];
  employeesByLine?: Record<string, number>;
  heatColor: string;
  bucketMinutes: number;
}

export const HourBar = ({
  label,
  productivity,
  totalSales,
  employeesPresent,
  maxProductivity,
  isExpanded,
  onToggle,
  lines,
  employeesByLine,
  heatColor,
  bucketMinutes,
}: HourBarProps) => {
  const percentage =
    maxProductivity > 0 ? (productivity / maxProductivity) * 100 : 0;
  const hasActivity = totalSales > 0 || employeesPresent > 0;

  return (
    <div className="group rounded-2xl border border-slate-200/60 bg-white/80 p-2 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] transition-all hover:-translate-y-0.5 hover:border-amber-200/70 hover:bg-white">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasActivity}
        className="flex w-full items-center gap-3 text-left transition-opacity disabled:opacity-40"
      >
        <div className="w-26 shrink-0 text-right">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200/60">
            {label}
          </span>
        </div>

        <div className="relative h-9 flex-1 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
          {percentage > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(percentage, 2)}%`,
                backgroundColor: heatColor,
              }}
            />
          )}
          {hasActivity && (
            <div className="absolute inset-0 flex items-center justify-between px-3">
              <span className="inline-flex items-center rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200/60">
                Vta/Hr: {formatProductivity(productivity)}
              </span>
            </div>
          )}
        </div>

        <div className="flex w-64 shrink-0 items-center justify-end gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
            {formatCurrency(totalSales)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/70">
            <Users className="h-3.5 w-3.5" />
            {employeesPresent}
          </span>
          {hasActivity && (
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 transition-transform group-hover:text-mercamio-600 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          )}
        </div>
      </button>

      {isExpanded && hasActivity && (
        <div className="mt-2 ml-26 mr-64 rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
          <div className="grid grid-cols-12 gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500 ring-1 ring-slate-200/60">
            <span className="col-span-8">Linea</span>
            <span className="col-span-4 text-right">Vta/Hr</span>
          </div>
          <div className="mt-2 space-y-2">
            {lines
              .filter((l) => l.sales > 0)
              .sort((a, b) => b.sales - a.sales)
              .map((line) => {
                const lineEmployees = employeesByLine?.[line.lineId] ?? 0;
                const lineLaborHours = lineEmployees * (bucketMinutes / 60);
                const lineProductivity = calcVtaHr(line.sales, lineLaborHours);
                return (
                  <div
                    key={line.lineId}
                    className="grid grid-cols-12 items-center gap-2 rounded-xl border border-slate-200/60 bg-white px-3 py-2 text-sm shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)]"
                  >
                    <div className="col-span-8">
                      <p className="font-semibold text-slate-900">
                        {line.lineName}
                      </p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: "100%",
                            backgroundColor: heatColor,
                          }}
                        />
                      </div>
                    </div>
                    <span className="col-span-4 text-right font-semibold text-slate-800">
                      {formatProductivity(lineProductivity)}
                    </span>
                  </div>
                );
              })}
          </div>
          {lines.every((l) => l.sales === 0) && (
            <p className="py-2 text-center text-xs text-slate-500">
              Sin ventas registradas en esta hora
            </p>
          )}
        </div>
      )}
    </div>
  );
};
