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

/** Matview diaria limpia/agregada por tenant. */
export const ROTACION_CLEAN_MATVIEW_BY_SOURCE = {
  [ROTACION_SOURCE_LEGACY]: "rotacion_item_dia_clean",
  [ROTACION_SOURCE_DINASTIA]: "rotacion_dinastia_item_dia_clean",
} as const;

/** Snapshot rolling default por tenant. */
export const ROTACION_PERIODO_STD_BY_SOURCE = {
  [ROTACION_SOURCE_LEGACY]: "rotacion_item_periodo_std",
  [ROTACION_SOURCE_DINASTIA]: "rotacion_dinastia_item_periodo_std",
} as const;

export const ROTACION_PERIODO_STD_META_BY_SOURCE = {
  [ROTACION_SOURCE_LEGACY]: "rotacion_item_periodo_std_meta",
  [ROTACION_SOURCE_DINASTIA]: "rotacion_dinastia_item_periodo_std_meta",
} as const;

export type RotacionCleanMatview =
  (typeof ROTACION_CLEAN_MATVIEW_BY_SOURCE)[RotacionSourceTable];
export type RotacionPeriodoStdTable =
  (typeof ROTACION_PERIODO_STD_BY_SOURCE)[RotacionSourceTable];

export const resolveRotacionCleanMatview = (
  source: RotacionSourceTable,
): RotacionCleanMatview => ROTACION_CLEAN_MATVIEW_BY_SOURCE[source];

export const resolveRotacionPeriodoStdTable = (
  source: RotacionSourceTable,
): RotacionPeriodoStdTable => ROTACION_PERIODO_STD_BY_SOURCE[source];

export const resolveRotacionPeriodoStdMetaTable = (
  source: RotacionSourceTable,
): (typeof ROTACION_PERIODO_STD_META_BY_SOURCE)[RotacionSourceTable] =>
  ROTACION_PERIODO_STD_META_BY_SOURCE[source];
