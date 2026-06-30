import {
  isKnownWeakPassword,
  validatePasswordLength,
  validatePasswordPolicy,
} from "@/lib/auth/password-policy";

export type PasswordStrengthLevel = "weak" | "medium" | "strong";

export type PasswordStrength = {
  level: PasswordStrengthLevel;
  label: string;
  score: number;
  passesPolicy: boolean;
};

const STRENGTH_LABELS: Record<PasswordStrengthLevel, string> = {
  weak: "Débil",
  medium: "Media",
  strong: "Segura",
};

export const scorePasswordStrength = (password: string): PasswordStrength => {
  const empty = {
    level: "weak" as const,
    label: STRENGTH_LABELS.weak,
    score: 0,
    passesPolicy: false,
  };

  if (!password) return empty;

  if (validatePasswordPolicy(password) === null) {
    const score =
      password.length >= 14 ? 100 : password.length >= 10 ? 92 : 85;
    return {
      level: "strong",
      label: STRENGTH_LABELS.strong,
      score,
      passesPolicy: true,
    };
  }

  if (isKnownWeakPassword(password) || validatePasswordLength(password)) {
    return {
      level: "weak",
      label: STRENGTH_LABELS.weak,
      score: Math.max(8, Math.min(password.length * 4, 28)),
      passesPolicy: false,
    };
  }

  let score = 0;
  if (password.length >= 8) score += 22;
  else score += password.length * 3;
  if (password.length >= 12) score += 8;
  if (/[A-ZÁÉÍÓÚÑ]/.test(password)) score += 18;
  if (/[a-záéíóúñ]/.test(password)) score += 18;
  if (/[0-9]/.test(password)) score += 18;
  if (/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]/.test(password)) score += 16;

  const clamped = Math.max(12, Math.min(score, 78));
  if (clamped >= 58) {
    return {
      level: "medium",
      label: STRENGTH_LABELS.medium,
      score: clamped,
      passesPolicy: false,
    };
  }

  return {
    level: "weak",
    label: STRENGTH_LABELS.weak,
    score: clamped,
    passesPolicy: false,
  };
};

export const passwordStrengthBarClass = (level: PasswordStrengthLevel): string => {
  switch (level) {
    case "strong":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    default:
      return "bg-rose-500";
  }
};

export const passwordStrengthTextClass = (level: PasswordStrengthLevel): string => {
  switch (level) {
    case "strong":
      return "text-emerald-700";
    case "medium":
      return "text-amber-700";
    default:
      return "text-rose-700";
  }
};
