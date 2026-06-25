"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type MargenSelectOption = {
  value: string;
  label: string;
  code?: string;
};

export const MargenesMultiSelect = ({
  label,
  values,
  options,
  onChange,
  disabled,
  emptyLabel = "Todos",
}: {
  label: string;
  values: string[];
  options: MargenSelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) ||
        option.value.toLowerCase().includes(q) ||
        option.code?.toLowerCase().includes(q),
    );
  }, [options, search]);

  const buttonLabel =
    values.length === 0
      ? emptyLabel
      : values.length === 1
        ? (options.find((option) => option.value === values[0])?.label ??
          values[0])
        : `${values.length} seleccionados`;

  const toggleValue = (value: string) => {
    onChange(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    );
  };

  return (
    <div className="relative flex min-w-[105px] max-w-[185px] flex-col gap-0.5" ref={wrapRef}>
      <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-1.5 rounded-md border bg-[#1b1e2e] px-2.5 py-1.5 text-left text-xs text-[#dde3f0] disabled:opacity-50 ${
          open ? "border-[#4f8ef7]" : "border-[#2a2f47] hover:border-[#4f8ef7]/60"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{buttonLabel}</span>
        {values.length > 0 ? (
          <span className="rounded-full bg-[#4f8ef7] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {values.length}
          </span>
        ) : null}
        <span className="text-[10px] opacity-40">▼</span>
      </button>
      {open ? (
        <div className="absolute top-[calc(100%+3px)] left-0 z-[300] flex min-w-[240px] max-w-[360px] flex-col rounded-md border border-[#2a2f47] bg-[#1b1e2e] shadow-2xl">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar…"
            className="rounded-t-md border-b border-[#2a2f47] bg-[#232740] px-2.5 py-2 text-xs text-[#dde3f0] outline-none"
          />
          <div className="flex border-b border-[#2a2f47]">
            <button
              type="button"
              className="flex-1 px-2 py-1.5 text-[11px] text-[#4f8ef7] hover:bg-[#4f8ef7]/10"
              onClick={() => onChange(filtered.map((option) => option.value))}
            >
              Marcar visibles
            </button>
            <button
              type="button"
              className="flex-1 px-2 py-1.5 text-[11px] text-[#4f8ef7] hover:bg-[#4f8ef7]/10"
              onClick={() =>
                onChange(values.filter((value) => !filtered.some((o) => o.value === value)))
              }
            >
              Quitar visibles
            </button>
          </div>
          <div className="max-h-[220px] overflow-y-auto">
            {filtered.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={values.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                  className="accent-[#4f8ef7]"
                />
                <span className="min-w-0 flex-1 truncate text-xs">{option.label}</span>
                {option.code ? (
                  <span className="rounded bg-[#232740] px-1.5 py-0.5 font-mono text-[10px] text-[#6b7590]">
                    {option.code}
                  </span>
                ) : null}
              </label>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-xs text-[#6b7590]">Sin opciones</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
