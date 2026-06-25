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
  sedes: MargenSedePickerOption[];
  selectedSedes: string[];
  loading: boolean;
  error: string | null;
  onToggleSede: (value: string) => void;
  onToggleEmpresa: (empresa: string, values: string[]) => void;
  onConfirm: () => void;
};

export function MargenesSedePickerModal({
  open,
  rangeLabel,
  sedes,
  selectedSedes,
  loading,
  error,
  onToggleSede,
  onToggleEmpresa,
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
                Elige las sedes a analizar
              </h2>
              <p className="mt-1 text-sm text-[#9aa3bc]">
                Marca una o varias sedes por empresa. Rango:{" "}
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
            <div className="space-y-4">
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
                    className="rounded-lg border border-[#2a2f47] bg-[#1b1e2e]"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-[#2a2f47] px-4 py-2.5">
                      <div>
                        <h3 className="text-sm font-semibold text-[#dde3f0]">
                          {group.label}
                        </h3>
                        <p className="text-[11px] text-[#6b7590]">
                          {selectedInGroup}/{group.sedes.length} sede(s)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleEmpresa(group.empresa, groupValues)}
                        className="text-xs font-medium text-[#4f8ef7] hover:text-[#3b7de0]"
                      >
                        {allInGroup ? "Quitar todas" : "Marcar todas"}
                      </button>
                    </div>
                    <div className="grid gap-1 p-2 sm:grid-cols-2">
                      {group.sedes.map((sede) => {
                        const checked = selectedSet.has(sede.value);
                        return (
                          <label
                            key={sede.value}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition ${
                              checked
                                ? "border-[#4f8ef7]/60 bg-[#4f8ef7]/10"
                                : "border-transparent hover:border-[#2a2f47] hover:bg-[#141720]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleSede(sede.value)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#2a2f47] bg-[#141720] text-[#4f8ef7] focus:ring-[#4f8ef7]/40"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-[#dde3f0]">
                                {sede.label}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-[#6b7590]">
                                {sede.idCo} ·{" "}
                                {sede.rowCount.toLocaleString("es-CO")} filas
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

        <div className="flex items-center justify-between gap-3 border-t border-[#2a2f47] px-5 py-4">
          <p className="min-w-0 text-xs text-[#6b7590]">
            {selectedSedes.length === 0
              ? "Marca al menos una sede para continuar."
              : selectedSedes.length === 1
                ? `1 sede: ${selectedLabels[0]}`
                : `${selectedSedes.length} sedes seleccionadas`}
          </p>
          <button
            type="button"
            disabled={selectedSedes.length === 0 || loading}
            onClick={onConfirm}
            className="shrink-0 rounded-md bg-[#4f8ef7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3b7de0] disabled:opacity-50"
          >
            Cargar datos
          </button>
        </div>
      </div>
    </div>
  );
}
