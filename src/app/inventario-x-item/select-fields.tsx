"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import type { SelectOption } from "./types";

export const SelectField = ({
  icon: Icon,
  label,
  value,
  options,
  onChange,
  emptyLabel,
  disabled = false,
  invalid = false,
  helperText,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  emptyLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  helperText?: string;
}) => (
  <label className="block">
    <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
      <Icon className="h-3.5 w-3.5 text-blue-600" />
      {label}
    </span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={`w-full rounded-2xl border bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid
          ? "border-red-300 hover:border-red-400 focus:border-red-300 focus:ring-red-100"
          : "border-slate-200/70 hover:border-slate-300 focus:border-blue-300 focus:ring-blue-100"
      }`}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.key ?? option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {helperText ? (
      <p
        className={`mt-2 text-xs leading-5 ${
          invalid ? "text-red-600" : "text-slate-500"
        }`}
      >
        {helperText}
      </p>
    ) : null}
  </label>
);

export const MultiSelectField = ({
  icon: Icon,
  label,
  values,
  options,
  visibleOptions,
  onChange,
  emptyLabel,
  maxSelected,
  searchable = false,
  searchValue = "",
  onSearchChange,
  totalResultsCount,
  truncatedResults = false,
  disabled = false,
  invalid = false,
  helperText,
  allLabel,
  selectAllLabel,
  onSelectAll,
  onClearSelection,
  clearLabel,
  allSelected = false,
}: {
  icon: React.ElementType;
  label: string;
  values: string[];
  options: SelectOption[];
  visibleOptions?: SelectOption[];
  onChange: (value: string[]) => void;
  emptyLabel: string;
  maxSelected?: number;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  totalResultsCount?: number;
  truncatedResults?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  helperText?: string;
  allLabel?: string;
  selectAllLabel?: string;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  clearLabel?: string;
  allSelected?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectedOptions = options.filter((option) => values.includes(option.value));
  const renderedOptions = visibleOptions ?? options;
  const selectedPreview = allSelected
    ? []
    : selectedOptions.slice(0, 2);
  const hiddenSelectedOptions = allSelected ? [] : selectedOptions.slice(2);
  const remainingSelectedCount = Math.max(0, selectedOptions.length - selectedPreview.length);
  const limitReached =
    maxSelected !== undefined && maxSelected > 0 && values.length >= maxSelected;

  const selectionCountLabel =
    allSelected
      ? "Todas"
      : values.length > 0
        ? maxSelected
          ? `${values.length}/${maxSelected}`
          : `${values.length}`
        : maxSelected
          ? `0/${maxSelected}`
          : null;

  /** Con busqueda y sin seleccion: no mostramos fila inferior (solo Buscar + contadores; la lista abre al foco en Buscar). */
  const hideSearchableSelectionRow =
    Boolean(searchable && onSearchChange) && !allSelected && selectedOptions.length === 0;

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    if (limitReached) return;
    onChange([...values, value]);
  };

  return (
    <div className="block" ref={menuRef}>
      <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <Icon className="h-3.5 w-3.5 text-blue-600" />
        {label}
      </span>

      <div className="relative">
        {searchable && onSearchChange ? (
          <div
            className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow focus-within:shadow-md ${
              invalid
                ? "border-red-300 ring-1 ring-red-100"
                : "border-slate-200/70 focus-within:border-blue-200 focus-within:ring-2 focus-within:ring-blue-100/80"
            }`}
          >
            <label className="flex items-center gap-2 bg-slate-50/90 px-3 py-2 transition-colors focus-within:bg-white">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                onFocus={() => {
                  if (!disabled) setOpen(true);
                }}
                placeholder="Buscar..."
                disabled={disabled}
                className="min-h-0 w-full bg-transparent py-0.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <div
              className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-slate-100 px-3 py-1 ${
                hideSearchableSelectionRow ? "rounded-b-2xl pb-2" : ""
              }`}
            >
              <span className="text-[10px] font-medium tabular-nums text-slate-500">
                {renderedOptions.length} de {totalResultsCount ?? options.length}{" "}
                resultados
              </span>
              {truncatedResults ? (
                <span className="text-[10px] leading-tight text-amber-800">
                  Lista parcial: escribe mas para acotar.
                </span>
              ) : null}
            </div>
            {!hideSearchableSelectionRow ? (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                disabled={disabled}
                className="flex w-full items-start justify-between gap-2 border-t border-slate-100 bg-white px-3 py-2 text-left text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50/80 focus:outline-none focus-visible:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  {allSelected ? (
                    <span className="block truncate">{allLabel ?? emptyLabel}</span>
                  ) : selectedOptions.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {selectedPreview.map((option) => (
                        <span
                          key={option.key ?? option.value}
                          className="max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                          title={option.label}
                        >
                          <span className="block truncate">{option.label}</span>
                        </span>
                      ))}
                      {remainingSelectedCount > 0 && (
                        <span className="group/summary relative inline-flex">
                          <span
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                            title={hiddenSelectedOptions.map((option) => option.label).join("\n")}
                          >
                            +{remainingSelectedCount}
                          </span>
                          <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-30 hidden w-max max-w-72 -translate-x-1/2 rounded-2xl border border-slate-200/80 bg-slate-950/95 px-3 py-2 text-left text-[11px] font-medium leading-5 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.6)] group-hover/summary:block">
                            {hiddenSelectedOptions.map((option) => (
                              <span
                                key={option.key ?? option.value}
                                className="block whitespace-normal"
                              >
                                {option.label}
                              </span>
                            ))}
                          </span>
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="block truncate text-slate-500">{emptyLabel}</span>
                  )}
                </span>
                {selectionCountLabel ? (
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {selectionCountLabel}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : (
          <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              disabled={disabled}
              className={`flex w-full items-start justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 shadow-sm transition-all focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                invalid
                  ? "border-red-300 hover:border-red-400 focus:border-red-300 focus:ring-red-100"
                  : "border-slate-200/70 hover:border-slate-300 focus:border-blue-300 focus:ring-blue-100"
              }`}
            >
              <span className="min-w-0 flex-1">
                {allSelected ? (
                  <span className="block truncate">{allLabel ?? emptyLabel}</span>
                ) : selectedOptions.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {selectedPreview.map((option) => (
                      <span
                        key={option.key ?? option.value}
                        className="max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                        title={option.label}
                      >
                        <span className="block truncate">{option.label}</span>
                      </span>
                    ))}
                    {remainingSelectedCount > 0 && (
                      <span className="group/summary relative inline-flex">
                        <span
                          className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                          title={hiddenSelectedOptions.map((option) => option.label).join("\n")}
                        >
                          +{remainingSelectedCount}
                        </span>
                        <span className="pointer-events-none absolute left-1/2 top-[calc(100%+0.5rem)] z-30 hidden w-max max-w-72 -translate-x-1/2 rounded-2xl border border-slate-200/80 bg-slate-950/95 px-3 py-2 text-left text-[11px] font-medium leading-5 text-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.6)] group-hover/summary:block">
                          {hiddenSelectedOptions.map((option) => (
                            <span
                              key={option.key ?? option.value}
                              className="block whitespace-normal"
                            >
                              {option.label}
                            </span>
                          ))}
                        </span>
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="block truncate text-slate-500">{emptyLabel}</span>
                )}
              </span>
              {selectionCountLabel ? (
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {selectionCountLabel}
                </span>
              ) : null}
            </button>
        )}

        {open && (
          <div className="absolute left-0 top-full z-30 mt-0.5 w-full rounded-b-2xl rounded-t-lg border border-slate-200/90 bg-white p-1.5 shadow-[0_16px_40px_-24px_rgba(15,23,42,0.35)]">
            {(onSelectAll || onClearSelection) && (
              <div className="mb-1 flex flex-wrap gap-1 border-b border-slate-100 px-1 pb-1">
                {onSelectAll && (
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    {selectAllLabel ?? allLabel ?? emptyLabel}
                  </button>
                )}
                {onClearSelection && (
                  <button
                    type="button"
                    onClick={onClearSelection}
                    className="rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-slate-50"
                  >
                    {clearLabel ?? "Limpiar filtro"}
                  </button>
                )}
              </div>
            )}

            <div className="max-h-60 space-y-0.5 overflow-auto pr-0.5 sm:max-h-72">
              {renderedOptions.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">
                  No hay opciones disponibles para este filtro.
                </p>
              ) : (
                renderedOptions.map((option) => {
                  const checked = values.includes(option.value);
                  const disabledOption = !checked && Boolean(limitReached);
                  return (
                    <button
                      key={option.key ?? option.value}
                      type="button"
                      onClick={() => toggleValue(option.value)}
                      disabled={disabledOption}
                      className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                        disabledOption
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {option.label}
                        </p>
                        {option.hint && (
                          <p className="mt-0.5 text-xs leading-5 text-slate-500">
                            {option.hint}
                          </p>
                        )}
                      </div>
                      <span
                        className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          checked
                            ? "border-blue-500 bg-blue-500 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {maxSelected && limitReached && (
              <p className="mt-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">
                Maximo {maxSelected} seleccionados
              </p>
            )}
          </div>
        )}
      </div>
      {helperText ? (
        <p
          className={`mt-1.5 text-xs leading-snug ${
            invalid ? "text-red-600" : "text-slate-500"
          }`}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
};
