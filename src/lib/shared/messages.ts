/**
 * Catalogo de mensajes estandarizados del Portal UAID.
 *
 * Antes cada pagina y cada API route definia sus propios textos para errores,
 * vacios y confirmaciones. Esto genero inconsistencias como:
 *   - "No se pudo X" vs "No fue posible X" (mezclados al azar).
 *   - "Recargue la pagina" vs "Recarga la pagina" (tuteo vs ustedeo).
 *   - "Error de conexion" vs "Error de conexión" (tildes inconsistentes).
 *   - "No autorizado." vs "No tienes permisos para esta seccion." (mismo
 *     significado, distinta forma).
 *
 * Reglas de estilo aplicadas en este archivo:
 *   1. TUTEO siempre ("tu cuenta", "recarga", "verifica"). Es mas cercano
 *      y consistente con el tono general del portal.
 *   2. TILDES correctas en español. UTF-8 nativo, sin mojibake.
 *   3. Punto final en oraciones completas. Sin punto en titulos cortos.
 *   4. "No fue posible..." para errores tecnicos del servidor/datos.
 *      "No tienes permisos..." para autorizacion.
 *      "No hay..." para vacios (no es un error).
 *   5. Sin signos de exclamacion. El portal es una herramienta de trabajo,
 *      no una app de marketing.
 *
 * Como agregar un mensaje nuevo:
 *   - Si el texto se usa en mas de un lugar, agregalo aqui con un nombre
 *     descriptivo y reemplaza los literales originales.
 *   - Si necesita parametros, crea un helper (ver `forbiddenForResource`).
 *   - Si es 100% especifico de una pagina, dejalo inline. No fuerces todo
 *     aqui o se vuelve un archivo gigante de mensajes unicos.
 *
 * ---------------------------------------------------------------------------
 * COMO MOSTRAR ESTOS MENSAJES AL USUARIO
 * ---------------------------------------------------------------------------
 *
 * Desde junio/2026 el portal monta un <PortalToaster /> global (sonner) en
 * RootLayout. La regla es:
 *
 *   - Notificacion de RESULTADO de una accion (success, error, info):
 *     usar `toast.*` de sonner, NO un <div> rojo/verde inline ni `alert()`.
 *
 *     ```ts
 *     import { toast } from "sonner";
 *     import { ACTION_MESSAGES } from "@/lib/shared/messages";
 *
 *     toast.success(ACTION_MESSAGES.saveSuccess);
 *     toast.error(AUTH_MESSAGES.sessionExpired);
 *     ```
 *
 *   - Validacion INLINE de un campo (longitud, formato): mostrar el
 *     mensaje al lado del input. NO usar toast (el usuario necesita ver el
 *     error al lado del campo equivocado).
 *
 *   - Confirmacion ANTES de una accion destructiva (eliminar): por ahora
 *     `window.confirm()`. A futuro reemplazar con un componente
 *     <ConfirmDialog> (Radix Alert Dialog).
 *
 *   - Estado "Guardando..." en un boton: prop `disabled` + cambio de label.
 *     Para acciones largas con feedback: `toast.promise(prom, { loading,
 *     success, error })`.
 */

// ----------------------------------------------------------------------------
// Autenticacion y autorizacion
// ----------------------------------------------------------------------------

export const AUTH_MESSAGES = {
  /** 401 estandar para APIs cuando no hay sesion valida. */
  unauthorized: "No autorizado.",

  /** 403 estandar para usuarios autenticados sin permiso a la seccion. */
  forbiddenSection: "No tienes permisos para esta sección.",

  /** 403 para acciones administrativas (admin requerido). */
  adminRequired: "Esta acción requiere permisos de administrador.",

  /** Cliente: sesion no se pudo validar (estado intermedio raro). */
  sessionCheckFailed: "No se pudo validar la sesión. Recarga la página.",

  /** Sesion expirada o invalidada por inactividad. */
  sessionExpired: "Tu sesión expiró. Vuelve a iniciar sesión.",

  /** Login: credenciales invalidas. */
  invalidCredentials: "Usuario o contraseña incorrectos.",
} as const;

