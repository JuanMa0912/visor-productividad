/**
 * Benchmark SQL del informe de variacion (margen_item_dia_roll + agregacion).
 *
 *   npm run benchmark:informe-variacion
 *   BENCHMARK_YEAR=2026 BENCHMARK_MONTH=6 npm run benchmark:informe-variacion
 */

import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { getAvailableInformeDayRanges } from "../src/lib/informe-variacion/day-ranges.ts";
import { computeInformeDailyFetchBounds } from "../src/lib/informe-variacion/periods.ts";
import { loadInformeVariacionMonthBundle } from "../src/lib/informe-variacion/daily-bundle.ts";
import { loadInformeVariacionPayload } from "../src/lib/informe-variacion/query.ts";
import { defaultInformeDayRangeId } from "../src/lib/informe-variacion/day-ranges.ts";
import { resolveInformeMargenDataSource } from "../src/lib/margenes/margen-data-source.ts";

loadEnvFiles();

const year = Number(process.env.BENCHMARK_YEAR ?? new Date().getFullYear());
const month = Number(process.env.BENCHMARK_MONTH ?? new Date().getMonth() + 1);
const formatMs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

if (
  !Number.isInteger(year) ||
  year < 2000 ||
  !Number.isInteger(month) ||
  month < 1 ||
  month > 12
) {
  console.error("BENCHMARK_YEAR / BENCHMARK_MONTH invalidos.");
  process.exit(1);
}

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

try {
  console.log("=== Informe variacion — benchmark SQL ===");
  console.log(`Mes: ${year}-${String(month).padStart(2, "0")}`);

  await client.query("SET work_mem = '256MB'");
  await client.query("SET jit = off");

  const table = await resolveInformeMargenDataSource(client);
  console.log(`Fuente: ${table}`);

  const ranges = getAvailableInformeDayRanges(year, month);
  const primaryId = defaultInformeDayRangeId(ranges);
  console.log(`Rangos disponibles: ${ranges.length}`);
  if (primaryId) {
    console.log(`Rango principal: ${primaryId}`);
  }
  if (ranges.length > 0) {
    const bounds = computeInformeDailyFetchBounds(year, month, ranges);
    console.log(
      `Ventana SQL bundle: cur ${bounds.cur.from}-${bounds.cur.to} · mom ${bounds.mom.from}-${bounds.mom.to} · yoy ${bounds.yoy.from}-${bounds.yoy.to}`,
    );
  }

  if (primaryId) {
    const rangeSpec = ranges.find((range) => range.id === primaryId)!;
    const t0 = performance.now();
    const payload = await loadInformeVariacionPayload(client, year, month, null, {
      dayRange: rangeSpec,
    });
    const singleMs = performance.now() - t0;
    console.log(
      `\n1) Un rango (${primaryId}): ${formatMs(singleMs)} · filas=${payload.meta.rowCount}`,
    );
  }

  if (ranges.length > 0) {
    const t0 = performance.now();
    const loaded = await loadInformeVariacionMonthBundle(
      client,
      year,
      month,
      null,
      ranges,
    );
    const bundleMs = performance.now() - t0;
    if (!loaded) {
      console.log(
        `\n2) Bundle mes: no disponible (margen_item_dia_roll ausente o vacio)`,
      );
    } else {
      const firstPayload = loaded.bundle.payloads[loaded.bundle.rangeIds[0] ?? ""];
      console.log(
        `\n2) Bundle mes (${loaded.bundle.rangeIds.length} rangos): ${formatMs(bundleMs)}`,
      );
      console.log(
        `   sql=${formatMs(loaded.stats.sqlMs)} build=${formatMs(loaded.stats.buildMs)} dailyRows=${loaded.stats.dailyRowCount}`,
      );
      if (firstPayload) {
        console.log(
          `   filas 1er rango=${firstPayload.meta.rowCount} · ahorro vs N queries=${ranges.length > 1 ? `${((1 - 1 / ranges.length) * 100).toFixed(0)}% menos round-trips` : "n/a"}`,
        );
      }
    }
  }

  const countResult = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM margen_item_dia_roll WHERE fecha_dcto LIKE $1`,
    [`${year}${String(month).padStart(2, "0")}%`],
  );
  const monthRows = countResult.rows[0]?.n ?? "?";
  console.log(`\nFilas margen_item_dia_roll mes actual: ${monthRows}`);
} finally {
  await client.end();
}
