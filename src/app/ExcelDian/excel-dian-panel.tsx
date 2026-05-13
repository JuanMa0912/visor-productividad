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
  const now = useMemo(() => new Date(), []);
  const defaultMonth = String(now.getMonth() + 1).padStart(2, "0");
  const defaultYear = String(now.getFullYear());

  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);

  const monthLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label ?? "—";

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
              Configura el periodo para generar tu archivo de conciliación
              fiscal oficial.
            </p>
          </header>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 text-left">
              <label
                htmlFor="excel-dian-month"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Mes de reporte
              </label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger
                  id="excel-dian-month"
                  size="default"
                  className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
                >
                  <SelectValue placeholder="Elegir mes" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className={selectListClassName}
                >
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
            <div className="space-y-2 text-left">
              <label
                htmlFor="excel-dian-year"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Año fiscal
              </label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger
                  id="excel-dian-year"
                  size="default"
                  className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
                >
                  <SelectValue placeholder="Elegir año" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className={selectListClassName}
                >
                  {yearOptions.map((y) => (
                    <SelectItem
                      key={y}
                      value={y}
                      className={selectItemClassName}
                    >
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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
                  Periodo seleccionado: {monthLabel} {year}
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
