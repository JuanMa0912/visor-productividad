"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
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
  periodRangeToLapsoBounds,
} from "./excel-dian-period";

const selectListClassName =
  "z-[200] min-w-(--radix-select-trigger-width) rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg";

const selectItemClassName =
  "cursor-pointer py-2.5 pl-3 pr-8 text-slate-900 " +
  "data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900 " +
  "data-[state=checked]:bg-slate-50 data-[state=checked]:text-slate-900";

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

/** Años desde (actual - 6) hasta el año calendario actual (sin futuros). */
function buildYearOptions(maxYear: number): string[] {
  const from = maxYear - 6;
  const to = maxYear;
  const out: string[] = [];
  for (let i = from; i <= to; i += 1) out.push(String(i));
  return out.reverse();
}

function currentLapsoYm(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function clampLapsoRange(bounds: {
  startLapso: string;
  endLapso: string;
}): { startLapso: string; endLapso: string } | null {
  const cap = currentLapsoYm();
  const { startLapso } = bounds;
  let { endLapso } = bounds;
  if (startLapso > cap) return null;
  if (endLapso > cap) endLapso = cap;
  if (startLapso > endLapso) return null;
  return { startLapso, endLapso };
}

/** Tiempo desde clic en Descargar hasta tener el blob listo (consulta + Excel + red). */
function formatExcelDianExportDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toLocaleString("es-CO", {
      maximumFractionDigits: 1,
      minimumFractionDigits: s < 10 ? 1 : 0,
    })} s`;
  }
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m} min ${rs} s`;
}

function monthsForYear(
  yearStr: string,
  calendarYear: number,
  calendarMonth: number,
): { value: string; label: string }[] {
  const y = Number.parseInt(yearStr, 10);
  if (!Number.isFinite(y) || y > calendarYear) return MONTH_OPTIONS;
  if (y < calendarYear) return MONTH_OPTIONS;
  return MONTH_OPTIONS.filter(
    (m) => Number.parseInt(m.value, 10) <= calendarMonth,
  );
}

