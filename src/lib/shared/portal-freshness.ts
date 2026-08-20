import type { PoolClient } from "pg";

/** Tablas de 1 fila (o pocas) con `refreshed_at` del último rebuild de snapshots. */
export const PORTAL_FRESHNESS_META_TABLES = [
  "rotacion_item_periodo_std_meta",
  "informe_variacion_payload_std_meta",
  "rotacion_dinastia_item_periodo_std_meta",
] as const;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export type PortalFreshnessSourceId = "rotacion" | "informe" | "horas";

export type PortalFreshnessSource = {
  id: PortalFreshnessSourceId;
  label: string;
  at: string | null;
};

export type PortalFreshness = {
  updatedAt: string | null;
  sources: PortalFreshnessSource[];
};

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

export const pickLatestIso = (values: Array<string | null>): string | null => {
  let latest: string | null = null;
  for (const iso of values) {
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  return latest;
};

export const formatPortalFreshnessTooltip = (
  sources: PortalFreshnessSource[],
): string => {
  const parts = sources.map((source) => {
    const when = source.at ? formatPortalUpdatedAt(source.at) : "sin dato";
    return `${source.label}: ${when}`;
  });
  return parts.join(" · ");
};

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const readMetaTs = async (
  client: PoolClient,
  table: string,
): Promise<string | null> => {
  if (!IDENT_RE.test(table)) return null;
  const exists = await client.query<{ ok: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [`public.${table}`],
  );
  if (!exists.rows[0]?.ok) return null;
  const result = await client.query<{ ts: Date | string | null }>(
    `SELECT MAX(refreshed_at) AS ts FROM ${table}`,
  );
  return toIso(result.rows[0]?.ts);
};

const readHorasStatsTs = async (client: PoolClient): Promise<string | null> => {
  const exists = await client.query<{ ok: boolean }>(
    `SELECT to_regclass('public.asistencia_horas') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0]?.ok) return null;
  const result = await client.query<{ ts: Date | string | null }>(
    `SELECT GREATEST(last_vacuum, last_autovacuum, last_analyze, last_autoanalyze) AS ts
     FROM pg_stat_user_tables
     WHERE schemaname = 'public' AND relname = 'asistencia_horas'`,
  );
  return toIso(result.rows[0]?.ts);
};

export const loadPortalFreshness = async (
  client: PoolClient,
): Promise<PortalFreshness> => {
  const rotacion = pickLatestIso([
    await readMetaTs(client, "rotacion_item_periodo_std_meta"),
    await readMetaTs(client, "rotacion_dinastia_item_periodo_std_meta"),
  ]);
  const informe = await readMetaTs(client, "informe_variacion_payload_std_meta");
  const horas = await readHorasStatsTs(client);
  const sources: PortalFreshnessSource[] = [
    { id: "rotacion", label: "Rotación", at: rotacion },
    { id: "informe", label: "Informe de variación", at: informe },
    { id: "horas", label: "Horas (asistencia)", at: horas },
  ];
  return {
    updatedAt: pickLatestIso(sources.map((source) => source.at)),
    sources,
  };
};

/** Compat: solo el ISO más reciente. */
export const loadPortalUpdatedAt = async (
  client: PoolClient,
): Promise<string | null> => {
  const freshness = await loadPortalFreshness(client);
  return freshness.updatedAt;
};
