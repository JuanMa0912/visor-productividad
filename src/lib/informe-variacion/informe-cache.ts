import { getCachedQuery, setCachedQuery } from "@/lib/margenes/query-cache";
import type { InformeVariacionMonthBundle } from "@/lib/informe-variacion/daily-bundle";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { scopeExcludedTiposCacheSuffix, scopeLineasCacheSuffix, scopeTiposCacheSuffix } from "@/lib/shared/line-category-scope";

const INFORME_CACHE_TTL_MS = 30 * 60 * 1000;

const scopeCacheSuffix = (
  forcedMargenTipos?: string[] | null,
  forcedMargenLineas?: string[] | null,
  excludedMargenTipos?: string[] | null,
) =>
  `${scopeTiposCacheSuffix(forcedMargenTipos)}${scopeLineasCacheSuffix(forcedMargenLineas)}${scopeExcludedTiposCacheSuffix(excludedMargenTipos)}`;

export const buildInformeCacheKey = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  dayRangeId?: string | null,
  forcedMargenTipos?: string[] | null,
  forcedMargenLineas?: string[] | null,
  excludedMargenTipos?: string[] | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  const range = dayRangeId?.trim() || "1-eom";
  return `informe:${year}:${month}:range=${range}:${sedes}${scopeCacheSuffix(forcedMargenTipos, forcedMargenLineas, excludedMargenTipos)}`;
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
  // No cachear vacios: un refresh que vacie la tabla no debe congelar el
  // informe 30 min con "sin datos".
  if (!payload.rows?.length) return;
  setCachedQuery(key, payload, INFORME_CACHE_TTL_MS);
};

export const buildInformeBundleCacheKey = (
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  forcedMargenTipos?: string[] | null,
  forcedMargenLineas?: string[] | null,
  excludedMargenTipos?: string[] | null,
): string => {
  const sedes =
    allowedSedeKeys && allowedSedeKeys.length > 0
      ? [...allowedSedeKeys].sort().join(",")
      : "*";
  return `informe-bundle:${year}:${month}:${sedes}${scopeCacheSuffix(forcedMargenTipos, forcedMargenLineas, excludedMargenTipos)}`;
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
  forcedMargenTipos?: string[] | null,
  forcedMargenLineas?: string[] | null,
  excludedMargenTipos?: string[] | null,
): void => {
  const hasRows = Object.values(bundle.payloads).some(
    (payload) => (payload.rows?.length ?? 0) > 0,
  );
  if (!hasRows) return;
  setCachedQuery(key, bundle, INFORME_CACHE_TTL_MS);
  for (const [rangeId, payload] of Object.entries(bundle.payloads)) {
    setCachedInformePayload(
      buildInformeCacheKey(
        bundle.year,
        bundle.month,
        allowedSedeKeys,
        rangeId,
        forcedMargenTipos,
        forcedMargenLineas,
        excludedMargenTipos,
      ),
      payload,
    );
  }
};
