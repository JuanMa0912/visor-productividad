import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool, withPoolClient } from "@/lib/db";
import { normalizeRotationCategoriaKey } from "@/lib/rotacion-dimensions";

/** Unifica codigos N1 para filtros (BD a veces devuelve "1" en vez de "01"). */
const normalizeRotationLineaN1Code = (raw: string | null | undefined): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "__sin_n1__";
  if (t === "__sin_n1__") return t;
  if (/^\d+$/.test(t)) return t.padStart(2, "0");
  return t;
};
import { canAccessPortalSection } from "@/lib/portal-sections";
import {
  canAccessRotacionBoard,
  canEditRotacionAbcdConfig,
} from "@/lib/special-role-features";

type AvailableBoundsRow = {
  min_date: string | null;
  max_date: string | null;
};

type RotationFilterDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
};

type RotationDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  bodega: string | null;
  nombre_bodega: string | null;
  categoria: string | null;
  nombre_categoria: string | null;
  linea01: string | null;
  nombre_linea01: string | null;
  total_sales: string | number | null;
  total_units: string | number | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  rotation: string | number | null;
  tracked_days: number | string | null;
  sales_effective_days: number | string | null;
  last_movement_date: string | null;
  last_purchase_date: string | null;
  effective_days: number | string | null;
  status: "Agotado" | "Futuro agotado" | "Baja rotacion" | "En seguimiento";
};

type RotationRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  linea: string;
  lineaN1Codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  bodega: string | null;
  nombreBodega: string | null;
  categoria: string | null;
  nombreCategoria: string | null;
  linea01: string | null;
  nombreLinea01: string | null;
  totalSales: number;
  totalUnits: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  salesEffectiveDays: number;
  lastMovementDate: string | null;
  lastPurchaseDate: string | null;
  effectiveDays: number | null;
  status: "Agotado" | "Futuro agotado" | "Baja rotacion" | "En seguimiento";
};

type RotationCategoriaOption = {
  categoriaKey: string;
  nombreCategoria: string | null;
};

type RotationCategoriaBundle = {
  categorias: RotationCategoriaOption[];
  lineasN1PorCategoria: Record<string, string[]>;
};

type RotationFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
  lineasN1: string[];
  categorias: RotationCategoriaOption[];
  lineasN1PorCategoria: Record<string, string[]>;
};

type AbcdConfig = {
  aUntilPercent: number;
  bUntilPercent: number;
  cUntilPercent: number;
};

const CACHE_CONTROL = "no-store";
const LOW_ROTATION_DAYS_THRESHOLD = 45;
const ROTATION_META_CACHE_TTL_MS = 5 * 60 * 1000;
/** Ventana hacia atras para el DISTINCT de sedes (catalogo). Corta para no escanear meses de datos ni disparar timeouts en el servidor. */
const ROTATION_CATALOG_LOOKBACK_DAYS = 45;
const ROTATION_ABCD_CACHE_TTL_MS = 5 * 60 * 1000;
const ROTATION_LINEAS_N1_CACHE_TTL_MS = 3 * 60 * 1000;
const ROTACION_CATEGORIA_LINEA_CACHE_TTL_MS = 3 * 60 * 1000;

/** Clave de categoria alineada con normalizeRotationCategoriaKey. */
const SQL_ROTACION_CATEGORIA_KEY = `(
  CASE
    WHEN NULLIF(TRIM(categoria::text), '') IS NULL THEN '__sin_cat__'
    ELSE TRIM(BOTH FROM categoria::text)
  END
)`;
const MAX_ROTATION_RANGE_DAYS = 93;
const FUTURE_STOCKOUT_DAYS = 7;
const HIDDEN_SEDE_KEYS = new Set([
  "adm",
  "cedicavasa",
  "centrodistribucioncavasa",
  "importados",
]);
const DEFAULT_ABCD_CONFIG: AbcdConfig = {
  aUntilPercent: 70,
  bUntilPercent: 85,
  cUntilPercent: 98,
};

let availableBoundsCache:
  | { value: AvailableBoundsRow | null; expiresAt: number }
  | null = null;
let rotationFilterCatalogCache:
  | { rangeKey: string; value: RotationFilterCatalog; expiresAt: number }
  | null = null;
let abcdConfigCache: { value: AbcdConfig; expiresAt: number } | null = null;
const lineasN1ByRangeCache = new Map<
  string,
  { value: string[]; expiresAt: number }
>();
const categoriaBundleByRangeCache = new Map<
  string,
  { value: RotationCategoriaBundle; expiresAt: number }
>();

