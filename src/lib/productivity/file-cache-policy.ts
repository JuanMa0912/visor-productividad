/** Edad maxima del JSON en disco antes de forzar rebuild (default 6 h). */
export const resolveProductivityCacheMaxAgeMs = (
  raw: string | undefined = process.env.PRODUCTIVITY_CACHE_MAX_AGE_MS,
): number => {
  const trimmed = raw?.trim();
  if (trimmed && /^\d+$/.test(trimmed)) {
    return Math.max(60_000, Number.parseInt(trimmed, 10));
  }
  return 6 * 60 * 60 * 1000;
};

/**
 * Sirve cache en disco si:
 * - `PRODUCTIVITY_SERVE_FILE_CACHE=true` (siempre, si hay archivo), o
 * - flag ausente/omitida y el archivo es reciente (TTL, default 6h).
 * `PRODUCTIVITY_SERVE_FILE_CACHE=false` desactiva el atajo.
 * `?refresh=1` / `?force=1` fuerza rebuild (forceRefresh=true).
 */
export const shouldServeProductivityFileCache = (
  updatedAt: string | null,
  forceRefresh: boolean,
  options?: {
    flag?: string;
    nowMs?: number;
    maxAgeMs?: number;
  },
): boolean => {
  if (forceRefresh) return false;
  const flag = (
    options?.flag ?? process.env.PRODUCTIVITY_SERVE_FILE_CACHE
  )
    ?.trim()
    .toLowerCase();
  if (flag === "false" || flag === "0" || flag === "no") return false;
  if (flag === "true" || flag === "1" || flag === "yes") return true;

  if (!updatedAt) return false;
  const nowMs = options?.nowMs ?? Date.now();
  const ageMs = nowMs - Date.parse(updatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  const maxAgeMs =
    options?.maxAgeMs ?? resolveProductivityCacheMaxAgeMs();
  return ageMs <= maxAgeMs;
};
