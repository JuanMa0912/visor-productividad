/**
 * Pobla margen_final_roll desde margen_final (rollup factura+ítem).
 * Ejecutar tras cada carga ETL diaria de margen_final.
 *
 * Uso:
 *   npm run margen:refresh-roll
 *   MARGEN_ROLL_FROM=20260601 MARGEN_ROLL_TO=20260601 npm run margen:refresh-roll  # un día
 *   MARGEN_ROLL_SINGLE=1 npm run margen:refresh-roll   # full en una sola llamada (BD pequeña)
 */

import pg from "pg";
import { performance } from "node:perf_hooks";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { resetMargenDataSourceCache } from "../src/lib/margenes/margen-data-source";

loadEnvFiles();

const SINGLE = process.env.MARGEN_ROLL_SINGLE === "1";
const FROM = process.env.MARGEN_ROLL_FROM?.trim() ?? "";
const TO = process.env.MARGEN_ROLL_TO?.trim() ?? "";
const INCREMENTAL = Boolean(FROM && TO);

const formatMs = (ms: number) =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`;

const disableTimeouts = async (client: pg.PoolClient) => {
  await client.query("SET statement_timeout = 0");
  await client.query("SET lock_timeout = 0");
};

const refreshChunk = async (
  client: pg.PoolClient,
  from: string | null,
  to: string | null,
) => {
  const result = await client.query<{
    inserted_rows: string;
    elapsed_ms: string;
  }>(
    `SELECT * FROM refresh_margen_final_roll($1, $2)`,
    [from, to],
  );
  return {
    rows: Number(result.rows[0]?.inserted_rows ?? 0),
    ms: Number(result.rows[0]?.elapsed_ms ?? 0),
  };
};

const listMonthKeys = async (client: pg.PoolClient) => {
  const result = await client.query<{ ym: string }>(`
    SELECT DISTINCT left(fecha_dcto, 6) AS ym
    FROM margen_final
    WHERE fecha_dcto IS NOT NULL
      AND fecha_dcto ~ '^[0-9]{8}$'
    ORDER BY 1
  `);
  return result.rows.map((row) => row.ym);
};

const main = async () => {
  const pool = new pg.Pool(resolvePgClientConfig());
  const client = await pool.connect();
  try {
    const exists = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'margen_final_roll'
      ) AS ok
    `);
    if (!exists.rows[0]?.ok) {
      console.error(
        "Tabla margen_final_roll no existe. Aplica db/migrations/20260702_margen_final_roll.sql.",
      );
      process.exit(1);
    }

    await disableTimeouts(client);
    const t0 = performance.now();
    let totalRows = 0;

    if (INCREMENTAL) {
      console.log(`Refresh incremental ${FROM} → ${TO}...`);
      const chunk = await refreshChunk(client, FROM, TO);
      totalRows = chunk.rows;
      console.log(`  ${totalRows.toLocaleString("es-CO")} filas (${formatMs(chunk.ms)})`);
      await client.query("ANALYZE margen_final_roll");
    } else if (SINGLE) {
      console.log("Refresh completo (una sola pasada)...");
      const chunk = await refreshChunk(client, null, null);
      totalRows = chunk.rows;
      console.log(`  ${totalRows.toLocaleString("es-CO")} filas (${formatMs(chunk.ms)})`);
    } else {
      const months = await listMonthKeys(client);
      if (months.length === 0) {
        console.log("margen_final no tiene fechas válidas; nada que refrescar.");
        return;
      }

      console.log(
        `Refresh completo por meses (${months.length} chunks). Aplica migración 20260703 si falla por timeout.`,
      );
      await client.query("TRUNCATE margen_final_roll");

      for (const ym of months) {
        const from = `${ym}01`;
        const to = `${ym}31`;
        const label = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
        const chunkStarted = performance.now();
        const chunk = await refreshChunk(client, from, to);
        totalRows += chunk.rows;
        console.log(
          `  ${label}: ${chunk.rows.toLocaleString("es-CO")} filas (${formatMs(performance.now() - chunkStarted)})`,
        );
      }

      await client.query("ANALYZE margen_final_roll");
    }

    resetMargenDataSourceCache();
    console.log(
      `Listo: ${totalRows.toLocaleString("es-CO")} filas rollup en ${formatMs(performance.now() - t0)}.`,
    );

    const itemDiaExists = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'margen_item_dia_roll'
      ) AS ok
    `);
    if (itemDiaExists.rows[0]?.ok) {
      console.log("Refrescando margen_item_dia_roll (informe-variacion)...");
      const itemStarted = performance.now();
      const itemResult = await client.query<{
        inserted_rows: string;
        elapsed_ms: string;
      }>(
        INCREMENTAL
          ? `SELECT * FROM refresh_margen_item_dia_roll($1, $2)`
          : `SELECT * FROM refresh_margen_item_dia_roll(NULL, NULL)`,
        INCREMENTAL ? [FROM, TO] : [],
      );
      const itemRows = Number(itemResult.rows[0]?.inserted_rows ?? 0);
      console.log(
        `  margen_item_dia_roll: ${itemRows.toLocaleString("es-CO")} filas (${formatMs(performance.now() - itemStarted)})`,
      );
      resetMargenDataSourceCache();
    } else {
      console.log(
        "Aviso: margen_item_dia_roll no existe. Aplica db/migrations/20260708_margen_item_dia_roll.sql para acelerar /informe-variacion.",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
