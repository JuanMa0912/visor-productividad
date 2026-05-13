"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EXCEL_DIAN_EMPRESA_OPTIONS,
  type ExcelDianEmpresaValue,
} from "./excel-dian-empresa";
import {
  buildExcelDianFullYearRange,
  buildExcelDianInclusiveRange,
  buildExcelDianMonthSpanRange,
  EXCEL_DIAN_PERIOD_MODE_OPTIONS,
  type ExcelDianPeriodMode,
  parseLocalYmd,
} from "./excel-dian-period";

const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

const selectListClassName =
  "z-[200] min-w-(--radix-select-trigger-width) rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg";

const selectItemClassName =
  "cursor-pointer py-2.5 pl-3 pr-8 text-slate-900 " +
  "data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900 " +
  "data-[state=checked]:bg-slate-50 data-[state=checked]:text-slate-900";

function buildYearOptions(): string[] {
  const y = new Date().getFullYear();
  const from = y - 6;
  const to = y + 2;
  const out: string[] = [];
  for (let i = from; i <= to; i += 1) out.push(String(i));
  return out.reverse();
}

export function ExcelDianPanel() {
  const yearOptions = useMemo(() => buildYearOptions(), []);
  const [periodMode, setPeriodMode] =
    useState<ExcelDianPeriodMode>("single_month");
  const [month, setMonth] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [spanStartMonth, setSpanStartMonth] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [spanStartYear, setSpanStartYear] = useState(() =>
    String(new Date().getFullYear()),
  );
  const [spanEndMonth, setSpanEndMonth] = useState(() =>
    String(new Date().getMonth() + 1).padStart(2, "0"),
  );
  const [spanEndYear, setSpanEndYear] = useState(() =>
    String(new Date().getFullYear()),
  );
  const [empresa, setEmpresa] = useState<ExcelDianEmpresaValue>("mercamio");

  const monthLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label ?? "—";
  const empresaLabel =
    EXCEL_DIAN_EMPRESA_OPTIONS.find((e) => e.value === empresa)?.label ?? "—";

  const reportRange = useMemo(() => {
    if (periodMode === "single_month") {
      return buildExcelDianInclusiveRange(month, year);
    }
    if (periodMode === "month_span") {
      return buildExcelDianMonthSpanRange(
        spanStartMonth,
        spanStartYear,
        spanEndMonth,
        spanEndYear,
      );
    }
    return buildExcelDianFullYearRange(year);
  }, [
    periodMode,
    month,
    year,
    spanStartMonth,
    spanStartYear,
    spanEndMonth,
    spanEndYear,
  ]);

  const rangeDescription = useMemo(() => {
    if (!reportRange.start || !reportRange.end) return "";
    const fmt = new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const from = fmt.format(parseLocalYmd(reportRange.start));
    const to = fmt.format(parseLocalYmd(reportRange.end));
    const cap = reportRange.cappedAtToday
      ? " El periodo incluye el mes en curso: los datos van solo hasta hoy."
      : "";
    if (periodMode === "single_month") {
      return `El archivo usará datos desde el ${from} hasta el ${to} (${monthLabel} ${year}).${cap}`;
    }
    if (periodMode === "full_year") {
      return `El archivo usará datos desde el ${from} hasta el ${to} (año ${year}).${cap}`;
    }
    return `El archivo usará datos desde el ${from} hasta el ${to} (lapso de meses).${cap}`;
  }, [reportRange, periodMode, monthLabel, year]);

  const onPeriodModeChange = (next: ExcelDianPeriodMode) => {
    setPeriodMode(next);
    if (next === "month_span") {
      setSpanStartMonth(month);
      setSpanStartYear(year);
      setSpanEndMonth(month);
      setSpanEndYear(year);
    }
  };

  const monthSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="space-y-2 text-left">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
      >
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          size="default"
          className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
        >
          <SelectValue placeholder="Mes" />
        </SelectTrigger>
        <SelectContent position="popper" className={selectListClassName}>
          {MONTH_OPTIONS.map((m) => (
            <SelectItem
              key={m.value}
              value={m.value}
              className={selectItemClassName}
            >
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const yearSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="space-y-2 text-left">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
      >
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          size="default"
          className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
        >
          <SelectValue placeholder="Año" />
        </SelectTrigger>
        <SelectContent position="popper" className={selectListClassName}>
          {yearOptions.map((y) => (
            <SelectItem key={y} value={y} className={selectItemClassName}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="relative min-h-[calc(100vh-2rem)] overflow-x-hidden bg-[#F8FAFC] px-4 py-12 sm:px-6 md:py-16">
      <div className="relative mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-lg shadow-slate-200/40 md:p-10">
          <header className="flex flex-col items-center text-center">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-200/90 bg-slate-50">
              <FileSpreadsheet
                className="size-6 text-emerald-600"
                aria-hidden
                strokeWidth={1.75}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-800">
                DIAN
              </span>
              <span className="text-sm font-medium text-slate-500">
                Centro de Reportes
              </span>
            </div>
            <h1 className="mt-4 text-balance text-2xl font-bold tracking-tight text-slate-900 md:text-[1.65rem] md:leading-snug">
              Exportación Excel
            </h1>
            <p className="mt-2.5 max-w-xl text-pretty text-sm leading-relaxed text-slate-500">
              Elige la empresa y el periodo (un mes, varios meses o un año
              calendario); cada legal genera su archivo por separado.
            </p>
          </header>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 text-left sm:col-span-2 lg:col-span-1">
              <label
                htmlFor="excel-dian-empresa"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Empresa
              </label>
              <Select
                value={empresa}
                onValueChange={(v) => setEmpresa(v as ExcelDianEmpresaValue)}
              >
                <SelectTrigger
                  id="excel-dian-empresa"
                  size="default"
                  className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
                >
                  <SelectValue placeholder="Elegir empresa" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className={selectListClassName}
                >
                  {EXCEL_DIAN_EMPRESA_OPTIONS.map((e) => (
                    <SelectItem
                      key={e.value}
                      value={e.value}
                      className={selectItemClassName}
                    >
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 text-left sm:col-span-2 lg:col-span-1">
              <label
                htmlFor="excel-dian-period-mode"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Tipo de periodo
              </label>
              <Select
                value={periodMode}
                onValueChange={(v) => onPeriodModeChange(v as ExcelDianPeriodMode)}
              >
                <SelectTrigger
                  id="excel-dian-period-mode"
                  size="default"
                  className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
                >
                  <SelectValue placeholder="Tipo de periodo" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className={selectListClassName}
                >
                  {EXCEL_DIAN_PERIOD_MODE_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className={selectItemClassName}
                      title={opt.description}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {periodMode === "single_month" ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {monthSelect("excel-dian-month", "Mes de reporte", month, setMonth)}
              {yearSelect("excel-dian-year", "Año", year, setYear)}
            </div>
          ) : null}

          {periodMode === "month_span" ? (
            <div className="mt-6 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                {monthSelect(
                  "excel-dian-span-start-m",
                  "Desde (mes)",
                  spanStartMonth,
                  setSpanStartMonth,
                )}
                {yearSelect(
                  "excel-dian-span-start-y",
                  "Desde (año)",
                  spanStartYear,
                  setSpanStartYear,
                )}
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {monthSelect(
                  "excel-dian-span-end-m",
                  "Hasta (mes)",
                  spanEndMonth,
                  setSpanEndMonth,
                )}
                {yearSelect(
                  "excel-dian-span-end-y",
                  "Hasta (año)",
                  spanEndYear,
                  setSpanEndYear,
                )}
              </div>
            </div>
          ) : null}

          {periodMode === "full_year" ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {yearSelect(
                "excel-dian-full-year",
                "Año calendario",
                year,
                setYear,
              )}
            </div>
          ) : null}

          {rangeDescription ? (
            <p className="mt-5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-4 py-3 text-left text-sm leading-relaxed text-slate-600">
              {rangeDescription}
            </p>
          ) : null}

          <Button
            type="button"
            size="lg"
            className="mt-7 h-11 w-full rounded-lg bg-slate-900 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400/60 focus-visible:ring-offset-2"
          >
            <Download className="size-5 text-white" aria-hidden />
            Descargar Excel
          </Button>

          <footer className="mt-8 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
              <div className="text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Última exportación
                </p>
                <p className="mt-1 text-sm font-medium text-slate-700">
                  12 Abr, 2026 • 2.4 MB
                </p>
                <p className="sr-only">
                  Empresa: {empresaLabel}. Modo: {periodMode}. Rango efectivo:{" "}
                  {reportRange.start} a {reportRange.end}
                  {reportRange.cappedAtToday ? " (acotado a hoy)" : ""}.
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Estado del servicio
                </p>
                <div className="mt-1 flex items-center gap-2 sm:justify-end">
                  <span
                    className="size-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25"
                    aria-hidden
                  />
                  <span className="text-sm font-medium text-slate-700">
                    Operativo
                  </span>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
