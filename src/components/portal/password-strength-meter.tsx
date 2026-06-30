"use client";

import { useMemo } from "react";
import {
  passwordStrengthBarClass,
  passwordStrengthTextClass,
  scorePasswordStrength,
  type PasswordStrengthLevel,
} from "@/lib/auth/password-strength";

type PasswordStrengthMeterProps = {
  password: string;
  className?: string;
  /** Si true, muestra la barra aunque el campo esté vacío. */
  showWhenEmpty?: boolean;
};

const emptyStrength = {
  level: "weak" as PasswordStrengthLevel,
  label: "Sin evaluar",
  score: 0,
  passesPolicy: false,
};

export function PasswordStrengthMeter({
  password,
  className = "",
  showWhenEmpty = true,
}: PasswordStrengthMeterProps) {
  const strength = useMemo(
    () => (password ? scorePasswordStrength(password) : emptyStrength),
    [password],
  );

  if (!password && !showWhenEmpty) return null;

  const barClass = password
    ? passwordStrengthBarClass(strength.level)
    : "bg-slate-300";

  const textClass = password
    ? passwordStrengthTextClass(strength.level)
    : "text-slate-500";

  return (
    <div
      className={`space-y-1.5 ${className}`.trim()}
      aria-live="polite"
      data-testid="password-strength-meter"
    >
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-200 ring-1 ring-slate-200/80"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={strength.score}
        aria-label={
          password
            ? `Fortaleza de contraseña: ${strength.label}`
            : "Fortaleza de contraseña sin evaluar"
        }
      >
        <div
          className={`h-full min-w-[4%] rounded-full transition-all duration-300 ease-out ${barClass}`}
          style={{ width: `${Math.max(password ? 4 : 0, strength.score)}%` }}
        />
      </div>
      <p className={`text-xs font-semibold ${textClass}`}>
        {password ? (
          <>
            Fortaleza: {strength.label}
            {!strength.passesPolicy && strength.level !== "weak" ? (
              <span className="font-normal text-slate-500">
                {" "}
                · Falta cumplir todos los requisitos
              </span>
            ) : null}
            {strength.passesPolicy ? (
              <span className="font-normal text-emerald-600">
                {" "}
                · Cumple la política del portal
              </span>
            ) : null}
          </>
        ) : (
          "Escriba la nueva contraseña para ver si es débil, media o segura."
        )}
      </p>
    </div>
  );
}
