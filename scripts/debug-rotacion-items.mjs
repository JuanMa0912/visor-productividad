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
    fecha_dia,
    TRIM(COALESCE(empresa::text, '')) AS empresa,
    TRIM(COALESCE(sede::text, '')) AS sede,
    TRIM(COALESCE(nombre_sede::text, '')) AS nombre_sede,
    TRIM(COALESCE(id_item::text, '')) AS item,
    can_disponible_foto AS inventario_unidades,
    (COALESCE(can_disponible_foto, 0) * COALESCE(costo_uni_inventario, 0)) AS valor_inventario,
    cantidad_vendida AS unidades_vendidas,
    venta_sin_impuesto,
    TRIM(COALESCE(bodega_local::text, '')) AS bodega,
    NULL::text AS nombre_bodega,
    TRIM(COALESCE(nombre_linea_nivel_1::text, '')) AS linea,
    TRIM(COALESCE(id_linea_nivel_1::text, '')) AS linea_n1_codigo,
    COALESCE(fecha_actualizacion, fecha_carga) AS carga_ts
  FROM rotacion_base_item_dia_sede
  WHERE TRIM(COALESCE(id_item::text, '')) = ANY($1::text[])
    AND fecha_dia IS NOT NULL
),
by_item AS (
  SELECT item, MAX(fecha_dia) AS ultima_fecha
  FROM scoped
  GROUP BY item
)
SELECT
  s.fecha_dia,
  s.empresa,
  s.sede,
  s.nombre_sede,
  s.item,
  s.inventario_unidades,
  s.valor_inventario,
  s.unidades_vendidas,
  s.venta_sin_impuesto,
  s.bodega,
  s.nombre_bodega,
  s.linea,
  s.linea_n1_codigo,
  s.carga_ts
FROM scoped s
JOIN by_item u ON u.item = s.item AND u.ultima_fecha = s.fecha_dia
ORDER BY s.item, s.sede, s.empresa, s.bodega NULLS LAST, s.linea, s.carga_ts DESC;
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
      `Filas en ultima fecha_dia por item (cualquier sede). Total: ${rows.length}\n`,
    );
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }

    const sumSql = `
      WITH scoped AS (
        SELECT
          fecha_dia,
          TRIM(COALESCE(empresa::text, '')) AS empresa,
          TRIM(COALESCE(sede::text, '')) AS sede,
          TRIM(COALESCE(id_item::text, '')) AS item,
          GREATEST(COALESCE(can_disponible_foto, 0), 0)::numeric AS inv_u,
          GREATEST(COALESCE(can_disponible_foto, 0) * COALESCE(costo_uni_inventario, 0), 0)::numeric AS val_inv,
          TRIM(COALESCE(nombre_linea_nivel_1::text, '')) AS linea,
          TRIM(COALESCE(id_linea_nivel_1::text, '')) AS linea_n1_codigo
        FROM rotacion_base_item_dia_sede
        WHERE TRIM(COALESCE(id_item::text, '')) = ANY($1::text[])
          AND fecha_dia IS NOT NULL
      ),
      ranked AS (
        SELECT
          *,
          MAX(fecha_dia::date) OVER (PARTITION BY empresa, sede, item) AS latest_consulta_date
        FROM scoped
      )
      SELECT
        empresa,
        sede,
        item,
        linea,
        linea_n1_codigo,
        latest_consulta_date::date AS ultima_fecha,
        SUM(CASE WHEN fecha_dia::date = latest_consulta_date THEN inv_u ELSE 0 END)::numeric AS sum_inv,
        SUM(CASE WHEN fecha_dia::date = latest_consulta_date THEN val_inv ELSE 0 END)::numeric AS sum_valor,
        COUNT(*) FILTER (WHERE fecha_dia::date = latest_consulta_date)::int AS filas_en_ultima_fecha
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
