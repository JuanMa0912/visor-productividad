"use client";

import { useMemo } from "react";
import {
  passwordStrengthBarClass,
  passwordStrengthTextClass,
  scorePasswordStrength,
} from "@/lib/auth/password-strength";

type PasswordStrengthMeterProps = {
  password: string;
  className?: string;
};

export function PasswordStrengthMeter({
  password,
  className = "",
}: PasswordStrengthMeterProps) {
  const strength = useMemo(() => scorePasswordStrength(password), [password]);

  if (!password) return null;

  return (
    <div className={`space-y-1.5 ${className}`.trim()} aria-live="polite">
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={strength.score}
        aria-label={`Fortaleza de contraseña: ${strength.label}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${passwordStrengthBarClass(strength.level)}`}
          style={{ width: `${strength.score}%` }}
        />
      </div>
      <p
        className={`text-xs font-semibold ${passwordStrengthTextClass(strength.level)}`}
      >
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
      </p>
    </div>
  );
}
