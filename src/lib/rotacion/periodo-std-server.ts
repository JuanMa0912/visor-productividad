import type { RotacionBaseQueryClient } from "@/lib/rotacion/base-fields";
import type { RotacionPeriodoStdMeta } from "@/lib/rotacion/periodo-std";
import { getRotacionSourceTable } from "@/lib/rotacion/source-context";
import {
  resolveRotacionPeriodoStdMetaTable,
  type RotacionSourceTable,
} from "@/lib/rotacion/source-tables";

const ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROTACION_PERIODO_STD_META_CACHE_TTL_MS = 5 * 60 * 1000;

const rotacionPeriodoStdProbeCache = new Map<
  string,
  { ready: boolean; expiresAt: number }
>();
const rotacionPeriodoStdMetaCache = new Map<
  string,
  { value: RotacionPeriodoStdMeta | null; expiresAt: number }
>();

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

const resolveMetaTable = (source?: RotacionSourceTable) =>
  resolveRotacionPeriodoStdMetaTable(source ?? getRotacionSourceTable());

export async function probeRotacionPeriodoStdReady(
  client: RotacionBaseQueryClient,
  source?: RotacionSourceTable,
): Promise<boolean> {
  const metaTable = resolveMetaTable(source);
  const now = Date.now();
  const cached = rotacionPeriodoStdProbeCache.get(metaTable);
  if (cached && cached.expiresAt > now) {
    return cached.ready;
  }
  try {
    const result = await client.query(
      `
      SELECT 1
      FROM ${metaTable}
      WHERE id = 1
        AND row_count > 0
      LIMIT 1
      `,
    );
    const ready = (result.rows?.length ?? 0) > 0;
    rotacionPeriodoStdProbeCache.set(metaTable, {
      ready,
      expiresAt: now + ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS,
    });
    return ready;
  } catch {
    rotacionPeriodoStdProbeCache.set(metaTable, {
      ready: false,
      expiresAt: now + ROTACION_PERIODO_STD_PROBE_CACHE_TTL_MS,
    });
    return false;
  }
}

export async function getRotacionPeriodoStdMeta(
  client: RotacionBaseQueryClient,
  source?: RotacionSourceTable,
): Promise<RotacionPeriodoStdMeta | null> {
  const metaTable = resolveMetaTable(source);
  const now = Date.now();
  const cached = rotacionPeriodoStdMetaCache.get(metaTable);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const result = await client.query(
      `
      SELECT
        periodo_start,
        periodo_end,
        refreshed_at,
        row_count
      FROM ${metaTable}
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
      rotacionPeriodoStdMetaCache.set(metaTable, {
        value: null,
        expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
      });
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
    rotacionPeriodoStdMetaCache.set(metaTable, {
      value,
      expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
    });
    return value;
  } catch {
    rotacionPeriodoStdMetaCache.set(metaTable, {
      value: null,
      expiresAt: now + ROTACION_PERIODO_STD_META_CACHE_TTL_MS,
    });
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
