import type { ChecklistActorRole } from "@/lib/checklists/session";

export const CHECKLIST_ENCARGADO_ROLE = "checklist_encargado";
export const CHECKLIST_REVISOR_ROLE = "checklist_revisor";
export const CHECKLIST_PANEL_ROLE = "checklist_panel";

export type { ChecklistActorRole };

const hasRole = (
  specialRoles: string[] | null | undefined,
  role: string,
  isAdmin = false,
) => {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  const needle = role.trim().toLowerCase();
  return specialRoles.some((entry) => entry.trim().toLowerCase() === needle);
};

export const canFillChecklistAsEncargado = (
  specialRoles: string[] | null | undefined,
  isAdmin = false,
) => hasRole(specialRoles, CHECKLIST_ENCARGADO_ROLE, isAdmin);

export const canFillChecklistAsRevisor = (
  specialRoles: string[] | null | undefined,
  isAdmin = false,
) => hasRole(specialRoles, CHECKLIST_REVISOR_ROLE, isAdmin);

export const canFillAnyChecklist = (
  specialRoles: string[] | null | undefined,
  isAdmin = false,
) =>
  canFillChecklistAsEncargado(specialRoles, isAdmin) ||
  canFillChecklistAsRevisor(specialRoles, isAdmin);

export const canAccessChecklistPanel = (
  specialRoles: string[] | null | undefined,
  isAdmin = false,
) => hasRole(specialRoles, CHECKLIST_PANEL_ROLE, isAdmin);

export const canUnlockChecklistRuns = (
  specialRoles: string[] | null | undefined,
  isAdmin = false,
) => canAccessChecklistPanel(specialRoles, isAdmin);

export const parseChecklistActorRole = (
  value: unknown,
): ChecklistActorRole | null => {
  if (value === "encargado" || value === "revisor") return value;
  return null;
};
