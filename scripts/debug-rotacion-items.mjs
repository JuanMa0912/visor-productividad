/**
 * One-off: inspecciona filas en rotacion_base_item_dia_sede para items concretos.
 * Uso: node scripts/debug-rotacion-items.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadLocalEnv = () => {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
};

loadLocalEnv();

const items = ["020303", "064745", "013234"];

const sql = `
WITH scoped AS (
  SELECT
    fecha_consulta,
    TRIM(COALESCE(empresa::text, '')) AS empresa,
    TRIM(COALESCE(sede::text, '')) AS sede,
    TRIM(COALESCE(nombre_sede::text, '')) AS nombre_sede,
    TRIM(COALESCE(item::text, '')) AS item,
    inv_cierre_dia_ayer,
    valor_inventario,
    unidades_vendidas,
    venta_sin_impuesto,
    TRIM(COALESCE(bodega::text, '')) AS bodega,
    TRIM(COALESCE(nombre_bodega::text, '')) AS nombre_bodega,
    TRIM(COALESCE(linea::text, '')) AS linea,
    TRIM(COALESCE(linea_n1_codigo::text, '')) AS linea_n1_codigo,
    fecha_carga
  FROM rotacion_base_item_dia_sede
  WHERE TRIM(COALESCE(item::text, '')) = ANY($1::text[])
    AND fecha_consulta ~ '^[0-9]{8}$'
),
by_item AS (
  SELECT item, MAX(fecha_consulta) AS ultima_fecha
  FROM scoped
  GROUP BY item
)
SELECT
  s.fecha_consulta,
  s.empresa,
  s.sede,
  s.nombre_sede,
  s.item,
  s.inv_cierre_dia_ayer,
  s.valor_inventario,
  s.unidades_vendidas,
  s.venta_sin_impuesto,
  s.bodega,
  s.nombre_bodega,
  s.linea,
  s.linea_n1_codigo,
  s.fecha_carga
FROM scoped s
JOIN by_item u ON u.item = s.item AND u.ultima_fecha = s.fecha_consulta
ORDER BY s.item, s.sede, s.empresa, s.bodega NULLS LAST, s.linea, s.fecha_carga DESC;
`;

async function main() {
  const password = process.env.DB_PASSWORD?.trim();
  if (!password) {
    console.error("Falta DB_PASSWORD (revisa .env.local).");
    process.exit(1);
  }

  const client = new pg.Client({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "produXdia",
    user: process.env.DB_USER ?? "postgres",
    password,
  });

  await client.connect();
  try {
    const { rows } = await client.query(sql, [items]);
    console.log(
      `Filas en ultima fecha_consulta por item (cualquier sede). Total: ${rows.length}\n`,
    );
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }

    const sumSql = `
      WITH scoped AS (
        SELECT
          fecha_consulta,
          TRIM(COALESCE(empresa::text, '')) AS empresa,
          TRIM(COALESCE(sede::text, '')) AS sede,
          TRIM(COALESCE(item::text, '')) AS item,
          GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0)::numeric AS inv_u,
          GREATEST(COALESCE(valor_inventario, 0), 0)::numeric AS val_inv,
          TRIM(COALESCE(linea::text, '')) AS linea,
          TRIM(COALESCE(linea_n1_codigo::text, '')) AS linea_n1_codigo
        FROM rotacion_base_item_dia_sede
        WHERE TRIM(COALESCE(item::text, '')) = ANY($1::text[])
          AND fecha_consulta ~ '^[0-9]{8}$'
      ),
      ranked AS (
        SELECT
          *,
          MAX(to_date(fecha_consulta, 'YYYYMMDD')) OVER (PARTITION BY empresa, sede, item) AS latest_consulta_date
        FROM scoped
      )
      SELECT
        empresa,
        sede,
        item,
        linea,
        linea_n1_codigo,
        latest_consulta_date::date AS ultima_fecha,
        SUM(CASE WHEN to_date(fecha_consulta, 'YYYYMMDD') = latest_consulta_date THEN inv_u ELSE 0 END)::numeric AS sum_inv,
        SUM(CASE WHEN to_date(fecha_consulta, 'YYYYMMDD') = latest_consulta_date THEN val_inv ELSE 0 END)::numeric AS sum_valor,
        COUNT(*) FILTER (WHERE to_date(fecha_consulta, 'YYYYMMDD') = latest_consulta_date)::int AS filas_en_ultima_fecha
      FROM ranked
      GROUP BY empresa, sede, item, linea, linea_n1_codigo, latest_consulta_date
      ORDER BY item, sede;
    `;
    const { rows: sums } = await client.query(sumSql, [items]);
    console.log("\n--- Agregado como en API (suma ultimo dia por grupo linea/n1) ---\n");
    for (const r of sums) {
      console.log(JSON.stringify(r));
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
