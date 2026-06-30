/**
 * Pobla margen_final_roll desde margen_final (rollup factura+ítem).
 * Ejecutar tras cada carga ETL diaria de margen_final.
 *
 * Uso:
 *   npm run margen:refresh-roll
 */

import pg from "pg";
import { performance } from "node:perf_hooks";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { resetMargenDataSourceCache } from "../src/lib/margenes/margen-data-source";

loadEnvFiles();

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

    console.log("Refrescando margen_final_roll...");
    const t0 = performance.now();
    const result = await client.query<{
      inserted_rows: string;
      elapsed_ms: string;
    }>(`SELECT * FROM refresh_margen_final_roll()`);
    const row = result.rows[0];
    const wallMs = performance.now() - t0;
    resetMargenDataSourceCache();

    console.log(
      `Listo: ${Number(row?.inserted_rows ?? 0).toLocaleString("es-CO")} filas en ${Number(row?.elapsed_ms ?? wallMs).toLocaleString("es-CO")} ms (wall ${Math.round(wallMs)} ms).`,
    );
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