export function ExcelDianPanel() {
  const now = new Date();
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const yearOptions = useMemo(
    () => buildYearOptions(calendarYear),
    [calendarYear],
  );

  const [periodMode, setPeriodMode] =
    useState<ExcelDianPeriodMode>("full_year");
  const [year, setYear] = useState(() => String(calendarYear));
  const [month, setMonth] = useState(() =>
    String(calendarMonth).padStart(2, "0"),
  );
  const [spanStartMonth, setSpanStartMonth] = useState(() =>
    String(calendarMonth).padStart(2, "0"),
  );
  const [spanStartYear, setSpanStartYear] = useState(() => String(calendarYear));
  const [spanEndMonth, setSpanEndMonth] = useState(() =>
    String(calendarMonth).padStart(2, "0"),
  );
  const [spanEndYear, setSpanEndYear] = useState(() => String(calendarYear));

  const [empresa, setEmpresa] = useState<ExcelDianEmpresaValue>("mtodo");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [lastExportMeta, setLastExportMeta] = useState<{
    durationLabel: string;
    lapsoLabel: string;
  } | null>(null);
  const downloadCompleteHideTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  useEffect(() => {
    return () => {
      if (downloadCompleteHideTimeoutRef.current) {
        clearTimeout(downloadCompleteHideTimeoutRef.current);
        downloadCompleteHideTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!yearOptions.includes(year)) {
      setYear(String(calendarYear));
    }
  }, [calendarYear, year, yearOptions]);

  const onPeriodModeChange = (next: ExcelDianPeriodMode) => {
    setPeriodMode(next);
    if (next === "month_span") {
      setSpanStartMonth(month);
      setSpanStartYear(year);
      setSpanEndMonth(month);
      setSpanEndYear(year);
    }
  };

  const reportRange = useMemo(() => {
    const today = new Date();
    if (periodMode === "full_year") {
      return buildExcelDianFullYearRange(year, today);
    }
    if (periodMode === "single_month") {
      return buildExcelDianInclusiveRange(month, year, today);
    }
    return buildExcelDianMonthSpanRange(
      spanStartMonth,
      spanStartYear,
      spanEndMonth,
      spanEndYear,
      today,
    );
  }, [
    periodMode,
    year,
    month,
    spanStartMonth,
    spanStartYear,
    spanEndMonth,
    spanEndYear,
  ]);

  const lapsoBounds = useMemo(() => {
    const raw = periodRangeToLapsoBounds(reportRange);
    if (!raw) return null;
    return clampLapsoRange(raw);
  }, [reportRange]);

  const empresaLabel =
    EXCEL_DIAN_EMPRESA_OPTIONS.find((e) => e.value === empresa)?.label ?? "-";

  const rangeDescription = useMemo(() => {
    if (!lapsoBounds) {
      return "Revisa el periodo: el rango queda vacío o es futuro.";
    }
    const capped = reportRange.cappedAtToday
      ? " El fin se acotó a la fecha de hoy porque el periodo incluye el mes en curso."
      : "";
    return `El archivo usará datos del lapso ${lapsoBounds.startLapso} al ${lapsoBounds.endLapso}.${capped}`;
  }, [lapsoBounds, reportRange.cappedAtToday]);

  const handleDownload = async () => {
    setDownloadError("");
    if (!lapsoBounds) {
      setDownloadError(
        "El periodo seleccionado no es valido (futuro o sin datos).",
      );
      return;
    }

    if (downloadCompleteHideTimeoutRef.current) {
      clearTimeout(downloadCompleteHideTimeoutRef.current);
      downloadCompleteHideTimeoutRef.current = null;
    }

    setIsDownloading(true);
    setDownloadProgress(2);
    let serverTimer: ReturnType<typeof setInterval> | undefined;
    let downloadSucceeded = false;
    const serverStartedAt = Date.now();
    try {
      serverTimer = setInterval(() => {
        setDownloadProgress((prev) => {
          const elapsed = Date.now() - serverStartedAt;
          const asymptotic = 82 * (1 - Math.exp(-elapsed / 28_000));
          return Math.max(prev, Math.min(82, asymptotic));
        });
      }, 450);

      const params = new URLSearchParams({
        empresa,
        startLapso: lapsoBounds.startLapso,
        endLapso: lapsoBounds.endLapso,
      });
      const response = await fetch(`/api/excel-dian/export?${params}`, {
        method: "GET",
        cache: "no-store",
      });
      if (serverTimer) clearInterval(serverTimer);
      serverTimer = undefined;

      if (!response.ok) {
        let message = "No se pudo generar el Excel DIAN.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Mantiene el mensaje generico si el servidor no respondio JSON.
        }
        throw new Error(message);
      }

      const rawLen = response.headers.get("Content-Length");
      const totalBytes =
        rawLen && /^\d+$/.test(rawLen.trim())
          ? Number.parseInt(rawLen.trim(), 10)
          : 0;

      let blob: Blob;
      const body = response.body;
      if (body && totalBytes > 0) {
        const reader = body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const transferPct = Math.min(
            100,
            Math.round((received / totalBytes) * 100),
          );
          setDownloadProgress(82 + Math.round((transferPct / 100) * 18));
        }
        const type =
          response.headers.get("Content-Type") ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        blob = new Blob(chunks, { type });
        setDownloadProgress(100);
      } else {
        setDownloadProgress(92);
        blob = await response.blob();
        setDownloadProgress(100);
      }

      const elapsedMs = Date.now() - serverStartedAt;
      setLastExportMeta({
        durationLabel: formatExcelDianExportDuration(elapsedMs),
        lapsoLabel: `${empresa} · ${lapsoBounds.startLapso}–${lapsoBounds.endLapso}`,
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medios-magneticos-${empresa}-${lapsoBounds.startLapso}-${lapsoBounds.endLapso}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      downloadSucceeded = true;
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "No se pudo generar el Excel DIAN.",
      );
    } finally {
      if (serverTimer) clearInterval(serverTimer);
      if (downloadSucceeded) {
        setDownloadProgress(100);
        downloadCompleteHideTimeoutRef.current = setTimeout(() => {
          downloadCompleteHideTimeoutRef.current = null;
          setIsDownloading(false);
          setDownloadProgress(0);
        }, 350);
      } else {
        setIsDownloading(false);
        setDownloadProgress(0);
      }
    }
  };

  const monthOptionsSingle = useMemo(
    () => monthsForYear(year, calendarYear, calendarMonth),
    [year, calendarYear, calendarMonth],
  );

  const monthOptionsSpanStart = useMemo(
    () => monthsForYear(spanStartYear, calendarYear, calendarMonth),
    [spanStartYear, calendarYear, calendarMonth],
  );

  const monthOptionsSpanEnd = useMemo(
    () => monthsForYear(spanEndYear, calendarYear, calendarMonth),
    [spanEndYear, calendarYear, calendarMonth],
  );

  useEffect(() => {
    if (!monthOptionsSingle.some((m) => m.value === month)) {
      setMonth(monthOptionsSingle[0]?.value ?? "01");
    }
  }, [month, monthOptionsSingle]);

  useEffect(() => {
    if (!monthOptionsSpanStart.some((m) => m.value === spanStartMonth)) {
      setSpanStartMonth(monthOptionsSpanStart[0]?.value ?? "01");
    }
  }, [spanStartMonth, monthOptionsSpanStart]);

  useEffect(() => {
    if (!monthOptionsSpanEnd.some((m) => m.value === spanEndMonth)) {
      setSpanEndMonth(monthOptionsSpanEnd[0]?.value ?? "01");
    }
  }, [spanEndMonth, monthOptionsSpanEnd]);

  const monthSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[],
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
          {options.map((m) => (
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
      <Select
        value={value}
        onValueChange={(v) => {
          onChange(v);
          setDownloadError("");
        }}
      >
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
              Exportacion Excel
            </h1>
            <p className="mt-2.5 max-w-xl text-pretty text-sm leading-relaxed text-slate-500">
              Elige la empresa (Comercializadora, Mercamio o Merkmios) y el
              periodo: un mes, varios meses o el año calendario completo
              (enero–diciembre). Cada empresa usa su base en formato lapso
              YYYYMM.
            </p>
          </header>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 text-left">
              <label
                htmlFor="excel-dian-empresa"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Empresa
              </label>
              <Select
                value={empresa}
                onValueChange={(v) => {
                  setEmpresa(v as ExcelDianEmpresaValue);
                  setDownloadError("");
                }}
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

            <div className="space-y-2 text-left">
              <label
                htmlFor="excel-dian-period-mode"
                className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Tipo de periodo
              </label>
              <Select
                value={periodMode}
                onValueChange={(v) => {
                  onPeriodModeChange(v as ExcelDianPeriodMode);
                  setDownloadError("");
                }}
              >
                <SelectTrigger
                  id="excel-dian-period-mode"
                  size="default"
                  className="h-11 w-full min-w-0 rounded-lg border-slate-200 bg-white text-left text-[15px] font-medium text-slate-900 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 focus-visible:ring-slate-300/50"
                >
                  <SelectValue placeholder="Periodo" />
                </SelectTrigger>
                <SelectContent position="popper" className={selectListClassName}>
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
              {monthSelect(
                "excel-dian-month",
                "Mes",
                month,
                (v) => {
                  setMonth(v);
                  setDownloadError("");
                },
                monthOptionsSingle,
              )}
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
                  (v) => {
                    setSpanStartMonth(v);
                    setDownloadError("");
                  },
                  monthOptionsSpanStart,
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
                  (v) => {
                    setSpanEndMonth(v);
                    setDownloadError("");
                  },
                  monthOptionsSpanEnd,
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

          <p className="mt-5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-4 py-3 text-left text-sm leading-relaxed text-slate-600">
            {rangeDescription}
          </p>

          <Button
            type="button"
            size="lg"
            onClick={handleDownload}
            disabled={isDownloading || !lapsoBounds}
            className="mt-7 h-11 w-full rounded-lg bg-slate-900 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400/60 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isDownloading ? (
              <Loader2 className="size-5 animate-spin text-white" aria-hidden />
            ) : (
              <Download className="size-5 text-white" aria-hidden />
            )}
            {isDownloading
              ? downloadProgress >= 100
                ? "Listo"
                : "Generando..."
              : "Descargar Excel"}
          </Button>

          {isDownloading ? (
            <div className="mt-4 space-y-2">
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(downloadProgress)}
                aria-label="Progreso de exportacion"
              >
                <div
                  className="h-full rounded-full bg-emerald-600 transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.min(100, downloadProgress)}%` }}
                />
              </div>
              <p className="text-center text-xs text-slate-500">
                {downloadProgress >= 100
                  ? lastExportMeta
                    ? `Exportacion lista · ${lastExportMeta.durationLabel}`
                    : "Exportacion lista."
                  : downloadProgress < 83
                    ? "Generando en el servidor (consulta y Excel); puede tardar varios minutos."
                    : "Recibiendo archivo..."}
                <span className="ml-1 tabular-nums text-slate-600">
                  {Math.round(downloadProgress)}%
                </span>
              </p>
            </div>
          ) : null}

          {downloadError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm font-medium text-rose-700"
            >
              {downloadError}
            </p>
          ) : null}

          <footer className="mt-8 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
              <div className="text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Ultima exportacion
                </p>
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {lastExportMeta ? (
                    <>
                      {lastExportMeta.durationLabel}
                      <span className="block text-xs font-normal text-slate-500">
                        Lapso {lastExportMeta.lapsoLabel}
                      </span>
                    </>
                  ) : (
                    "Pendiente de generar"
                  )}
                </p>
                <p className="sr-only">
                  Empresa: {empresaLabel}. Modo: {periodMode}. Lapso:{" "}
                  {lapsoBounds
                    ? `${lapsoBounds.startLapso} a ${lapsoBounds.endLapso}`
                    : "—"}
                  .
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
