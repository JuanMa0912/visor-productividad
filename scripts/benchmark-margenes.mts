/**
 * Benchmark exhaustivo de cargas de /margenes (SQL directo).
 *
 * Cubre todos los modos del tablero: meta, drill L0–L4, fact-nav/list,
 * sede, cliente, vendedor, filters, filter-items, kpi, summary, detalle factura.
 *
 * Uso:
 *   npm run benchmark:margenes
 *   BENCHMARK_RUNS=1 BENCHMARK_FULL=1 npm run benchmark:margenes
 *   BENCHMARK_DAYS=5 BENCHMARK_SEDES=todas npm run benchmark:margenes
 *   BENCHMARK_JSON=tmp/margenes-bench.json npm run benchmark:margenes
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { performance } from "node:perf_hooks";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { defaultMargenDateRange } from "../src/lib/margenes/date-range.ts";
import { listMargenSedeCatalogOptions } from "../src/lib/margenes/margen-sede-catalog.ts";
import { resolveMargenDataSource } from "../src/lib/margenes/margen-data-source.ts";
import type { DrillPathStep } from "../src/lib/margenes/drill-path.ts";
import type { FactNavStep } from "../src/lib/margenes/fact-path.ts";
import {
  kpiFromAggregatedRows,
  queryClienteCompare,
  queryClienteFacturas,
  queryDrillBoard,
  queryFactListRows,
  queryFactNavRows,
  queryFilterItemSearch,
  queryFilterOptions,
  queryInvoiceDetailBoard,
  queryKpi,
  querySedeCompare,
  queryVendedorCompare,
  queryVendedorFacturas,
} from "../src/lib/margenes/drill-queries.ts";

loadEnvFiles();

const RUNS = Math.max(1, Number(process.env.BENCHMARK_RUNS ?? 1) || 1);
const FULL = process.env.BENCHMARK_FULL !== "0";
const DAYS = Math.max(1, Number(process.env.BENCHMARK_DAYS ?? 0) || 0);
const JSON_OUT = process.env.BENCHMARK_JSON?.trim() || "";

const formatMs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

const percentile = (arr: number[], p: number) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
};

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

const buildFilters = (fromIso: string, toIso: string, sedes: string[]) => ({
  fromCompact: isoToCompact(fromIso),
  toCompact: isoToCompact(toIso),
  fechas: [] as string[],
  empresas: [] as string[],
  sedes,
  categorias: [] as string[],
  lineas: [] as string[],
  sublineas: [] as string[],
  items: [] as string[],
  orderBy: undefined as string | undefined,
  orderDir: undefined as "asc" | "desc" | undefined,
});

type BenchRow = {
  id: string;
  label: string;
  family: string;
  avg_ms: number;
  p95_ms: number;
  runs: number;
  note?: string;
  ok: boolean;
  error?: string;
};

const timedRuns = async (
  id: string,
  label: string,
  family: string,
  fn: () => Promise<unknown>,
  note?: string,
): Promise<BenchRow> => {
  const samples: number[] = [];
  let lastError: string | undefined;
  for (let run = 0; run < RUNS; run += 1) {
    const t0 = performance.now();
    try {
      await fn();
      samples.push(performance.now() - t0);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      samples.push(performance.now() - t0);
      break;
    }
  }
  const avg =
    samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  return {
    id,
    label,
    family,
    avg_ms: Number(avg.toFixed(0)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(0)),
    runs: samples.length,
    note,
    ok: !lastError,
    error: lastError,
  };
};

const shiftIsoDays = (iso: string, delta: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

try {
  console.log("=== Márgenes — benchmark exhaustivo ===\n");

  const tableCheck = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'margen_final' LIMIT 1
  `);
  if (!tableCheck.rows.length) {
    console.error("Tabla margen_final no existe.");
    process.exit(1);
  }

  const bounds = await client.query<{
    min_date: string | null;
    max_date: string | null;
    row_estimate: string | null;
  }>(`
    SELECT
      (SELECT fecha_dcto FROM margen_final WHERE fecha_dcto IS NOT NULL ORDER BY fecha_dcto ASC LIMIT 1) AS min_date,
      (SELECT fecha_dcto FROM margen_final WHERE fecha_dcto IS NOT NULL ORDER BY fecha_dcto DESC LIMIT 1) AS max_date,
      (SELECT GREATEST(c.reltuples::bigint, 0) FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'margen_final') AS row_estimate
  `);

  const minCompact = bounds.rows[0]?.min_date ?? null;
  const maxCompact = bounds.rows[0]?.max_date ?? null;
  const rowEstimate = Number(bounds.rows[0]?.row_estimate ?? 0);

  const catalog = listMargenSedeCatalogOptions();
  const allSedes = catalog.map((s) => s.value);
  const customSedes = process.env.BENCHMARK_SEDES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const oneSede = [customSedes?.[0] ?? allSedes[0] ?? "mercamio|001"];
  const threeSedes =
    customSedes && customSedes.length >= 3
      ? customSedes.slice(0, 3)
      : allSedes.slice(0, 3);
  const targetSedes =
    process.env.BENCHMARK_SEDES === "todas" || !customSedes?.length
      ? allSedes
      : customSedes;

  const table = await resolveMargenDataSource(client);

  // Rango sobre la tabla REAL de consulta (roll puede ir atrasado vs raw).
  const tableBounds = await client.query<{
    min_date: string | null;
    max_date: string | null;
  }>(`
    SELECT MIN(fecha_dcto) AS min_date, MAX(fecha_dcto) AS max_date
    FROM ${table}
    WHERE fecha_dcto IS NOT NULL
  `);
  const dataMin = tableBounds.rows[0]?.min_date ?? minCompact;
  const dataMax = tableBounds.rows[0]?.max_date ?? maxCompact;
  let range = defaultMargenDateRange(dataMin, dataMax);
  if (!range) {
    console.error(`Sin fechas válidas en ${table}.`);
    process.exit(1);
  }
  if (process.env.BENCHMARK_FROM && process.env.BENCHMARK_TO) {
    range = {
      start: process.env.BENCHMARK_FROM,
      end: process.env.BENCHMARK_TO,
    };
  } else if (DAYS > 0) {
    range = {
      start: shiftIsoDays(range.end, -(DAYS - 1)),
      end: range.end,
    };
  }

  console.log(`Tabla datos: ${table}`);
  console.log(`Estimado margen_final: ~${rowEstimate.toLocaleString("es-CO")} filas`);
  console.log(`Bounds ${table}: ${dataMin} → ${dataMax}`);
  console.log(`Rango bench: ${range.start} → ${range.end}`);
  console.log(`Sedes bajo prueba: ${targetSedes.length} · runs=${RUNS}\n`);

  const filters = buildFilters(range.start, range.end, targetSedes);
  const filtersOne = buildFilters(range.start, range.end, oneSede);
  const results: BenchRow[] = [];

  const push = async (
    id: string,
    label: string,
    family: string,
    fn: () => Promise<unknown>,
    note?: string,
  ) => {
    process.stdout.write(`▸ ${label}… `);
    await client.query("DISCARD ALL").catch(() => {});
    const row = await timedRuns(id, label, family, fn, note);
    results.push(row);
    const status = row.ok ? formatMs(row.avg_ms) : `ERROR ${row.error}`;
    console.log(status);
  };

  // —— Meta / source ——
  await push("meta_bounds", "Meta: bounds + estimate", "meta", async () => {
    await client.query(`
      SELECT
        (SELECT fecha_dcto FROM margen_final WHERE fecha_dcto IS NOT NULL ORDER BY fecha_dcto DESC LIMIT 1) AS max_date,
        (SELECT GREATEST(c.reltuples::bigint, 0) FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'margen_final') AS row_estimate
    `);
  });

  await push(
    "resolve_source",
    "Resolver tabla roll/raw",
    "meta",
    () => resolveMargenDataSource(client),
  );

  // —— Carga inicial Producto ——
  let dayPath: DrillPathStep[] = [];
  let tipoPath: DrillPathStep[] = [];
  let lineaPath: DrillPathStep[] = [];
  let subPath: DrillPathStep[] = [];
  let itemPath: DrillPathStep[] = [];
  let sampleFactura:
    | { documento: string; tipdoc?: string; fecha?: string }
    | null = null;
  let sampleCliente: string | null = null;
  let sampleVend: string | null = null;

  await push(
    "drill_l0_all",
    "Producto L0 · días (todas sedes)",
    "drill",
    async () => {
      const board = await queryDrillBoard(client, filters, [], table);
      const day = board.rows.find((row) => !row.isAcum && row.drillStep?.type === "day");
      if (day?.drillStep) dayPath = [day.drillStep];
    },
    "Vista inicial tras Cargar datos",
  );

  await push(
    "drill_l0_1sede",
    "Producto L0 · días (1 sede)",
    "drill",
    () => queryDrillBoard(client, filtersOne, [], table),
    "Referencia angosta",
  );

  if (FULL && dayPath.length) {
    await push(
      "drill_l1_day",
      "Producto L1 · categorías (clic día)",
      "drill",
      async () => {
        const board = await queryDrillBoard(client, filters, dayPath, table);
        const tipo = board.rows.find((row) => row.drillStep?.type === "tipo");
        if (tipo?.drillStep) tipoPath = [...dayPath, tipo.drillStep];
      },
      "Queja: ~1 min antes del fix HashAggregate",
    );
  }

  if (FULL && tipoPath.length) {
    await push(
      "drill_l2_tipo",
      "Producto L2 · líneas",
      "drill",
      async () => {
        const board = await queryDrillBoard(client, filters, tipoPath, table);
        const linea = board.rows.find((row) => row.drillStep?.type === "linea1");
        if (linea?.drillStep) lineaPath = [...tipoPath, linea.drillStep];
      },
    );
  }

  if (FULL && lineaPath.length) {
    await push(
      "drill_l3_linea",
      "Producto L3 · sublíneas",
      "drill",
      async () => {
        const board = await queryDrillBoard(client, filters, lineaPath, table);
        const sub = board.rows.find((row) => row.drillStep?.type === "linea2");
        if (sub?.drillStep) subPath = [...lineaPath, sub.drillStep];
      },
    );
  }

  if (FULL && subPath.length) {
    await push(
      "drill_l4_sub",
      "Producto L4 · ítems",
      "drill",
      async () => {
        const board = await queryDrillBoard(client, filters, subPath, table);
        const item = board.rows.find((row) => row.drillStep?.type === "item");
        if (item?.drillStep) itemPath = [...subPath, item.drillStep];
      },
    );
  }

  if (FULL && itemPath.length) {
    await push(
      "drill_l5_item_facts",
      "Producto L5 · facturas del ítem",
      "drill",
      async () => {
        const board = await queryDrillBoard(client, filters, itemPath, table);
        const fact = board.rows.find((row) => row.documento);
        if (fact?.documento) {
          sampleFactura = {
            documento: fact.documento,
            tipdoc: fact.tipdoc,
            fecha: fact.fechaDcto,
          };
        }
      },
      "Aún usa metricsSqlFor + GROUP BY factura",
    );
  }

  // —— Filtros ——
  await push(
    "filters_catalog",
    "Catálogo filters (dropdown)",
    "filters",
    () => queryFilterOptions(client, filters, table),
    "mode=filters · item_dia_roll si existe",
  );

  await push(
    "filter_items",
    "Búsqueda ítems (typeahead)",
    "filters",
    () => queryFilterItemSearch(client, filters, table, "arroz"),
    "mode=filter-items LIMIT 150",
  );

  // —— Por Factura ——
  await push(
    "fact_nav_l0",
    "Por Factura · nav L0 días",
    "factura",
    async () => {
      const tableResult = await queryFactNavRows(client, filters, [], table);
      kpiFromAggregatedRows(tableResult.rows, filters.sedes.length);
    },
    "Filas + KPI derivado (sin queryKpi DISTINCT)",
  );

  await push(
    "fact_nav_rows_only",
    "Por Factura · nav L0 solo filas",
    "factura",
    () => queryFactNavRows(client, filters, [], table),
  );

  if (FULL && dayPath[0]?.type === "day") {
    const factDayPath: FactNavStep[] = [
      { type: "fecha", fecha: dayPath[0].fecha, label: dayPath[0].label },
    ];
    await push(
      "fact_nav_l1",
      "Por Factura · nav L1 categorías",
      "factura",
      () => queryFactNavRows(client, filters, factDayPath, table),
    );
  }

  await push(
    "fact_list",
    "Por Factura · lista completa",
    "factura",
    async () => {
      const rows = await queryFactListRows(client, filters, table);
      kpiFromAggregatedRows(rows, filters.sedes.length);
    },
    "Lista + KPI derivado",
  );

  // —— Por Sede ——
  await push(
    "sede_tab",
    "Por Sede · compare + KPI derivado",
    "sede",
    async () => {
      const rows = await querySedeCompare(client, filters, table);
      kpiFromAggregatedRows(rows, filters.sedes.length);
    },
    "Una query (boardMetrics) + KPI JS",
  );

  await push(
    "sede_compare_only",
    "Por Sede · solo compare",
    "sede",
    () => querySedeCompare(client, filters, table),
  );

  // —— Cliente / Vendedor ——
  await push(
    "cliente_tab",
    "Por Cliente · ranking",
    "cliente",
    async () => {
      const payload = await queryClienteCompare(client, filters, table);
      sampleCliente = payload.rows[0]?.idTerc ?? null;
    },
    "GROUP BY id_terc + meta DISTINCT",
  );

  if (FULL && sampleCliente) {
    await push(
      "cliente_facts",
      "Por Cliente · facturas de 1 cliente",
      "cliente",
      () => queryClienteFacturas(client, filters, table, sampleCliente!),
    );
  }

  await push(
    "vendedor_tab",
    "Por Vendedor · ranking",
    "vendedor",
    async () => {
      const payload = await queryVendedorCompare(client, filters, table);
      sampleVend = payload.rows[0]?.vendCc ?? null;
    },
  );

  if (FULL && sampleVend) {
    await push(
      "vendedor_facts",
      "Por Vendedor · facturas de 1 vend.",
      "vendedor",
      () => queryVendedorFacturas(client, filters, table, sampleVend!),
    );
  }

  // —— Detalle factura ——
  if (FULL && sampleFactura) {
    await push(
      "invoice_detail",
      "Detalle factura (líneas)",
      "factura",
      () =>
        queryInvoiceDetailBoard(
          client,
          filters,
          {
            type: "factura",
            id: sampleFactura!.documento,
            label: sampleFactura!.documento,
            tipdoc: sampleFactura!.tipdoc,
            fecha: sampleFactura!.fecha,
          },
          table,
          6,
        ),
      "Índice por documento",
    );
  }

  // —— KPI / summary legacy ——
  await push(
    "kpi_l0",
    "mode=kpi L0 (legacy)",
    "kpi",
    () => queryKpi(client, filters, [], table),
    "Hoy reusa drill L0 completo",
  );

  if (FULL && dayPath.length) {
    await push(
      "kpi_l1_path",
      "mode=kpi con path día",
      "kpi",
      () => queryKpi(client, filters, dayPath, table),
      "Aún metricsSqlFor + COUNT DISTINCT",
    );
  }

  await push(
    "summary_sums",
    "mode=summary SUM simples",
    "summary",
    async () => {
      const isRoll =
        table === "margen_final_roll" || table === "margen_dinastia_roll";
      const ventas = isRoll ? "ventas_netas" : "COALESCE(vlrtot_bru,0)";
      const costo = isRoll ? "costo_total" : "COALESCE(tot_costo,0)";
      // Filtro mínimo por fechas compactas (sin sedes UNNEST) para referencia.
      await client.query(
        `
        SELECT COALESCE(SUM(${ventas}),0) AS v, COALESCE(SUM(${costo}),0) AS c, COUNT(*) AS n
        FROM ${table}
        WHERE fecha_dcto BETWEEN $1 AND $2
        `,
        [isoToCompact(range.start), isoToCompact(range.end)],
      );
    },
    "Referencia: suma cruda por fechas (todas sedes del rango)",
  );

  // —— Referencia 3 sedes drill ——
  if (threeSedes.length >= 3 && targetSedes.length > 3) {
    const filters3 = buildFilters(range.start, range.end, threeSedes);
    await push(
      "drill_l0_3sedes",
      "Producto L0 · 3 sedes",
      "drill",
      () => queryDrillBoard(client, filters3, [], table),
    );
  }

  console.log("\n=== Resumen (más lento → más rápido) ===\n");
  const sorted = [...results].sort((a, b) => b.avg_ms - a.avg_ms);
  console.log(
    ["familia".padEnd(10), "avg".padStart(8), "p95".padStart(8), "carga"].join(
      " ",
    ),
  );
  console.log("-".repeat(72));
  for (const row of sorted) {
    const mark = row.ok ? "" : " !";
    console.log(
      [
        row.family.padEnd(10),
        formatMs(row.avg_ms).padStart(8),
        formatMs(row.p95_ms).padStart(8),
        `${row.label}${mark}`,
      ].join(" "),
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    table,
    range,
    sedeCount: targetSedes.length,
    runs: RUNS,
    rowEstimate,
    results: sorted,
  };

  if (JSON_OUT) {
    const outPath = path.resolve(JSON_OUT);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nJSON: ${outPath}`);
  } else {
    const fallback = path.resolve("tmp/margenes-bench.json");
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.writeFileSync(fallback, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nJSON: ${fallback}`);
  }
} finally {
  await client.end();
}
