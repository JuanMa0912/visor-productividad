"use client";

import { Building2, Loader2 } from "lucide-react";

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
  sedes: MargenSedePickerOption[];
  selectedSede: string;
  loading: boolean;
  error: string | null;
  onSelect: (value: string) => void;
  onConfirm: () => void;
};

export function MargenesSedePickerModal({
  open,
  rangeLabel,
  sedes,
  selectedSede,
  loading,
  error,
  onSelect,
  onConfirm,
}: MargenesSedePickerModalProps) {
  if (!open) return null;

  const selected = sedes.find((sede) => sede.value === selectedSede);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d0f18]/80 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="margenes-sede-picker-title"
    >
      <div className="flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#2a2f47] bg-[#141720] shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
        <div className="border-b border-[#2a2f47] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#232740] text-[#4f8ef7]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="margenes-sede-picker-title"
                className="text-base font-bold text-[#dde3f0]"
              >
                Elige la sede a analizar
              </h2>
              <p className="mt-1 text-sm text-[#9aa3bc]">
                Solo cargamos datos de la sede que elijas. Rango:{" "}
                <span className="font-medium text-[#dde3f0]">{rangeLabel}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[#6b7590]">
              <Loader2 className="h-6 w-6 animate-spin text-[#4f8ef7]" />
            </div>
          ) : error ? (
            <p className="rounded-md border border-[#7f1d1d] bg-[#1b1e2e] px-3 py-2 text-sm text-[#f87171]">
              {error}
            </p>
          ) : sedes.length === 0 ? (
            <p className="text-sm text-[#6b7590]">
              No hay sedes con datos en el rango seleccionado.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sedes.map((sede) => {
                const active = sede.value === selectedSede;
                return (
                  <button
                    key={sede.value}
                    type="button"
                    onClick={() => onSelect(sede.value)}
                    className={`rounded-lg border px-4 py-3 text-left transition ${
                      active
                        ? "border-[#4f8ef7] bg-[#4f8ef7]/10 text-[#dde3f0]"
                        : "border-[#2a2f47] bg-[#1b1e2e] text-[#dde3f0] hover:border-[#4f8ef7]/50"
                    }`}
                  >
                    <div className="text-sm font-semibold">{sede.label}</div>
                    <div className="mt-1 text-[11px] text-[#6b7590]">
                      {sede.empresa.toUpperCase()} · {sede.idCo} ·{" "}
                      {sede.rowCount.toLocaleString("es-CO")} filas
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#2a2f47] px-5 py-4">
          <p className="text-xs text-[#6b7590]">
            {selected
              ? `Seleccionada: ${selected.label}`
              : "Selecciona una sede para continuar."}
          </p>
          <button
            type="button"
            disabled={!selectedSede || loading}
            onClick={onConfirm}
            className="rounded-md bg-[#4f8ef7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3b7de0] disabled:opacity-50"
          >
            Cargar datos
          </button>
        </div>
      </div>
    </div>
  );
}
