/**
 * Benchmark de carga de /margenes (SQL directo + opcional HTTP E2E).
 *
 * Replica el flujo tras pulsar «Cargar datos»:
 *   1. GET /api/margenes/meta (apertura de página)
 *   2. GET /api/margenes/data?mode=drill&drillPath=[] (vista inicial del tablero)
 *
 * Uso:
 *   npm run benchmark:margenes
 *   BENCHMARK_HTTP=1 BENCHMARK_USER=admin BENCHMARK_PASSWORD='...' npm run benchmark:margenes
 *   BENCHMARK_SEDES=mercamio::001,mercamio::002 npm run benchmark:margenes
 *   BENCHMARK_RUNS=3 npm run benchmark:margenes
 */

import pg from "pg";
import { performance } from "node:perf_hooks";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { defaultMargenDateRange } from "../src/lib/margenes/date-range.ts";
import { listMargenSedeCatalogOptions } from "../src/lib/margenes/margen-sede-catalog.ts";
import { resolveMargenDataSource } from "../src/lib/margenes/margen-data-source.ts";
import {
  queryDrillBoard,
  queryDrillRows,
  queryFilterOptions,
  queryKpi,
  querySedeCompare,
} from "../src/lib/margenes/drill-queries.ts";

loadEnvFiles();

const RUNS = Math.max(1, Number(process.env.BENCHMARK_RUNS ?? 2) || 2);
const HTTP = process.env.BENCHMARK_HTTP === "1";
const VERBOSE = process.env.BENCHMARK_VERBOSE === "1";
const BASE_URL = (process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const USER = process.env.BENCHMARK_USER?.trim() ?? "";
const PASSWORD = process.env.BENCHMARK_PASSWORD ?? "";

const formatMs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const percentile = (arr: number[], p: number) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
};

const timed = async <T>(label: string, fn: () => Promise<T>) => {
  const t0 = performance.now();
  const result = await fn();
  const ms = performance.now() - t0;
  return { result, ms, label };
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

const mergeSetCookies = (jar: Map<string, string>, response: Response) => {
  const lines =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const line of lines) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};

const cookieHeader = (jar: Map<string, string>) =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

const httpRequest = async (jar: Map<string, string>, path: string, init: RequestInit = {}) => {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = { ...(init.headers as Record<string, string> | undefined) };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;

  const started = performance.now();
  const response = await fetch(url, { ...init, headers });
  mergeSetCookies(jar, response);
  const buffer = await response.arrayBuffer();
  const elapsedMs = performance.now() - started;

  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    bytes: buffer.byteLength,
  };
};

const loginHttp = async (jar: Map<string, string>) => {
  if (!USER || !PASSWORD) {
    throw new Error("BENCHMARK_HTTP=1 requiere BENCHMARK_USER y BENCHMARK_PASSWORD.");
  }
  const result = await httpRequest(jar, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!result.ok) throw new Error(`Login falló (${result.status})`);
  if (!jar.has("vp_session")) throw new Error("Login OK pero falta vp_session.");
};

