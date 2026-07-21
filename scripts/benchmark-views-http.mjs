/**
 * Benchmark HTTP de las vistas /margenes y /informe-variacion.
 * Replica las llamadas fetch que hace cada page.tsx al cargar datos.
 *
 * Uso:
 *   BENCHMARK_USER=... BENCHMARK_PASSWORD=... node scripts/benchmark-views-http.mjs
 *   BENCHMARK_BASE_URL=http://127.0.0.1:3000
 *   BENCHMARK_RUNS=1
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!process.env[key]) {
      process.env[key] = t
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
    }
  }
}

const BASE_URL = (process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const RUNS = Math.max(1, Number(process.env.BENCHMARK_RUNS ?? 1) || 1);
const USER = process.env.BENCHMARK_USER?.trim() ?? "";
const PASSWORD = process.env.BENCHMARK_PASSWORD ?? "";

const formatMs = (ms) => `${(ms / 1000).toFixed(2)}s`;
const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const mergeSetCookies = (jar, response) => {
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

const cookieHeader = (jar) =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

const request = async (jar, pathOrUrl, init = {}) => {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const headers = { ...(init.headers ?? {}) };
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
    dataSource: response.headers.get("x-data-source"),
    bodyText: buffer.byteLength < 5_000_000 ? new TextDecoder().decode(buffer) : "",
  };
};

const login = async (jar) => {
  if (!USER || !PASSWORD) {
    throw new Error("Defina BENCHMARK_USER y BENCHMARK_PASSWORD.");
  }
  const result = await request(jar, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!result.ok) {
    throw new Error(`Login fallo (${result.status}): ${result.bodyText.slice(0, 200)}`);
  }
  if (!jar.has("vp_session")) {
    throw new Error("Login OK pero falta cookie vp_session.");
  }
};

const compactToIso = (compact) => {
  if (!compact || !/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

const defaultMargenRange = (minCompact, maxCompact) => {
  const endIso = compactToIso(maxCompact);
  const minIso = compactToIso(minCompact);
  if (!endIso) return null;
  let startIso = `${endIso.slice(0, 7)}-01`;
  if (minIso && startIso < minIso) startIso = minIso;
  return { start: startIso, end: endIso };
};

const INFORME_RANGES = [
  { id: "1-7", fromDay: 1, toDay: 7 },
  { id: "1-14", fromDay: 1, toDay: 14 },
  { id: "8-14", fromDay: 8, toDay: 14 },
  { id: "1-21", fromDay: 1, toDay: 21 },
  { id: "15-21", fromDay: 15, toDay: 21 },
  { id: "1-28", fromDay: 1, toDay: 28 },
  { id: "22-28", fromDay: 22, toDay: 28 },
  { id: "1-eom", fromDay: 1, toDay: null },
];

const lastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();

const availableInformeRanges = (year, month, maxCompact) => {
  const monthLast = lastDayOfMonth(year, month);
  const today = new Date();
  let refDay = today.getDate();
  if (maxCompact && /^\d{8}$/.test(maxCompact)) {
    const maxYear = Number(maxCompact.slice(0, 4));
    const maxMonth = Number(maxCompact.slice(4, 6));
    const maxDay = Number(maxCompact.slice(6, 8));
    if (maxYear === year && maxMonth === month) refDay = Math.min(refDay, maxDay);
  }
  if (refDay <= 0) return [];
  return INFORME_RANGES.filter((range) => {
    const endDay = range.toDay ?? monthLast;
    return refDay >= endDay;
  });
};

const defaultInformeRangeId = (ranges) => {
  if (ranges.length === 0) return null;
  const cumulative = ranges.filter((r) => r.fromDay === 1);
  const pool = cumulative.length > 0 ? cumulative : ranges;
  return pool.reduce((best, range) =>
  (range.toDay ?? Number.POSITIVE_INFINITY) >
  (best.toDay ?? Number.POSITIVE_INFINITY)
    ? range
    : best).id;
};

const defaultInformeYearMonth = (maxCompact) => {
  if (maxCompact && /^\d{8}$/.test(maxCompact)) {
    return {
      year: Number(maxCompact.slice(0, 4)),
      month: Number(maxCompact.slice(4, 6)),
    };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

const benchStep = async (jar, label, pathOrUrl, init) => {
  const times = [];
  let last = null;
  for (let i = 0; i < RUNS; i += 1) {
    last = await request(jar, pathOrUrl, init);
    times.push(last.elapsedMs);
    if (!last.ok) break;
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    label,
    status: last?.status ?? 0,
    ok: last?.ok ?? false,
    avg_ms: Number(avg.toFixed(0)),
    bytes: last?.bytes ?? 0,
    dataSource: last?.dataSource ?? null,
    bodyText: last?.bodyText ?? "",
    error: last?.ok ? null : last?.bodyText?.slice(0, 200) ?? null,
  };
};

const ONE_SEDE = "mercamio::001";
const ALL_SEDES =
  "mercamio::001,mercamio::002,mercamio::003,mercamio::004,mercamio::005,mercamio::006,mtodo::001,mtodo::002,mtodo::003,bogota::001,bogota::002";

const main = async () => {
  const jar = new Map();
  const loginStarted = performance.now();
  await login(jar);
  const loginMs = performance.now() - loginStarted;

  console.log("=== Benchmark vistas (HTTP) ===");
  console.log(`Base: ${BASE_URL}  runs=${RUNS}`);
  console.log(`Login: ${formatMs(loginMs)}\n`);

  const results = [];

  // --- Márgenes: igual que page.tsx + primer «Cargar datos» ---
  const metaMargen = await benchStep(jar, "margenes /meta", "/api/margenes/meta");
  results.push(metaMargen);

  let margenRange = { start: "2026-07-01", end: "2026-07-20" };
  if (metaMargen.ok) {
    try {
      const payload = JSON.parse(metaMargen.bodyText);
      const range = defaultMargenRange(payload.minDate, payload.maxDate);
      if (range) margenRange = range;
    } catch {
      // keep default
    }
  }

  const drillPath = encodeURIComponent("[]");
  const drillBase = `from=${margenRange.start}&to=${margenRange.end}`;

  for (const [label, sedeParam] of [
    ["margenes drill 1 sede", ONE_SEDE],
    ["margenes drill 11 sedes", ALL_SEDES],
  ]) {
    const url =
      `/api/margenes/data?mode=drill&drillPath=${drillPath}&${drillBase}&sede=${encodeURIComponent(sedeParam)}`;
    results.push(await benchStep(jar, label, url));
  }

  const margenFirstLoad1 =
    metaMargen.avg_ms + results.find((r) => r.label === "margenes drill 1 sede")?.avg_ms;
  const margenFirstLoadAll =
    metaMargen.avg_ms + results.find((r) => r.label === "margenes drill 11 sedes")?.avg_ms;

  // --- Informe variación: meta + bundle mes + rango default ---
  const metaInforme = await benchStep(
    jar,
    "informe /meta",
    "/api/informe-variacion/meta",
  );
  results.push(metaInforme);

  let year = 2026;
  let month = 7;
  let maxDate = "20260720";
  if (metaInforme.ok) {
    try {
      const meta = JSON.parse(metaInforme.bodyText);
      maxDate = meta.maxDate ?? maxDate;
      ({ year, month } = defaultInformeYearMonth(maxDate));
    } catch {
      // keep defaults
    }
  }

  const ranges = availableInformeRanges(year, month, maxDate);
  const primaryRange = defaultInformeRangeId(ranges);

  const bundle = await benchStep(
    jar,
    "informe bundle month",
    `/api/informe-variacion?year=${year}&month=${month}&bundle=month`,
  );
  results.push(bundle);

  if (primaryRange) {
    results.push(
      await benchStep(
        jar,
        `informe range ${primaryRange}`,
        `/api/informe-variacion?year=${year}&month=${month}&range=${primaryRange}`,
      ),
    );
  }

  const informeFirstPaint =
    metaInforme.avg_ms +
    (bundle.ok ? bundle.avg_ms : results.find((r) => r.label.startsWith("informe range"))?.avg_ms ?? 0);

  console.log(`Rango margenes: ${margenRange.start} → ${margenRange.end}`);
  console.log(`Informe mes: ${year}-${String(month).padStart(2, "0")} · max=${maxDate}`);
  console.log(`Rangos UI: ${ranges.map((r) => r.id).join(", ") || "(ninguno)"}`);
  console.log("");

  const header = [
    "tiempo".padStart(8),
    "status".padStart(6),
    "size".padStart(10),
    "source".padEnd(18),
    "paso",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length + 24));

  for (const row of results) {
    const flag = row.ok ? "" : " FAIL";
    console.log(
      [
        formatMs(row.avg_ms).padStart(8),
        String(row.status).padStart(6),
        formatBytes(row.bytes).padStart(10),
        (row.dataSource ?? "-").padEnd(18),
        `${row.label}${flag}`,
      ].join(" "),
    );
    if (!row.ok && row.error) {
      console.log(`         → ${row.error}`);
    }
  }

  console.log("");
  console.log("Flujo vista (aprox. first load):");
  console.log(`  /margenes (meta + 1 sede):     ${formatMs(margenFirstLoad1)}`);
  console.log(`  /margenes (meta + 11 sedes):   ${formatMs(margenFirstLoadAll)}`);
  console.log(`  /informe-variacion (meta + datos): ${formatMs(informeFirstPaint)}`);
};

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
