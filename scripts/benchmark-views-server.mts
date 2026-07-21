/**
 * Benchmark del flujo server de /margenes y /informe-variacion
 * (misma lógica que las APIs + serialización JSON; sin auth/red HTTP).
 *
 *   npm run benchmark:views-server
 */

import { performance } from "node:perf_hooks";
import pg from "pg";
import { loadEnvFiles, resolvePgClientConfig } from "./db-client-config.mjs";
import { defaultMargenDateRange } from "../src/lib/margenes/date-range.ts";
import { listMargenSedeCatalogOptions } from "../src/lib/margenes/margen-sede-catalog.ts";
import { resolveMargenDataSource } from "../src/lib/margenes/margen-data-source.ts";
import { queryDrillBoard } from "../src/lib/margenes/drill-queries.ts";
import { loadInformeVariacionMeta } from "../src/lib/informe-variacion/meta.ts";
import { loadInformeVariacionMonthBundle } from "../src/lib/informe-variacion/daily-bundle.ts";
import { loadInformeVariacionPayload } from "../src/lib/informe-variacion/query.ts";
import {
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
} from "../src/lib/informe-variacion/day-ranges.ts";
import { defaultInformeYearMonth } from "../src/lib/informe-variacion/periods.ts";

loadEnvFiles();

const formatMs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

const timedJson = async <T>(label: string, fn: () => Promise<T>) => {
  const t0 = performance.now();
  const data = await fn();
  const sqlMs = performance.now() - t0;
  const t1 = performance.now();
  const json = JSON.stringify(data);
  const jsonMs = performance.now() - t1;
  return {
    label,
    totalMs: sqlMs + jsonMs,
    sqlMs,
    jsonMs,
    bytes: Buffer.byteLength(json, "utf8"),
    data,
  };
};

const client = new pg.Client(resolvePgClientConfig());
await client.connect();
await client.query("SET work_mem = '256MB'");
await client.query("SET jit = off");

console.log("=== Benchmark vistas (server / API logic) ===\n");

const catalog = listMargenSedeCatalogOptions();
const allSedes = catalog.map((s) => s.value);
const oneSede = [allSedes[0] ?? "mercamio::001"];

const bounds = await client.query<{
  min_date: string | null;
  max_date: string | null;
}>(`
  SELECT
    (SELECT fecha_dcto FROM margen_final WHERE fecha_dcto IS NOT NULL ORDER BY fecha_dcto ASC LIMIT 1) AS min_date,
    (SELECT fecha_dcto FROM margen_final WHERE fecha_dcto IS NOT NULL ORDER BY fecha_dcto DESC LIMIT 1) AS max_date
`);

const range = defaultMargenDateRange(
  bounds.rows[0]?.min_date,
  bounds.rows[0]?.max_date,
);
if (!range) {
  console.error("Sin fechas en margen_final.");
  process.exit(1);
}

const table = await resolveMargenDataSource(client);
console.log(`Fuente margenes/informe: ${table}`);
console.log(`Rango margenes: ${range.start} → ${range.end}\n`);

const rows: Array<{
  view: string;
  step: string;
  sql: string;
  json: string;
  total: string;
  size: string;
}> = [];

// --- Márgenes meta (como /api/margenes/meta) ---
const metaMargen = await timedJson("margenes meta", async () => {
  const row = bounds.rows[0];
  return {
    ready: true,
    table: "margen_final",
    minDate: row?.min_date ?? null,
    maxDate: row?.max_date ?? null,
    rowCount: 0,
    sedeCount: catalog.length,
  };
});
rows.push({
  view: "margenes",
  step: "GET /api/margenes/meta",
  sql: formatMs(metaMargen.sqlMs),
  json: formatMs(metaMargen.jsonMs),
  total: formatMs(metaMargen.totalMs),
  size: formatBytes(metaMargen.bytes),
});

for (const [label, sedes] of [
  ["GET /api/margenes/data drill (1 sede)", oneSede],
  ["GET /api/margenes/data drill (11 sedes)", allSedes],
] as const) {
  const drill = await timedJson(label, async () =>
    queryDrillBoard(client, buildFilters(range.start, range.end, [...sedes]), [], table),
  );
  rows.push({
    view: "margenes",
    step: label,
    sql: formatMs(drill.sqlMs),
    json: formatMs(drill.jsonMs),
    total: formatMs(drill.totalMs),
    size: formatBytes(drill.bytes),
  });
}

