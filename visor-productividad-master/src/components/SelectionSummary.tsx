import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";

interface SelectionSummaryProps {
  selectedSedeName: string;
  dateRangeLabel: string;
  lineFilterLabel: string;
  filteredCount: number;
  totalCount: number;
  availableDatesCount: number;
  hasRangeData: boolean;
  onDownloadPdf: () => void;
  onDownloadCsv: () => void;
  onDownloadXlsx: () => void;
  isDownloadDisabled: boolean;
}

export const SelectionSummary = ({
  selectedSedeName,
  dateRangeLabel,
  lineFilterLabel,
  filteredCount,
  totalCount,
  availableDatesCount,
  hasRangeData,
  onDownloadPdf,
  onDownloadCsv,
  onDownloadXlsx,
  isDownloadDisabled,
}: SelectionSummaryProps) => {
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      data-animate="top-bar"
      className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100/80 px-3 py-1 text-sm font-semibold text-slate-900">
          {selectedSedeName}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200/70">
          {dateRangeLabel}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200/60">
          {lineFilterLabel}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200/60">
          {filteredCount}/{totalCount} líneas
          {availableDatesCount > 0 && (
            <span className="text-slate-500">
              {availableDatesCount} días
            </span>
          )}
        </span>
        {!hasRangeData && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/70">
            Sin datos en este rango
          </span>
        )}
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          disabled={isDownloadDisabled}
          onClick={() => setExportOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Exportar
          <ChevronDown
            className={`h-3 w-3 transition-transform ${exportOpen ? "rotate-180" : ""}`}
          />
        </button>

        {exportOpen && (
          <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-lg">
            <button
              type="button"
              onClick={() => {
                onDownloadPdf();
                setExportOpen(false);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={() => {
                onDownloadCsv();
                setExportOpen(false);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={() => {
                onDownloadXlsx();
                setExportOpen(false);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              Descargar XLSX
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

