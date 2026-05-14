/**
 * Cuando es true, /ExcelDian y GET /api/excel-dian/export no exigen sesion.
 * Solo para entornos controlados: el export consulta BD y puede ser abusado sin auth.
 *
 * Lee `EXCEL_DIAN_EXPORT_PUBLIC` (.env.local / servidor). Si el proxy no ve esa var
 * (p. ej. Edge), se acepta tambien `NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC` (queda en el cliente).
 */
export const isExcelDianExportPublic = (): boolean => {
  const raw =
    process.env.EXCEL_DIAN_EXPORT_PUBLIC?.trim() ||
    process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC?.trim();
  const v = raw?.toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes";
};
