/**
 * Mapea un path (window.location.pathname) a un label legible del tablero o
 * seccion en que se encuentra el usuario, para mostrarlo en el panel de
 * presencia y en el registro de accesos.
 */
const EXACT_PATH_LABELS: Record<string, string> = {
  "/": "Productividad por linea",
  "/login": "Inicio de sesion",
  "/secciones": "Portal de secciones",
  "/venta": "Venta",
  "/productividad": "Productividad",
  "/productividad/cajas": "Productividad cajas",
  "/operacion": "Operacion",
  "/ventas-x-item": "Ventas por item",
  "/inventario-x-item": "Inventario por item",
  "/analisis-de-inventario": "Analisis de inventario",
  "/margenes": "Margenes",
  "/rotacion": "Rotacion",
  "/rotacion-dos": "Rotacion V4",
  "/prediccion-pedidos": "Prediccion de pedidos",
  "/horario": "Horarios",
  "/horarios-comparar": "Planilla vs asistencia",
  "/horarios-guardados": "Horarios guardados",
  "/ingresar-horarios": "Ingresar horarios",
  "/jornada-extendida": "Jornada extendida",
  "/kardex": "Kardex",
  "/cronograma": "Cronograma",
  "/tableros": "Tableros",
  "/cuenta/contrasena": "Cambiar contraseña",
  "/admin/usuarios": "Admin · Usuarios",
  "/admin/usuarios/accesos": "Admin · Accesos",
  "/admin/usuarios/accesos/en-linea": "Admin · En línea",
  "/admin/usuarios/accesos/pormes": "Admin · Accesos por mes",
  "/admin/usuarios/uso-tableros": "Admin · Uso de tableros",
  "/ExcelDian": "Excel DIAN",
};

const PREFIX_LABELS: Array<{ prefix: string; label: string }> = [
  { prefix: "/admin/usuarios/accesos", label: "Admin · Accesos" },
  { prefix: "/admin/usuarios", label: "Admin · Usuarios" },
  { prefix: "/admin", label: "Admin" },
  { prefix: "/productividad", label: "Productividad" },
  { prefix: "/horario", label: "Horarios" },
];

export const PATH_LABEL_FALLBACK = "Eligiendo tablero";

/**
 * Recibe un path (con o sin trailing slash) y devuelve un nombre amigable.
 * Si el path es nulo / vacio devuelve un fallback ("Eligiendo tablero").
 * Si la ruta no esta mapeada, devuelve el path tal cual (truncado) para
 * conservar la informacion sin romper la UI.
 */
export const getPathLabel = (path: string | null | undefined): string => {
  if (!path) return PATH_LABEL_FALLBACK;
  const cleaned = path.trim();
  if (!cleaned || !cleaned.startsWith("/")) return PATH_LABEL_FALLBACK;
  const normalized = cleaned.length > 1 ? cleaned.replace(/\/+$/, "") : cleaned;
  const exact = EXACT_PATH_LABELS[normalized];
  if (exact) return exact;
  const prefixMatch = PREFIX_LABELS.find((entry) =>
    normalized === entry.prefix || normalized.startsWith(`${entry.prefix}/`),
  );
  if (prefixMatch) return prefixMatch.label;
  return normalized.length > 48 ? `${normalized.slice(0, 45)}…` : normalized;
};
