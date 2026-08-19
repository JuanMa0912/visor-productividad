/**
 * Materializa el payload YTD por defecto de /informe-variacion
 * (1 ene → maxDate vs el mismo tramo del año anterior) en
 * informe_variacion_payload_std.
 *
 *   npx tsx scripts/warm-informe-variacion-snapshot.mts
 */

import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { normalizeInformeCompactDate } from "../src/lib/informe-variacion/day-ranges.ts";
import { loadInformeVariacionRangePayload } from "../src/lib/informe-variacion/query.ts";
import { loadInformeVariacionMeta } from "../src/lib/informe-variacion/meta.ts";
import {
  touchInformePayloadStdMeta,
  upsertInformePayloadStd,
} from "../src/lib/informe-variacion/payload-std-server.ts";
import { INFORME_PAYLOAD_STD_FULL_SCOPE } from "../src/lib/informe-variacion/payload-std.ts";
import {
  defaultInformeYtdRanges,
  informeRangeCacheKey,
} from "../src/lib/informe-variacion/date-range.ts";

loadEnvFiles();

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

const startedAt = Date.now();

try {
  const tableCheck = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'informe_variacion_payload_std'
    LIMIT 1
    `,
  );
  if (tableCheck.rowCount === 0) {
    console.error(
      "Falta migracion db/migrations/20260716_informe_variacion_payload_std.sql",
    );
    process.exit(1);
  }

  await client.query("SET work_mem = '256MB'");
  await client.query("SET jit = off");
  await client.query("SET statement_timeout = 0");

  const meta = await loadInformeVariacionMeta(client, null);
  const maxCompactDate = normalizeInformeCompactDate(meta.maxDate);
  const ranges = defaultInformeYtdRanges(maxCompactDate);
  const rangeId = informeRangeCacheKey(ranges);
  const year = Number(ranges.currentTo.slice(0, 4));
  const month = Number(ranges.currentTo.slice(4, 6));

  console.log(
    `=== Warm informe_variacion_payload_std YTD (scope=${INFORME_PAYLOAD_STD_FULL_SCOPE}) ===`,
  );
  console.log(
    `rango ${ranges.currentFrom}-${ranges.currentTo} vs ${ranges.previousFrom}-${ranges.previousTo}`,
  );

  const t0 = Date.now();
  const payload = await loadInformeVariacionRangePayload(
    client,
    ranges,
    null,
  );
  await upsertInformePayloadStd(client, {
    year,
    month,
    rangeId,
    payload,
  });
  await touchInformePayloadStdMeta(client, year, month, 1);
  console.log(
    `OK ${payload.meta.rowCount} filas en ${((Date.now() - t0) / 1000).toFixed(1)}s (total ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
} catch (error) {
  console.error("warm-informe-variacion-snapshot failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
