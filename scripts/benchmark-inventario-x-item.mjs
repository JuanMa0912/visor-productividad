/**
 * Benchmark SQL de /api/inventario-x-item (rotacion_base_item_dia_sede).
 *
 *   npm run benchmark:inventario-x-item
 *   BENCHMARK_EXPLAIN=1 npm run benchmark:inventario-x-item
 */

import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { resolveRotacionBaseSqlFields } from "../src/lib/rotacion/base-fields.ts";

loadEnvFiles();

const explain = process.env.BENCHMARK_EXPLAIN === "1";
const formatMs = (ms) => `${(ms / 1000).toFixed(2)}s`;

const timed = async (label, fn) => {
  const t0 = performance.now();
  const result = await fn();
  const ms = performance.now() - t0;
  console.log(`  ${label}: ${formatMs(ms)}`);
  return { result, ms };
};

const buildEndDateEqualsSql = (column, endParam = "$1") =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date = TO_DATE(${endParam}::text, 'YYYYMMDD')`
    : `${column} = ${endParam}::text AND ${column} ~ '^[0-9]{8}$'`;

const buildCompactDateRangeSql = (column, startParam = "$1", endParam = "$2") =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date BETWEEN TO_DATE(${startParam}::text, 'YYYYMMDD') AND TO_DATE(${endParam}::text, 'YYYYMMDD')`
    : `${column} BETWEEN ${startParam} AND ${endParam} AND ${column} ~ '^[0-9]{8}$'`;

