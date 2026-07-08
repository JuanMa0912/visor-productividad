import { getCachedQuery, setCachedQuery } from "@/lib/margenes/query-cache";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const INFORME_CACHE_TTL_MS = 10 * 60 * 1000;

export const buildInformeCacheKey = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  dayRangeId?: string | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  const range = dayRangeId?.trim() || "1-eom";
  return `informe:${year}:${month}:range=${range}:${sedes}`;
};

export const getCachedInformePayload = (
  key: string,
): InformeVariacionPayload | null => {
  const hit = getCachedQuery(key);
  return hit ? (hit as InformeVariacionPayload) : null;
};

export const setCachedInformePayload = (
  key: string,
  payload: InformeVariacionPayload,
): void => {
  setCachedQuery(key, payload, INFORME_CACHE_TTL_MS);
};
