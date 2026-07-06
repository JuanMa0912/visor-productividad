/** Tabla diaria legacy (producción). */
export const ROTACION_SOURCE_LEGACY = "rotacion_base_item_dia_sede";

export type RotacionSourceTable = typeof ROTACION_SOURCE_LEGACY;

const ALLOWED = new Set<string>([ROTACION_SOURCE_LEGACY]);

export function assertRotacionSourceTable(
  table: string,
): asserts table is RotacionSourceTable {
  if (!ALLOWED.has(table)) {
    throw new Error(`Tabla de rotacion no permitida: ${table}`);
  }
}