const benchSqlScenario = async (
  client: pg.PoolClient,
  name: string,
  fromIso: string,
  toIso: string,
  sedes: string[],
) => {
  const filters = buildFilters(fromIso, toIso, sedes);
  const times: Record<string, number[]> = {
    drill_load: [],
    kpi: [],
    drill_rows: [],
    filters: [],
    sede_compare: [],
  };

  for (let run = 0; run < RUNS; run += 1) {
    await client.query("DISCARD ALL").catch(() => {});
    const table = await resolveMargenDataSource(client);

    const drillStarted = performance.now();
    const board = await queryDrillBoard(client, filters, [], table);
    const drillMs = performance.now() - drillStarted;
    times.drill_load.push(drillMs);

    if (VERBOSE) {
      const kpiOnly = await timed("kpi", () =>
        queryKpi(client, filters, [], table),
      );
      times.kpi.push(kpiOnly.ms);

      const rowsOnly = await timed("drill_rows", () =>
        queryDrillRows(client, filters, [], table),
      );
      times.drill_rows.push(rowsOnly.ms);

      const filtersOnly = await timed("filters", () =>
        queryFilterOptions(client, filters, table),
      );
      times.filters.push(filtersOnly.ms);

      const sedeOnly = await timed("sede_compare", () =>
        querySedeCompare(client, filters, table),
      );
      times.sede_compare.push(sedeOnly.ms);
    }

    if (run === 0) {
      const rowCount = board.rows.length;
      const acum = board.rows.find((row) => row.isAcum);
      console.log(
        `    tabla: ${table} · filas drill: ${rowCount} (acum: ${acum ? "sí" : "no"}) · kpi ventas ${Math.round(board.kpi.ventasNetas).toLocaleString("es-CO")}`,
      );
    }
  }

  const avg = (key: keyof typeof times) =>
    Number((times[key].reduce((a, b) => a + b, 0) / times[key].length).toFixed(0));

  return {
    name,
    sedeCount: sedes.length,
    runs: RUNS,
    drill_avg_ms: avg("drill_load"),
    drill_p95_ms: Number(percentile(times.drill_load, 0.95).toFixed(0)),
    kpi_avg_ms: avg("kpi"),
    drill_rows_avg_ms: avg("drill_rows"),
    filters_avg_ms: avg("filters"),
    sede_compare_avg_ms: avg("sede_compare"),
  };
};

const benchHttpFlow = async (
  fromIso: string,
  toIso: string,
  sedes: string[],
) => {
  const jar = new Map<string, string>();
  await loginHttp(jar);

  const meta = await httpRequest(jar, "/api/margenes/meta");
  const sedeParam = encodeURIComponent(sedes.join(","));
  const drillPath = encodeURIComponent("[]");
  const drillUrl =
    `/api/margenes/data?mode=drill&drillPath=${drillPath}` +
    `&from=${fromIso}&to=${toIso}&sede=${sedeParam}`;

  const drillTimes: number[] = [];
  let lastBytes = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const drill = await httpRequest(jar, drillUrl);
    drillTimes.push(drill.elapsedMs);
    lastBytes = drill.bytes;
    if (!drill.ok) {
      throw new Error(`drill HTTP ${drill.status}`);
    }
  }

  const drillAvg = drillTimes.reduce((a, b) => a + b, 0) / drillTimes.length;
  return {
    meta_ms: Number(meta.elapsedMs.toFixed(0)),
    drill_avg_ms: Number(drillAvg.toFixed(0)),
    drill_p95_ms: Number(percentile(drillTimes, 0.95).toFixed(0)),
    total_first_load_ms: Number((meta.elapsedMs + drillTimes[0]).toFixed(0)),
    total_warm_avg_ms: Number((meta.elapsedMs + drillAvg).toFixed(0)),
    payload_bytes: lastBytes,
    sedeCount: sedes.length,
  };
};

const client = new pg.Client(resolvePgClientConfig());
await client.connect();

