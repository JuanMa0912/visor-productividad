/** Tabla diaria legacy (producción). */
export const ROTACION_SOURCE_LEGACY = "rotacion_base_item_dia_sede";

/** Tabla v4 para pruebas / nueva carga ETL. */
export const ROTACION_SOURCE_V4 = "rotacion_v4";

export type RotacionSourceTable =
  | typeof ROTACION_SOURCE_LEGACY
  | typeof ROTACION_SOURCE_V4;

const ALLOWED = new Set<string>([ROTACION_SOURCE_LEGACY, ROTACION_SOURCE_V4]);

export function assertRotacionSourceTable(
  table: string,
): asserts table is RotacionSourceTable {
  if (!ALLOWED.has(table)) {
    throw new Error(`Tabla de rotacion no permitida: ${table}`);
  }
}
