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

export const normalizeProveedorToken = (raw: unknown): string =>
  String(raw ?? "")
    .trim()
    .slice(0, 80);

export const isValidProveedorToken = (token: string): boolean =>
  /^prv_[a-f0-9]{20,64}$/i.test(token);

/** Clave de selección: empresa|id_cricla1 (maestro POS). */
export const encodeProveedorPosKey = (empresa: string, codigo: string): string =>
  `${empresa.trim()}|${codigo.trim()}`;

export const decodeProveedorPosKey = (
  raw: unknown,
): { empresa: string; codigo: string } | null => {
  const value = String(raw ?? "").trim();
  const sep = value.indexOf("|");
  if (sep <= 0 || sep === value.length - 1) return null;
  const empresa = value.slice(0, sep).trim();
  const codigo = value.slice(sep + 1).trim();
  if (!empresa || !codigo || codigo.length > 40) return null;
  return { empresa, codigo };
};

export type ProveedorCatalogItem = {
  /** `empresa|id_cricla1` */
  id: string;
  empresa: string;
  codigo: string;
  nombre: string;
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
