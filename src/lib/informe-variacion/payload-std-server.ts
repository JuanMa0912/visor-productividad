import type { QueryResult, QueryResultRow } from "pg";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";
import type { InformeVariacionMonthBundle } from "@/lib/informe-variacion/daily-bundle";
import {
  INFORME_PAYLOAD_STD_FULL_SCOPE,
  type InformePayloadStdMeta,
} from "@/lib/informe-variacion/payload-std";

type Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
};

const TABLE_MISSING = /informe_variacion_payload_std/i;
const DOES_NOT_EXIST = /does not exist|no existe/i;

export const canUseInformePayloadStd = (
  allowedSedeKeys: string[] | null,
  forcedMargenTipos?: string[] | null,
): boolean =>
  allowedSedeKeys === null &&
  (forcedMargenTipos == null || forcedMargenTipos.length === 0);

export const getInformePayloadStd = async (
  client: Queryable,
  year: number,
  month: number,
  rangeId: string,
  scopeKey: string = INFORME_PAYLOAD_STD_FULL_SCOPE,
): Promise<InformeVariacionPayload | null> => {
  try {
    const result = await client.query<{ payload: InformeVariacionPayload }>(
      `
      SELECT payload
      FROM informe_variacion_payload_std
      WHERE year = $1
        AND month = $2
        AND range_id = $3
        AND scope_key = $4
      LIMIT 1
      `,
      [year, month, rangeId, scopeKey],
    );
    const payload = result.rows[0]?.payload ?? null;
    if (!payload?.rows?.length) return null;
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (TABLE_MISSING.test(message) && DOES_NOT_EXIST.test(message)) {
      return null;
    }
    throw error;
  }
};

export const getInformePayloadStdBundle = async (
  client: Queryable,
  year: number,
  month: number,
  rangeIds: readonly string[],
  scopeKey: string = INFORME_PAYLOAD_STD_FULL_SCOPE,
): Promise<InformeVariacionMonthBundle | null> => {
  if (rangeIds.length === 0) return null;
  try {
    const result = await client.query<{
      range_id: string;
      payload: InformeVariacionPayload;
    }>(
      `
      SELECT range_id, payload
      FROM informe_variacion_payload_std
      WHERE year = $1
        AND month = $2
        AND scope_key = $3
        AND range_id = ANY($4::text[])
      `,
      [year, month, scopeKey, [...rangeIds]],
    );
    if (result.rows.length !== rangeIds.length) return null;

    const payloads: Record<string, InformeVariacionPayload> = {};
    for (const row of result.rows) {
      if (!row.payload?.rows?.length) return null;
      payloads[row.range_id] = row.payload;
    }
    for (const rangeId of rangeIds) {
      if (!payloads[rangeId]) return null;
    }

    return {
      bundle: true,
      year,
      month,
      payloads,
      rangeIds: [...rangeIds],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (TABLE_MISSING.test(message) && DOES_NOT_EXIST.test(message)) {
      return null;
    }
    throw error;
  }
};

export const upsertInformePayloadStd = async (
  client: Queryable,
  input: {
    year: number;
    month: number;
    rangeId: string;
    scopeKey?: string;
    payload: InformeVariacionPayload;
  },
): Promise<void> => {
  const scopeKey = input.scopeKey ?? INFORME_PAYLOAD_STD_FULL_SCOPE;
  await client.query(
    `
    INSERT INTO informe_variacion_payload_std (
      year, month, range_id, scope_key, payload, row_count, generated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
    ON CONFLICT (year, month, range_id, scope_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      row_count = EXCLUDED.row_count,
      generated_at = EXCLUDED.generated_at
    `,
    [
      input.year,
      input.month,
      input.rangeId,
      scopeKey,
      JSON.stringify(input.payload),
      input.payload.meta?.rowCount ?? input.payload.rows?.length ?? 0,
    ],
  );
};

export const touchInformePayloadStdMeta = async (
  client: Queryable,
  year: number,
  month: number,
  rangeCount: number,
): Promise<void> => {
  await client.query(
    `
    INSERT INTO informe_variacion_payload_std_meta (
      id, refreshed_at, year, month, range_count
    )
    VALUES (1, now(), $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET
      refreshed_at = EXCLUDED.refreshed_at,
      year = EXCLUDED.year,
      month = EXCLUDED.month,
      range_count = EXCLUDED.range_count
    `,
    [year, month, rangeCount],
  );
};

export const getInformePayloadStdMeta = async (
  client: Queryable,
): Promise<InformePayloadStdMeta | null> => {
  try {
    const result = await client.query<{
      refreshed_at: Date | string;
      year: number;
      month: number;
      range_count: number;
    }>(
      `
      SELECT refreshed_at, year, month, range_count
      FROM informe_variacion_payload_std_meta
      WHERE id = 1
      LIMIT 1
      `,
    );
    const row = result.rows[0];
    if (!row) return null;
    const refreshedAt =
      row.refreshed_at instanceof Date
        ? row.refreshed_at.toISOString()
        : new Date(row.refreshed_at).toISOString();
    return {
      refreshedAt,
      year: Number(row.year),
      month: Number(row.month),
      rangeCount: Number(row.range_count),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (TABLE_MISSING.test(message) && DOES_NOT_EXIST.test(message)) {
      return null;
    }
    throw error;
  }
};
