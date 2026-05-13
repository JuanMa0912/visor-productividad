/**
 * Códigos de empresa alineados con filtros de rotación / BD (`formatCompanyLabel` en rotacion-preamble).
 * `bogota` es el valor almacenado para la filial mostrada como "Merkmios".
 */
export const EXCEL_DIAN_EMPRESA_OPTIONS = [
  { value: "mercamio", label: "Mercamio" },
  { value: "mtodo", label: "Comercializadora" },
  { value: "bogota", label: "Merkmios" },
] as const;

export type ExcelDianEmpresaValue =
  (typeof EXCEL_DIAN_EMPRESA_OPTIONS)[number]["value"];
