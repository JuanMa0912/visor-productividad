/**
 * Códigos de empresa para exportación DIAN y variables `EXCEL_DIAN_*_DB_*`.
 * - `mtodo`: Comercializadora
 * - `mio`: Mercamio
 * - `bgt`: Merkmios
 */
export const EXCEL_DIAN_EMPRESA_OPTIONS = [
  { value: "mtodo", label: "Comercializadora" },
  { value: "mio", label: "Mercamio" },
  { value: "bgt", label: "Merkmios" },
] as const;

export type ExcelDianEmpresaValue =
  (typeof EXCEL_DIAN_EMPRESA_OPTIONS)[number]["value"];
