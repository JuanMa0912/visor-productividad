import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const envPath = path.join(process.cwd(), ".env.local");
let dbPassword = process.env.DB_PASSWORD ?? "";
if (!dbPassword && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "DB_PASSWORD") {
      dbPassword = value;
      break;
    }
  }
}

if (!dbPassword) {
  console.error("DB_PASSWORD no encontrado.");
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST ?? "192.168.35.232",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "produXdia",
  user: process.env.DB_USER ?? "postgres",
  password: dbPassword,
  options: `-c search_path=${process.env.DB_SCHEMA ?? "public"}`,
});

const percentile = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
};

const run = async () => {
  const client = await pool.connect();
  try {
    const sample = await client.query(`
      SELECT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede,
        MIN(fecha_consulta) AS minf,
        MAX(fecha_consulta) AS maxf
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta ~ '^[0-9]{8}$'
      GROUP BY 1,2
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    if (!sample.rows.length) {
      console.log("Sin datos para benchmark.");
      return;
    }

    const { empresa, sede, minf, maxf } = sample.rows[0];
    const tests = [
      {
        name: "catalogOnly_general",
        sql: `
          SELECT DISTINCT
            COALESCE(NULLIF(TRIM(empresa),''),'sin_empresa') AS empresa,
            COALESCE(NULLIF(TRIM(sede),''),'sin_sede') AS sede_id,
            COALESCE(NULLIF(TRIM(nombre_sede),''), NULLIF(TRIM(sede),''), 'Sin sede') AS sede_name
          FROM rotacion_base_item_dia_sede
          WHERE fecha_consulta BETWEEN $1 AND $2
            AND fecha_consulta ~ '^[0-9]{8}$'
            AND item IS NOT NULL
          ORDER BY empresa ASC, sede_name ASC, sede_id ASC
        `,
        params: [minf, maxf],
      },
      {
        name: "catalogOnly_por_sede_lineasN1",
        sql: `
          SELECT DISTINCT
            COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__') AS linea_n1_codigo
          FROM rotacion_base_item_dia_sede
          WHERE fecha_consulta BETWEEN $1 AND $2
            AND fecha_consulta ~ '^[0-9]{8}$'
            AND item IS NOT NULL
            AND COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $3
            AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $4)
          ORDER BY linea_n1_codigo ASC
        `,
        params: [minf, maxf, sede, empresa],
      },
      {
        name: "tabla_agregada_por_sede",
        sql: `
          WITH scoped AS (
            SELECT
              COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
              COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
              COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
              COALESCE(venta_sin_impuesto, 0) AS venta_sin_impuesto,
              COALESCE(unidades_vendidas, 0) AS unidades_vendidas,
              GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0) AS inventory_units,
              GREATEST(COALESCE(valor_inventario, 0), 0) AS inventory_value,
              TO_DATE(fecha_consulta, 'YYYYMMDD') AS consulta_date,
              fecha_carga
            FROM rotacion_base_item_dia_sede
            WHERE fecha_consulta BETWEEN $1 AND $2
              AND fecha_consulta ~ '^[0-9]{8}$'
              AND item IS NOT NULL
              AND ($3::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $3)
              AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $4)
          ),
          ranked AS (
            SELECT
              *,
              MAX(consulta_date) OVER (PARTITION BY empresa, sede_id, item) AS latest_consulta_date,
              ROW_NUMBER() OVER (PARTITION BY empresa, sede_id, item ORDER BY consulta_date DESC, fecha_carga DESC) AS latest_rank
            FROM scoped
          ),
          aggregated AS (
            SELECT
              empresa,
              sede_id,
              item,
              SUM(venta_sin_impuesto)::numeric AS total_sales,
              SUM(unidades_vendidas)::numeric AS total_units,
              SUM(CASE WHEN consulta_date = latest_consulta_date THEN inventory_units ELSE 0 END)::numeric AS inventory_units,
              SUM(CASE WHEN consulta_date = latest_consulta_date THEN inventory_value ELSE 0 END)::numeric AS inventory_value,
              COUNT(*)::int AS tracked_days
            FROM ranked
            GROUP BY empresa, sede_id, item
          )
          SELECT
            COUNT(*)::int AS items,
            COALESCE(SUM(total_sales),0)::numeric AS total_sales,
            COALESCE(SUM(inventory_value),0)::numeric AS total_inventory
          FROM aggregated
        `,
        params: [minf, maxf, empresa, sede],
      },
    ];

    const report = [];
    for (const test of tests) {
      const times = [];
      for (let i = 0; i < 5; i += 1) {
        const explain = await client.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${test.sql}`,
          test.params,
        );
        const executionMs = explain.rows[0]["QUERY PLAN"][0]["Execution Time"];
        times.push(Number(executionMs));
      }
      report.push({
        name: test.name,
        times_ms: times.map((v) => Number(v.toFixed(2))),
        avg_ms: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)),
        p95_ms: Number(percentile(times, 0.95).toFixed(2)),
        min_ms: Number(Math.min(...times).toFixed(2)),
        max_ms: Number(Math.max(...times).toFixed(2)),
      });
    }

    console.log(
      JSON.stringify(
        {
          sample: { empresa, sede, start: minf, end: maxf },
          report,
        },
        null,
        2,
      ),
    );
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
