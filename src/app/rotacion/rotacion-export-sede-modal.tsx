"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type RotacionExportSedeOption = {
  value: string;
  label: string;
};

export type RotacionExportSedeModalProps = {
  sedeOptions: RotacionExportSedeOption[];
  initialSelectedValues: string[];
  rowCountBySedeValue: ReadonlyMap<string, number | undefined>;
  isExporting: boolean;
  onClose: () => void;
  onConfirm: (selectedValues: string[]) => void | Promise<void>;
};

export const RotacionExportSedeModal = ({
  sedeOptions,
  initialSelectedValues,
  rowCountBySedeValue,
  isExporting,
  onClose,
  onConfirm,
}: RotacionExportSedeModalProps) => {
  const [selectedValues, setSelectedValues] = useState<string[]>(
    initialSelectedValues,
  );
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const totalRows = useMemo(
    () =>
      selectedValues.reduce((acc, value) => {
        const count = rowCountBySedeValue.get(value);
        return acc + (count ?? 0);
      }, 0),
    [rowCountBySedeValue, selectedValues],
  );

  const unloadedSelectedCount = useMemo(
    () =>
      selectedValues.filter(
        (value) => rowCountBySedeValue.get(value) === undefined,
      ).length,
    [rowCountBySedeValue, selectedValues],
  );

  const toggleValue = (value: string) => {
    setSelectedValues((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotacion-export-sede-modal-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col rounded-2xl border border-emerald-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-6 py-5">
          <button
            type="button"
            className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
          <h2
            id="rotacion-export-sede-modal-title"
            className="pr-8 text-lg font-bold text-slate-900"
          >
            Exportar Excel por sede
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Se exporta la misma vista y filtros de la tabla actual, una hoja con
            un bloque por sede.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-6 py-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-xs"
              onClick={() =>
                setSelectedValues(sedeOptions.map((option) => option.value))
              }
            >
              Todas
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-xs"
              onClick={() => setSelectedValues([])}
            >
              Ninguna
            </Button>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {unloadedSelectedCount > 0
              ? `${selectedValues.length} sede(s); ${unloadedSelectedCount} se consultaran al exportar`
              : `${totalRows.toLocaleString("es-CO")} filas`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ul className="space-y-2">
            {sedeOptions.map((option) => {
              const rowCount = rowCountBySedeValue.get(option.value);
              const checked = selectedSet.has(option.value);
              return (
                <li key={option.value}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-emerald-600"
                      checked={checked}
                      onChange={() => toggleValue(option.value)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {option.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {rowCount === undefined
                          ? "Se consultara al exportar (mismos filtros y rango)"
                          : `${rowCount.toLocaleString("es-CO")} filas con filtros actuales`}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={
              isExporting ||
              selectedValues.length === 0 ||
              (unloadedSelectedCount === 0 && totalRows === 0)
            }
            onClick={() => void onConfirm(selectedValues)}
          >
            {isExporting ? "Exportando..." : "Descargar Excel"}
          </Button>
        </div>
      </div>
    </div>
  );
};
