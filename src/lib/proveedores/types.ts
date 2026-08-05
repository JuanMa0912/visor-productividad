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

export type ProveedorCatalogItem = {
  id: number;
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
  proveedorId: number | null;
  proveedorNombre: string;
  visitanteNombre: string;
  visitanteCedula: string;
  entradaAt: string;
  salidaAt: string | null;
  /** Minutos entre entrada y salida; null si abierta. */
  duracionMinutos: number | null;
};