/** Helper para mensajes de permisos sobre un recurso especifico. */
export const forbiddenForResource = (resource: string) =>
  `No tienes permisos para acceder a ${resource}.`;

/** Helper para sedes/lineas/items que el usuario quiso filtrar. */
export const forbiddenForFilter = (
  filterType: "sede" | "sedes" | "línea" | "líneas" | "ítem" | "ítems",
) => `No tienes permisos para consultar ${filterType === "sedes" || filterType === "líneas" || filterType === "ítems" ? "alguna de las" : "esa"} ${filterType}.`;

// ----------------------------------------------------------------------------
// Carga y consulta de datos (cliente y server)
// ----------------------------------------------------------------------------

export const DATA_MESSAGES = {
  /** Error generico cuando una consulta a BD falla. */
  loadFailed: "No fue posible cargar la información solicitada.",

  /** Cuando el servidor responde pero los datos vienen incompletos/invalidos. */
  invalidResponse: "La respuesta del servidor no es válida.",

  /** Problema de red (fetch fallo, server inaccesible). */
  connectionError: "Error de conexión con el servidor.",

  /** Empty state generico (NO es error). */
  noData: "No hay datos disponibles.",

  /** Empty state para selectores/filtros que no devolvieron opciones. */
  noOptions: "No hay opciones disponibles para los filtros seleccionados.",

  /** Loading genérico. */
  loading: "Cargando...",
} as const;

/** Helper para mensajes de "no fue posible X" parametrizado. */
export const couldNotLoad = (resource: string) =>
  `No fue posible cargar ${resource}.`;

/** Helper para mensajes de "no fue posible consultar X" (queries especificas). */
export const couldNotQuery = (resource: string) =>
  `No fue posible consultar ${resource}.`;

/** Helper para errores de conexion con contexto (ej. nombre de la BD). */
export const connectionErrorWithDetail = (detail: string) =>
  `Error de conexión: ${detail}`;

// ----------------------------------------------------------------------------
// Acciones del usuario (guardado, eliminacion, etc.)
// ----------------------------------------------------------------------------

export const ACTION_MESSAGES = {
  saveSuccess: "Cambios guardados correctamente.",
  saveFailed: "No se pudo guardar. Intenta de nuevo.",
  deleteSuccess: "Eliminado correctamente.",
  deleteFailed: "No se pudo eliminar. Intenta de nuevo.",
  updateSuccess: "Actualizado correctamente.",
  updateFailed: "No se pudo actualizar. Intenta de nuevo.",

  /** Confirmaciones destructivas (usar en window.confirm). */
  confirmDelete: "¿Confirmas que quieres eliminar este registro?",
  confirmDiscard: "Tienes cambios sin guardar. ¿Salir de todos modos?",
} as const;

// ----------------------------------------------------------------------------
// Validacion de formularios
// ----------------------------------------------------------------------------

export const VALIDATION_MESSAGES = {
  required: "Este campo es obligatorio.",
  invalidEmail: "El correo electrónico no tiene un formato válido.",
  passwordTooShort: "La contraseña debe tener al menos 8 caracteres.",
  passwordsDoNotMatch: "Las contraseñas no coinciden.",
  invalidDateRange: "La fecha final debe ser posterior a la inicial.",
} as const;

// ----------------------------------------------------------------------------
// Helper de extraccion: errores de respuestas HTTP
// ----------------------------------------------------------------------------

/**
 * Extrae un mensaje de error desde un payload JSON tipico de las APIs del
 * portal (`{ error: "..." }`) con fallback al mensaje generico de carga.
 *
 * Uso:
 * ```ts
 * const payload = await res.json().catch(() => null);
 * setError(extractErrorMessage(payload, DATA_MESSAGES.loadFailed));
 * ```
 */
export const extractErrorMessage = (
  payload: unknown,
  fallback: string = DATA_MESSAGES.loadFailed,
): string => {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
};
