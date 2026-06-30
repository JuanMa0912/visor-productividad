export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MAX_AGE_DAYS = 30;

export type PasswordChangeReason = "weak" | "expired" | "unset";

const KNOWN_WEAK_PASSWORDS = new Set(
  [
    "12345678",
    "123456789",
    "1234567890",
    "87654321",
    "password",
    "password1",
    "admin123",
    "qwerty123",
    "mercamio",
    "mercatodo",
    "11111111",
    "00000000",
  ].map((value) => value.toLowerCase()),
);

const DAY_MS = 24 * 60 * 60 * 1000;

export const isKnownWeakPassword = (password: string): boolean =>
  KNOWN_WEAK_PASSWORDS.has(password.trim().toLowerCase());

export const validatePasswordLength = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_CHARS) {
    return `La contraseña debe tener mínimo ${PASSWORD_MIN_CHARS} caracteres.`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return `La contraseña no puede exceder ${PASSWORD_MAX_BYTES} bytes (acentos y emojis cuentan como 2-4).`;
  }
  return null;
};

export const validatePasswordPolicy = (password: string): string | null => {
  const lengthError = validatePasswordLength(password);
  if (lengthError) return lengthError;

  if (isKnownWeakPassword(password)) {
    return "Esa contraseña es demasiado común. Elija una más segura.";
  }
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) {
    return "La contraseña debe incluir al menos una letra mayúscula.";
  }
  if (!/[a-záéíóúñ]/.test(password)) {
    return "La contraseña debe incluir al menos una letra minúscula.";
  }
  if (!/[0-9]/.test(password)) {
    return "La contraseña debe incluir al menos un número.";
  }
  if (!/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]/.test(password)) {
    return "La contraseña debe incluir al menos un carácter especial (ej. ! @ # $).";
  }
  return null;
};

const parsePasswordChangedAt = (
  value: Date | string | null | undefined,
): Date | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getPasswordExpiryDate = (
  passwordChangedAt: Date | string | null | undefined,
): Date | null => {
  const changedAt = parsePasswordChangedAt(passwordChangedAt);
  if (!changedAt) return null;
  return new Date(changedAt.getTime() + PASSWORD_MAX_AGE_DAYS * DAY_MS);
};

export const getPasswordDaysUntilExpiry = (
  passwordChangedAt: Date | string | null | undefined,
  now = new Date(),
): number | null => {
  const expiry = getPasswordExpiryDate(passwordChangedAt);
  if (!expiry) return null;
  return Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);
};

export const isPasswordExpired = (
  passwordChangedAt: Date | string | null | undefined,
  now = new Date(),
): boolean => {
  const expiry = getPasswordExpiryDate(passwordChangedAt);
  if (!expiry) return true;
  return now.getTime() >= expiry.getTime();
};

export const evaluatePasswordChangeRequirement = (input: {
  loginPassword: string;
  passwordChangedAt: Date | string | null | undefined;
  now?: Date;
}): {
  required: boolean;
  reason: PasswordChangeReason | null;
  daysUntilExpiry: number | null;
} => {
  const now = input.now ?? new Date();

  if (
    isKnownWeakPassword(input.loginPassword) ||
    validatePasswordPolicy(input.loginPassword) !== null
  ) {
    return { required: true, reason: "weak", daysUntilExpiry: null };
  }

  const changedAt = parsePasswordChangedAt(input.passwordChangedAt);
  if (!changedAt) {
    return { required: true, reason: "unset", daysUntilExpiry: null };
  }

  const daysUntilExpiry = getPasswordDaysUntilExpiry(changedAt, now);
  if (daysUntilExpiry !== null && daysUntilExpiry <= 0) {
    return { required: true, reason: "expired", daysUntilExpiry: 0 };
  }

  return {
    required: false,
    reason: null,
    daysUntilExpiry,
  };
};

export const PASSWORD_POLICY_HINT =
  "Mínimo 8 caracteres, con mayúscula, minúscula, número y carácter especial. No use contraseñas obvias como 12345678.";

export type PasswordPolicyChecks = {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
  notCommon: boolean;
};

export const getPasswordPolicyChecks = (
  password: string,
): PasswordPolicyChecks => ({
  minLength: password.length >= PASSWORD_MIN_CHARS,
  uppercase: /[A-ZÁÉÍÓÚÑ]/.test(password),
  lowercase: /[a-záéíóúñ]/.test(password),
  number: /[0-9]/.test(password),
  special: /[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]/.test(password),
  notCommon: password.length > 0 && !isKnownWeakPassword(password),
});
