import { canAccessPortalSection, canAccessPortalSubsection } from "@/lib/shared/portal-sections";

/**
 * Roles especiales (app_users.special_roles) que habilitan funciones concretas.
 * Los ids permitidos viven en `ALLOWED_SPECIAL_ROLE_SET` (esta misma fuente).
 * p. ej. replicar_lunes, comparar_horarios, eliminar_foto_surtido.
 */
export const LUNES_SCHEDULE_SYNC_SPECIAL_ROLES = ["replicar_lunes"] as const;
export const COMPARAR_HORARIOS_SPECIAL_ROLES = ["comparar_horarios"] as const;
/** Editar umbrales ABCD en Rotacion (modal de configuracion). */
export const ROTACION_ABCD_CONFIG_SPECIAL_ROLES = ["abcd"] as const;
/** Ver historial de auditoria de S.inventario (cero rotacion / restock) en Rotacion. */
export const ROTACION_SINVENTARIO_HISTORIAL_SPECIAL_ROLES = [
  "historial_sinventario",
] as const;
/** Eliminar foto de evidencia de surtido restock desde el historial de auditoria. */
export const ROTACION_ELIMINAR_FOTO_SURTIDO_SPECIAL_ROLES = [
  "eliminar_foto_surtido",
] as const;
/**
 * Crear nuevos horarios predeterminados (el boton "+") en el modal de
 * "Horarios predeterminados" de Ingresar horarios. Editar y aplicar los
 * 3 originales sigue rigiendose por `replicar_lunes`.
 */
export const CREATE_LUNES_PRESET_SPECIAL_ROLES = [
  "crear_horario_predeterminado",
] as const;
/** Ver y descargar links/QR de ingreso de proveedores en el tablero. */
export const PROVEEDORES_QR_SPECIAL_ROLES = ["proveedores_qr"] as const;

const LUNES_SYNC_SET = new Set<string>(LUNES_SCHEDULE_SYNC_SPECIAL_ROLES);
const COMPARAR_HORARIOS_SET = new Set<string>(COMPARAR_HORARIOS_SPECIAL_ROLES);
const ROTACION_ABCD_CONFIG_SET = new Set<string>(ROTACION_ABCD_CONFIG_SPECIAL_ROLES);
const ROTACION_SINVENTARIO_HISTORIAL_SET = new Set<string>(
  ROTACION_SINVENTARIO_HISTORIAL_SPECIAL_ROLES,
);
const ROTACION_ELIMINAR_FOTO_SURTIDO_SET = new Set<string>(
  ROTACION_ELIMINAR_FOTO_SURTIDO_SPECIAL_ROLES,
);

/**
 * Catalogo de ids de `special_roles` que la API de admin acepta.
 * Mantener alineado con los checkboxes de `/admin/usuarios`.
 */
export const APP_SPECIAL_ROLE_IDS = [
  "alex",
  "cronograma",
  "replicar_lunes",
  "comparar_horarios",
  "abcd",
  "historial_sinventario",
  "eliminar_foto_surtido",
  "crear_horario_predeterminado",
  "proveedores_qr",
  "checklist_encargado",
  "checklist_revisor",
  "checklist_panel",
] as const;

export const ALLOWED_SPECIAL_ROLE_SET = new Set<string>(APP_SPECIAL_ROLE_IDS);

const CREATE_LUNES_PRESET_SET = new Set<string>(
  CREATE_LUNES_PRESET_SPECIAL_ROLES,
);
const PROVEEDORES_QR_SET = new Set<string>(PROVEEDORES_QR_SPECIAL_ROLES);

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
 * Los administradores lo tienen siempre.
 * El resto necesita el subtablero `rotacion` en `allowed_subdashboards`
 * (vacio/null = todos los subtableros).
 */
export function canAccessRotacionBoard(
  _specialRoles: string[] | null | undefined,
  isAdmin = false,
  allowedSubdashboards?: unknown,
): boolean {
  if (isAdmin) return true;
  // Sin 3er argumento (= undefined): denegar. null = todos; [] = ninguno.
  if (allowedSubdashboards === undefined) return false;
  return canAccessPortalSubsection(allowedSubdashboards, "rotacion");
}

/**
 * Puede acceder al tablero Proveedores (hub Venta).
 * Los administradores lo tienen siempre.
 * El resto necesita el subtablero `proveedores` en `allowed_subdashboards`
 * (null = todos los subtableros; [] = ninguno).
 */
