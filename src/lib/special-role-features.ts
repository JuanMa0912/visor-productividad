/**
 * Roles especiales (app_users.special_roles) que habilitan funciones concretas.
 * Deben coincidir con los ids permitidos en la API de admin (`ALLOWED_SPECIAL_ROLE_SET`).
 */
export const LUNES_SCHEDULE_SYNC_SPECIAL_ROLES = ["replicar_lunes"] as const;

const LUNES_SYNC_SET = new Set<string>(LUNES_SCHEDULE_SYNC_SPECIAL_ROLES);

/**
 * Puede usar "Mismo horario que lunes" en Ingresar horarios.
 * Los administradores lo tienen siempre; el resto necesita el rol especial `replicar_lunes`.
 */
export function canUseLunesScheduleSync(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) => LUNES_SYNC_SET.has(r.trim().toLowerCase()));
}
