"use client";

import { useState, type Ref } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

type PasswordInputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInput?: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  compact?: boolean;
};

export function PasswordInputField({
  id,
  label,
  value,
  onChange,
  onInput,
  autoComplete,
  required = false,
  minLength,
  inputRef,
  placeholder = "••••••••",
  compact = false,
}: PasswordInputFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label
        htmlFor={id}
        className={`block font-semibold uppercase tracking-[0.12em] text-slate-700 ${compact ? "text-[10px]" : "text-xs"}`}
      >
        {label}
      </label>
      <div className={`relative ${compact ? "mt-1" : "mt-2"}`}>
        <Lock
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onInput={
            onInput
              ? (e) => onInput((e.target as HTMLInputElement).value)
              : undefined
          }
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={`w-full rounded-xl border border-slate-200 bg-white pr-11 pl-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none vp-sync-autofill ${compact ? "py-2" : "py-2.5"}`}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
