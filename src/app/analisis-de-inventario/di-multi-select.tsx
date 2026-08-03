"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type DiSelectOption = {
  value: string;
  label: string;
};

/** MultiSelect compacto para la barra de filtros de DI (tema claro). */
export function DiMultiSelect({
  label,
  values,
  options,
  onChange,
  emptyLabel,
  searchable = false,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar…",
  disabled = false,
  className = "",
}: {
  label: string;
  values: string[];
  options: DiSelectOption[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  searchable?: boolean;
  /** Búsqueda controlada (p. ej. ítems vía API). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlled = typeof onSearchChange === "function";
  const query = controlled ? (searchValue ?? "") : localQuery;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = controlled
    ? options
    : searchable
      ? options.filter((opt) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return (
            opt.label.toLowerCase().includes(q) ||
            opt.value.toLowerCase().includes(q)
          );
        })
      : options;

  const summary =
    values.length === 0
      ? emptyLabel
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? values[0])
        : `${values.length} seleccionadas`;

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
      return;
    }
    onChange([...values, value]);
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {searchable || controlled ? (
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                if (controlled) onSearchChange?.(next);
                else setLocalQuery(next);
              }}
              placeholder={searchPlaceholder}
              className="w-full border-b border-slate-100 px-2.5 py-2 text-xs outline-none"
              autoFocus
            />
          ) : null}
          <div className="max-h-44 overflow-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-slate-500">
                {controlled && query.trim().length < 2
                  ? "Escribe ≥2 letras"
                  : "Sin opciones"}
              </p>
            ) : (
              filtered.map((opt) => {
                const selected = values.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-50"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300"
                      }`}
                    >
                      {selected ? <Check className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {values.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-t border-slate-100 px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
