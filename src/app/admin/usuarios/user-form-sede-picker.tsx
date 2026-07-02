"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/shared/utils";

type UserFormSedePickerProps = {
  options: string[];
  selected: string[];
  disabled?: boolean;
  error?: string;
  onToggle: (sede: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
};

export function UserFormSedePicker({
  options,
  selected,
  disabled = false,
  error,
  onToggle,
  onSelectAll,
  onClearAll,
}: UserFormSedePickerProps) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((sede) => sede.toLowerCase().includes(normalized));
  }, [options, query]);

  return (
    <div className="space-y-3">
      {!disabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar sede..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex gap-2 text-xs font-medium">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-indigo-600 transition hover:text-indigo-700"
            >
              Todas
            </button>
            <span className="text-slate-300" aria-hidden>
              |
            </span>
            <button
              type="button"
              onClick={onClearAll}
              className="text-slate-500 transition hover:text-slate-700"
            >
              Ninguna
            </button>
          </div>
        </div>
      ) : null}

      {selected.length > 0 && !disabled ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((sede) => (
            <span
              key={sede}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-900"
            >
              {sede}
              <button
                type="button"
                onClick={() => onToggle(sede, true)}
                className="rounded-full p-0.5 text-indigo-500 transition hover:bg-indigo-100 hover:text-indigo-800"
                aria-label={`Quitar sede ${sede}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "grid max-h-44 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2",
          error ? "rounded-lg ring-2 ring-red-200" : "",
        )}
      >
        {filteredOptions.length === 0 ? (
          <p className="col-span-full py-4 text-center text-sm text-slate-500">
            No hay sedes que coincidan con la búsqueda.
          </p>
        ) : (
          filteredOptions.map((sede) => {
            const checked = selectedSet.has(sede);
            return (
              <label
                key={sede}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition",
                  disabled
                    ? "cursor-not-allowed border-slate-100 bg-slate-50/80 opacity-60"
                    : checked
                      ? "border-indigo-200 bg-indigo-50/80 text-indigo-950"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(sede, checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 disabled:cursor-not-allowed"
                />
                <span className="min-w-0 font-medium leading-snug">{sede}</span>
              </label>
            );
          })
        )}
      </div>

      <p className="text-xs text-slate-500">
        {disabled
          ? "Los perfiles admin tienen acceso a todas las sedes."
          : selected.length === 0
            ? "Ninguna sede seleccionada."
            : `${selected.length} de ${options.length} sede(s) seleccionada(s).`}
      </p>

      {error ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
