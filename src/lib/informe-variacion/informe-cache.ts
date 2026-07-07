import { getCachedQuery, setCachedQuery } from "@/lib/margenes/query-cache";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

const INFORME_CACHE_TTL_MS = 10 * 60 * 1000;

export const buildInformeCacheKey = (
  year: number,
  month: number,
  mockBases: boolean,
  allowedSedeKeys: string[] | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  return `informe:${year}:${month}:mock=${mockBases ? 1 : 0}:${sedes}`;
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
