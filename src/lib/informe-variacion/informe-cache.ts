import { getCachedQuery, setCachedQuery } from "@/lib/margenes/query-cache";
import type { InformeVariacionMonthBundle } from "@/lib/informe-variacion/daily-bundle";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { scopeTiposCacheSuffix } from "@/lib/shared/line-category-scope";

const INFORME_CACHE_TTL_MS = 30 * 60 * 1000;

export const buildInformeCacheKey = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  dayRangeId?: string | null,
  forcedMargenTipos?: string[] | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  const range = dayRangeId?.trim() || "1-eom";
  return `informe:${year}:${month}:range=${range}:${sedes}${scopeTiposCacheSuffix(forcedMargenTipos)}`;
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

export const buildInformeBundleCacheKey = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  forcedMargenTipos?: string[] | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  return `informe-bundle:${year}:${month}:${sedes}${scopeTiposCacheSuffix(forcedMargenTipos)}`;
};

export const getCachedInformeMonthBundle = (
  key: string,
): InformeVariacionMonthBundle | null => {
  const hit = getCachedQuery(key);
  return hit ? (hit as InformeVariacionMonthBundle) : null;
};

export const setCachedInformeMonthBundle = (
  key: string,
  bundle: InformeVariacionMonthBundle,
  allowedSedeKeys: string[] | null,
): void => {
  setCachedQuery(key, bundle, INFORME_CACHE_TTL_MS);
  for (const [rangeId, payload] of Object.entries(bundle.payloads)) {
    setCachedInformePayload(
      buildInformeCacheKey(bundle.year, bundle.month, allowedSedeKeys, rangeId),
      payload,
    );
  }
};