// --- Informe variación ---
const informeMeta = await timedJson("informe meta", () =>
  loadInformeVariacionMeta(client, null),
);
rows.push({
  view: "informe",
  step: "GET /api/informe-variacion/meta",
  sql: formatMs(informeMeta.sqlMs),
  json: formatMs(informeMeta.jsonMs),
  total: formatMs(informeMeta.totalMs),
  size: formatBytes(informeMeta.bytes),
});

const maxDate = informeMeta.data.maxDate;
const { year, month } = defaultInformeYearMonth(maxDate);
const ranges = getAvailableInformeDayRanges(year, month, new Date(), maxDate);
const primaryId = defaultInformeDayRangeId(ranges);

console.log(`Informe mes: ${year}-${String(month).padStart(2, "0")} · max=${maxDate}`);
console.log(`Rangos UI: ${ranges.map((r) => r.id).join(", ")}\n`);

const bundle = await timedJson("informe bundle month", async () => {
  const loaded = await loadInformeVariacionMonthBundle(client, year, month, null, ranges);
  if (!loaded) return { ok: false as const, payloads: {} };
  return { ok: true as const, payloads: loaded.bundle.payloads };
});
rows.push({
  view: "informe",
  step: "GET /api/informe-variacion?bundle=month",
  sql: formatMs(bundle.sqlMs),
  json: formatMs(bundle.jsonMs),
  total: formatMs(bundle.totalMs),
  size: formatBytes(bundle.bytes),
});

if (primaryId) {
  const rangeSpec = ranges.find((r) => r.id === primaryId)!;
  const single = await timedJson(`informe range ${primaryId}`, () =>
    loadInformeVariacionPayload(client, year, month, null, { dayRange: rangeSpec }),
  );
  rows.push({
    view: "informe",
    step: `GET /api/informe-variacion?range=${primaryId}`,
    sql: formatMs(single.sqlMs),
    json: formatMs(single.jsonMs),
    total: formatMs(single.totalMs),
    size: formatBytes(single.bytes),
  });
}

const header = ["vista", "paso", "sql", "json", "total", "payload"].join("\t");
console.log(header);
console.log("-".repeat(100));
for (const row of rows) {
  console.log(
    [row.view, row.step, row.sql, row.json, row.total, row.size].join("\t"),
  );
}

const margenMeta = rows.find((r) => r.step.includes("margenes/meta"));
const margenDrill1 = rows.find((r) => r.step.includes("1 sede"));
const margenDrillAll = rows.find((r) => r.step.includes("11 sedes"));
const informeMetaRow = rows.find((r) => r.step.includes("informe-variacion/meta"));
const informeBundle = rows.find((r) => r.step.includes("bundle=month"));
const informeRange = rows.find((r) => r.step.startsWith("GET /api/informe-variacion?range="));

const parseSec = (s: string) => Number(s.replace("s", ""));

console.log("\n--- First load vista (suma pasos) ---");
if (margenMeta && margenDrill1) {
  console.log(
    `/margenes (meta + 1 sede): ${formatMs((parseSec(margenMeta.total) + parseSec(margenDrill1.total)) * 1000)}`,
  );
}
if (margenMeta && margenDrillAll) {
  console.log(
    `/margenes (meta + 11 sedes): ${formatMs((parseSec(margenMeta.total) + parseSec(margenDrillAll.total)) * 1000)}`,
  );
}
if (informeMetaRow && (informeBundle || informeRange)) {
  const bundleFailed =
    bundle.data &&
    typeof bundle.data === "object" &&
    "ok" in bundle.data &&
    bundle.data.ok === false;
  const dataStep = bundleFailed ? informeRange : informeBundle ?? informeRange;
  if (dataStep) {
    console.log(
      `/informe-variacion (meta + datos): ${formatMs((parseSec(informeMetaRow.total) + parseSec(dataStep.total)) * 1000)}`,
    );
  }
}

await client.end();
