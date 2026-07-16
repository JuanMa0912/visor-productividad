/**
 * Materializa payloads JSON de /informe-variacion en informe_variacion_payload_std.
 * Scope '*' (todas las sedes). Corre tras refresh-variacion-roll.sh.
 *
 *   npx tsx scripts/warm-informe-variacion-snapshot.mts
 *   WARM_MONTHS=2 npx tsx scripts/warm-informe-variacion-snapshot.mts
 */

import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import {
  getAvailableInformeDayRanges,
  normalizeInformeCompactDate,
} from "../src/lib/informe-variacion/day-ranges.ts";
import { loadInformeVariacionMonthBundle } from "../src/lib/informe-variacion/daily-bundle.ts";
import { loadInformeVariacionMeta } from "../src/lib/informe-variacion/meta.ts";
import {
  touchInformePayloadStdMeta,
  upsertInformePayloadStd,
} from "../src/lib/informe-variacion/payload-std-server.ts";
import { INFORME_PAYLOAD_STD_FULL_SCOPE } from "../src/lib/informe-variacion/payload-std.ts";

loadEnvFiles();

const monthsBack = Math.max(
  1,
  Math.min(6, Number(process.env.WARM_MONTHS ?? "2") || 2),
);

const shiftMonth = (year: number, month: number, delta: number) => {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

const startedAt = Date.now();
let totalRanges = 0;
let primaryYear = new Date().getFullYear();
let primaryMonth = new Date().getMonth() + 1;

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
  const asOf = new Date();

  console.log(
    `=== Warm informe_variacion_payload_std (scope=${INFORME_PAYLOAD_STD_FULL_SCOPE}, meses=${monthsBack}) ===`,
  );
  if (maxCompactDate) {
    console.log(`maxDate roll: ${maxCompactDate}`);
  }

  for (let offset = 0; offset < monthsBack; offset += 1) {
    const { year, month } = shiftMonth(
      asOf.getFullYear(),
      asOf.getMonth() + 1,
      -offset,
    );
    if (offset === 0) {
      primaryYear = year;
      primaryMonth = month;
    }

    const ranges = getAvailableInformeDayRanges(
      year,
      month,
      asOf,
      maxCompactDate,
    );
    if (ranges.length === 0) {
      console.log(
        `  ${year}-${String(month).padStart(2, "0")}: sin rangos disponibles`,
      );
      continue;
    }

    console.log(
      `  ${year}-${String(month).padStart(2, "0")}: ${ranges.length} rangos…`,
    );
    const t0 = Date.now();
    const loaded = await loadInformeVariacionMonthBundle(
      client,
      year,
      month,
      null,
      ranges,
      null,
    );

    if (!loaded) {
      console.warn(
        `  WARN: bundle no disponible (¿margen_item_dia_roll?). Skip ${year}-${month}`,
      );
      continue;
    }

    for (const rangeId of loaded.bundle.rangeIds) {
      const payload = loaded.bundle.payloads[rangeId];
      if (!payload) continue;
      await upsertInformePayloadStd(client, {
        year,
        month,
        rangeId,
        payload,
      });
      totalRanges += 1;
    }

    console.log(
      `  OK ${loaded.bundle.rangeIds.length} payloads en ${((Date.now() - t0) / 1000).toFixed(1)}s (sql=${loaded.stats.sqlMs}ms)`,
    );
  }

  await touchInformePayloadStdMeta(client, primaryYear, primaryMonth, totalRanges);
  console.log(
    `Completado: ${totalRanges} rangos en ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
} catch (error) {
  console.error("warm-informe-variacion-snapshot failed:", error);
  process.exitCode = 1;
} finally {
  await client.end();
}
