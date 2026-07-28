import {
  isGcpDeployment,
  isLocalPortalExcelDianBypass,
} from "@/lib/shared/local-portal-notices";

const isTruthyExportFlag = (raw: string | undefined): boolean => {
  const v = raw?.trim().toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes";
};

const readExportPublicFlag = (): boolean => {
  const raw =
    process.env.EXCEL_DIAN_EXPORT_PUBLIC?.trim() ||
    process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC?.trim();
  return isTruthyExportFlag(raw);
};

/**
 * Flag explicita: /ExcelDian y GET /api/excel-dian/export sin sesion.
 * Solo para entornos controlados (red LAN); el export consulta bases DIAN
 * (mtodo / mio / bgt) y puede abusarse sin auth.
 *
 * En GCP (`VISOR_DEPLOYMENT=gcp`) siempre false: Excel DIAN no debe vivir
 * en la nube ni quedar publico por copy-paste de env del 232.
 *
 * Lee `EXCEL_DIAN_EXPORT_PUBLIC` (.env.local / servidor). Si el proxy no ve esa var
 * (p. ej. Edge), se acepta tambien `NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC`.
 */
export const isExcelDianExportPublic = (): boolean => {
  if (isGcpDeployment()) return false;
  return readExportPublicFlag();
};

/**
 * Acceso sin login a Excel DIAN: flag explicita o portal local restringido
 * (`LOCAL_PORTAL_CLOSED` / `LOCAL_PORTAL_EXCEL_DIAN_ONLY` en el 232).
 * Nunca activo en GCP.
 */
export const isExcelDianPublicAccess = (): boolean => {
  if (isGcpDeployment()) return false;
  return isExcelDianExportPublic() || isLocalPortalExcelDianBypass();
};

if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
  if (isGcpDeployment() && readExportPublicFlag()) {
    console.warn(
      "[SECURITY] EXCEL_DIAN_EXPORT_PUBLIC ignorada (VISOR_DEPLOYMENT=gcp). Excel DIAN no se expone en la nube.",
    );
  } else if (isExcelDianExportPublic()) {
    console.warn(
      "[SECURITY] EXCEL_DIAN_EXPORT_PUBLIC=true en produccion. /api/excel-dian/export y /ExcelDian quedan PUBLICOS (sin autenticacion) y exponen las bases DIAN configuradas (mtodo/mio/bgt). Cambia a false si no es intencional.",
    );
  } else if (isLocalPortalExcelDianBypass()) {
    console.warn(
      "[local-notice] Portal local restringido: /ExcelDian y /api/excel-dian/export accesibles SIN login (bases DIAN solo en LAN).",
    );
  }
}