try {
  console.log("=== Márgenes — benchmark de carga ===\n");

  const tableCheck = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'margen_final' LIMIT 1
  `);
  if (!tableCheck.rows.length) {
    console.error("Tabla margen_final no existe. Aplica la migración antes del benchmark.");
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
  const range = defaultMargenDateRange(minCompact, maxCompact);

  if (!range) {
    console.error("Sin fechas válidas en margen_final.");
    process.exit(1);
  }

  const catalog = listMargenSedeCatalogOptions();
  const allSedes = catalog.map((s) => s.value);
  const customSedes = process.env.BENCHMARK_SEDES?.split(",").map((s) => s.trim()).filter(Boolean);
  const oneSede = [customSedes?.[0] ?? allSedes[0] ?? "mercamio::001"];
  const threeSedes = customSedes?.length
    ? customSedes.slice(0, 3)
    : allSedes.slice(0, 3);

  console.log(`Tabla: margen_final (~${rowEstimate.toLocaleString("es-CO")} filas est.)`);
  console.log(`Rango default (mes en curso): ${range.start} → ${range.end}`);
  console.log(`Runs por escenario: ${RUNS}\n`);

  const scenarios = [
    { name: "1 sede", sedes: oneSede },
    { name: "3 sedes", sedes: threeSedes.length >= 3 ? threeSedes : allSedes.slice(0, 3) },
    { name: "Todas las sedes catálogo", sedes: allSedes },
  ];

  console.log("--- SQL directo (paralelo KPI + drill, como /api/margenes/data) ---\n");
  const sqlResults = [];
  for (const scenario of scenarios) {
    console.log(`▸ ${scenario.name} (${scenario.sedes.length} sede(s))`);
    const row = await benchSqlScenario(
      client,
      scenario.name,
      range.start,
      range.end,
      scenario.sedes,
    );
    sqlResults.push(row);
    console.log(
      `  Cargar datos (drill): avg ${formatMs(row.drill_avg_ms)} · p95 ${formatMs(row.drill_p95_ms)}`,
    );
    if (VERBOSE) {
      console.log(
        `  Desglose avg: kpi ${formatMs(row.kpi_avg_ms)} · filas ${formatMs(row.drill_rows_avg_ms)} · filtros ${formatMs(row.filters_avg_ms)} · sede ${formatMs(row.sede_compare_avg_ms)}\n`,
      );
    } else {
      console.log("");
    }
  }

  console.log("Resumen SQL (ordenado por drill avg):");
  const header = VERBOSE
    ? [
        "escenario".padEnd(28),
        "sedes".padStart(5),
        "drill avg".padStart(10),
        "drill p95".padStart(10),
        "filtros".padStart(10),
      ].join(" ")
    : [
        "escenario".padEnd(28),
        "sedes".padStart(5),
        "drill avg".padStart(10),
        "drill p95".padStart(10),
      ].join(" ");
  console.log(header);
  console.log("-".repeat(VERBOSE ? 65 : 55));
  for (const row of [...sqlResults].sort((a, b) => b.drill_avg_ms - a.drill_avg_ms)) {
    const cells = VERBOSE
      ? [
          row.name.padEnd(28),
          String(row.sedeCount).padStart(5),
          formatMs(row.drill_avg_ms).padStart(10),
          formatMs(row.drill_p95_ms).padStart(10),
          formatMs(row.filters_avg_ms).padStart(10),
        ]
      : [
          row.name.padEnd(28),
          String(row.sedeCount).padStart(5),
          formatMs(row.drill_avg_ms).padStart(10),
          formatMs(row.drill_p95_ms).padStart(10),
        ];
    console.log(cells.join(" "));
  }

  const primary = sqlResults[0];
  console.log(
    `\nTiempo típico «Cargar datos» (1 sede, SQL): ~${formatMs(primary.drill_avg_ms)} (sin contar /meta ni red).`,
  );

  if (HTTP) {
    console.log("\n--- HTTP E2E (meta + drill, con auth y JSON) ---\n");
    const httpOne = await benchHttpFlow(range.start, range.end, oneSede);
    console.log(`▸ 1 sede · meta ${formatMs(httpOne.meta_ms)} + drill avg ${formatMs(httpOne.drill_avg_ms)}`);
    console.log(
      `  Primera carga (meta + drill frío): ~${formatMs(httpOne.total_first_load_ms)} · payload ${formatBytes(httpOne.payload_bytes)}`,
    );
    console.log(
      `  Carga repetida (meta + drill warm avg): ~${formatMs(httpOne.total_warm_avg_ms)}`,
    );
  } else {
    console.log(
      "\nTip: BENCHMARK_VERBOSE=1 desglosa kpi/filas/filtros. BENCHMARK_HTTP=1 mide también red + auth.",
    );
  }
} finally {
  await client.end();
}