const isIsoDate = (value: string | null) =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const compactToIsoDate = (value: string | null) => {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const isoToCompactDate = (value: string) => value.replace(/-/g, "");

const shiftDate = (dateKey: string, offsetDays: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** Rango compacto YYYYMMDD para el DISTINCT de sedes: ultimos N dias o desde el minimo de tabla si es mas reciente. */
const computeRotationCatalogCompactRange = (
  tableMinCompact: string | null | undefined,
  maxCompact: string,
): { start: string; end: string } | null => {
  if (!/^\d{8}$/.test(maxCompact)) return null;
  const maxIso = compactToIsoDate(maxCompact);
  if (!maxIso) return null;
  const windowStartIso = shiftDate(maxIso, -ROTATION_CATALOG_LOOKBACK_DAYS);
  const tableMinIso =
    tableMinCompact && /^\d{8}$/.test(tableMinCompact)
      ? compactToIsoDate(tableMinCompact)
      : null;
  const rangeStartIso =
    tableMinIso && tableMinIso > windowStartIso ? tableMinIso : windowStartIso;
  const start = isoToCompactDate(rangeStartIso);
  const end = maxCompact;
  if (start > end) return { start: end, end: end };
  return { start, end };
};

/** Mismo día del mes anterior (p. ej. 14 abr → 14 mar), en ISO local vía UTC slice. */
const shiftCalendarMonths = (dateKey: string, deltaMonths: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setMonth(date.getMonth() + deltaMonths);
  return date.toISOString().slice(0, 10);
};

const clampDateRange = ({
  start,
  end,
  minDate,
  maxDate,
}: {
  start: string;
  end: string;
  minDate: string;
  maxDate: string;
}) => {
  let nextStart = start;
  let nextEnd = end;

  if (nextStart < minDate) nextStart = minDate;
  if (nextStart > maxDate) nextStart = maxDate;
  if (nextEnd < minDate) nextEnd = minDate;
  if (nextEnd > maxDate) nextEnd = maxDate;
  if (nextStart > nextEnd) nextStart = nextEnd;

  return { start: nextStart, end: nextEnd };
};

const limitDateRangeWindow = (range: { start: string; end: string }) => {
  const maxStart = shiftDate(range.end, -(MAX_ROTATION_RANGE_DAYS - 1));
  if (range.start < maxStart) {
    return { start: maxStart, end: range.end };
  }
  return range;
};

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const toOptionalTrimmedString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t ? t : null;
};

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

/** Coincide sede de catalogo con claves permitidas (exacta o por subcadena; nombres en BD suelen traer prefijos). */
const MIN_SUBSTRING_TOKEN_LEN = 5;

const catalogSedeMatchesAllowedKeys = (
  sede: { sedeName: string; sedeId: string },
  allowedKeys: Set<string>,
): boolean => {
  const nameK = normalizeKey(sede.sedeName);
  const idK = normalizeKey(sede.sedeId);
  for (const token of allowedKeys) {
    if (!token) continue;
    if (token === normalizeKey("Todas")) continue;
    if (nameK === token || idK === token) return true;
    if (/^\d+$/.test(token) && /^\d+$/.test(idK)) {
      if (parseInt(token, 10) === parseInt(idK, 10)) return true;
    }
    if (token.length >= MIN_SUBSTRING_TOKEN_LEN) {
      if (nameK.includes(token) || idK.includes(token)) return true;
    }
  }
  return false;
};

const resolveVisibleSedes = (
  sessionUser: {
    role: "admin" | "user";
    sede: string | null;
    allowedSedes?: string[] | null;
  },
  catalog: RotationFilterCatalog,
) => {
  if (sessionUser.role === "admin") {
    return {
      authorized: true,
      visibleSedes: catalog.sedes,
    };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed.map((sede) => normalizeKey(sede)).filter(Boolean),
  );

  if (normalizedAllowed.has(normalizeKey("Todas"))) {
    return {
      authorized: true,
      visibleSedes: catalog.sedes,
    };
  }

  const visibleFromAllowed = catalog.sedes.filter((sede) =>
    catalogSedeMatchesAllowedKeys(sede, normalizedAllowed),
  );

  /** Lista explicita en perfil: siempre autorizado; la lista puede quedar vacia si aun no hay filas en BD para esas sedes. */
  if (rawAllowed.length > 0) {
    return {
      authorized: true,
      visibleSedes: visibleFromAllowed,
    };
  }

  if (sessionUser.sede) {
    const legacyKey = normalizeKey(sessionUser.sede ?? "");
    const legacySet = legacyKey ? new Set([legacyKey]) : new Set<string>();
    const legacyVisible = catalog.sedes.filter((sede) =>
      legacyKey ? catalogSedeMatchesAllowedKeys(sede, legacySet) : false,
    );
    if (legacyVisible.length > 0) {
      return {
        authorized: true,
        visibleSedes: legacyVisible,
      };
    }
  }

  return {
    authorized: false,
    visibleSedes: [] as RotationFilterCatalog["sedes"],
  };
};

const parsePositiveNumber = (value: string | null) => {
  if (!value) return null;
  const normalized = value.replace(/[^\d]/g, "");
  if (!normalized) return null;
  return Number(normalized);
};

const clampSalesThreshold = (value: number | null) => {
  if (value === null) return null;
  return Math.max(0, value);
};

const normalizeAbcdConfig = (
  raw: Partial<AbcdConfig> | null | undefined,
): AbcdConfig => {
  const a = Number(raw?.aUntilPercent ?? DEFAULT_ABCD_CONFIG.aUntilPercent);
  const b = Number(raw?.bUntilPercent ?? DEFAULT_ABCD_CONFIG.bUntilPercent);
  const c = Number(raw?.cUntilPercent ?? DEFAULT_ABCD_CONFIG.cUntilPercent);

  const safeA = Math.max(1, Math.min(100, Number.isFinite(a) ? a : 70));
  const safeB = Math.max(safeA, Math.min(100, Number.isFinite(b) ? b : 85));
  const safeC = Math.max(safeB, Math.min(100, Number.isFinite(c) ? c : 98));

  return {
    aUntilPercent: safeA,
    bUntilPercent: safeB,
    cUntilPercent: safeC,
  };
};

const ensureRotacionAbcdConfigTable = async () => {
  const client = await (await getDbPool()).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rotacion_abcd_config (
        id smallint PRIMARY KEY,
        a_until_percent numeric(5,2) NOT NULL,
        b_until_percent numeric(5,2) NOT NULL,
        c_until_percent numeric(5,2) NOT NULL,
        updated_by text NULL,
        updated_at timestamp without time zone NOT NULL DEFAULT NOW()
      )
    `);
  } finally {
    client.release();
  }
};

const getRotacionAbcdConfig = async (): Promise<AbcdConfig> => {
  const now = Date.now();
  if (abcdConfigCache && abcdConfigCache.expiresAt > now) {
    return abcdConfigCache.value;
  }

  try {
    await ensureRotacionAbcdConfigTable();
  } catch {
    return DEFAULT_ABCD_CONFIG;
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        a_until_percent,
        b_until_percent,
        c_until_percent
      FROM rotacion_abcd_config
      WHERE id = 1
      LIMIT 1
      `,
    );
    const row = result.rows?.[0] as
      | {
          a_until_percent?: string | number | null;
          b_until_percent?: string | number | null;
          c_until_percent?: string | number | null;
        }
      | undefined;

    if (!row) {
      abcdConfigCache = {
        value: DEFAULT_ABCD_CONFIG,
        expiresAt: now + ROTATION_ABCD_CACHE_TTL_MS,
      };
      return DEFAULT_ABCD_CONFIG;
    }
    const normalized = normalizeAbcdConfig({
      aUntilPercent:
        row.a_until_percent == null ? undefined : Number(row.a_until_percent),
      bUntilPercent:
        row.b_until_percent == null ? undefined : Number(row.b_until_percent),
      cUntilPercent:
        row.c_until_percent == null ? undefined : Number(row.c_until_percent),
    });
    abcdConfigCache = {
      value: normalized,
      expiresAt: now + ROTATION_ABCD_CACHE_TTL_MS,
    };
    return normalized;
  } finally {
    client.release();
  }
};

