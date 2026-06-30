"use client";

import { useMemo } from "react";
import { Check, Circle } from "lucide-react";
import {
  getPasswordPolicyChecks,
  type PasswordPolicyChecks,
} from "@/lib/auth/password-policy";

const RULES: Array<{
  key: keyof PasswordPolicyChecks;
  label: string;
}> = [
  { key: "minLength", label: "Mínimo 8 caracteres" },
  { key: "uppercase", label: "Una letra mayúscula" },
  { key: "lowercase", label: "Una letra minúscula" },
  { key: "number", label: "Un número" },
  { key: "special", label: "Un carácter especial (! @ # …)" },
  { key: "notCommon", label: "No es una contraseña obvia" },
];

type PasswordPolicyChecklistProps = {
  password: string;
  className?: string;
  compact?: boolean;
};

export function PasswordPolicyChecklist({
  password,
  className = "",
  compact = false,
}: PasswordPolicyChecklistProps) {
  const checks = useMemo(() => getPasswordPolicyChecks(password), [password]);
  const hasInput = password.length > 0;

  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-slate-50/80 ${compact ? "p-2.5" : "rounded-2xl p-4"} ${className}`.trim()}
      aria-label="Requisitos de contraseña"
    >
      <p
        className={`font-semibold uppercase tracking-[0.12em] text-slate-600 ${compact ? "text-[10px]" : "text-xs"}`}
      >
        Requisitos de seguridad
      </p>
      <ul
        className={`${compact ? "mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2" : "mt-3 space-y-2"}`}
      >
        {RULES.map(({ key, label }) => {
          const met = checks[key];
          const Icon = met ? Check : Circle;
          const iconClass = met
            ? "text-emerald-600"
            : hasInput
              ? "text-amber-500"
              : "text-slate-300";
          const textClass = met
            ? "text-emerald-800"
            : hasInput
              ? "text-slate-700"
              : "text-slate-500";

          return (
            <li
              key={key}
              className={`flex items-center gap-1.5 ${compact ? "text-[11px] leading-tight" : "items-start gap-2.5 text-sm"}`}
            >
              <Icon
                className={`shrink-0 ${iconClass} ${met ? "stroke-[2.5]" : ""} ${compact ? "h-3 w-3" : "mt-0.5 h-4 w-4"}`}
                aria-hidden
              />
              <span className={textClass}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
