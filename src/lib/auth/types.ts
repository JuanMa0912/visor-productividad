/**
 * Tipos puros de autenticacion, importables desde client y server sin arrastrar
 * dependencias de Node (`crypto`, `pg`, etc.) que viven en `./index.ts`.
 *
 * Si necesitas agregar campos al perfil del usuario, modifica AuthUser aqui y
 * el resto de la app los recibira via el contexto (`useAuth`).
 */

export type AuthRole = "admin" | "user";

export type PortalProfileId =
  | "admin"
  | "subadmin"
  | "gerente"
  | "director_comercial"
  | "asadero"
  | "fruver"
  | "rrhh"
  | "personalizado";

export type PasswordChangeReason = "weak" | "expired" | "unset";

export type AuthUser = {
  id: string;
  username: string;
  role: AuthRole;
  portalProfile?: PortalProfileId | null;
  sede: string | null;
  allowedSedes: string[] | null;
  /** Empresas BD permitidas (`mercamio`/`mtodo`/`bogota`/`dinastia`). null = todas. */
  allowedEmpresas?: string[] | null;
  allowedLines: string[] | null;
  allowedDashboards: string[] | null;
  allowedSubdashboards: string[] | null;
  specialRoles: string[] | null;
  // Metadatos opcionales: GET /api/auth/me los devuelve siempre, pero el POST
  // /api/auth/login devuelve solo el subset "publico" para no obligar a una
  // segunda query. Mantenerlos opcionales permite que `signIn(user)` acepte
  // cualquiera de las dos respuestas sin gimnasia de tipos.
  is_active?: boolean;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  passwordChangeRequired?: boolean;
  passwordChangeReason?: PasswordChangeReason | null;
  /** Días restantes antes del cambio obligatorio (30 días desde el último cambio). */
  passwordDaysUntilExpiry?: number | null;
};

/** Subset compacto util para la mayoria de UIs (no expone metadatos de login). */
export type AuthUserPublic = Pick<
  AuthUser,
  | "id"
  | "username"
  | "role"
  | "sede"
  | "allowedSedes"
  | "allowedEmpresas"
  | "allowedLines"
  | "allowedDashboards"
  | "allowedSubdashboards"
  | "specialRoles"
  | "portalProfile"
>;
