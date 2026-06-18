import type { RotacionBaseQueryClient } from "@/lib/rotacion/base-fields";
import type { RotacionPeriodoStdMeta } from "@/lib/rotacion/periodo-std";

const ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROTACION_PERIODO_STD_META_CACHE_TTL_MS = 5 * 60 * 1000;

let rotacionPeriodoStdProbeCache:
  | { ready: boolean; expiresAt: number }
  | null = null;
let rotacionPeriodoStdMetaCache:
  | { value: RotacionPeriodoStdMeta | null; expiresAt: number }
  | null = null;

const toIsoDateKey = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);
  return null;
};

export async function probeRotacionPeriodoStdReady(
  client: RotacionBaseQueryClient,
): Promise<boolean> {
  const now = Date.now();
  if (
    rotacionPeriodoStdProbeCache &&
    rotacionPeriodoStdProbeCache.expiresAt > now
  ) {
    return rotacionPeriodoStdProbeCache.ready;
  }
  try {
    const result = await client.query(
      `
      SELECT 1
      FROM rotacion_item_periodo_std_meta
      WHERE id = 1
        AND row_count > 0
      LIMIT 1
      `,
    );
    const ready = (result.rows?.length ?? 0) > 0;
    rotacionPeriodoStdProbeCache = {
      ready,
      expiresAt: now + ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS,
    };
    return ready;
  } catch {
    rotacionPeriodoStdProbeCache = {
      ready: false,
      expiresAt: now + ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS,
    };
    return false;
  }
}

export async function getRotacionPeriodoStdMeta(
  client: RotacionBaseQueryClient,
): Promise<RotacionPeriodoStdMeta | null> {
  const now = Date.now();
  if (
    rotacionPeriodoStdMetaCache &&
    rotacionPeriodoStdMetaCache.expiresAt > now
  ) {
    return rotacionPeriodoStdMetaCache.value;
  }

  try {
    const result = await client.query(
      `
      SELECT
        periodo_start,
        periodo_end,
        refreshed_at,
        row_count
      FROM rotacion_item_periodo_std_meta
      WHERE id = 1
      LIMIT 1
      `,
    );
    const row = result.rows?.[0] as
      | {
          periodo_start?: string | Date | null;
          periodo_end?: string | Date | null;
          refreshed_at?: string | Date | null;
          row_count?: string | number | null;
        }
      | undefined;

    const periodoStart = toIsoDateKey(row?.periodo_start);
    const periodoEnd = toIsoDateKey(row?.periodo_end);
    if (!periodoStart || !periodoEnd) {
      rotacionPeriodoStdMetaCache = {
        value: null,
        expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
      };
      return null;
    }

    const value: RotacionPeriodoStdMeta = {
      periodoStart,
      periodoEnd,
      refreshedAt: row?.refreshed_at
        ? new Date(row.refreshed_at).toISOString()
        : "",
      rowCount: Number(row?.row_count ?? 0) || 0,
    };
    rotacionPeriodoStdMetaCache = {
      value,
      expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
    };
    return value;
  } catch {
    rotacionPeriodoStdMetaCache = {
      value: null,
      expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
    };
    return null;
  }
}

export const matchesRotacionPeriodoStdRange = (
  meta: RotacionPeriodoStdMeta | null,
  startDate: string,
  endDate: string,
): boolean =>
  Boolean(
    meta &&
      meta.rowCount > 0 &&
      meta.periodoStart === startDate &&
      meta.periodoEnd === endDate,
  );
