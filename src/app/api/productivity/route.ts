import { NextResponse } from "next/server";
import { DailyProductivity } from "@/types";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool, testDbConnection } from "@/lib/db";
import { canAccessPortalSection } from "@/lib/shared/portal-sections";
import { normalizeKeyCompact } from "@/lib/shared/normalize";
import {
  userHasDinastiaAccess,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";
import { promises as fs } from "fs";
import path from "path";
import { shouldServeProductivityFileCache } from "@/lib/productivity/file-cache-policy";
import {
  emptyLineMetrics,
  hasProductivityVolumeShape,
  lineHasActivity,
  resolveProductivityLineFromRoll,
  splitAsaderoQty,
} from "@/lib/productivity/line-volume";
import {
  filterProductivityByDateRange,
  isProductivityIsoDate,
  toProductivityCompactDate,
} from "@/lib/productivity/date-window";
import {
  getCachedQuery,
  setCachedQuery,
} from "@/lib/margenes/query-cache";

const resolveCachePath = () => {
  const defaultPath = "data/productivity-cache.json";
  const envPath = process.env.PRODUCTIVITY_CACHE_PATH?.trim();
  if (!envPath) {
    return path.resolve(/* turbopackIgnore: true */ process.cwd(), defaultPath);
  }
  const isSafeRelative =
    !path.isAbsolute(envPath) &&
    !envPath.split(path.sep).includes("..") &&
    /^[\w./-]+$/.test(envPath);
  if (!isSafeRelative) {
    return path.resolve(/* turbopackIgnore: true */ process.cwd(), defaultPath);
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), envPath);
};

const PRODUCTIVITY_MEMORY_CACHE_KEY = "productivity:full-v2";
const PRODUCTIVITY_MEMORY_TTL_MS = 10 * 60 * 1000;

type ProductivityDateBounds = {
  fromIso: string | null;
  toIso: string | null;
};

const readMemoryProductivityCache = (): DailyProductivity[] | null => {
  const hit = getCachedQuery(PRODUCTIVITY_MEMORY_CACHE_KEY);
  if (!Array.isArray(hit) || hit.length === 0) return null;
  return hit as DailyProductivity[];
};

const writeMemoryProductivityCache = (dailyData: DailyProductivity[]) => {
  if (dailyData.length === 0) return;
  setCachedQuery(
    PRODUCTIVITY_MEMORY_CACHE_KEY,
    dailyData,
    PRODUCTIVITY_MEMORY_TTL_MS,
  );
};

const cacheFilePath = resolveCachePath();
const NO_STORE_CACHE_CONTROL = "no-store, private";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_ENTRIES = 10_000;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (request: Request) => {
  const trustProxy = process.env.TRUST_PROXY === "true";
  const forwarded = trustProxy ? request.headers.get("x-forwarded-for") : null;
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
};

const checkRateLimit = (request: Request) => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(ip);
    }
  }
  if (rateLimitStore.size > RATE_LIMIT_MAX_ENTRIES) {
    const overflow = rateLimitStore.size - RATE_LIMIT_MAX_ENTRIES;
    const keys = rateLimitStore.keys();
    for (let i = 0; i < overflow; i += 1) {
      const next = keys.next();
      if (next.done) break;
      rateLimitStore.delete(next.value);
    }
  }
  const clientIp = getClientIp(request);
  const entry = rateLimitStore.get(clientIp);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return null;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return entry.resetAt;
  }
  entry.count += 1;
  return null;
};

