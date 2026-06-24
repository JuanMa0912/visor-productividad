/**
 * Benchmark de Ventas x item: indices, meta, validacion de rango y mode=summary.
 *
 * Uso local o en app-server (lee .env.local):
 *   node scripts/benchmark-ventas-x-item.mjs
 *
 * Opciones:
 *   BENCHMARK_START=2026-06-01
 *   BENCHMARK_END=2026-06-15
 *   BENCHMARK_EMPRESAS=mercamio,mtodo,bogota
 *   BENCHMARK_EXPLAIN=1          (muestra plan del summary, sin ANALYZE)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(root, ".env.local"));
loadEnv(path.join(root, ".env"));

const empresas = (process.env.BENCHMARK_EMPRESAS ?? "mercamio,mtodo,bogota")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const explain = process.env.BENCHMARK_EXPLAIN === "1";

const formatMs = (ms) => `${(ms / 1000).toFixed(2)}s`;

const timed = async (label, fn) => {
  const started = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - started;
  console.log(`  ${label}: ${formatMs(elapsedMs)}`);
  return { result, elapsedMs };
};

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

await client.connect();

try {
  const tableCheck = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ventas_item_diario'
    LIMIT 1
  `);
  if (!tableCheck.rows.length) {
    console.error("Tabla ventas_item_diario no existe.");
    process.exit(1);
  }

  console.log("=== Ventas x item — benchmark SQL ===");
  console.log(`Host: ${process.env.DB_HOST ?? "(default)"}  DB: ${process.env.DB_NAME ?? ""}`);
  console.log(`Empresas: ${empresas.join(", ")}`);

  const { result: indexRows } = await timed("listar indices", () =>
    client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'ventas_item_diario'
        AND indexname LIKE 'ventas_item_diario_idx_%'
      ORDER BY 1
    `),
  );
  const indexes = (indexRows.rows ?? []).map((r) => r.indexname);
  console.log(`  indices (${indexes.length}): ${indexes.join(", ") || "(ninguno perf)"}`);

  const need = [
    "ventas_item_diario_idx_fecha_empresa_expr",
    "ventas_item_diario_idx_summary",
    "ventas_item_diario_idx_summary_covering",
  ];
  const missing = need.filter((name) => !indexes.includes(name));
  if (missing.length > 0) {
    console.log(`  AVISO: faltan migraciones — ${missing.join(", ")}`);
  }

  const { result: stats } = await timed("stats tabla", () =>
    client.query(`
      SELECT
        COUNT(*)::bigint AS total_rows,
        MIN(fecha_dcto)::text AS min_fecha,
        MAX(fecha_dcto)::text AS max_fecha
      FROM ventas_item_diario
    `),
  );
  const totalRows = Number(stats.rows[0]?.total_rows ?? 0);
  const minCompact = stats.rows[0]?.min_fecha ?? "";
  const maxCompact = stats.rows[0]?.max_fecha ?? "";
  console.log(
    `  filas: ${totalRows.toLocaleString("es-CO")}  rango: ${minCompact} .. ${maxCompact}`,
  );

  let startIso = process.env.BENCHMARK_START?.trim() ?? "";
  let endIso = process.env.BENCHMARK_END?.trim() ?? "";
  if (!startIso || !endIso) {
    if (maxCompact && /^\d{8}$/.test(maxCompact)) {
      const endAt = new Date(
        `${maxCompact.slice(0, 4)}-${maxCompact.slice(4, 6)}-${maxCompact.slice(6, 8)}T12:00:00`,
      );
      const monthStart = new Date(endAt);
      monthStart.setDate(1);
      const fmt = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      endIso = fmt(endAt);
      startIso = fmt(monthStart);
      if (startIso === endIso) {
        const prev = new Date(endAt);
        prev.setDate(prev.getDate() - 1);
        startIso = fmt(prev);
      }
    }
  }

  const startCompact = startIso.replace(/-/g, "");
  const endCompact = endIso.replace(/-/g, "");
  console.log(`Rango benchmark: ${startIso} .. ${endIso} (${startCompact}..${endCompact})`);

  const empresaWhere = `COALESCE(NULLIF(empresa_norm, ''), empresa) = ANY($1::text[])`;

  await timed("meta MIN/MAX (con filtro empresa)", () =>
    client.query(
      `
      SELECT MIN(fecha_dcto)::text AS min_fecha, MAX(fecha_dcto)::text AS max_fecha
      FROM ventas_item_diario
      WHERE ${empresaWhere}
      `,
      [empresas],
    ),
  );

  await timed("validacion EXISTS en rango", () =>
    client.query(
      `
      SELECT EXISTS (
        SELECT 1 FROM ventas_item_diario
        WHERE fecha_dcto >= $2::text
          AND fecha_dcto <= $3::text
          AND ${empresaWhere}
        LIMIT 1
      ) AS ok
      `,
      [empresas, startCompact, endCompact],
    ),
  );

  const { result: summary } = await timed("mode=summary GROUP BY", () =>
    client.query(
      `
      SELECT
        base.empresa,
        base.fecha_dcto,
        base.id_co,
        base.id_item,
        MAX(base.descripcion) AS descripcion,
        MAX(base.linea) AS linea,
        SUM(COALESCE(base.und_dia::numeric, 0))::float8 AS und_dia,
        SUM(COALESCE(base.venta_sin_impuesto_dia::numeric, 0))::float8 AS venta_sin_impuesto_dia
      FROM ventas_item_diario base
      WHERE base.fecha_dcto >= $2::text
        AND base.fecha_dcto <= $3::text
        AND COALESCE(NULLIF(base.empresa_norm, ''), base.empresa) = ANY($1::text[])
      GROUP BY base.empresa, base.fecha_dcto, base.id_co, base.id_item
      `,
      [empresas, startCompact, endCompact],
    ),
  );
  console.log(`  filas agregadas: ${(summary.rows ?? []).length.toLocaleString("es-CO")}`);

  if (explain) {
    const plan = await client.query(
      `
      EXPLAIN (FORMAT TEXT)
      SELECT
        base.empresa, base.fecha_dcto, base.id_co, base.id_item,
        MAX(base.descripcion), MAX(base.linea),
        SUM(COALESCE(base.und_dia::numeric, 0)),
        SUM(COALESCE(base.venta_sin_impuesto_dia::numeric, 0))
      FROM ventas_item_diario base
      WHERE base.fecha_dcto >= $2::text
        AND base.fecha_dcto <= $3::text
        AND COALESCE(NULLIF(base.empresa_norm, ''), base.empresa) = ANY($1::text[])
      GROUP BY base.empresa, base.fecha_dcto, base.id_co, base.id_item
      `,
      [empresas, startCompact, endCompact],
    );
    console.log("\n--- EXPLAIN summary ---");
    for (const row of plan.rows ?? []) console.log(row["QUERY PLAN"]);
  }

  console.log("\nListo. Si summary > 30s sin indices perf, aplica 20260529 y 20260624.");
} finally {
  await client.end();
}
