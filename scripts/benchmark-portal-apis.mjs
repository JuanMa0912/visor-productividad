/**
 * Benchmark E2E de APIs del portal (desde app-server contra localhost).
 *
 * Mide tiempo de respuesta HTTP (red + auth + SQL + serializacion JSON).
 *
 * Uso en app-server:
 *   cd /opt/visor-productividad
 *   BENCHMARK_USER=admin BENCHMARK_PASSWORD='...' node scripts/benchmark-portal-apis.mjs
 *
 * Opciones:
 *   BENCHMARK_BASE_URL=http://127.0.0.1:3000   (default)
 *   BENCHMARK_RUNS=2                             (mediciones por endpoint; 1 = sin warmup extra)
 *   BENCHMARK_START=2026-05-22
 *   BENCHMARK_END=2026-06-21
 *   BENCHMARK_JSON=1                             (salida JSON)
 */

const BASE_URL = (process.env.BENCHMARK_BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const RUNS = Math.max(1, Number(process.env.BENCHMARK_RUNS ?? 2) || 2);
const JSON_OUT = process.env.BENCHMARK_JSON === "1";
const USER = process.env.BENCHMARK_USER?.trim() ?? "";
const PASSWORD = process.env.BENCHMARK_PASSWORD ?? "";

const percentile = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
};

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

const request = async (jar, path, init = {}) => {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
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
    contentType: response.headers.get("content-type"),
    bodyText: buffer.byteLength < 2_000_000 ? new TextDecoder().decode(buffer) : "",
  };
};

const login = async (jar) => {
  if (!USER || !PASSWORD) {
    throw new Error(
      "Defina BENCHMARK_USER y BENCHMARK_PASSWORD (usuario admin o con acceso amplio).",
    );
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

const rollingMonthRange = (maxIso) => {
  const end = maxIso;
  const endDate = new Date(`${end}T12:00:00`);
  const daysInPrevMonth = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    0,
  ).getDate();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (daysInPrevMonth - 1));
  const toKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: toKey(startDate), end };
};

const discoverContext = async (jar, start, end) => {
  const params = new URLSearchParams({
    catalogOnly: "1",
    start,
    end,
  });
  const catalog = await request(jar, `/api/rotacion?${params}`);
  if (!catalog.ok) {
    throw new Error(
      `No se pudo leer catalogo rotacion (${catalog.status}): ${catalog.bodyText.slice(0, 200)}`,
    );
  }
  const payload = JSON.parse(catalog.bodyText);
  const availableMax =
    payload?.meta?.availableRange?.max ??
    payload?.meta?.effectiveRange?.end ??
    end;
  const range =
    process.env.BENCHMARK_START && process.env.BENCHMARK_END
      ? { start: process.env.BENCHMARK_START, end: process.env.BENCHMARK_END }
      : rollingMonthRange(availableMax);

  const sede = payload?.filters?.sedes?.[0];
  const sedeScope = sede ? `${sede.empresa}::${sede.sedeId}` : null;
  const sedeName = sede?.sedeName ?? null;

  return { range, sedeScope, sedeName, catalogMs: catalog.elapsedMs };
};

const buildCases = (ctx) => {
  const { range, sedeScope, sedeName } = ctx;
  const q = (path, params) => {
    const search = new URLSearchParams(params);
    return `${path}?${search}`;
  };

  const cases = [
    { group: "sistema", name: "health", path: "/api/health", auth: false },
    { group: "auth", name: "auth/me", path: "/api/auth/me" },
    {
      group: "productividad",
      name: "productivity",
      path: "/api/productivity",
    },
    {
      group: "margenes",
      name: "margenes (90d default)",
      path: q("/api/margenes", { from: range.start, to: range.end }),
    },
    {
      group: "rotacion",
      name: "rotacion catalogOnly",
      path: q("/api/rotacion", {
        catalogOnly: "1",
        start: range.start,
        end: range.end,
      }),
    },
  ];

  if (sedeScope) {
    cases.push(
      {
        group: "rotacion",
        name: "rotacion filas 1 sede (periodo default)",
        path: q("/api/rotacion", {
          start: range.start,
          end: range.end,
          sedeScope,
        }),
      },
      {
        group: "rotacion",
        name: "rotacion cero-estados",
        path: q("/api/rotacion/cero-estados", {
          start: range.start.replace(/-/g, ""),
          end: range.end.replace(/-/g, ""),
          sedeScope,
        }),
      },
    );
  }

  cases.push(
    {
      group: "ventas",
      name: "ventas-x-item v2 meta",
      path: q("/api/ventas-x-item/v2", { mode: "meta" }),
    },
    {
      group: "ventas",
      name: "ventas-x-item v2 table (maxRows=5000)",
      path: q("/api/ventas-x-item/v2", {
        mode: "table",
        start: range.end.replace(/-/g, ""),
        end: range.end.replace(/-/g, ""),
        maxRows: "5000",
      }),
    },
    {
      group: "inventario",
      name: "inventario-x-item catalog",
      path: q("/api/inventario-x-item", {
        mode: "catalog",
        dateStart: range.end,
        dateEnd: range.end,
      }),
    },
    {
      group: "inventario",
      name: "inventario-x-item table 1 dia",
      path: q("/api/inventario-x-item", {
        mode: "table",
        dateStart: range.end,
        dateEnd: range.end,
      }),
    },
    {
      group: "kardex",
      name: "kardex lookups",
      path: q("/api/kardex/lookups", {
        fechaDesde: range.start,
        fechaHasta: range.end,
      }),
    },
    {
      group: "kardex",
      name: "kardex totales",
      path: q("/api/kardex/totales", {
        fechaDesde: range.start,
        fechaHasta: range.end,
      }),
    },
    {
      group: "kardex",
      name: "kardex resumen-item",
      path: q("/api/kardex/resumen-item", {
        fechaDesde: range.start,
        fechaHasta: range.end,
      }),
    },
    {
      group: "horarios",
      name: "jornada-extendida meta",
      path: "/api/jornada-extendida/meta",
    },
  );

  if (sedeName) {
    cases.push(
      {
        group: "horarios",
        name: "hourly-analysis 1 dia",
        path: q("/api/hourly-analysis", {
          date: range.end,
          sede: sedeName,
        }),
      },
      {
        group: "horarios",
        name: "horarios-comparar",
        path: q("/api/horarios-comparar", {
          start: range.start,
          end: range.end,
          sede: sedeName,
        }),
      },
    );
  }

  cases.push({
    group: "cronograma",
    name: "cronograma (Notion)",
    path: "/api/cronograma",
    optional: true,
  });

  return cases;
};

