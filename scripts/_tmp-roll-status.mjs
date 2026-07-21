import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";

loadEnvFiles();

const migrations = [
  "db/migrations/20260702_margen_final_roll.sql",
  "db/migrations/20260703_margen_final_roll_refresh_chunks.sql",
  "db/migrations/20260708_margen_item_dia_roll.sql",
  "db/migrations/20260710_margen_item_dia_roll_margin.sql",
  "db/migrations/20260715_margen_item_dia_roll_atomic_refresh.sql",
];

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

const exists = async (name) => {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name],
  );
  return (r.rows?.length ?? 0) > 0;
};

const report = {
  tables: {
    margen_final_roll: await exists("margen_final_roll"),
    margen_item_dia_roll: await exists("margen_item_dia_roll"),
    informe_variacion_payload_std: await exists("informe_variacion_payload_std"),
  },
};

if (await exists("margen_final")) {
  const bounds = await client.query(`
    SELECT MIN(fecha_dcto)::text AS min_date, MAX(fecha_dcto)::text AS max_date,
           COUNT(*)::bigint AS rows
    FROM margen_final WHERE fecha_dcto IS NOT NULL
  `);
  report.margen_final = bounds.rows[0];
  const months = await client.query(`
    SELECT left(fecha_dcto,6) AS ym, COUNT(*)::bigint AS rows
    FROM margen_final WHERE fecha_dcto IS NOT NULL AND fecha_dcto ~ '^[0-9]{8}$'
    GROUP BY 1 ORDER BY 1
  `);
  report.months = months.rows;
}

if (report.tables.margen_final_roll) {
  const roll = await client.query(`
    SELECT COUNT(*)::bigint AS rows, MIN(fecha_dcto)::text AS min_date, MAX(fecha_dcto)::text AS max_date
    FROM margen_final_roll
  `);
  report.margen_final_roll_stats = roll.rows[0];
}

if (report.tables.margen_item_dia_roll) {
  const item = await client.query(`
    SELECT COUNT(*)::bigint AS rows, MIN(fecha_dcto)::text AS min_date, MAX(fecha_dcto)::text AS max_date
    FROM margen_item_dia_roll
  `);
  report.margen_item_dia_roll_stats = item.rows[0];
}

console.log(JSON.stringify(report, null, 2));
await client.end();
