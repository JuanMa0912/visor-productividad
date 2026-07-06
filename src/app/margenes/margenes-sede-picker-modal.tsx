"use client";

import { useMemo } from "react";
import { Building2, Loader2 } from "lucide-react";
import { empresaLabel } from "@/lib/margenes/margen-final-query";

export type MargenSedePickerOption = {
  value: string;
  label: string;
  empresa: string;
  idCo: string;
  rowCount: number;
};

type MargenesSedePickerModalProps = {
  open: boolean;
  rangeLabel: string;
  dateStart: string;
  dateEnd: string;
  minDate?: string;
  maxDate?: string;
  onDateStartChange: (value: string) => void;
  onDateEndChange: (value: string) => void;
  sedes: MargenSedePickerOption[];
  selectedSedes: string[];
  loading: boolean;
  error: string | null;
  onToggleSede: (value: string) => void;
  onToggleEmpresa: (empresa: string, values: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onConfirm: () => void;
};

export function MargenesSedePickerModal({
  open,
  rangeLabel,
  dateStart,
  dateEnd,
  minDate,
  maxDate,
  onDateStartChange,
  onDateEndChange,
  sedes,
  selectedSedes,
  loading,
  error,
  onToggleSede,
  onToggleEmpresa,
  onSelectAll,
  onClearAll,
  onConfirm,
}: MargenesSedePickerModalProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, MargenSedePickerOption[]>();
    for (const sede of sedes) {
      const bucket = map.get(sede.empresa) ?? [];
      bucket.push(sede);
      map.set(sede.empresa, bucket);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => empresaLabel(a).localeCompare(empresaLabel(b), "es"))
      .map(([empresa, items]) => ({
        empresa,
        label: empresaLabel(empresa),
        sedes: items.sort((a, b) => a.label.localeCompare(b.label, "es")),
      }));
  }, [sedes]);

  const selectedSet = useMemo(() => new Set(selectedSedes), [selectedSedes]);

  const selectedLabels = useMemo(
    () =>
      sedes
        .filter((sede) => selectedSet.has(sede.value))
        .map((sede) => sede.label),
    [sedes, selectedSet],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#0d0f18]/80 px-3 py-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="margenes-sede-picker-title"
    >
      <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#2a2f47] bg-[#141720] shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
        <div className="shrink-0 border-b border-[#2a2f47] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#232740] text-[#4f8ef7]">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="margenes-sede-picker-title"
                className="text-sm font-bold text-[#dde3f0]"
              >
                Elige las sedes a analizar
              </h2>
              <p className="text-[11px] leading-snug text-[#6b7590]">
                Sede(s) y rango. Por defecto: mes en curso (1 a ayer).
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={loading || selectedSedes.length === sedes.length}
                className="text-[11px] font-medium text-[#4f8ef7] hover:text-[#3b7de0] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Seleccionar todas
              </button>
              <button
                type="button"
                onClick={onClearAll}
                disabled={loading || selectedSedes.length === 0}
                className="text-[11px] font-medium text-[#4f8ef7] hover:text-[#3b7de0] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Limpiar todas
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2 pl-11">
            <label className="flex flex-col gap-0.5 text-[9px] tracking-wide text-[#6b7590] uppercase">
              Desde
              <input
                type="date"
                value={dateStart}
                min={minDate}
                max={dateEnd || maxDate}
                onChange={(event) => onDateStartChange(event.target.value)}
                className="rounded border border-[#2a2f47] bg-[#1b1e2e] px-2 py-1 text-[11px] normal-case text-[#dde3f0]"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] tracking-wide text-[#6b7590] uppercase">
              Hasta
              <input
                type="date"
                value={dateEnd}
                min={dateStart || minDate}
                max={maxDate}
                onChange={(event) => onDateEndChange(event.target.value)}
                className="rounded border border-[#2a2f47] bg-[#1b1e2e] px-2 py-1 text-[11px] normal-case text-[#dde3f0]"
              />
            </label>
            <span className="pb-0.5 text-[10px] text-[#6b7590]">{rangeLabel}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[#6b7590]">
              <Loader2 className="h-5 w-5 animate-spin text-[#4f8ef7]" />
            </div>
          ) : error ? (
            <p className="rounded border border-[#7f1d1d] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#f87171]">
              {error}
            </p>
          ) : sedes.length === 0 ? (
            <p className="text-xs text-[#6b7590]">
              No hay sedes con datos en margen_final.
            </p>
          ) : (
            <div className="space-y-2">
              {grouped.map((group) => {
                const groupValues = group.sedes.map((sede) => sede.value);
                const selectedInGroup = groupValues.filter((value) =>
                  selectedSet.has(value),
                ).length;
                const allInGroup =
                  groupValues.length > 0 &&
                  selectedInGroup === groupValues.length;

                return (
                  <section
                    key={group.empresa}
                    className="rounded-md border border-[#2a2f47] bg-[#1b1e2e]"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-[#2a2f47] px-2.5 py-1.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#dde3f0]">
                        {group.label}
                        <span className="ml-1.5 font-normal normal-case text-[#6b7590]">
                          {selectedInGroup}/{group.sedes.length}
                        </span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => onToggleEmpresa(group.empresa, groupValues)}
                        className="shrink-0 text-[10px] font-medium text-[#4f8ef7] hover:text-[#3b7de0]"
                      >
                        {allInGroup ? "Quitar todas" : "Marcar todas"}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-0.5 p-1 sm:grid-cols-3 md:grid-cols-4">
                      {group.sedes.map((sede) => {
                        const checked = selectedSet.has(sede.value);
                        return (
                          <label
                            key={sede.value}
                            className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 transition ${
                              checked
                                ? "border-[#4f8ef7]/60 bg-[#4f8ef7]/10"
                                : "border-transparent hover:border-[#2a2f47] hover:bg-[#141720]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleSede(sede.value)}
                              className="h-3.5 w-3.5 shrink-0 rounded border-[#2a2f47] bg-[#141720] text-[#4f8ef7] focus:ring-[#4f8ef7]/40"
                            />
                            <span className="min-w-0 truncate text-xs font-medium text-[#dde3f0]">
                              {sede.label}
                              <span className="ml-1 font-normal text-[#6b7590]">
                                {sede.idCo}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#2a2f47] px-3 py-2">
          <p className="min-w-0 truncate text-[11px] text-[#6b7590]">
            {selectedSedes.length === 0
              ? "Marca al menos una sede para continuar."
              : selectedSedes.length === 1
                ? `1 sede: ${selectedLabels[0]}`
                : `${selectedSedes.length} sedes seleccionadas`}
          </p>
          <button
            type="button"
            disabled={selectedSedes.length === 0 || loading || !dateStart || !dateEnd}
            onClick={onConfirm}
            className="shrink-0 rounded-md bg-[#4f8ef7] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3b7de0] disabled:opacity-50"
          >
            Cargar datos
          </button>
        </div>
      </div>
    </div>
  );
}