const benchmarkCase = async (jar, testCase) => {
  const times = [];
  let last = null;
  for (let i = 0; i < RUNS; i += 1) {
    const localJar = testCase.auth === false ? new Map() : new Map(jar);
    last = await request(localJar, testCase.path);
    times.push(last.elapsedMs);
  }
  return {
    ...testCase,
    runs: RUNS,
    status: last?.status ?? 0,
    ok: last?.ok ?? false,
    bytes: last?.bytes ?? 0,
    dataSource: last?.dataSource ?? null,
    times_ms: times.map((v) => Number(v.toFixed(0))),
    avg_ms: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)),
    min_ms: Number(Math.min(...times).toFixed(0)),
    max_ms: Number(Math.max(...times).toFixed(0)),
    p95_ms: Number(percentile(times, 0.95).toFixed(0)),
  };
};

const printTable = (rows, meta) => {
  console.log("=== Benchmark APIs portal ===");
  console.log(`Base: ${BASE_URL}  runs=${RUNS}  rango=${meta.range.start}..${meta.range.end}`);
  if (meta.sedeScope) console.log(`Sede muestra: ${meta.sedeScope}`);
  console.log("");

  const sorted = [...rows].sort((a, b) => b.avg_ms - a.avg_ms);
  const header = [
    "avg".padStart(8),
    "p95".padStart(8),
    "status".padStart(6),
    "size".padStart(10),
    "source".padEnd(14),
    "endpoint",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length + 40));

  for (const row of sorted) {
    const flag = row.ok ? "" : row.optional ? " (skip)" : " FAIL";
    console.log(
      [
        formatMs(row.avg_ms).padStart(8),
        formatMs(row.p95_ms).padStart(8),
        String(row.status).padStart(6),
        formatBytes(row.bytes).padStart(10),
        (row.dataSource ?? "-").padEnd(14),
        `[${row.group}] ${row.name}${flag}`,
      ].join(" "),
    );
  }

  const failures = sorted.filter((r) => !r.ok && !r.optional);
  console.log("");
  if (failures.length > 0) {
    console.log(`Atencion: ${failures.length} endpoint(s) con error (revisar permisos o params).`);
  } else {
    console.log("Todos los endpoints obligatorios respondieron OK.");
  }
  console.log("");
  console.log(
    "Tip: para SQL puro en BD use scripts/benchmark-pg-stat-statements.sql o scripts/benchmark-rotacion.mjs",
  );
};

const main = async () => {
  const jar = new Map();
  await login(jar);

  const ctx = await discoverContext(
    jar,
    process.env.BENCHMARK_START ?? "2026-05-01",
    process.env.BENCHMARK_END ?? "2026-06-21",
  );
  const cases = buildCases(ctx);
  const results = [];

  for (const testCase of cases) {
    const row = await benchmarkCase(jar, testCase);
    results.push(row);
    if (!JSON_OUT) {
      process.stdout.write(
        `  ${row.ok ? "ok" : row.optional ? "skip" : "ERR"} ${row.name} ${formatMs(row.avg_ms)}\n`,
      );
    }
  }

  const payload = {
    baseUrl: BASE_URL,
    runs: RUNS,
    range: ctx.range,
    sedeScope: ctx.sedeScope,
    results: results.sort((a, b) => b.avg_ms - a.avg_ms),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("");
    printTable(results, ctx);
  }
};

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
