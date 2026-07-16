/** Scope completo (admin / sin filtro de sede ni tipos forzados). */
export const INFORME_PAYLOAD_STD_FULL_SCOPE = "*";

export type InformePayloadStdMeta = {
  refreshedAt: string;
  year: number;
  month: number;
  rangeCount: number;
};
