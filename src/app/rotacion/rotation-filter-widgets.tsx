import type { ComponentType, ReactNode, SVGProps } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/shared/utils";
import type { RotationSortDirection, RotationSortField } from "./rotacion-preamble";

type SortableRotationHeaderProps = {
  field: RotationSortField;
  label: ReactNode;
  activeField: RotationSortField | null;
  direction: RotationSortDirection;
  onSort: (field: RotationSortField) => void;
  /** Encabezados numericos alineados a la derecha como las celdas (evita desfase visual). */
  align?: "left" | "right";
};

export const WhatsAppLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

export const SortableRotationHeader = ({
  field,
  label,
  activeField,
  direction,
  onSort,
  align = "left",
}: SortableRotationHeaderProps) => {
  const isActive = activeField === field;
  const isRight = align === "right";

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "grid w-full min-w-0 items-center gap-x-2 transition-colors",
        isRight
          ? "grid-cols-[minmax(0,1fr)_auto] justify-items-end text-right"
          : "grid-cols-[minmax(0,1fr)_auto] justify-items-start text-left",
        isActive ? "text-amber-700" : "text-slate-700 hover:text-amber-700",
      )}
      aria-pressed={isActive}
    >
      <span
        className={cn(
          "min-w-0 leading-tight",
          isRight ? "justify-self-end" : "justify-self-start",
        )}
      >
        {label}
      </span>
      <ArrowUp
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-all",
          isActive
            ? `opacity-100 ${direction === "desc" ? "rotate-180" : ""}`
            : "opacity-35",
        )}
      />
    </button>
  );
};

export type SelectFieldProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
  helperText: string;
  accentClassName: string;
  disabled?: boolean;
};

export const FilterFieldLabel = ({
  icon: Icon,
  label,
  accentClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  accentClassName: string;
}) => (
  <span
    className={`mb-2 flex min-h-2.75rem items-start gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] leading-4 ${accentClassName}`}
  >
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <span className="block">{label}</span>
  </span>
);

export const FilterSelectField = ({
  icon: Icon,
  label,
  values,
  options,
  onChange,
  helperText,
  accentClassName,
  disabled = false,
}: SelectFieldProps) => {
  const valueSet = new Set(values);
  const allSelected = options.length > 0 && values.length === options.length;
  return (
    <div className="block">
      <FilterFieldLabel
        icon={Icon}
        label={label}
        accentClassName={accentClassName}
      />
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || allSelected}
            onClick={() => onChange(options.map((option) => option.value))}
            className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
          >
            Seleccionar todas
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || values.length === 0}
            onClick={() => onChange([])}
            className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
          >
            Limpiar
          </Button>
        </div>
        <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
          {options.map((option) => {
            const checked = valueSet.has(option.value);
            return (
              <label
                key={option.value}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      checked
                        ? values.filter((value) => value !== option.value)
                        : [...values, option.value],
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-200"
                />
                <span className="leading-5">{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{helperText}</p>
    </div>
  );
};
