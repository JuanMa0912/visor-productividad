/**
 * Cache en memoria (proceso) para los resultados PESADOS del tablero de margenes.
 *
 * El tablero se navega re-consultando la misma sede/mes/filtros muchas veces; cada KPI/nivel
 * agrega millones de filas y tarda segundos. Cacheamos el payload por (mode + querystring)
 * con un TTL corto: la PRIMERA carga de un combo paga el costo; las repeticiones son instantaneas.
 *
 * - TTL corto (5 min) -> la frescura maxima es 5 min; los datos del mes en curso solo cambian
 *   1 vez/dia (ETL), asi que es de sobra. Para meses cerrados los datos no cambian.
 * - Cache por PROCESO (la app corre 1 instancia en fork, tanto en 232/PM2 como en GCP/systemd).
 *   Si algun dia se escala a N instancias, habria que mover esto a un store compartido.
 * - Tope de entradas con eviccion del mas viejo (Map preserva orden de insercion).
 */

type CacheEntry = { expires: number; value: unknown };

const CACHE = new Map<string, CacheEntry>();
const MAX_ENTRIES = 300;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Devuelve el payload cacheado y vigente, o null si no hay o expiro. */
export const getCachedQuery = (key: string): unknown => {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
};

/** Guarda el payload con TTL; evicta el mas viejo si se llena. */
export const setCachedQuery = (
  key: string,
  value: unknown,
  ttlMs: number = DEFAULT_TTL_MS,
): void => {
  if (CACHE.size >= MAX_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, { expires: Date.now() + ttlMs, value });
};
