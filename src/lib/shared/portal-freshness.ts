import type { PoolClient } from "pg";

/** Tablas de 1 fila (o pocas) con `refreshed_at` del último rebuild de snapshots. */
export const PORTAL_FRESHNESS_META_TABLES = [
  "rotacion_item_periodo_std_meta",
  "informe_variacion_payload_std_meta",
  "rotacion_dinastia_item_periodo_std_meta",
] as const;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export const formatPortalUpdatedAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
};

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const loadPortalUpdatedAt = async (
  client: PoolClient,
): Promise<string | null> => {
  let latest: string | null = null;
  for (const table of PORTAL_FRESHNESS_META_TABLES) {
    if (!IDENT_RE.test(table)) continue;
    const exists = await client.query<{ ok: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [`public.${table}`],
    );
    if (!exists.rows[0]?.ok) continue;
    const result = await client.query<{ ts: Date | string | null }>(
      `SELECT MAX(refreshed_at) AS ts FROM ${table}`,
    );
    const iso = toIso(result.rows[0]?.ts);
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  return latest;
};
