/**
 * Roles especiales (app_users.special_roles) que habilitan funciones concretas.
 * Deben coincidir con los ids permitidos en la API de admin (`ALLOWED_SPECIAL_ROLE_SET`),
 * p. ej. replicar_lunes, rotacion, comparar_horarios.
 */
export const LUNES_SCHEDULE_SYNC_SPECIAL_ROLES = ["replicar_lunes"] as const;
export const ROTACION_SPECIAL_ROLES = ["rotacion"] as const;
export const COMPARAR_HORARIOS_SPECIAL_ROLES = ["comparar_horarios"] as const;
/** Editar umbrales ABCD en Rotacion (modal de configuracion). */
export const ROTACION_ABCD_CONFIG_SPECIAL_ROLES = ["abcd"] as const;

const LUNES_SYNC_SET = new Set<string>(LUNES_SCHEDULE_SYNC_SPECIAL_ROLES);
const ROTACION_SET = new Set<string>(ROTACION_SPECIAL_ROLES);
const COMPARAR_HORARIOS_SET = new Set<string>(COMPARAR_HORARIOS_SPECIAL_ROLES);
const ROTACION_ABCD_CONFIG_SET = new Set<string>(ROTACION_ABCD_CONFIG_SPECIAL_ROLES);

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

/**
 * Puede acceder al tablero de rotacion.
 * Los administradores lo tienen siempre; el resto necesita el rol especial `rotacion`.
 */
export function canAccessRotacionBoard(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) => ROTACION_SET.has(r.trim().toLowerCase()));
}

/**
 * Puede acceder al tablero Comparar horarios (planilla vs asistencia).
 * Los administradores lo tienen siempre; el resto necesita el rol especial `comparar_horarios`.
 */
export function canAccessHorariosCompararBoard(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) => COMPARAR_HORARIOS_SET.has(r.trim().toLowerCase()));
}

/**
 * Puede editar la configuracion ABCD (umbrales) en Rotacion.
 * Los administradores lo tienen siempre; el resto necesita el rol especial `abcd`.
 */
export function canEditRotacionAbcdConfig(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) => ROTACION_ABCD_CONFIG_SET.has(r.trim().toLowerCase()));
}