export function canAccessProveedoresBoard(
  isAdmin = false,
  allowedSubdashboards?: unknown,
): boolean {
  if (isAdmin) return true;
  if (allowedSubdashboards === undefined) return false;
  return canAccessPortalSubsection(allowedSubdashboards, "proveedores");
}

/**
 * Puede acceder a Órdenes de compra (`/ordenes-compra`).
 * Admin siempre. El resto necesita sección `venta` y el subtablero
 * `ordenes-compra` marcado de forma explícita (opt-in; no se hereda de
 * `allowed_subdashboards = null`).
 */
export function canAccessOrdenesCompra(
  role: string,
  allowedDashboards: unknown,
  allowedSubdashboards?: unknown,
): boolean {
  if (role === "admin") return true;
  if (!canAccessPortalSection(allowedDashboards, "venta")) return false;
  if (allowedSubdashboards === undefined) return false;
  return canAccessPortalSubsection(allowedSubdashboards, "ordenes-compra");
}

/**
 * Puede acceder a Costos (`/costos`).
 * Admin siempre. El resto necesita sección `venta` y el subtablero
 * `precios-proveedor` marcado de forma explícita (no se hereda de
 * `allowed_subdashboards = null`).
 */
export function canAccessPreciosProveedor(
  role: string,
  allowedDashboards: unknown,
  allowedSubdashboards?: unknown,
): boolean {
  if (role === "admin") return true;
  if (!canAccessPortalSection(allowedDashboards, "venta")) return false;
  if (allowedSubdashboards === undefined) return false;
  return canAccessPortalSubsection(allowedSubdashboards, "precios-proveedor");
}

/**
 * Puede ver links/QR de ingreso por sede en el tablero Proveedores.
 * Los administradores lo tienen siempre; el resto necesita `proveedores_qr`.
 * Sin permiso: no mostrar el bloque ni devolver tokens en la API.
 */
export function canViewProveedoresQrLinks(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) =>
    PROVEEDORES_QR_SET.has(r.trim().toLowerCase()),
  );
}

/**
 * Puede acceder al informe de variacion (comparativo de dos periodos).
 * Requiere seccion producto y subseccion `informe-variacion` (permiso propio;
 * no se hereda de margenes ni rotacion).
 * `allowedSubdashboards` vacio/null = todos los subtableros (incluye informe).
 */
export function canAccessInformeVariacion(
  role: string,
  allowedDashboards: unknown,
  allowedSubdashboards: unknown,
  _specialRoles?: string[] | null,
): boolean {
  if (role === "admin") return true;
  if (!canAccessPortalSection(allowedDashboards, "producto")) return false;
  return canAccessPortalSubsection(allowedSubdashboards, "informe-variacion");
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

/**
 * Puede abrir el historial de auditoria de S.inventario en Rotacion.
 *
 * - Cuentas con **rol de aplicacion** `admin`: siempre permitido (no hace falta
 *   incluir `historial_sinventario` en `special_roles`).
 * - Cualquier otra cuenta: solo si en `special_roles` figura el id
 *   `historial_sinventario` (y ya cumple el acceso al tablero de rotacion).
 * - Quien no cumpla lo anterior: la UI **no debe mostrar** el boton (ni
 *   deshabilitado): `null`, para no revelar la existencia de la funcion.
 */
export function canViewRotacionSinventarioHistorial(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) =>
    ROTACION_SINVENTARIO_HISTORIAL_SET.has(r.trim().toLowerCase()),
  );
}

/**
 * Puede eliminar la foto de evidencia de un item restock surtido.
 *
 * - Cuentas con **rol de aplicacion** `admin`: siempre permitido.
 * - Cualquier otra cuenta: solo con `eliminar_foto_surtido` en `special_roles`.
 *   Para hacerlo desde el historial tambien necesita `historial_sinventario`.
 * - Quien no cumpla: la UI no muestra el boton de borrar.
 */
export function canDeleteRotacionRestockSurtidoFoto(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) =>
    ROTACION_ELIMINAR_FOTO_SURTIDO_SET.has(r.trim().toLowerCase()),
  );
}

/**
 * Puede crear nuevos "Horarios predeterminados" (boton "+") en Ingresar
 * horarios. Implica `replicar_lunes` (necesita ver el modal para crear), pero
 * el boton solo aparece para administradores o quienes tengan
 * `crear_horario_predeterminado`.
 */
export function canCreateLunesSchedulePresets(
  specialRoles: string[] | null | undefined,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  if (!specialRoles?.length) return false;
  return specialRoles.some((r) =>
    CREATE_LUNES_PRESET_SET.has(r.trim().toLowerCase()),
  );
}