const buildConsultaDateSql = (column) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date`
    : `TO_DATE(${column}, 'YYYYMMDD')`;

const buildHiddenSedeWhereClause = (sedeNameExpr) =>
  `LOWER(REGEXP_REPLACE(TRANSLATE(${sedeNameExpr}, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '[^a-zA-Z0-9]+', '', 'g')) NOT IN ('adm', 'cedicavasa', 'centrodistribucioncavasa', 'importados')`;

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

try {
  console.log("=== Inventario x item — benchmark SQL ===");
  const fields = await resolveRotacionBaseSqlFields(client);
  const dateColumn = fields.dateColumn;

  const { result: idxRows } = await timed("listar indices", () =>
    client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'rotacion_base_item_dia_sede'
        AND indexname LIKE 'rotacion_base%'
      ORDER BY 1
    `),
  );
  const indexes = (idxRows.rows ?? []).map((r) => r.indexname);
  console.log(`  indices (${indexes.length}): ${indexes.join(", ") || "(ninguno)"}`);

  const { result: stats } = await timed("stats tabla", () =>
    client.query(`
      SELECT COUNT(*)::bigint AS n,
        MIN(TO_CHAR(fecha_dia::date, 'YYYYMMDD')) AS minf,
        MAX(TO_CHAR(fecha_dia::date, 'YYYYMMDD')) AS maxf
      FROM rotacion_base_item_dia_sede
      WHERE fecha_dia IS NOT NULL
    `),
  );
  const totalRows = Number(stats.rows[0]?.n ?? 0);
  const maxCompact = stats.rows[0]?.maxf ?? "";
  const minCompact = stats.rows[0]?.minf ?? "";
  console.log(`  filas: ${totalRows.toLocaleString("es-CO")}  rango: ${minCompact} .. ${maxCompact}`);

  let endIso = process.env.BENCHMARK_END?.trim() ?? "";
  let startIso = process.env.BENCHMARK_START?.trim() ?? "";
  if (!endIso && maxCompact.length === 8) {
    endIso = `${maxCompact.slice(0, 4)}-${maxCompact.slice(4, 6)}-${maxCompact.slice(6, 8)}`;
  }
  if (!startIso && endIso) {
    const d = new Date(`${endIso}T12:00:00`);
    d.setDate(1);
    startIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const startCompact = startIso.replace(/-/g, "");
  const endCompact = endIso.replace(/-/g, "");
  console.log(`Rango: ${startIso} .. ${endIso}`);

  await timed("meta MIN/MAX fechas", () =>
    client.query(`
      SELECT TO_CHAR(MIN(fecha_dia::date), 'YYYYMMDD') AS min_date,
             TO_CHAR(MAX(fecha_dia::date), 'YYYYMMDD') AS max_date
      FROM rotacion_base_item_dia_sede WHERE fecha_dia IS NOT NULL
    `),
  );

  const { result: catalog } = await timed("mode=catalog (1 dia, GROUP BY item)", () =>
    client.query(
      `
      SELECT
        ${fields.lineExpr} AS linea,
        ${fields.itemExpr} AS item,
        SUM(${fields.closingUnitsExpr})::numeric AS inventory_units,
        SUM(${fields.inventoryValueExpr})::numeric AS inventory_value
      FROM rotacion_base_item_dia_sede
      WHERE ${buildEndDateEqualsSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      GROUP BY ${fields.lineExpr}, ${fields.n1CodeExpr}, ${fields.itemExpr},
        ${fields.descriptionExpr}, ${fields.unitExpr}
      HAVING SUM(${fields.closingUnitsExpr}) > 0 OR SUM(${fields.inventoryValueExpr}) > 0
      `,
      [endCompact],
    ),
  );
  console.log(`  filas catalog: ${(catalog.rows ?? []).length.toLocaleString("es-CO")}`);

  const { result: filters } = await timed("mode=filters (DISTINCT empresa/sede, 1 dia)", () =>
    client.query(
      `
      SELECT DISTINCT
        ${fields.empresaExpr} AS empresa,
        ${fields.sedeIdExpr} AS sede_id,
        ${fields.sedeNameExpr} AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE ${buildEndDateEqualsSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      `,
      [endCompact],
    ),
  );
  console.log(`  filas filters: ${(filters.rows ?? []).length}`);

  const { result: topItems } = await timed("prefetch top 10 items (fecha fin)", () =>
    client.query(
      `
      SELECT ${fields.itemExpr} AS item
      FROM rotacion_base_item_dia_sede
      WHERE ${buildEndDateEqualsSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      GROUP BY ${fields.itemExpr}
      HAVING SUM(${fields.closingUnitsExpr}) > 0 OR SUM(${fields.inventoryValueExpr}) > 0
      ORDER BY SUM(${fields.inventoryValueExpr}) DESC NULLS LAST, ${fields.itemExpr} ASC
      LIMIT 10
      `,
      [endCompact],
    ),
  );
  const matrixItemIds = (topItems.rows ?? []).map((r) => r.item).filter(Boolean);
  console.log(`  top items: ${matrixItemIds.length}`);

  const { result: matrix } = await timed("mode=table matrix (rango acotado a top 10)", () =>
    client.query(
      `
      WITH scoped AS (
        SELECT
          ${fields.empresaExpr} AS empresa,
          ${fields.sedeIdExpr} AS sede_id,
          ${fields.sedeNameExpr} AS sede_name,
          ${fields.lineExpr} AS linea,
          ${fields.n1CodeExpr} AS linea_n1_codigo,
          ${fields.itemExpr} AS item,
          ${fields.descriptionExpr} AS descripcion,
          ${fields.unitExpr} AS unidad,
          ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value,
          ${fields.unitsSoldExpr} AS total_units,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date
        FROM rotacion_base_item_dia_sede
        WHERE ${buildCompactDateRangeSql(dateColumn)}
          AND ${fields.itemPresentCondition}
          AND ${fields.itemExpr} = ANY($3::text[])
          AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      ),
      latest AS (
        SELECT empresa, sede_id, item, MAX(consulta_date) AS latest_consulta_date
        FROM scoped
        GROUP BY empresa, sede_id, item
      ),
      aggregated AS (
        SELECT s.empresa, s.sede_id, s.sede_name, s.linea, s.linea_n1_codigo, s.item,
          s.descripcion, s.unidad,
          SUM(s.total_units)::numeric AS total_units,
          COUNT(DISTINCT s.consulta_date)::int AS tracked_days,
          SUM(CASE WHEN s.consulta_date = l.latest_consulta_date THEN s.inventory_units ELSE 0 END)::numeric AS inventory_units,
          SUM(CASE WHEN s.consulta_date = l.latest_consulta_date THEN s.inventory_value ELSE 0 END)::numeric AS inventory_value
        FROM scoped s
        INNER JOIN latest l
          ON s.empresa = l.empresa AND s.sede_id = l.sede_id AND s.item = l.item
        GROUP BY s.empresa, s.sede_id, s.sede_name, s.linea, s.linea_n1_codigo, s.item, s.descripcion, s.unidad
      )
      SELECT * FROM aggregated
      WHERE inventory_units > 0 OR inventory_value > 0
      `,
      [startCompact, endCompact, matrixItemIds],
    ),
  );
  console.log(`  filas matrix (top 10 items): ${(matrix.rows ?? []).length}`);

  await timed("mode=table matrix LEGACY (sin prefetch, referencia)", () =>
    client.query(
      `
      WITH scoped AS (
        SELECT
          ${fields.empresaExpr} AS empresa,
          ${fields.sedeIdExpr} AS sede_id,
          ${fields.itemExpr} AS item,
          ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value,
          ${fields.unitsSoldExpr} AS total_units,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date
        FROM rotacion_base_item_dia_sede
        WHERE ${buildCompactDateRangeSql(dateColumn)}
          AND ${fields.itemPresentCondition}
          AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      ),
      ranked AS (
        SELECT *,
          MAX(consulta_date) OVER (PARTITION BY empresa, sede_id, item) AS latest_consulta_date
        FROM scoped
      ),
      top_items AS (
        SELECT item FROM ranked
        WHERE consulta_date = latest_consulta_date
        GROUP BY item
        ORDER BY SUM(inventory_value) DESC NULLS LAST, item ASC
        LIMIT 10
      ),
      aggregated AS (
        SELECT item,
          SUM(CASE WHEN consulta_date = latest_consulta_date THEN inventory_value ELSE 0 END)::numeric AS inventory_value
        FROM ranked
        WHERE item IN (SELECT item FROM top_items)
        GROUP BY item
      )
      SELECT COUNT(*)::int AS n FROM aggregated
      `,
      [startCompact, endCompact],
    ),
  );

  if (explain) {
    const plan = await client.query(
      `EXPLAIN (FORMAT TEXT)
      WITH scoped AS (
        SELECT ${fields.empresaExpr} AS empresa, ${fields.sedeIdExpr} AS sede_id,
          ${fields.itemExpr} AS item, ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value, ${fields.unitsSoldExpr} AS total_units,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date
        FROM rotacion_base_item_dia_sede
        WHERE ${buildCompactDateRangeSql(dateColumn)} AND ${fields.itemPresentCondition}
      ),
      ranked AS (
        SELECT *, MAX(consulta_date) OVER (PARTITION BY empresa, sede_id, item) AS latest_consulta_date
        FROM scoped
      )
      SELECT COUNT(*) FROM ranked`,
      [startCompact, endCompact],
    );
    console.log("\n--- EXPLAIN matrix scoped+ranked ---");
    for (const row of plan.rows ?? []) console.log(row["QUERY PLAN"]);
  }

  console.log("\nListo.");
} finally {
  await client.end();
}
