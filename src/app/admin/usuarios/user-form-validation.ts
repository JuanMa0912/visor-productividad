import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import type { PortalProfileId } from "@/lib/auth/types";
import { portalProfileRequiresAssignedSedes } from "@/lib/shared/portal-profiles";

export type UserFormState = {
  id?: string;
  username: string;
  portalProfile: PortalProfileId;
  role: "admin" | "user";
  sede: string;
  allowedSedes: string[];
  /** Vacio = todas las empresas (null en BD). */
  allowedEmpresas: string[];
  allowedLines: string[];
  allowedDashboards: string[];
  allowedSubdashboards: string[];
  specialRoles: string[];
  password: string;
  is_active: boolean;
};

export type UserFormFieldErrors = {
  username?: string;
  password?: string;
  allowedSedes?: string;
};

export type UserFormWizardStep = "account" | "profile" | "permissions" | "summary";

export const serializeUserFormState = (state: UserFormState): string =>
  JSON.stringify({
    id: state.id ?? null,
    username: state.username.trim(),
    portalProfile: state.portalProfile,
    allowedSedes: [...state.allowedSedes].sort(),
    allowedEmpresas: [...state.allowedEmpresas].sort(),
    allowedLines: [...state.allowedLines].sort(),
    allowedDashboards: [...state.allowedDashboards].sort(),
    allowedSubdashboards: [...state.allowedSubdashboards].sort(),
    specialRoles: [...state.specialRoles].sort(),
    password: state.password,
    is_active: state.is_active,
  });

export const getWizardSteps = (
  portalProfile: PortalProfileId,
): UserFormWizardStep[] => {
  if (
    portalProfile === "personalizado" ||
    portalProfile === "asadero"
  ) {
    return ["account", "profile", "permissions", "summary"];
  }
  return ["account", "profile", "summary"];
};

export const validateAccountStep = (
  state: UserFormState,
  isEditing: boolean,
): UserFormFieldErrors => {
  const errors: UserFormFieldErrors = {};
  const username = state.username.trim();

  if (!username) {
    errors.username = "El nombre de usuario es obligatorio.";
  } else if (username.length < 2) {
    errors.username = "El usuario debe tener al menos 2 caracteres.";
  }

  const password = state.password.trim();
  if (!isEditing) {
    if (!password) {
      errors.password = "La contraseña es obligatoria al crear un usuario.";
    } else {
      const policyError = validatePasswordPolicy(password);
      if (policyError) {
        errors.password = policyError;
      }
    }
  } else if (password.length > 0) {
    const policyError = validatePasswordPolicy(password);
    if (policyError) {
      errors.password = policyError;
    }
  }

  return errors;
};

export const validateProfileStep = (
  state: UserFormState,
): UserFormFieldErrors => {
  const errors: UserFormFieldErrors = {};

  if (state.portalProfile === "admin") {
    return errors;
  }

  if (state.allowedSedes.length === 0) {
    errors.allowedSedes = "Selecciona al menos una sede para este perfil.";
    return errors;
  }

  if (
    portalProfileRequiresAssignedSedes(state.portalProfile) &&
    state.allowedSedes.includes("Todas")
  ) {
    errors.allowedSedes =
      "Este perfil no puede usar la sede «Todas». Elige sedes concretas.";
  }

  return errors;
};

export const validateWizardStep = (
  step: UserFormWizardStep,
  state: UserFormState,
  isEditing: boolean,
): UserFormFieldErrors => {
  if (step === "account") {
    return validateAccountStep(state, isEditing);
  }
  if (step === "profile") {
    return validateProfileStep(state);
  }
  return {};
};

export const hasFieldErrors = (errors: UserFormFieldErrors): boolean =>
  Object.keys(errors).length > 0;
