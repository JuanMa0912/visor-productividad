"use client";

import { useMemo, useState } from "react";
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
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [empresa, setEmpresa] = useState<ExcelDianEmpresaValue>("mtodo");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  /** 0–100: fase servidor estimada; luego recepción real si hay Content-Length */
  const [downloadProgress, setDownloadProgress] = useState(0);

  const empresaLabel =
    EXCEL_DIAN_EMPRESA_OPTIONS.find((e) => e.value === empresa)?.label ?? "-";
  const startLapso = `${year}01`;
  const endLapso = `${year}12`;

  const handleDownload = async () => {
    setDownloadError("");
    if (empresa !== "mtodo") {
      setDownloadError(
        "Por ahora la descarga DIAN solo esta habilitada para Comercializadora.",
      );
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(2);
    let serverTimer: ReturnType<typeof setInterval> | undefined;
    const serverStartedAt = Date.now();
    try {
      serverTimer = setInterval(() => {
        setDownloadProgress((prev) => {
          const elapsed = Date.now() - serverStartedAt;
          const asymptotic = 82 * (1 - Math.exp(-elapsed / 28_000));
          return Math.max(prev, Math.min(82, asymptotic));
        });
      }, 450);

      const params = new URLSearchParams({ empresa, year });
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
        rawLen && /^\d+$/.test(rawLen.trim()) ? Number.parseInt(rawLen.trim(), 10) : 0;

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
          const transferPct = Math.min(100, Math.round((received / totalBytes) * 100));
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

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medios-magneticos-comercializadora-${year}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "No se pudo generar el Excel DIAN.",
      );
    } finally {
      if (serverTimer) clearInterval(serverTimer);
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

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
          <SelectValue placeholder="Anio" />
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
              Elige la empresa y el anio calendario. Para Comercializadora, el
              lapso se genera completo de enero a diciembre.
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

            {yearSelect("excel-dian-full-year", "Anio calendario", year, setYear)}
          </div>

          <p className="mt-5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-4 py-3 text-left text-sm leading-relaxed text-slate-600">
            El archivo usara datos del lapso {startLapso} al {endLapso}.
          </p>

          <Button
            type="button"
            size="lg"
            onClick={handleDownload}
            disabled={isDownloading}
            className="mt-7 h-11 w-full rounded-lg bg-slate-900 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400/60 focus-visible:ring-offset-2"
          >
            {isDownloading ? (
              <Loader2 className="size-5 animate-spin text-white" aria-hidden />
            ) : (
              <Download className="size-5 text-white" aria-hidden />
            )}
            {isDownloading ? "Generando..." : "Descargar Excel"}
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
                {downloadProgress < 83
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
                  Pendiente de generar
                </p>
                <p className="sr-only">
                  Empresa: {empresaLabel}. Rango efectivo: {startLapso} a{" "}
                  {endLapso}.
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
