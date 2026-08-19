"use client";

import {
  parseProveedorLineaFilter,
  PROVEEDOR_LINEA_FILTER_OPTIONS,
  type ProveedorLineaFilter,
} from "@/lib/proveedores/board-filters";

export function ProveedoresLineaFilter({
  value,
  onChange,
}: {
  value: ProveedorLineaFilter;
  onChange: (value: ProveedorLineaFilter) => void;
}) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      Línea
      <select
        value={value}
        onChange={(event) =>
          onChange(parseProveedorLineaFilter(event.target.value))
        }
        className="mt-1 block h-9 min-w-44 rounded-lg border border-slate-200 px-3 text-sm font-semibold normal-case tracking-normal text-slate-800"
      >
        {PROVEEDOR_LINEA_FILTER_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
