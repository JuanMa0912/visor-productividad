/** Sedes con QR de ingreso de proveedores (11 operativas; sin Dinastía). */
export const PROVEEDORES_QR_SEDES = [
  "Calle 5ta",
  "La 39",
  "Plaza Norte",
  "Ciudad Jardin",
  "Centro Sur",
  "Palmira",
  "Floresta",
  "Floralia",
  "Guaduales",
  "Bogota",
  "Chia",
] as const;

export type ProveedoresQrSede = (typeof PROVEEDORES_QR_SEDES)[number];

export const isProveedoresQrSede = (value: string): value is ProveedoresQrSede =>
  (PROVEEDORES_QR_SEDES as readonly string[]).includes(value);

export const normalizeVisitanteCedula = (raw: unknown): string => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || digits;
};

export const isValidVisitanteCedula = (cedula: string): boolean =>
  cedula.length >= 6 && cedula.length <= 15;

export const normalizeVisitanteNombre = (raw: unknown): string =>
  String(raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

export const isValidVisitanteNombre = (nombre: string): boolean =>
  nombre.length >= 3 && nombre.length <= 120;

/** Aviso Ley 1581 en el formulario público QR. */
export const PROVEEDORES_INGRESO_DATOS_AVISO =
  "Sus datos (nombre y cédula) se usan solo para el control de ingreso de proveedores a esta sede. No se usan con fines comerciales. Puede solicitar consulta, corrección o supresión ante administración UAID (Ley 1581 de 2012).";

/** True solo si el visitante marcó explícitamente la autorización. */
export const isAcceptedDatosAutorizacion = (raw: unknown): boolean =>
  raw === true || raw === 1 || raw === "1" || raw === "true";

export const normalizeProveedorToken = (raw: unknown): string =>
  String(raw ?? "")
    .trim()
    .slice(0, 80);

export const isValidProveedorToken = (token: string): boolean =>
  /^prv_[a-f0-9]{20,64}$/i.test(token);

/** Clave de selección: empresa|codigo|sucursal del maestro comercial POS. */
export const encodeProveedorPosKey = (
  empresa: string,
  codigo: string,
  sucursal?: string,
): string =>
  `${empresa.trim()}|${codigo.trim()}|${(sucursal ?? "00").trim() || "00"}`;

export const decodeProveedorPosKey = (
  raw: unknown,
): { empresa: string; codigo: string; sucursal: string } | null => {
  const value = String(raw ?? "").trim();
  const [empresaRaw, codigoRaw, sucursalRaw = "00", ...extra] = value.split("|");
  if (extra.length > 0) return null;
  const empresa = empresaRaw?.trim() ?? "";
  const codigo = codigoRaw?.trim() ?? "";
  const sucursal = sucursalRaw.trim() || "00";
  if (!empresa || !codigo || codigo.length > 40) return null;
  if (sucursal.length > 10) return null;
  return { empresa, codigo, sucursal };
};

export type ProveedorCatalogItem = {
  /** `empresa|codigo|sucursal` del maestro comercial POS. */
  id: string;
  empresa: string;
  codigo: string;
  sucursal: string;
  nombre: string;
  nit: string | null;
};

export type ProveedorVisitaOpen = {
  id: number;
  sedeName: string;
  proveedorNombre: string;
  visitanteNombre: string;
  visitanteCedula: string;
  entradaAt: string;
};

export type ProveedorVisitaRow = {
  id: number;
  sedeName: string;
  proveedorId: string | null;
  proveedorNombre: string;
  visitanteNombre: string;
  visitanteCedula: string;
  entradaAt: string;
  salidaAt: string | null;
  /** Minutos entre entrada y salida; null si abierta. */
  duracionMinutos: number | null;
};

export type ProveedorVisitasMetrics = {
  totalVisitas: number;
  abiertas: number;
  cerradas: number;
  proveedoresUnicos: number;
  visitantesUnicos: number;
  /** Promedio minutos solo visitas cerradas. */
  duracionPromedioMin: number | null;
  /** Mediana minutos solo visitas cerradas. */
  duracionMedianaMin: number | null;
  bySede: Array<{
    sedeName: string;
    visitas: number;
    abiertas: number;
    duracionPromedioMin: number | null;
  }>;
  byProveedor: Array<{
    proveedorNombre: string;
    visitas: number;
    duracionPromedioMin: number | null;
  }>;
  byDay: Array<{
    date: string;
    visitas: number;
    abiertas: number;
  }>;
  byHour: Array<{
    hour: number;
    visitas: number;
  }>;
};
