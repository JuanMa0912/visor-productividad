/** Tabla diaria legacy (producción). */
export const ROTACION_SOURCE_LEGACY = "rotacion_base_item_dia_sede";
export const ROTACION_SOURCE_DINASTIA = "rotacion_dinastia";

export type RotacionSourceTable =
  | typeof ROTACION_SOURCE_LEGACY
  | typeof ROTACION_SOURCE_DINASTIA;

const ALLOWED = new Set<string>([
  ROTACION_SOURCE_LEGACY,
  ROTACION_SOURCE_DINASTIA,
]);

export function assertRotacionSourceTable(
  table: string,
): asserts table is RotacionSourceTable {
  if (!ALLOWED.has(table)) {
    throw new Error(`Tabla de rotacion no permitida: ${table}`);
  }
}