const readCache = async (): Promise<{
  dailyData: DailyProductivity[];
  updatedAt: string | null;
} | null> => {
  try {
    const raw = await fs.readFile(cacheFilePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      dailyData?: DailyProductivity[];
      updatedAt?: string;
    };
    if (!Array.isArray(parsed.dailyData) || parsed.dailyData.length === 0) {
      return null;
    }
    if (!hasProductivityVolumeShape(parsed.dailyData)) {
      return null;
    }
    const updatedAt =
      typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
        ? parsed.updatedAt.trim()
        : null;
    return { dailyData: parsed.dailyData, updatedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
};

/** Persiste dataset completo para que los siguientes GET lean readCache() sin ir a BD. */
const writeProductivityCacheFile = async (
  dailyData: DailyProductivity[],
): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
    await fs.writeFile(
      cacheFilePath,
      JSON.stringify({
        dailyData,
        updatedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
  } catch (error) {
    console.error("[productivity] No se pudo escribir cache en disco:", error);
  }
};

const buildFallbackResponse = (message?: string) => {
  void message;
  return NextResponse.json(
    {
      dailyData: [],
      sedes: [],
      error: "No se pudieron cargar los datos de productividad.",
    },
    {
      headers: {
        "Cache-Control": NO_STORE_CACHE_CONTROL,
        "X-Data-Source": "fallback",
      },
    },
  );
};

const HIDDEN_SEDES = new Set(
  [
    "adm",
    "cedi-cavasa",
    "cedicavasa",
    "panificadora",
    "planta desposte mixto",
    "planta desprese pollo",
    "planta desposte pollo",
  ].map((value) => normalizeKeyCompact(value)),
);

const normalizeSedeKey = normalizeKeyCompact;

const buildSedes = (dailyData: DailyProductivity[]) =>
  Array.from(new Set(dailyData.map((item) => item.sede)))
    .filter((sede) => !HIDDEN_SEDES.has(normalizeSedeKey(sede)))
    .map((sede) => ({
      id: sede,
      name: sede,
    }));

/** Reduce payload: quita líneas en cero (el cliente rellena DEFAULT_LINES). */
const compactDailyDataForTransport = (
  dailyData: DailyProductivity[],
): DailyProductivity[] =>
  dailyData
    .map((day) => ({
      ...day,
      lines: day.lines.filter(lineHasActivity),
    }))
    .filter((day) => day.lines.length > 0);

const buildDataResponse = (
  dailyData: DailyProductivity[],
  source: "cache" | "memory" | "database" | "database-window",
) => {
  const compact = compactDailyDataForTransport(dailyData);
  return NextResponse.json(
    { dailyData: compact, sedes: buildSedes(compact) },
    {
      headers: {
        "Cache-Control": NO_STORE_CACHE_CONTROL,
        "X-Data-Source": source,
      },
    },
  );
};

const LINE_TABLES: Array<{
  id: DailyProductivity["lines"][number]["id"];
  name: string;
  table: string;
}> = [
  { id: "cajas", name: "Cajas", table: "ventas_cajas" },
  { id: "fruver", name: "Fruver", table: "ventas_fruver" },
  { id: "industria", name: "Industria", table: "ventas_industria" },
  { id: "carnes", name: "Carnes", table: "ventas_carnes" },
  {
    id: "pollo y pescado",
    name: "Pollo y pescado",
    table: "ventas_pollo_pesc",
  },
  { id: "asadero", name: "Asadero", table: "ventas_asadero" },
];

const normalizeLineId = (value: string) => value.trim().toLowerCase();
const LINE_ID_SET = new Set(LINE_TABLES.map((line) => normalizeLineId(line.id)));
const LINE_NAME_BY_ID = new Map(LINE_TABLES.map((line) => [line.id, line.name]));

const resolveSessionAllowedLineIds = (allowedLines: string[] | null | undefined) => {
  if (!Array.isArray(allowedLines) || allowedLines.length === 0) {
    return [] as string[];
  }
  const normalized = Array.from(
    new Set(
      allowedLines
        .map((line) => (typeof line === "string" ? normalizeLineId(line) : ""))
        .filter(Boolean),
    ),
  );
  return normalized.filter((line) => LINE_ID_SET.has(line));
};

const filterDailyDataByAllowedLines = (
  dailyData: DailyProductivity[],
  allowedLineIds: string[],
) => {
  if (allowedLineIds.length === 0) {
    return dailyData;
  }
  const allowedSet = new Set(allowedLineIds.map(normalizeLineId));

  return dailyData
    .map((item) => ({
      ...item,
      lines: item.lines.filter((line) => allowedSet.has(normalizeLineId(line.id))),
    }))
    .filter((item) => item.lines.length > 0);
};

const isDinastiaSedeName = (sede: string) =>
  normalizeSedeKey(sede).includes("dinastia");

/**
 * Productividad por linea: todas las sedes del tenant para comparar.
 * No aplica `allowedSedes` del perfil (eso sigue en margenes, rotacion, etc.).
 * Solo separa tenant Dinastia vs historico.
 */
const filterDailyDataByEmpresaTenant = (
  dailyData: DailyProductivity[],
  sessionUser: {
    role: "admin" | "user";
    allowedEmpresas?: string[] | null;
  },
): DailyProductivity[] => {
  if (userIsDinastiaOnly(sessionUser)) {
    return dailyData.filter((item) => isDinastiaSedeName(item.sede));
  }
  if (!userHasDinastiaAccess(sessionUser)) {
    return dailyData.filter((item) => !isDinastiaSedeName(item.sede));
  }
  return dailyData;
};

// Mapeo de centro_operacion + empresa_bd a nombre de sede
// Clave: "numero|empresa" -> Nombre de sede
const SEDE_NAMES: Record<string, string> = {
  // Mercamio
  "001|mercamio": "Calle 5ta",
  "002|mercamio": "La 39",
  "003|mercamio": "Plaza Norte",
  "004|mercamio": "Ciudad Jardín",
  "005|mercamio": "Centro Sur",
  "006|mercamio": "Palmira",
  // Mercatodo (en BD aparece como "mtodo")
  "001|mtodo": "Floresta",
  "002|mtodo": "Floralia",
  "003|mtodo": "Guaduales",
  // Merkmios (en BD aparece como "bogota")
  "001|bogota": "Bogotá",
  "002|bogota": "Chía",
  // Dinastía
  "001|dinastia": "Dinastia 1 Santa Elena",
  "002|dinastia": "Dinastia 2 CR Primera",
};

// Función para obtener el nombre de sede a partir de centro_operacion y empresa
const getSedeKey = (centroOp: string, empresa: string): string => {
  const normalizedEmpresa = empresa?.toLowerCase().trim() || "";
  return `${centroOp}|${normalizedEmpresa}`;
};

// Convierte fecha de formato YYYYMMDD a YYYY-MM-DD
const formatDate = (dateStr: string): string => {
  if (dateStr.length !== 8) return dateStr;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${year}-${month}-${day}`;
};

// Mapeo de departamento en asistencia_horas a ID de línea
// Los nombres se normalizan a minúsculas antes de buscar
const DEPARTAMENTO_TO_LINE: Record<string, string> = {
  // Cajas
  cajas: "cajas",
  "supervision y cajas": "cajas",
  // Fruver
  fruver: "fruver",
  "surtidor fruver": "fruver",
  // Industria
  industria: "industria",
  surtidores: "industria",
  // Carnes
  carnes: "carnes",
  "carnes rojas": "carnes",
  // Pollo y pescado
  "pollo y pescado": "pollo y pescado",
  "surtidor (a) pollo y pescado": "pollo y pescado",
  // Asadero
  asadero: "asadero",
  "pollo asado": "asadero",
  // Planta
  "planta de produccion": "industria",
};

// Normaliza el nombre del departamento para mapear a línea
const normalizeDepto = (depto: string): string => {
  return (
    depto
      ?.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || ""
  );
};

const resolveLineId = (depto: string): string | undefined => {
  const normalized = normalizeDepto(depto);
  if (!normalized) return undefined;

  const direct = DEPARTAMENTO_TO_LINE[normalized];
  if (direct) return direct;

  if (normalized.includes("asadero") || normalized.includes("asado"))
    return "asadero";
  if (
    normalized.includes("pollo") ||
    normalized.includes("pescado") ||
    normalized.includes("mariscos")
  )
    return "pollo y pescado";
  if (
    normalized.includes("fruver") ||
    normalized.includes("fruta") ||
    normalized.includes("verdura")
  )
    return "fruver";
  if (normalized.includes("caja")) return "cajas";
  if (normalized.includes("industria") || normalized.includes("surtidor"))
    return "industria";
  if (normalized.includes("carn")) return "carnes";

  return undefined;
};

// Mapeo de nombres de sede en asistencia_horas a nombres del sistema
const SEDE_ASISTENCIA_TO_SYSTEM: Record<string, string> = {
  "merkmios bogota": "Bogotá",
  "mio plaza norte": "Plaza Norte",
  floresta: "Floresta",
  "la 5a": "Calle 5ta",
  "palmira mercamio": "Palmira",
  guaduales: "Guaduales",
  "merkmios chia": "Chía",
  "centro sur": "Centro Sur",
  floralia: "Floralia",
  "floralia mercatodo": "Floralia",
  "mercatodo floralia": "Floralia",
  "la 39": "La 39",
  "ciudad jardin": "Ciudad Jardín",
};

// Normaliza el nombre de sede de asistencia_horas al nombre del sistema
const normalizeSedeAsistencia = (sede: string): string => {
  const normalized =
    sede
      ?.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || "";
  if (SEDE_ASISTENCIA_TO_SYSTEM[normalized]) {
    return SEDE_ASISTENCIA_TO_SYSTEM[normalized];
  }
  if (normalized.includes("floralia")) return "Floralia";
  if (normalized.includes("panificadora")) return "Panificadora";
  if (
    normalized.includes("planta desposte pollo") ||
    normalized.includes("planta desprese pollo")
  )
    return "Planta Desprese Pollo";
  if (normalized.includes("planta desposte mixto"))
    return "Planta Desposte Mixto";
  return sede?.trim() || "";
};

const fetchAllProductivityData = async (
  allowedLineIds: string[] = [],
  bounds: ProductivityDateBounds = { fromIso: null, toIso: null },
): Promise<DailyProductivity[]> => {
  const pool = await getDbPool();
  const dailyDataMap = new Map<string, DailyProductivity>();
  const allowedSet = new Set(allowedLineIds.map(normalizeLineId));
  const lineTables =
    allowedSet.size > 0
      ? LINE_TABLES.filter((line) => allowedSet.has(normalizeLineId(line.id)))
      : LINE_TABLES;

  const fromCompact =
    bounds.fromIso && isProductivityIsoDate(bounds.fromIso)
      ? toProductivityCompactDate(bounds.fromIso)
      : null;
  const toCompact =
    bounds.toIso && isProductivityIsoDate(bounds.toIso)
      ? toProductivityCompactDate(bounds.toIso)
      : null;
  const fromIso =
    bounds.fromIso && isProductivityIsoDate(bounds.fromIso)
      ? bounds.fromIso
      : null;
  const toIso =
    bounds.toIso && isProductivityIsoDate(bounds.toIso) ? bounds.toIso : null;

  const ventasWhereParts = [
    "fecha_dcto IS NOT NULL",
    "centro_operacion IS NOT NULL",
  ];
  const ventasParams: string[] = [];
  if (fromCompact) {
    ventasParams.push(fromCompact);
    ventasWhereParts.push(`fecha_dcto >= $${ventasParams.length}`);
  }
  if (toCompact) {
    ventasParams.push(toCompact);
    ventasWhereParts.push(`fecha_dcto <= $${ventasParams.length}`);
  }
  const ventasWhere = ventasWhereParts.join("\n            AND ");

  const hoursWhereParts = [
    "fecha IS NOT NULL",
    "sede IS NOT NULL",
    "departamento IS NOT NULL",
  ];
  const hoursParams: string[] = [];
  if (fromIso) {
    hoursParams.push(fromIso);
    hoursWhereParts.push(`fecha >= $${hoursParams.length}::date`);
  }
  if (toIso) {
    hoursParams.push(toIso);
    hoursWhereParts.push(`fecha <= $${hoursParams.length}::date`);
  }
  const hoursWhere = hoursWhereParts.join("\n          AND ");

  const hoursQuery = `
        SELECT
          fecha,
          sede,
          departamento,
          COALESCE(SUM(total_laborado_horas), 0) AS total_hours
        FROM asistencia_horas
        WHERE ${hoursWhere}
        GROUP BY fecha, sede, departamento
        ORDER BY fecha, sede
      `;

  const needsRollVolume =
    allowedSet.size === 0 ||
    Array.from(allowedSet).some((id) => id !== "cajas");
  const rollWhereParts = ["fecha_dcto IS NOT NULL"];
  const rollParams: string[] = [];
  if (fromCompact) {
    rollParams.push(fromCompact);
    rollWhereParts.push(`fecha_dcto >= $${rollParams.length}`);
  }
  if (toCompact) {
    rollParams.push(toCompact);
    rollWhereParts.push(`fecha_dcto <= $${rollParams.length}`);
  }
  const rollWhere = rollWhereParts.join("\n          AND ");
  const tipo4VolumeQuery = `
        SELECT
          fecha_dcto,
          empresa_norm,
          id_co_norm,
          TRIM(COALESCE(id_tipo, '')) AS id_tipo,
          TRIM(COALESCE(id_linea1, '')) AS id_linea1,
          SUM(COALESCE(cantidad, 0)) AS qty
        FROM margen_item_dia_roll
        WHERE ${rollWhere}
          AND TRIM(COALESCE(id_tipo, '')) = '4'
        GROUP BY fecha_dcto, empresa_norm, id_co_norm,
          TRIM(COALESCE(id_tipo, '')), TRIM(COALESCE(id_linea1, ''))
      `;
  const asaderoVolumeQuery = `
        SELECT
          fecha_dcto,
          empresa_norm,
          id_co_norm,
          TRIM(COALESCE(id_tipo, '')) AS id_tipo,
          TRIM(COALESCE(id_linea1, '')) AS id_linea1,
          TRIM(COALESCE(id_linea2, '')) AS id_linea2,
          MAX(nombre_linea1) AS nombre_linea1,
          MAX(nombre_linea2) AS nombre_linea2,
          TRIM(COALESCE(id_item, '')) AS id_item,
          MAX(item_descripcion) AS item_descripcion,
          SUM(COALESCE(cantidad, 0)) AS qty
        FROM margen_item_dia_roll
        WHERE ${rollWhere}
          AND TRIM(COALESCE(id_tipo, '')) = '3'
        GROUP BY fecha_dcto, empresa_norm, id_co_norm,
          TRIM(COALESCE(id_tipo, '')), TRIM(COALESCE(id_linea1, '')),
          TRIM(COALESCE(id_linea2, '')), TRIM(COALESCE(id_item, ''))
      `;

  const emptyQueryResult = { rows: [] as Record<string, unknown>[] };
  const queryOrEmpty = async (sql: string, params: string[], label: string) => {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      console.warn(`No se pudo consultar ${label}:`, error);
      return emptyQueryResult;
    }
  };

  // Varias conexiones del pool en paralelo (antes: 1 client serializado).
  const [lineOutputs, hoursQueryResult, tipo4VolumeResult, asaderoVolumeResult] =
    await Promise.all([
      Promise.all(
        lineTables.map(async (line) => {
          const query = `
          SELECT
            fecha_dcto,
            centro_operacion,
            empresa_bd,
            COALESCE(SUM(total_bruto), 0) AS total_sales,
            COUNT(*) FILTER (WHERE COALESCE(total_bruto, 0) > 0)::int AS tx_count
          FROM ${line.table}
          WHERE ${ventasWhere}
          GROUP BY fecha_dcto, centro_operacion, empresa_bd
          ORDER BY fecha_dcto, centro_operacion
        `;
          try {
            const result = await pool.query(query, ventasParams);
            return {
              line,
              rows: (result.rows ?? []) as Record<string, unknown>[],
            };
          } catch (error) {
            console.warn(
              `No se pudo consultar la tabla ${line.table}. Se omite.`,
              error,
            );
            return { line, rows: [] as Record<string, unknown>[] };
          }
        }),
      ),
      queryOrEmpty(hoursQuery, hoursParams, "asistencia_horas"),
      needsRollVolume
        ? queryOrEmpty(tipo4VolumeQuery, rollParams, "margen_item_dia_roll (cat. 4)")
        : Promise.resolve(emptyQueryResult),
      needsRollVolume
        ? queryOrEmpty(
            asaderoVolumeQuery,
            rollParams,
            "margen_item_dia_roll (asadero)",
          )
        : Promise.resolve(emptyQueryResult),
    ]);

  const getOrCreateDaily = (fecha: string, sedeName: string) => {
    const key = `${fecha}_${sedeName}`;
    let dailyData = dailyDataMap.get(key);
    if (!dailyData) {
      dailyData = { date: fecha, sede: sedeName, lines: [] };
      dailyDataMap.set(key, dailyData);
    }
    return dailyData;
  };

  const ensureLine = (
    dailyData: DailyProductivity,
    lineId: string,
    lineName?: string,
  ) => {
    let lineMetric = dailyData.lines.find((l) => l.id === lineId);
    if (!lineMetric) {
      lineMetric = emptyLineMetrics(
        lineId,
        lineName || LINE_NAME_BY_ID.get(lineId) || lineId,
      );
      dailyData.lines.push(lineMetric);
    }
    return lineMetric;
  };

  const sedeNameFromRoll = (idCo: string, empresa: string) => {
    const centro = String(idCo ?? "").trim().padStart(3, "0");
    const emp = String(empresa ?? "").toLowerCase().trim();
    const sedeKey = getSedeKey(centro, emp);
    return SEDE_NAMES[sedeKey] || `Sede ${centro} ${emp}`.trim();
  };

  for (const { line, rows } of lineOutputs) {
    for (const row of rows) {
      const typedRow = row as {
        fecha_dcto: string;
        centro_operacion: string;
        empresa_bd: string | null;
        total_sales: string | number;
        tx_count?: string | number;
      };
      const fecha = formatDate(typedRow.fecha_dcto);
      const centroOp = typedRow.centro_operacion;
      const empresa = typedRow.empresa_bd || "";
      const sedeKey = getSedeKey(centroOp, empresa);
      const sedeName =
        SEDE_NAMES[sedeKey] || `Sede ${centroOp} ${empresa}`.trim();
      const lineMetric = ensureLine(getOrCreateDaily(fecha, sedeName), line.id, line.name);
      lineMetric.sales += Number(typedRow.total_sales) || 0;
      if (line.id === "cajas") {
        const tx = Number(typedRow.tx_count) || 0;
        lineMetric.transactions = (lineMetric.transactions ?? 0) + tx;
        lineMetric.volume = (lineMetric.volume ?? 0) + tx;
      }
    }
  }

  for (const row of hoursQueryResult.rows ?? []) {
    const typedRow = row as {
      fecha: string;
      sede: string;
      departamento: string;
      total_hours: string | number;
    };

    let fecha: string;
    if (typeof typedRow.fecha === "string") {
      fecha = typedRow.fecha.slice(0, 10);
    } else {
      const fechaObj = new Date(typedRow.fecha);
      const year = fechaObj.getFullYear();
      const month = String(fechaObj.getMonth() + 1).padStart(2, "0");
      const day = String(fechaObj.getDate()).padStart(2, "0");
      fecha = `${year}-${month}-${day}`;
    }
    const sedeName = normalizeSedeAsistencia(typedRow.sede);
    if (HIDDEN_SEDES.has(normalizeSedeKey(sedeName))) {
      continue;
    }
    const lineId = resolveLineId(typedRow.departamento);

    if (!lineId || !sedeName) {
      continue;
    }
    if (allowedSet.size > 0 && !allowedSet.has(normalizeLineId(lineId))) {
      continue;
    }

    const lineMetric = ensureLine(getOrCreateDaily(fecha, sedeName), lineId);
    lineMetric.hours += Number(typedRow.total_hours) || 0;
  }

  for (const row of tipo4VolumeResult.rows ?? []) {
    const typedRow = row as {
      fecha_dcto: string;
      empresa_norm: string;
      id_co_norm: string;
      id_tipo: string;
      id_linea1: string;
      qty: string | number;
    };
    const lineId = resolveProductivityLineFromRoll(
      typedRow.id_tipo,
      typedRow.id_linea1,
    );
    if (!lineId || lineId === "asadero") continue;
    if (allowedSet.size > 0 && !allowedSet.has(normalizeLineId(lineId))) {
      continue;
    }
    const qty = Number(typedRow.qty) || 0;
    if (qty === 0) continue;
    const fecha = formatDate(typedRow.fecha_dcto);
    const sedeName = sedeNameFromRoll(typedRow.id_co_norm, typedRow.empresa_norm);
    const lineMetric = ensureLine(getOrCreateDaily(fecha, sedeName), lineId);
    lineMetric.volume = (lineMetric.volume ?? 0) + qty;
  }

  for (const row of asaderoVolumeResult.rows ?? []) {
    const typedRow = row as {
      fecha_dcto: string;
      empresa_norm: string;
      id_co_norm: string;
      id_tipo: string;
      id_linea1: string;
      id_linea2: string;
      nombre_linea1: string | null;
      nombre_linea2: string | null;
      id_item: string;
      item_descripcion: string | null;
      qty: string | number;
    };
    if (allowedSet.size > 0 && !allowedSet.has("asadero")) continue;
    const split = splitAsaderoQty({
      idTipo: typedRow.id_tipo,
      idLinea1: typedRow.id_linea1,
      idLinea2: typedRow.id_linea2,
      nombreLinea1: typedRow.nombre_linea1 ?? "",
      nombreLinea2: typedRow.nombre_linea2 ?? "",
      idItem: typedRow.id_item,
      itemDescripcion: typedRow.item_descripcion ?? "",
      cantidad: Number(typedRow.qty) || 0,
    });
    if (split.pollosUnd === 0 && split.otherUnd === 0) continue;
    const fecha = formatDate(typedRow.fecha_dcto);
    const sedeName = sedeNameFromRoll(typedRow.id_co_norm, typedRow.empresa_norm);
    const lineMetric = ensureLine(getOrCreateDaily(fecha, sedeName), "asadero");
    lineMetric.asaderoPollosUnd =
      (lineMetric.asaderoPollosUnd ?? 0) + split.pollosUnd;
    lineMetric.asaderoOtherUnd =
      (lineMetric.asaderoOtherUnd ?? 0) + split.otherUnd;
  }

  // No rellenar líneas en 0: el cliente ya completa DEFAULT_LINES y el JSON baja mucho.
  const result: DailyProductivity[] = [];
  for (const dailyData of dailyDataMap.values()) {
    dailyData.lines = dailyData.lines.filter(lineHasActivity);
    if (dailyData.lines.length === 0) continue;
    result.push(dailyData);
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
};

/** Una sola pasada en frío si varios GET llegan sin caché (evita consultas duplicadas). */
let productivityColdInflight: Promise<DailyProductivity[]> | null = null;
const productivityWindowInflight = new Map<
  string,
  Promise<DailyProductivity[]>
>();

const runColdProductivityLoad = (): Promise<DailyProductivity[]> => {
  if (!productivityColdInflight) {
    productivityColdInflight = (async () => {
      const raw = await fetchAllProductivityData([]);
      if (raw.length > 0) {
        writeMemoryProductivityCache(raw);
        await writeProductivityCacheFile(raw);
      }
      return raw;
    })();
    void productivityColdInflight.finally(() => {
      productivityColdInflight = null;
    });
  }
  return productivityColdInflight;
};

const runWindowedProductivityLoad = (
  bounds: ProductivityDateBounds,
): Promise<DailyProductivity[]> => {
  const key = `${bounds.fromIso ?? ""}:${bounds.toIso ?? ""}`;
  const existing = productivityWindowInflight.get(key);
  if (existing) return existing;
  const inflight = fetchAllProductivityData([], bounds);
  productivityWindowInflight.set(key, inflight);
  void inflight.finally(() => {
    productivityWindowInflight.delete(key);
  });
  return inflight;
};

const resolveDateBoundsFromRequest = (
  searchParams: URLSearchParams,
): ProductivityDateBounds => {
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const fromIso = isProductivityIsoDate(fromRaw) ? fromRaw : null;
  const toIso = isProductivityIsoDate(toRaw) ? toRaw : null;
  if (fromIso && toIso && fromIso > toIso) {
    return { fromIso: toIso, toIso: fromIso };
  }
  return { fromIso, toIso };
};

const scopeDailyDataForSession = (
  dailyData: DailyProductivity[],
  allowedLineIds: string[],
  sessionUser: {
    role: "admin" | "user";
    allowedEmpresas?: string[] | null;
  },
  bounds: ProductivityDateBounds,
) =>
  filterProductivityByDateRange(
    filterDailyDataByEmpresaTenant(
      filterDailyDataByAllowedLines(dailyData, allowedLineIds),
      sessionUser,
    ),
    bounds.fromIso,
    bounds.toIso,
  );

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } },
    );
  }
  const withSession = (response: NextResponse) => {
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    }
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };
  const allowedLineIds =
    session.user.role === "admin"
      ? []
      : resolveSessionAllowedLineIds(session.user.allowedLines);
  const allowedDashboards = session.user.allowedDashboards;
  if (
    session.user.role !== "admin" &&
    !canAccessPortalSection(allowedDashboards, "producto")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }
  const limitedUntil = checkRateLimit(request);
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta más tarde." },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
            "Cache-Control": NO_STORE_CACHE_CONTROL,
          },
        },
      ),
    );
  }

  const refreshParams = new URL(request.url).searchParams;
  const forceRefresh =
    refreshParams.get("refresh") === "1" || refreshParams.get("force") === "1";
  const bounds = resolveDateBoundsFromRequest(refreshParams);
  const hasWindow = Boolean(bounds.fromIso || bounds.toIso);

  if (!forceRefresh) {
    const memoryCached = readMemoryProductivityCache();
    if (memoryCached) {
      const scoped = scopeDailyDataForSession(
        memoryCached,
        allowedLineIds,
        session.user,
        bounds,
      );
      return withSession(buildDataResponse(scoped, "memory"));
    }

    const cachedFile = await readCache();
    if (
      cachedFile &&
      shouldServeProductivityFileCache(cachedFile.updatedAt, forceRefresh)
    ) {
      writeMemoryProductivityCache(cachedFile.dailyData);
      const scopedCached = scopeDailyDataForSession(
        cachedFile.dailyData,
        allowedLineIds,
        session.user,
        bounds,
      );
      return withSession(buildDataResponse(scopedCached, "cache"));
    }
  }

  try {
    // Primera carga con ventana: consulta acotada en paralelo.
    // El rebuild completo se dispara solo cuando el cliente pide histórico
    // (sin from/to) o ?refresh=1 — evita saturar la BD en el cold start.
    if (hasWindow && !forceRefresh) {
      const windowed = await runWindowedProductivityLoad(bounds);
      const dailyData = scopeDailyDataForSession(
        windowed,
        allowedLineIds,
        session.user,
        { fromIso: null, toIso: null },
      );
      return withSession(buildDataResponse(dailyData, "database-window"));
    }

    await testDbConnection();
    const rawDaily = await runColdProductivityLoad();
    const dailyData = scopeDailyDataForSession(
      rawDaily,
      allowedLineIds,
      session.user,
      bounds,
    );
    if (dailyData.length > 0 || rawDaily.length > 0) {
      return withSession(buildDataResponse(dailyData, "database"));
    }
    const emptyRes = NextResponse.json(
      {
        dailyData: [],
        sedes: [],
        message: "Conexión a base de datos establecida. Sin datos aún.",
      },
      {
        headers: {
          "Cache-Control": NO_STORE_CACHE_CONTROL,
          "X-Data-Source": "database",
        },
      },
    );
    return withSession(emptyRes);
  } catch (error) {
    console.error("Error en endpoint de productividad:", error);
    return withSession(
      buildFallbackResponse(
        "Error de conexión: " +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
  }
}
