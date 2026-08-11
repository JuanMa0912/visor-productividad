import {
  isProveedoresQrSede,
  PROVEEDORES_QR_SEDES,
  type ProveedoresQrSede,
} from "@/lib/proveedores/types";

/** Tabla física de marcaciones QR por sede (whitelist). */
export const PROVEEDORES_QR_VISITAS_TABLE_BY_SEDE: Record<
  ProveedoresQrSede,
  string
> = {
  "Calle 5ta": "qr_calle_5ta",
  "La 39": "qr_la_39",
  "Plaza Norte": "qr_plaza_norte",
  "Ciudad Jardin": "qr_ciudad_jardin",
  "Centro Sur": "qr_centro_sur",
  Palmira: "qr_palmira",
  Floresta: "qr_floresta",
  Floralia: "qr_floralia",
  Guaduales: "qr_guaduales",
  Bogota: "qr_bogota",
  Chia: "qr_chia",
};

const TABLE_NAME_RE = /^qr_[a-z0-9_]+$/;

/** Resuelve sede canónica → nombre de tabla física. null si no es sede QR. */
export const resolveQrVisitasTable = (sedeName: string): string | null => {
  if (!isProveedoresQrSede(sedeName)) return null;
  const table = PROVEEDORES_QR_VISITAS_TABLE_BY_SEDE[sedeName];
  if (!TABLE_NAME_RE.test(table)) return null;
  return table;
};

/** Pares sede/tabla en orden canónico (UNION ALL / métricas globales). */
export const listQrVisitasTablePairs = (): Array<{
  sedeName: ProveedoresQrSede;
  table: string;
}> =>
  PROVEEDORES_QR_SEDES.map((sedeName) => ({
    sedeName,
    table: PROVEEDORES_QR_VISITAS_TABLE_BY_SEDE[sedeName],
  }));