const saveRotacionAbcdConfig = async (
  config: AbcdConfig,
  updatedBy: string,
): Promise<AbcdConfig> => {
  await ensureRotacionAbcdConfigTable();
  const normalized = normalizeAbcdConfig(config);
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      INSERT INTO rotacion_abcd_config (
        id,
        a_until_percent,
        b_until_percent,
        c_until_percent,
        updated_by,
        updated_at
      )
      VALUES (1, $1, $2, $3, $4, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        a_until_percent = EXCLUDED.a_until_percent,
        b_until_percent = EXCLUDED.b_until_percent,
        c_until_percent = EXCLUDED.c_until_percent,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [
        normalized.aUntilPercent,
        normalized.bUntilPercent,
        normalized.cUntilPercent,
        updatedBy,
      ],
    );
    abcdConfigCache = {
      value: normalized,
      expiresAt: Date.now() + ROTATION_ABCD_CACHE_TTL_MS,
    };
    return normalized;
  } finally {
    client.release();
  }
};

const getAvailableBounds = async () => {
  const now = Date.now();
  if (availableBoundsCache && availableBoundsCache.expiresAt > now) {
    return availableBoundsCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        MIN(fecha_consulta) AS min_date,
        MAX(fecha_consulta) AS max_date
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta ~ '^[0-9]{8}$'
      `,
    );
    const value = (result.rows?.[0] as AvailableBoundsRow | undefined) ?? null;
    availableBoundsCache = {
      value,
      expiresAt: now + ROTATION_META_CACHE_TTL_MS,
    };
    return value;
  } finally {
    client.release();
  }
};

const mapRotationCatalogRows = (
  rows: RotationFilterDbRow[],
): RotationFilterCatalog => {
  const sedes = rows
    .map((row) => ({
      empresa: row.empresa,
      sedeId: row.sede_id,
      sedeName: row.sede_name,
    }))
    .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));
  const companies = Array.from(new Set(sedes.map((row) => row.empresa))).sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  return {
    companies,
    sedes,
    lineasN1: [],
    categorias: [],
    lineasN1PorCategoria: {},
  };
};

const getRotationFilterCatalog = async (
  startDateCompact: string,
  endDateCompact: string,
): Promise<RotationFilterCatalog> => {
  const now = Date.now();
  const rangeKey = `${startDateCompact}|${endDateCompact}`;
  const snapKey = `snap|${endDateCompact}`;
  if (rotationFilterCatalogCache && rotationFilterCatalogCache.expiresAt > now) {
    if (
      rotationFilterCatalogCache.rangeKey === rangeKey ||
      rotationFilterCatalogCache.rangeKey === snapKey
    ) {
      return rotationFilterCatalogCache.value;
    }
  }

  const client = await (await getDbPool()).connect();
  try {
    const rangeSql = `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
        COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta BETWEEN $1 AND $2
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
    `;
    const snapSql = `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
        COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta = $1
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
    `;

    let result: { rows?: RotationFilterDbRow[] };
    let cacheKey = rangeKey;

    try {
      result = await client.query(rangeSql, [startDateCompact, endDateCompact]);
    } catch (rangeErr) {
      console.warn(
        "[rotacion] catalogo por rango fallo (timeout o carga); usando solo ultimo dia:",
        rangeErr instanceof Error ? rangeErr.message : rangeErr,
      );
      result = await client.query(snapSql, [endDateCompact]);
      cacheKey = snapKey;
    }

    const value = mapRotationCatalogRows(
      (result.rows ?? []) as RotationFilterDbRow[],
    );

    rotationFilterCatalogCache = {
      rangeKey: cacheKey,
      value,
      expiresAt: now + ROTATION_META_CACHE_TTL_MS,
    };

    return value;
  } finally {
    client.release();
  }
};

const queryRotationLineasN1 = async ({
  startDate,
  endDate,
  empresa,
  sedeId,
}: {
  startDate: string;
  endDate: string;
  empresa: string | null;
  sedeId: string;
}) => {
  const cacheKey = `${startDate}|${endDate}|${empresa ?? "*"}|${sedeId}`;
  const now = Date.now();
  const cached = lineasN1ByRangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await withPoolClient(async (client) => {
    const result = await client.query(
      `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__') AS linea_n1_codigo
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta BETWEEN $1 AND $2
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
        AND COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $3
        AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $4)
      ORDER BY linea_n1_codigo ASC
      `,
      [isoToCompactDate(startDate), isoToCompactDate(endDate), sedeId, empresa],
    );

    const raw = ((result.rows ?? []) as Array<{ linea_n1_codigo: string | null }>)
      .map((row) => normalizeRotationLineaN1Code(row.linea_n1_codigo))
      .filter((code) => Boolean(code));
    return Array.from(new Set(raw)).sort((a, b) => a.localeCompare(b, "es"));
  });

  if (value.length > 0) {
    if (lineasN1ByRangeCache.size > 500) {
      lineasN1ByRangeCache.clear();
    }
    lineasN1ByRangeCache.set(cacheKey, {
      value,
      expiresAt: now + ROTATION_LINEAS_N1_CACHE_TTL_MS,
    });
  }
  return value;
};

const queryRotationCategoriaBundle = async ({
  startDate,
  endDate,
  empresa,
  sedeId,
}: {
  startDate: string;
  endDate: string;
  empresa: string | null;
  sedeId: string;
}): Promise<RotationCategoriaBundle> => {
  const cacheKey = `catbundle|${startDate}|${endDate}|${empresa ?? "*"}|${sedeId}`;
  const now = Date.now();
  const cached = categoriaBundleByRangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await withPoolClient(async (client) => {
    const result = await client.query(
      `
      SELECT DISTINCT
        ${SQL_ROTACION_CATEGORIA_KEY} AS categoria_key,
        NULLIF(TRIM(nombre_categoria::text), '') AS nombre_categoria,
        COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__') AS linea_n1_raw
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta BETWEEN $1 AND $2
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
        AND COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $3
        AND ($4::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $4)
      `,
      [isoToCompactDate(startDate), isoToCompactDate(endDate), sedeId, empresa],
    );

    const n1ByCat = new Map<string, Set<string>>();
    const nombreByCat = new Map<string, string | null>();

    for (const raw of (result.rows ?? []) as Array<{
      categoria_key: string;
      nombre_categoria: string | null;
      linea_n1_raw: string | null;
    }>) {
      const ck = normalizeRotationCategoriaKey(raw.categoria_key);
      const n1 = normalizeRotationLineaN1Code(raw.linea_n1_raw);
      if (!n1ByCat.has(ck)) n1ByCat.set(ck, new Set());
      n1ByCat.get(ck)!.add(n1);
      const name = toOptionalTrimmedString(raw.nombre_categoria);
      const prev = nombreByCat.get(ck);
      if (name && (!prev || name.length > prev.length)) {
        nombreByCat.set(ck, name);
      } else if (prev === undefined) {
        nombreByCat.set(ck, name);
      }
    }

    const categorias: RotationCategoriaOption[] = Array.from(n1ByCat.keys()).map(
      (categoriaKey) => ({
        categoriaKey,
        nombreCategoria: nombreByCat.get(categoriaKey) ?? null,
      }),
    );
    categorias.sort((a, b) => {
      const la = a.nombreCategoria ?? a.categoriaKey;
      const lb = b.nombreCategoria ?? b.categoriaKey;
      const byName = la.localeCompare(lb, "es", { sensitivity: "base", numeric: true });
      if (byName !== 0) return byName;
      return a.categoriaKey.localeCompare(b.categoriaKey, "es");
    });

    const lineasN1PorCategoria: Record<string, string[]> = {};
    for (const [ck, set] of n1ByCat) {
      lineasN1PorCategoria[ck] = Array.from(set).sort((a, b) =>
        a.localeCompare(b, "es"),
      );
    }

    return { categorias, lineasN1PorCategoria };
  });

  if (categoriaBundleByRangeCache.size > 500) {
    categoriaBundleByRangeCache.clear();
  }
  categoriaBundleByRangeCache.set(cacheKey, {
    value,
    expiresAt: now + ROTACION_CATEGORIA_LINEA_CACHE_TTL_MS,
  });
  return value;
};

const isPgConnectionFailure = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /connection terminated unexpectedly/i.test(msg) ||
    /ECONNRESET|EPIPE|ETIMEDOUT/i.test(msg)
  );
};

const queryRotationRows = async ({
  startDate,
  endDate,
  maxSalesValue,
  empresa,
  sedeId,
  lineasN1,
  categoriaKeys,
}: {
  startDate: string;
  endDate: string;
  maxSalesValue: number | null;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  categoriaKeys: string[] | null;
}): Promise<RotationRow[]> => {
  const fetchRows = async (): Promise<RotationRow[]> =>
    withPoolClient(async (client) => {
      const result = await client.query(
      `
      WITH scoped AS (
        SELECT
          COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
          COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
          COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name,
          COALESCE(NULLIF(TRIM(linea), ''), 'Sin linea') AS linea,
          NULLIF(TRIM(linea_n1_codigo), '') AS linea_n1_codigo,
          COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
          COALESCE(NULLIF(TRIM(descripcion), ''), COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')) AS descripcion,
          NULLIF(TRIM(unidad), '') AS unidad,
          COALESCE(venta_sin_impuesto, 0) AS venta_sin_impuesto,
          COALESCE(unidades_vendidas, 0) AS unidades_vendidas,
          GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0) AS inventory_units,
          GREATEST(COALESCE(valor_inventario, 0), 0) AS inventory_value,
          TO_DATE(fecha_consulta, 'YYYYMMDD') AS consulta_date,
          CASE
            WHEN fecha_ultima_compra ~ '^[0-9]{8}$'
              AND TO_DATE(fecha_ultima_compra, 'YYYYMMDD')
                BETWEEN TO_DATE($1::text, 'YYYYMMDD') AND TO_DATE($2::text, 'YYYYMMDD')
            THEN TO_DATE(fecha_ultima_compra, 'YYYYMMDD')
            ELSE NULL
          END AS last_movement_date,
          CASE
            WHEN fecha_ultima_compra ~ '^[0-9]{8}$'
            THEN TO_DATE(fecha_ultima_compra, 'YYYYMMDD')
            ELSE NULL
          END AS last_purchase_date,
          NULLIF(TRIM(COALESCE(bodega::text, '')), '') AS bodega,
          NULLIF(TRIM(COALESCE(nombre_bodega::text, '')), '') AS nombre_bodega,
          NULLIF(TRIM(COALESCE(categoria::text, '')), '') AS categoria,
          NULLIF(TRIM(COALESCE(nombre_categoria::text, '')), '') AS nombre_categoria,
          NULLIF(TRIM(COALESCE(linea01::text, '')), '') AS linea01,
          NULLIF(TRIM(COALESCE(nombre_linea01::text, '')), '') AS nombre_linea01,
          fecha_carga
        FROM rotacion_base_item_dia_sede
        WHERE fecha_consulta BETWEEN $1 AND $2
          AND fecha_consulta ~ '^[0-9]{8}$'
          AND item IS NOT NULL
          AND ($5::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $5)
          AND ($6::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $6)
          AND ($7::text[] IS NULL OR COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__') = ANY($7::text[]))
          AND ($10::text[] IS NULL OR ${SQL_ROTACION_CATEGORIA_KEY} = ANY($10::text[]))
      ),
      ranked AS (
        SELECT
          *,
          MAX(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS latest_consulta_date,
          ROW_NUMBER() OVER (
            PARTITION BY empresa, sede_id, item
            ORDER BY consulta_date DESC, fecha_carga DESC
          ) AS latest_rank
        FROM scoped
      ),
      aggregated AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          SUM(venta_sin_impuesto)::numeric AS total_sales,
          SUM(unidades_vendidas)::numeric AS total_units,
          MAX(last_movement_date) AS last_movement_date,
          MAX(CASE WHEN latest_rank = 1 THEN last_purchase_date END) AS last_purchase_date,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_units
              ELSE 0
            END
          )::numeric AS inventory_units,
          SUM(
            CASE
              WHEN consulta_date = latest_consulta_date THEN inventory_value
              ELSE 0
            END
          )::numeric AS inventory_value,
          MAX(CASE WHEN latest_rank = 1 THEN bodega END) AS bodega,
          MAX(CASE WHEN latest_rank = 1 THEN nombre_bodega END) AS nombre_bodega,
          MAX(CASE WHEN latest_rank = 1 THEN categoria END) AS categoria,
          MAX(CASE WHEN latest_rank = 1 THEN nombre_categoria END) AS nombre_categoria,
          MAX(CASE WHEN latest_rank = 1 THEN linea01 END) AS linea01,
          MAX(CASE WHEN latest_rank = 1 THEN nombre_linea01 END) AS nombre_linea01,
          COUNT(*)::int AS tracked_days,
          SUM(CASE WHEN unidades_vendidas > 0 THEN 1 ELSE 0 END)::int AS sales_effective_days
        FROM ranked
        GROUP BY
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      ),
      enriched AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          bodega,
          nombre_bodega,
          categoria,
          nombre_categoria,
          linea01,
          nombre_linea01,
          total_sales,
          total_units,
          COALESCE(inventory_units, 0) AS inventory_units,
          COALESCE(inventory_value, 0) AS inventory_value,
          tracked_days,
          sales_effective_days,
          last_movement_date,
          last_purchase_date,
          CASE
            WHEN COALESCE(inventory_units, 0) <= 0 OR COALESCE(inventory_value, 0) <= 0 THEN 0::numeric
            WHEN COALESCE(total_units, 0) <= 0 OR COALESCE(tracked_days, 0) <= 0 THEN 999999::numeric
            ELSE (COALESCE(inventory_units, 0) * tracked_days::numeric) / NULLIF(total_units, 0)
          END AS rotation,
          CASE
            WHEN last_movement_date IS NULL THEN NULL
            ELSE ($3::date - last_movement_date)
          END::int AS effective_days
        FROM aggregated
        WHERE $4::numeric IS NULL OR total_sales <= $4::numeric
      ),
      classified AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          bodega,
          nombre_bodega,
          categoria,
          nombre_categoria,
          linea01,
          nombre_linea01,
          total_sales,
          total_units,
          inventory_units,
          inventory_value,
          rotation,
          tracked_days,
          sales_effective_days,
          last_movement_date,
          last_purchase_date,
          effective_days,
          CASE
            WHEN inventory_units <= 0 OR inventory_value <= 0 THEN 'Agotado'
            WHEN total_units > 0
              AND tracked_days > 0
              AND inventory_units > 0
              AND inventory_units <= ((total_units / tracked_days) * $8::numeric)
              THEN 'Futuro agotado'
            WHEN COALESCE(rotation, 0) > $9 THEN 'Baja rotacion'
            ELSE 'En seguimiento'
          END AS status
        FROM enriched
      )
      SELECT
        empresa,
        sede_id,
        sede_name,
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad,
        bodega,
        nombre_bodega,
        categoria,
        nombre_categoria,
        linea01,
        nombre_linea01,
        total_sales,
        total_units,
        inventory_units,
        inventory_value,
        rotation,
        tracked_days,
        sales_effective_days,
        TO_CHAR(last_movement_date, 'YYYY-MM-DD') AS last_movement_date,
        TO_CHAR(last_purchase_date, 'YYYY-MM-DD') AS last_purchase_date,
        effective_days,
        status
      FROM classified
      ORDER BY
        empresa ASC,
        sede_name ASC,
        total_sales DESC,
        inventory_value DESC,
        item ASC
      `,
      [
        isoToCompactDate(startDate),
        isoToCompactDate(endDate),
        endDate,
        maxSalesValue,
        empresa,
        sedeId,
        lineasN1,
        FUTURE_STOCKOUT_DAYS,
        LOW_ROTATION_DAYS_THRESHOLD,
        categoriaKeys,
      ],
    );

    return ((result.rows ?? []) as RotationDbRow[])
      .map((row) => ({
        empresa: row.empresa,
        sedeId: row.sede_id,
        sedeName: row.sede_name,
        linea: row.linea,
        lineaN1Codigo: row.linea_n1_codigo,
        item: row.item,
        descripcion: row.descripcion,
        unidad: row.unidad,
        bodega: toOptionalTrimmedString(row.bodega),
        nombreBodega: toOptionalTrimmedString(row.nombre_bodega),
        categoria: toOptionalTrimmedString(row.categoria),
        nombreCategoria: toOptionalTrimmedString(row.nombre_categoria),
        linea01: toOptionalTrimmedString(row.linea01),
        nombreLinea01: toOptionalTrimmedString(row.nombre_linea01),
        totalSales: toNumber(row.total_sales),
        totalUnits: toNumber(row.total_units),
        inventoryUnits: toNumber(row.inventory_units),
        inventoryValue: toNumber(row.inventory_value),
        rotation: toNumber(row.rotation),
        trackedDays: toNumber(row.tracked_days),
        salesEffectiveDays: toNumber(row.sales_effective_days),
        lastMovementDate: row.last_movement_date,
        lastPurchaseDate: row.last_purchase_date,
        effectiveDays:
          row.effective_days === null || row.effective_days === undefined
            ? null
            : toNumber(row.effective_days),
        status: row.status,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));
    });

  try {
    return await fetchRows();
  } catch (first) {
    if (!isPgConnectionFailure(first)) throw first;
    return await fetchRows();
  }
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  if (
    session.user.role !== "admin" &&
    !canAccessPortalSection(session.user.allowedDashboards, "producto")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  if (!canAccessRotacionBoard(session.user.specialRoles, session.user.role === "admin")) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para ver rotacion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    const bounds = await getAvailableBounds();
    const abcdConfig = await getRotacionAbcdConfig();
    const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
    const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);

    if (!minAvailableDate || !maxAvailableDate) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            stats: {
              evaluatedSedes: 0,
              visibleItems: 0,
              withoutMovement: 0,
            },
            filters: {
              companies: [],
              sedes: [],
              lineasN1: [],
              categorias: [],
              lineasN1PorCategoria: {},
            },
            meta: {
              effectiveRange: { start: "", end: "" },
              availableRange: { min: "", max: "" },
              sourceTable: "rotacion_base_item_dia_sede",
              maxSalesValue: null,
              abcdConfig,
            },
            message: "La tabla de rotacion no tiene datos disponibles.",
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const url = new URL(request.url);
    const requestedStart = url.searchParams.get("start");
    const requestedEnd = url.searchParams.get("end");
    const requestedCompany = url.searchParams.get("empresa")?.trim() || null;
    const requestedSedeId = url.searchParams.get("sede")?.trim() || null;
    const requestedLineasN1 = url.searchParams
      .getAll("lineasN1")
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedCategoriaKeys = url.searchParams
      .getAll("categoria")
      .map((value) => value.trim())
      .filter(Boolean);
    const isCatalogOnly = url.searchParams.get("catalogOnly") === "1";
    const maxSalesValue = clampSalesThreshold(
      parsePositiveNumber(url.searchParams.get("maxSalesValue")),
    );

    const rawEndDate = isIsoDate(requestedEnd) ? requestedEnd! : maxAvailableDate;
    const rawStartDate = isIsoDate(requestedStart)
      ? requestedStart!
      : shiftDate(shiftCalendarMonths(rawEndDate, -1), 1);

    const effectiveRange = clampDateRange({
      start: rawStartDate,
      end: rawEndDate,
      minDate: minAvailableDate,
      maxDate: maxAvailableDate,
    });
    const boundedRange = limitDateRangeWindow(effectiveRange);
    const filterCatalogMaxDate = bounds?.max_date ?? isoToCompactDate(maxAvailableDate);
    const catalogRange = computeRotationCatalogCompactRange(
      bounds?.min_date,
      filterCatalogMaxDate,
    );
    const fullCatalog = catalogRange
      ? await getRotationFilterCatalog(catalogRange.start, catalogRange.end)
      : {
          companies: [] as string[],
          sedes: [] as RotationFilterCatalog["sedes"],
          lineasN1: [] as string[],
          categorias: [] as RotationCategoriaOption[],
          lineasN1PorCategoria: {} as Record<string, string[]>,
        };
    const sedeAccess = resolveVisibleSedes(session.user, fullCatalog);

    if (!sedeAccess.authorized) {
      return withSession(
        NextResponse.json(
          { error: "No tienes sedes autorizadas para esta seccion." },
          { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const visibleSedes = sedeAccess.visibleSedes;
    const visibleCompanies = Array.from(
      new Set(visibleSedes.map((sede) => sede.empresa)),
    ).sort((a, b) => a.localeCompare(b, "es"));
    const filters: RotationFilterCatalog = {
      companies: visibleCompanies,
      sedes: visibleSedes,
      lineasN1: [],
      categorias: [],
      lineasN1PorCategoria: {},
    };
    const requestedVisibleSede =
      requestedSedeId === null
        ? null
        : (visibleSedes.find(
            (sede) =>
              sede.sedeId === requestedSedeId &&
              (!requestedCompany || sede.empresa === requestedCompany),
          ) ?? null);

    if (requestedSedeId && !requestedVisibleSede) {
      return withSession(
        NextResponse.json(
          { error: "La sede solicitada no esta autorizada." },
          { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const effectiveCompany = requestedVisibleSede?.empresa ?? requestedCompany;
    const lineasN1 = requestedVisibleSede
      ? await queryRotationLineasN1({
          startDate: boundedRange.start,
          endDate: boundedRange.end,
          empresa: effectiveCompany,
          sedeId: requestedVisibleSede.sedeId,
        })
      : [];
    filters.lineasN1 = lineasN1;

    const categoriaBundle = requestedVisibleSede
      ? await queryRotationCategoriaBundle({
          startDate: boundedRange.start,
          endDate: boundedRange.end,
          empresa: effectiveCompany,
          sedeId: requestedVisibleSede.sedeId,
        })
      : { categorias: [] as RotationCategoriaOption[], lineasN1PorCategoria: {} };
    filters.categorias = categoriaBundle.categorias;
    filters.lineasN1PorCategoria = categoriaBundle.lineasN1PorCategoria;

    if (!requestedSedeId) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            stats: {
              evaluatedSedes: 0,
              visibleItems: 0,
              withoutMovement: 0,
            },
            filters,
            meta: {
              effectiveRange: boundedRange,
              availableRange: {
                min: minAvailableDate,
                max: maxAvailableDate,
              },
              sourceTable: "rotacion_base_item_dia_sede",
              maxSalesValue,
              abcdConfig,
            },
            message: "Selecciona una sede para consultar la rotacion.",
          },
          {
            headers: {
              "Cache-Control": CACHE_CONTROL,
              "X-Data-Source": "database",
            },
          },
        ),
      );
    }

    if (isCatalogOnly) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            stats: {
              evaluatedSedes: 0,
              visibleItems: 0,
              withoutMovement: 0,
            },
            filters,
            meta: {
              effectiveRange: boundedRange,
              availableRange: {
                min: minAvailableDate,
                max: maxAvailableDate,
              },
              sourceTable: "rotacion_base_item_dia_sede",
              maxSalesValue,
              abcdConfig,
            },
            message: "Catalogo de lineas N1 actualizado.",
          },
          {
            headers: {
              "Cache-Control": CACHE_CONTROL,
              "X-Data-Source": "database",
            },
          },
        ),
      );
    }

    const catalogCategoriaKeySet = new Set(
      categoriaBundle.categorias.map((c) => c.categoriaKey),
    );
    const validatedCategoriaKeys = requestedCategoriaKeys.filter((k) =>
      catalogCategoriaKeySet.has(k),
    );
    const isFullCategoriaSelection =
      categoriaBundle.categorias.length > 0 &&
      validatedCategoriaKeys.length === categoriaBundle.categorias.length &&
      categoriaBundle.categorias.every((c) =>
        validatedCategoriaKeys.includes(c.categoriaKey),
      );
    const categoriaKeysForQuery =
      validatedCategoriaKeys.length === 0 || isFullCategoriaSelection
        ? null
        : validatedCategoriaKeys;

    const rows = await queryRotationRows({
      startDate: boundedRange.start,
      endDate: boundedRange.end,
      maxSalesValue,
      empresa: effectiveCompany,
      sedeId: requestedVisibleSede?.sedeId ?? null,
      lineasN1: requestedLineasN1.length > 0 ? requestedLineasN1 : null,
      categoriaKeys: categoriaKeysForQuery,
    });

    const stats = {
      evaluatedSedes: new Set(rows.map((row) => row.sedeName)).size,
      visibleItems: rows.length,
      withoutMovement: rows.filter((row) => row.status === "Agotado").length,
    };

    return withSession(
      NextResponse.json(
        {
          rows,
          stats,
          filters,
          meta: {
            effectiveRange: boundedRange,
            availableRange: {
              min: minAvailableDate,
              max: maxAvailableDate,
            },
            sourceTable: "rotacion_base_item_dia_sede",
            maxSalesValue,
            abcdConfig,
          },
        },
        {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "database",
          },
        },
      ),
    );
  } catch (error) {
    console.error("Error en endpoint de rotacion:", error);
    return withSession(
      NextResponse.json(
        {
          rows: [],
          stats: {
            evaluatedSedes: 0,
            visibleItems: 0,
            withoutMovement: 0,
          },
          filters: {
            companies: [],
            sedes: [],
            lineasN1: [],
            categorias: [],
            lineasN1PorCategoria: {},
          },
          meta: {
            effectiveRange: { start: "", end: "" },
            availableRange: { min: "", max: "" },
            sourceTable: "rotacion_base_item_dia_sede",
            maxSalesValue: null,
            abcdConfig: DEFAULT_ABCD_CONFIG,
          },
          error: "No fue posible consultar la rotacion en este momento.",
        },
        {
          status: 500,
          headers: { "Cache-Control": CACHE_CONTROL },
        },
      ),
    );
  }
}

export async function PUT(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  if (
    !canEditRotacionAbcdConfig(
      session.user.specialRoles,
      session.user.role === "admin",
    )
  ) {
    return withSession(
      NextResponse.json(
        {
          error:
            "No tienes permiso para actualizar esta configuracion (rol ABCD o administrador).",
        },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    const body = (await request.json()) as Partial<AbcdConfig> | null;
    const config = normalizeAbcdConfig(body);
    const updated = await saveRotacionAbcdConfig(
      config,
      session.user.username ?? "admin",
    );
    return withSession(
      NextResponse.json(
        {
          ok: true,
          config: updated,
        },
        {
          headers: { "Cache-Control": CACHE_CONTROL },
        },
      ),
    );
  } catch {
    return withSession(
      NextResponse.json(
        { error: "No fue posible guardar la configuracion ABCD." },
        { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
}
