/**
 * Códigos de empresa para exportación DIAN y variables `EXCEL_DIAN_*_DB_*`.
 * - `mtodo`: Comercializadora (usa la consulta de medios magnéticos)
 * - `mio`: Mercamio (misma consulta, su propia base)
 * - `bgt`: Merkmios (misma consulta, su propia base; id_emp '01')
 *
 * Requiere que las variables `EXCEL_DIAN_<PREFIJO>_DB_*` de cada empresa estén
 * configuradas en el servidor (232). Si faltan, la API responde 503 al exportar.
 */
export const EXCEL_DIAN_EMPRESA_OPTIONS = [
  { value: "mtodo", label: "Comercializadora", enabled: true },
  { value: "mio", label: "Mercamio", enabled: true },
  { value: "bgt", label: "Merkmios", enabled: true },
] as const;

export type ExcelDianEmpresaValue =
  (typeof EXCEL_DIAN_EMPRESA_OPTIONS)[number]["value"];

/** true si la empresa tiene consulta estándar lista para exportar. */
export const isExcelDianEmpresaEnabled = (value: string): boolean =>
  EXCEL_DIAN_EMPRESA_OPTIONS.some((o) => o.value === value && o.enabled);
