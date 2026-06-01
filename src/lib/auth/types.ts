/**
 * Tipos puros de autenticacion, importables desde client y server sin arrastrar
 * dependencias de Node (`crypto`, `pg`, etc.) que viven en `./index.ts`.
 *
 * Si necesitas agregar campos al perfil del usuario, modifica AuthUser aqui y
 * el resto de la app los recibira via el contexto (`useAuth`).
 */

export type AuthRole = "admin" | "user";

export type AuthUser = {
  id: string;
  username: string;
  role: AuthRole;
  sede: string | null;
  allowedSedes: string[] | null;
  allowedLines: string[] | null;
  allowedDashboards: string[] | null;
  allowedSubdashboards: string[] | null;
  specialRoles: string[] | null;
  is_active: boolean;
  last_login_at: string | null;
  last_login_ip: string | null;
};

/** Subset compacto util para la mayoria de UIs (no expone metadatos de login). */
export type AuthUserPublic = Pick<
  AuthUser,
  | "id"
  | "username"
  | "role"
  | "sede"
  | "allowedSedes"
  | "allowedLines"
  | "allowedDashboards"
  | "allowedSubdashboards"
  | "specialRoles"
>;
