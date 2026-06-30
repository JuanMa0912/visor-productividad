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
  compact?: boolean;
};

const emptyStrength = {
  level: "weak" as PasswordStrengthLevel,
  label: "Sin evaluar",
  score: 0,
  passesPolicy: false,
};

const segmentCountForLevel = (level: PasswordStrengthLevel): number => {
  switch (level) {
    case "strong":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
};

export function PasswordStrengthMeter({
  password,
  className = "",
  showWhenEmpty = true,
  compact = false,
}: PasswordStrengthMeterProps) {
  const strength = useMemo(
    () => (password ? scorePasswordStrength(password) : emptyStrength),
    [password],
  );

  if (!password && !showWhenEmpty) return null;

  const activeSegments = password
    ? segmentCountForLevel(strength.level)
    : 0;
  const barClass = password
    ? passwordStrengthBarClass(strength.level)
    : "bg-slate-300";
  const textClass = password
    ? passwordStrengthTextClass(strength.level)
    : "text-slate-500";

  return (
    <div
      className={`${compact ? "space-y-1" : "space-y-2"} ${className}`.trim()}
      aria-live="polite"
      data-testid="password-strength-meter"
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={`font-semibold uppercase tracking-[0.12em] text-slate-600 ${compact ? "text-[10px]" : "text-xs"}`}
        >
          Fortaleza
        </p>
        <p className={`font-semibold ${compact ? "text-[10px]" : "text-xs"} ${textClass}`}>
          {password ? strength.label : "—"}
        </p>
      </div>
      <div
        className="flex gap-1.5"
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
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={`flex-1 overflow-hidden rounded-full bg-slate-200 ${compact ? "h-1.5" : "h-2"}`}
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                index < activeSegments ? barClass : "bg-transparent"
              }`}
              style={{
                width: index < activeSegments ? "100%" : "0%",
              }}
            />
          </div>
        ))}
      </div>
      {!compact ? (
        <p className={`text-xs leading-relaxed ${textClass}`}>
          {password ? (
            <>
              {strength.passesPolicy ? (
                <span className="font-medium text-emerald-700">
                  Cumple la política del portal.
                </span>
              ) : strength.level === "medium" ? (
                <span>
                  Va por buen camino. Complete los requisitos pendientes.
                </span>
              ) : (
                <span>Elija una contraseña más robusta para continuar.</span>
              )}
            </>
          ) : (
            "La barra se actualiza mientras escribe la nueva contraseña."
          )}
        </p>
      ) : null}
    </div>
  );
}
