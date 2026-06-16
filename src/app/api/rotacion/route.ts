import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool, withPoolClient } from "@/lib/db";
import {
  resolveRotacionBaseSqlFields,
  type RotacionBaseDateColumn,
  type RotacionBaseQueryClient,
  type RotacionBaseSqlFields,
} from "@/lib/rotacion/base-fields";
import { getRotacionSourceTable } from "@/lib/rotacion/source-context";
import { ROTACION_SOURCE_V4 } from "@/lib/rotacion/source-tables";
import { normalizeRotationCategoriaKey } from "@/lib/rotacion/dimensions";

/** Unifica codigos N1 para filtros (BD a veces devuelve "1" en vez de "01"). */
const normalizeRotationLineaN1Code = (raw: string | null | undefined): string => {
  const t = String(raw ?? "").trim();
  if (!t) return "__sin_n1__";
  if (t === "__sin_n1__") return t;
  if (/^\d+$/.test(t)) return t.padStart(2, "0");
  return t;
};
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  canAccessRotacionBoard,
  canAccessRotacionV4Board,
  canEditRotacionAbcdConfig,
} from "@/lib/shared/special-role-features";
import { mapRawSedeToCanonical } from "@/lib/horarios/planilla-sede";
import {
  SEDE_ORDER,
  SEDE_ORDER_INDEX_MAP,
  stripSedeLabelPrefixes,
} from "@/lib/shared/constants";
import { normalizeKeyCompact } from "@/lib/shared/normalize";

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
  total_cost: string | number | null;
  total_margin: string | number | null;
  margin_daily_avg_pct: string | number | null;
  total_units: string | number | null;
  opening_inventory_units: string | number | null;
  min_inventory_units: string | number | null;
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
  totalCost: number;
  totalMargin: number;
  marginDailyAvgPct: number;
  totalUnits: number;
  openingInventoryUnits: number;
  minInventoryUnits: number;
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

export type RotationFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
  lineasN1: string[];
  /** Nombre legible por codigo N1 normalizado (misma clave que en filtros). */
  lineasN1Nombres: Record<string, string>;
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

/**
 * Vista materializada pre-procesada de `rotacion_base_item_dia_sede`. Vive en
 * la BD (creada por `db/migrations/20260616_rotacion_clean_matview.sql`) y se
 * refresca diariamente via `visor-refresh-rotacion.timer`. Si la matview
 * existe, `queryRotationRows` usa el camino simplificado contra ella; si no,
 * cae al query original sobre la tabla cruda. Detectarla cada vez seria caro:
 * cacheamos el probe por 5 min.
 */
const ROTACION_CLEAN_MATVIEW_NAME = "rotacion_item_dia_clean";
const ROTACION_CLEAN_MATVIEW_PROBE_CACHE_TTL_MS = 5 * 60 * 1000;
let rotacionCleanMatViewProbeCache:
  | { exists: boolean; expiresAt: number }
  | null = null;

/** Ventana hacia atras para el DISTINCT de sedes (catalogo). Corta para no escanear meses de datos ni disparar timeouts en el servidor. */
const ROTATION_CATALOG_LOOKBACK_DAYS = 45;
const ROTATION_ABCD_CACHE_TTL_MS = 5 * 60 * 1000;
const ROTATION_LINEAS_N1_CACHE_TTL_MS = 3 * 60 * 1000;
const ROTACION_CATEGORIA_LINEA_CACHE_TTL_MS = 3 * 60 * 1000;

const MAX_ROTATION_RANGE_DAYS = 93;
const FUTURE_STOCKOUT_DAYS = 7;
const HIDDEN_SEDE_KEYS = new Set([
  "adm",
  "cedicavasa",
  "centrodistribucioncavasa",
  "importados",
  // Sedes operativas de Mercamio que NO deben aparecer en el filtro de
  // rotacion (CEI, IMP, PPT). Se incluyen tanto la forma corta como la
  // que trae el prefijo "Mercamio " porque en algunos feeds la BD guarda
  // el nombre completo (ej. "Mercamio CEI") y en otros la version
  // canonica corta. Ambas se normalizan a la misma clave alfanumerica.
  "cei",
  "imp",
  "ppt",
  "mercamiocei",
  "mercamioimp",
  "mercamioppt",
]);

/**
 * Filtro SQL equivalente a `HIDDEN_SEDE_KEYS` (sedes administrativas / centros de
 * distribucion que nunca se muestran). Aplicarlo en el WHERE evita procesar y
 * transferir filas que despues se descartan en Node, ademas de aligerar window
 * functions y agregaciones.
 *
 * Recibe la expresion textual que produce `sedeNameExpr` (ya viene COALESCE'd y
 * casteada). El `.filter()` posterior en JS se conserva como red de seguridad.
 */
const buildHiddenSedeWhereClause = (sedeNameExpr: string) =>
  `LOWER(REGEXP_REPLACE(
    TRANSLATE(
      ${sedeNameExpr},
      'áéíóúÁÉÍÓÚñÑ',
      'aeiouAEIOUnN'
    ),
    '[^a-zA-Z0-9]+',
    '',
    'g'
  )) NOT IN (
    'adm',
    'cedicavasa',
    'centrodistribucioncavasa',
    'importados',
    'cei',
    'imp',
    'ppt',
    'mercamiocei',
    'mercamioimp',
    'mercamioppt'
  )`;
const DEFAULT_ABCD_CONFIG: AbcdConfig = {
  aUntilPercent: 70,
  bUntilPercent: 85,
  cUntilPercent: 98,
};

const availableBoundsCache = new Map<
  string,
  { value: AvailableBoundsRow | null; expiresAt: number }
>();
const rotationFilterCatalogCache = new Map<
  string,
  { rangeKey: string; value: RotationFilterCatalog; expiresAt: number }
>();
let abcdConfigCache: { value: AbcdConfig; expiresAt: number } | null = null;
const abcdConfigBySedeCache = new Map<
  string,
  { value: AbcdConfig; expiresAt: number }
>();
type RotationLineasN1Slice = {
  codes: string[];
  nombres: Record<string, string>;
};

const lineasN1ByRangeCache = new Map<
  string,
  { value: RotationLineasN1Slice; expiresAt: number }
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

const pickLongerTrimmedName = (
  left: string | null | undefined,
  right: string | null | undefined,
): string | null => {
  const a = toOptionalTrimmedString(left);
  const b = toOptionalTrimmedString(right);
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
};

const mergeLineaN1NombreRecords = (
  base: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> => {
  const out = { ...base };
  for (const [code, name] of Object.entries(incoming)) {
    const prev = out[code];
    if (!prev || name.length > prev.length) out[code] = name;
  }
  return out;
};

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

/**
 * Mapea cualquier texto de sede (canonico, alias, abreviado, con prefijo) a la
 * key normalizada (sin espacios, alfanumerica) de su sede canonica. Combina:
 *  - planilla-sede.mapRawSedeToCanonical (aliases largos / con prefijos)
 *  - SEDE_ORDER_INDEX_MAP (alias cortos: "CL 5", "Cra 39", etc.)
 *  - stripSedeLabelPrefixes (remueve "Mercamio ", "Merkmios ", "Sede ").
 */
const canonicalSedeKey = (value: string): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  /** 1) Probar mapRawSedeToCanonical (maneja aliases largos y prefijos). */
  const mapped = mapRawSedeToCanonical(trimmed);
  if (mapped && mapped !== trimmed) {
    return normalizeKey(mapped);
  }

  /** 2a) Probar el indice global por la clave COMPACTA original, antes de
   *  strippear prefijos. SEDE_ORDER_INDEX_MAP registra aliases CON prefijos
   *  ("Merkmios La 80" -> Bogota, "Mercatodo Floralia" -> Floralia) que
   *  desaparecerian si los strippearamos primero. Sin esta busqueda,
   *  textos como "Merkmios La 80" caian al paso 3 y nunca se asociaban con
   *  "Bogota" (rompiendo la autoseleccion de sede en rotacion para
   *  usuarios cuyo allowedSedes era ["Bogota"]). */
  const compactWithPrefix = normalizeKeyCompact(trimmed);
  let orderIndex = SEDE_ORDER_INDEX_MAP.get(compactWithPrefix);
  if (orderIndex !== undefined && SEDE_ORDER[orderIndex]) {
    return normalizeKey(SEDE_ORDER[orderIndex]);
  }

  /** 2b) Probar el indice global por alias corto (ya sin prefijos). */
  const stripped = stripSedeLabelPrefixes(trimmed);
  const compactKey = normalizeKeyCompact(stripped);
  orderIndex = SEDE_ORDER_INDEX_MAP.get(compactKey);
  if (orderIndex !== undefined && SEDE_ORDER[orderIndex]) {
    return normalizeKey(SEDE_ORDER[orderIndex]);
  }

  /** 3) Sin mapeo: regresar la key del texto tal cual. */
  return normalizeKey(trimmed);
};

/** Coincide sede de catalogo con claves permitidas (exacta o por subcadena; nombres en BD suelen traer prefijos). */
const MIN_SUBSTRING_TOKEN_LEN = 5;

const catalogSedeMatchesAllowedKeys = (
  sede: { sedeName: string; sedeId: string },
  allowedKeys: Set<string>,
  canonicalAllowedKeys: Set<string>,
): boolean => {
  const nameK = normalizeKey(sede.sedeName);
  const idK = normalizeKey(sede.sedeId);
  /** Forma canonica del nombre / id: cubre aliases como "CL 5" -> "Calle 5ta",
   *  "Cra 39" -> "La 39", "Mercatodo Floralia" -> "Floralia", etc. */
  const nameCanon = canonicalSedeKey(sede.sedeName);
  const idCanon = canonicalSedeKey(sede.sedeId);
  if (nameCanon && canonicalAllowedKeys.has(nameCanon)) return true;
  if (idCanon && canonicalAllowedKeys.has(idCanon)) return true;
  for (const token of allowedKeys) {
    if (!token) continue;
    if (token === normalizeKey("Todas")) continue;
    if (nameK === token || idK === token) return true;
    if (/^\d+$/.test(token) && /^\d+$/.test(idK)) {
      if (parseInt(token, 10) === parseInt(idK, 10)) return true;
    }
    if (token.length >= MIN_SUBSTRING_TOKEN_LEN) {
      if (nameK.includes(token) || idK.includes(token)) return true;
      /** Tambien probamos la direccion inversa: token "calle5ta" vs nameK "cl5". */
      if (nameK.length >= 2 && token.includes(nameK)) return true;
      if (idK.length >= 2 && token.includes(idK)) return true;
    }
  }
  return false;
};

export const resolveVisibleSedes = (
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
  /** Set canonico paralelo (aliases): "Calle 5ta" / "CL 5" / "Cl5" -> misma key. */
  const canonicalAllowed = new Set(
    rawAllowed.map((sede) => canonicalSedeKey(sede)).filter(Boolean),
  );

  if (normalizedAllowed.has(normalizeKey("Todas"))) {
    return {
      authorized: true,
      visibleSedes: catalog.sedes,
    };
  }

  const visibleFromAllowed = catalog.sedes.filter((sede) =>
    catalogSedeMatchesAllowedKeys(sede, normalizedAllowed, canonicalAllowed),
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
    const legacyCanon = canonicalSedeKey(sessionUser.sede ?? "");
    const legacySet = legacyKey ? new Set([legacyKey]) : new Set<string>();
    const legacyCanonSet = legacyCanon ? new Set([legacyCanon]) : new Set<string>();
    const legacyVisible = catalog.sedes.filter((sede) =>
      legacyKey
        ? catalogSedeMatchesAllowedKeys(sede, legacySet, legacyCanonSet)
        : false,
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

const ensureRotacionAbcdConfigBySedeTable = async () => {
  const client = await (await getDbPool()).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rotacion_abcd_config_sede (
        empresa text NOT NULL,
        sede_id text NOT NULL,
        a_until_percent numeric(5,2) NOT NULL,
        b_until_percent numeric(5,2) NOT NULL,
        c_until_percent numeric(5,2) NOT NULL,
        updated_by text NULL,
        updated_at timestamp without time zone NOT NULL DEFAULT NOW(),
        PRIMARY KEY (empresa, sede_id)
      )
    `);
  } finally {
    client.release();
  }
};

const buildSedeConfigCacheKey = (empresa: string, sedeId: string) =>
  `${empresa}::${sedeId}`;

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

const getRotacionAbcdConfigForSede = async (
  empresa: string,
  sedeId: string,
): Promise<AbcdConfig | null> => {
  const cacheKey = buildSedeConfigCacheKey(empresa, sedeId);
  const cached = abcdConfigBySedeCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  await ensureRotacionAbcdConfigBySedeTable();
  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        a_until_percent,
        b_until_percent,
        c_until_percent
      FROM rotacion_abcd_config_sede
      WHERE empresa = $1
        AND sede_id = $2
      LIMIT 1
      `,
      [empresa, sedeId],
    );
    const row = result.rows?.[0] as
      | {
          a_until_percent?: string | number | null;
          b_until_percent?: string | number | null;
          c_until_percent?: string | number | null;
        }
      | undefined;
    if (!row) return null;
    const normalized = normalizeAbcdConfig({
      aUntilPercent:
        row.a_until_percent == null ? undefined : Number(row.a_until_percent),
      bUntilPercent:
        row.b_until_percent == null ? undefined : Number(row.b_until_percent),
      cUntilPercent:
        row.c_until_percent == null ? undefined : Number(row.c_until_percent),
    });
    abcdConfigBySedeCache.set(cacheKey, {
      value: normalized,
      expiresAt: now + ROTATION_ABCD_CACHE_TTL_MS,
    });
    return normalized;
  } finally {
    client.release();
  }
};

const getRotacionAbcdConfigForScope = async (
  empresa: string | null,
  sedeId: string | null,
): Promise<AbcdConfig> => {
  if (!empresa || !sedeId) return getRotacionAbcdConfig();
  try {
    const scoped = await getRotacionAbcdConfigForSede(empresa, sedeId);
    if (scoped) return scoped;
  } catch {
    /* fallback global */
  }
  return getRotacionAbcdConfig();
};

const saveRotacionAbcdConfigForSede = async (
  config: AbcdConfig,
  updatedBy: string,
  empresa: string,
  sedeId: string,
): Promise<AbcdConfig> => {
  await ensureRotacionAbcdConfigBySedeTable();
  const normalized = normalizeAbcdConfig(config);
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      INSERT INTO rotacion_abcd_config_sede (
        empresa,
        sede_id,
        a_until_percent,
        b_until_percent,
        c_until_percent,
        updated_by,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (empresa, sede_id)
      DO UPDATE SET
        a_until_percent = EXCLUDED.a_until_percent,
        b_until_percent = EXCLUDED.b_until_percent,
        c_until_percent = EXCLUDED.c_until_percent,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [
        empresa,
        sedeId,
        normalized.aUntilPercent,
        normalized.bUntilPercent,
        normalized.cUntilPercent,
        updatedBy,
      ],
    );
    abcdConfigBySedeCache.set(buildSedeConfigCacheKey(empresa, sedeId), {
      value: normalized,
      expiresAt: Date.now() + ROTATION_ABCD_CACHE_TTL_MS,
    });
    return normalized;
  } finally {
    client.release();
  }
};

const getAvailableBounds = async () => {
  const sourceTable = getRotacionSourceTable();
  const now = Date.now();
  const cached = availableBoundsCache.get(sourceTable);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const { dateColumn } = await resolveRotacionBaseSqlFields(client);
    const result = await client.query(
      `
      SELECT
        MIN(${dateColumn === "fecha_carga" || dateColumn === "fecha_dia" ? `TO_CHAR(${dateColumn}::date, 'YYYYMMDD')` : dateColumn}) AS min_date,
        MAX(${dateColumn === "fecha_carga" || dateColumn === "fecha_dia" ? `TO_CHAR(${dateColumn}::date, 'YYYYMMDD')` : dateColumn}) AS max_date
      FROM ${getRotacionSourceTable()}
      WHERE ${
        dateColumn === "fecha_carga" || dateColumn === "fecha_dia"
          ? `${dateColumn} IS NOT NULL`
          : `${dateColumn} ~ '^[0-9]{8}$'`
      }
      `,
    );
    const value = (result.rows?.[0] as AvailableBoundsRow | undefined) ?? null;
    availableBoundsCache.set(sourceTable, {
      value,
      expiresAt: now + ROTATION_META_CACHE_TTL_MS,
    });
    return value;
  } finally {
    client.release();
  }
};

const buildCompactDateRangeSql = (
  column: RotacionBaseDateColumn,
  startParam = "$1",
  endParam = "$2",
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date BETWEEN TO_DATE(${startParam}::text, 'YYYYMMDD') AND TO_DATE(${endParam}::text, 'YYYYMMDD')`
    : `${column} BETWEEN ${startParam} AND ${endParam}
        AND ${column} ~ '^[0-9]{8}$'`;

const buildCompactDateEqualsSql = (
  column: RotacionBaseDateColumn,
  param = "$1",
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date = TO_DATE(${param}::text, 'YYYYMMDD')`
    : `${column} = ${param}
        AND ${column} ~ '^[0-9]{8}$'`;

const buildConsultaDateSql = (
  column: RotacionBaseDateColumn,
) =>
  column === "fecha_carga" || column === "fecha_dia"
    ? `${column}::date`
    : `TO_DATE(${column}, 'YYYYMMDD')`;

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
    lineasN1Nombres: {},
    categorias: [],
    lineasN1PorCategoria: {},
  };
};

export const getRotationFilterCatalog = async (
  startDateCompact: string,
  endDateCompact: string,
): Promise<RotationFilterCatalog> => {
  const sourceTable = getRotacionSourceTable();
  const now = Date.now();
  const rangeKey = `${startDateCompact}|${endDateCompact}`;
  const snapKey = `snap|${endDateCompact}`;
  const cached = rotationFilterCatalogCache.get(sourceTable);
  if (cached && cached.expiresAt > now) {
    if (cached.rangeKey === rangeKey || cached.rangeKey === snapKey) {
      return cached.value;
    }
  }

  const client = await (await getDbPool()).connect();
  try {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    // Catalogo de filtros: solo escaneamos la ULTIMA fecha del rango. Las
    // empresas/sedes son estables dia a dia, asi que escanear semanas/meses
    // solo para sacar combinaciones unicas no aporta nada y costaba ~13s.
    // (Antes habia un fallback try/catch que primero intentaba el rango y
    // solo si timeoutaba caia al snap; ahora vamos directo al snap.)
    const snapSql = `
      SELECT DISTINCT
        ${fields.empresaExpr} AS empresa,
        ${fields.sedeIdExpr} AS sede_id,
        ${fields.sedeNameExpr} AS sede_name
      FROM ${getRotacionSourceTable()}
      WHERE ${buildCompactDateEqualsSql(dateColumn)}
        AND ${fields.itemPresentCondition}
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
    `;

    const result = await client.query(snapSql, [endDateCompact]);
    const cacheKey = snapKey;

    const value = mapRotationCatalogRows(
      (result.rows ?? []) as RotationFilterDbRow[],
    );

    rotationFilterCatalogCache.set(sourceTable, {
      rangeKey: cacheKey,
      value,
      expiresAt: now + ROTATION_META_CACHE_TTL_MS,
    });

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
  const cacheKey = `${getRotacionSourceTable()}|${startDate}|${endDate}|${empresa ?? "*"}|${sedeId}`;
  const now = Date.now();
  const cached = lineasN1ByRangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await withPoolClient(async (client) => {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const result = await client.query(
      `
      SELECT DISTINCT
        COALESCE(${fields.n1CodeExpr}, '__sin_n1__') AS linea_n1_raw,
        ${fields.lineNullableExpr} AS linea,
        ${fields.nombreLinea01Expr} AS nombre_linea01
      FROM ${getRotacionSourceTable()}
      WHERE ${buildCompactDateRangeSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ${fields.allowedCategoriaExpr}
        AND ${fields.sedeIdExpr} = $3
        AND ($4::text IS NULL OR ${fields.empresaExpr} = $4)
      ORDER BY linea_n1_raw ASC
      `,
      [isoToCompactDate(startDate), isoToCompactDate(endDate), sedeId, empresa],
    );

    const codeSet = new Set<string>();
    const nombreByCode = new Map<string, string>();
    for (const raw of (result.rows ?? []) as Array<{
      linea_n1_raw: string | null;
      linea: string | null;
      nombre_linea01: string | null;
    }>) {
      const code = normalizeRotationLineaN1Code(raw.linea_n1_raw);
      codeSet.add(code);
      const lineaLabel = toOptionalTrimmedString(raw.linea);
      const n01 = toOptionalTrimmedString(raw.nombre_linea01);
      const best =
        lineaLabel && lineaLabel.toLowerCase() !== "sin linea"
          ? pickLongerTrimmedName(lineaLabel, n01)
          : n01;
      if (!best) continue;
      const prev = nombreByCode.get(code);
      if (!prev || best.length > prev.length) nombreByCode.set(code, best);
    }
    const codes = Array.from(codeSet).sort((a, b) => a.localeCompare(b, "es"));
    const nombres = Object.fromEntries(nombreByCode);
    return { codes, nombres } satisfies RotationLineasN1Slice;
  });

  if (value.codes.length > 0) {
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
  const cacheKey = `catbundle|${getRotacionSourceTable()}|${startDate}|${endDate}|${empresa ?? "*"}|${sedeId}`;
  const now = Date.now();
  const cached = categoriaBundleByRangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await withPoolClient(async (client) => {
    const fields = await resolveRotacionBaseSqlFields(client);
    const dateColumn = fields.dateColumn;
    const result = await client.query(
      `
      SELECT DISTINCT
        ${fields.categoriaKeyExpr} AS categoria_key,
        ${fields.categoriaNameExpr} AS nombre_categoria,
        COALESCE(${fields.n1CodeExpr}, '__sin_n1__') AS linea_n1_raw
      FROM ${getRotacionSourceTable()}
      WHERE ${buildCompactDateRangeSql(dateColumn)}
        AND ${fields.itemPresentCondition}
        AND ${fields.allowedCategoriaExpr}
        AND ${fields.sedeIdExpr} = $3
        AND ($4::text IS NULL OR ${fields.empresaExpr} = $4)
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

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  };

  await Promise.all(
    Array.from({ length: safeLimit }, () => runWorker()),
  );
  return results;
};

type ExplainPlanResult = {
  empresa: string | null;
  sedeId: string | null;
  rows: number;
  durationMs: number;
  plan: string;
};

/**
 * Detecta si la matview `rotacion_item_dia_clean` existe en la BD.
 * Cache 5 min para no pagar el SELECT contra pg_matviews en cada request.
 * Si la matview no existe (porque aun no se aplico la migracion), devolvemos
 * `false` y el caller hace fallback al query original.
 */
async function ensureRotacionCleanMatViewProbe(
  client: RotacionBaseQueryClient,
): Promise<boolean> {
  const now = Date.now();
  if (
    rotacionCleanMatViewProbeCache &&
    rotacionCleanMatViewProbeCache.expiresAt > now
  ) {
    return rotacionCleanMatViewProbeCache.exists;
  }
  try {
    const result = await client.query(
      "SELECT 1 FROM pg_matviews WHERE matviewname = $1 LIMIT 1",
      [ROTACION_CLEAN_MATVIEW_NAME],
    );
    const exists = (result.rows?.length ?? 0) > 0;
    rotacionCleanMatViewProbeCache = {
      exists,
      expiresAt: now + ROTACION_CLEAN_MATVIEW_PROBE_CACHE_TTL_MS,
    };
    return exists;
  } catch (err) {
    console.warn(
      `[rotacion API] probe matview fallo (asumiendo no existe): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

/**
 * Variante de `queryRotationRows` que lee de la vista materializada
 * `rotacion_item_dia_clean`. Esta vista ya tiene:
 *   - Strings limpios (TRIM/COALESCE/LPAD/normalizacion)
 *   - Categorias y sedes excluidas filtradas (`PRODUCTO TERMINADO`, hidden sedes)
 *   - Metricas diarias pre-sumadas (venta_sin_impuesto_dia, cost_value_dia,
 *     margin_value_dia, unidades_vendidas_dia, inventory_units_dia,
 *     inventory_value_dia)
 *   - Agregado por (fecha, empresa, sede_id, item) ignorando bodega_local
 *
 * El query es significativamente mas simple que el original porque elimina:
 *   - El CTE `scoped` con todas las transformaciones de columnas
 *   - Los CTEs `item_day_margin` e `item_day_inventory` (las daily sums ya
 *     vienen pre-calculadas)
 *   - El filtro `buildHiddenSedeWhereClause` (ya pre-filtrado)
 *
 * Mantiene comportamiento equivalente: window functions sobre (empresa, sede,
 * item) para opening/latest inventory, AVG del margin %, MIN del inventory en
 * el rango, classification por status, etc.
 */
async function queryRotationRowsViaMatview({
  client,
  startDate,
  endDate,
  maxSalesValue,
  empresa,
  sedeId,
  lineasN1,
  categoriaKeys,
  explain,
}: {
  client: RotacionBaseQueryClient;
  startDate: string;
  endDate: string;
  maxSalesValue: number | null;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  categoriaKeys: string[] | null;
  explain: boolean;
}): Promise<RotationRow[] | ExplainPlanResult> {
  const sqlStartTs = performance.now();
  const baseSql = `
    WITH base AS (
      SELECT
        fecha,
        empresa,
        sede_id,
        sede_name,
        item,
        descripcion,
        unidad,
        linea,
        linea_n1_codigo,
        bodega,
        categoria,
        nombre_categoria,
        categoria_key,
        venta_sin_impuesto_dia,
        cost_value_dia,
        margin_value_dia,
        unidades_vendidas_dia,
        inventory_units_dia,
        inventory_value_dia,
        ultima_venta_pdv,
        ultima_venta_inventario,
        fecha_ultima_compra,
        fecha_ultima_entrada,
        carga_ts
      FROM rotacion_item_dia_clean
      WHERE fecha BETWEEN $1::date AND $2::date
        AND ($5::text IS NULL OR empresa = $5)
        AND ($6::text IS NULL OR sede_id = $6)
        AND (
          $7::text[] IS NULL
          OR COALESCE(linea_n1_codigo, '__sin_n1__') = ANY($7::text[])
        )
        AND ($10::text[] IS NULL OR categoria_key = ANY($10::text[]))
    ),
    ranked AS (
      SELECT
        base.*,
        MIN(fecha) OVER (PARTITION BY empresa, sede_id, item) AS first_fecha,
        MAX(fecha) OVER (PARTITION BY empresa, sede_id, item) AS latest_fecha,
        ROW_NUMBER() OVER (
          PARTITION BY empresa, sede_id, item
          ORDER BY fecha DESC, carga_ts DESC NULLS LAST
        ) AS latest_rank
      FROM base
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
        SUM(venta_sin_impuesto_dia)::numeric AS total_sales,
        SUM(cost_value_dia)::numeric AS total_cost,
        SUM(margin_value_dia)::numeric AS total_margin,
        COALESCE(
          AVG(
            CASE
              WHEN venta_sin_impuesto_dia > 0
              THEN (margin_value_dia / venta_sin_impuesto_dia) * 100
              ELSE NULL
            END
          ),
          0
        )::numeric AS margin_daily_avg_pct,
        SUM(unidades_vendidas_dia)::numeric AS total_units,
        MAX(
          CASE
            WHEN COALESCE(fecha_ultima_compra, fecha_ultima_entrada)
                 BETWEEN $1::date AND $2::date
            THEN COALESCE(fecha_ultima_compra, fecha_ultima_entrada)
            WHEN COALESCE(ultima_venta_pdv, ultima_venta_inventario)
                 BETWEEN $1::date AND $2::date
            THEN COALESCE(ultima_venta_pdv, ultima_venta_inventario)
            ELSE NULL
          END
        ) AS last_movement_date,
        MAX(COALESCE(ultima_venta_pdv, ultima_venta_inventario)) AS last_purchase_date,
        SUM(
          CASE WHEN fecha = first_fecha THEN inventory_units_dia ELSE 0 END
        )::numeric AS opening_inventory_units,
        MIN(inventory_units_dia)::numeric AS min_inventory_units,
        SUM(
          CASE WHEN fecha = latest_fecha THEN inventory_units_dia ELSE 0 END
        )::numeric AS inventory_units,
        SUM(
          CASE WHEN fecha = latest_fecha THEN inventory_value_dia ELSE 0 END
        )::numeric AS inventory_value,
        MAX(CASE WHEN latest_rank = 1 THEN bodega END) AS bodega,
        MAX(CASE WHEN latest_rank = 1 THEN categoria END) AS categoria,
        MAX(CASE WHEN latest_rank = 1 THEN nombre_categoria END) AS nombre_categoria,
        MAX(CASE WHEN latest_rank = 1 THEN linea_n1_codigo END) AS linea01,
        MAX(CASE WHEN latest_rank = 1 THEN linea END) AS nombre_linea01,
        COUNT(DISTINCT fecha)::int AS tracked_days,
        COUNT(
          DISTINCT CASE
            WHEN unidades_vendidas_dia > 0 THEN fecha
            ELSE NULL
          END
        )::int AS sales_effective_days
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
        *,
        NULL::text AS nombre_bodega,
        CASE
          WHEN COALESCE(inventory_units, 0) <= 0
            OR COALESCE(inventory_value, 0) <= 0 THEN 0::numeric
          WHEN COALESCE(total_units, 0) <= 0
            OR COALESCE(tracked_days, 0) <= 0 THEN 999999::numeric
          ELSE (COALESCE(inventory_units, 0) * tracked_days::numeric)
               / NULLIF(total_units, 0)
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
        *,
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
      total_cost,
      total_margin,
      margin_daily_avg_pct,
      total_units,
      opening_inventory_units,
      min_inventory_units,
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
  `;
  const params = [
    startDate, // $1: fecha desde (ISO)
    endDate, // $2: fecha hasta (ISO)
    endDate, // $3: fecha hasta para effective_days
    maxSalesValue, // $4
    empresa, // $5
    sedeId, // $6
    lineasN1, // $7
    FUTURE_STOCKOUT_DAYS, // $8
    LOW_ROTATION_DAYS_THRESHOLD, // $9
    categoriaKeys, // $10
  ];

  // Misma estrategia que el query original: subir work_mem y forzar paralelismo
  // dentro de una transaccion local. La matview no necesita tanto como la
  // tabla raw (~478k filas vs 22k de items finales), pero no esta de mas.
  let txnStarted = false;
  try {
    await client.query("BEGIN");
    txnStarted = true;
    await client.query("SET LOCAL work_mem = '128MB'");
    await client.query("SET LOCAL max_parallel_workers_per_gather = 2");
  } catch (err) {
    console.warn(
      `[rotacion API matview] no se pudo elevar work_mem/parallelism: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    if (explain) {
      const explainResult = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${baseSql}`,
        params,
      );
      const planLines = (explainResult.rows ?? [])
        .map((row) => (row as { "QUERY PLAN": string })["QUERY PLAN"])
        .filter((line): line is string => typeof line === "string");
      if (txnStarted) await client.query("COMMIT");
      const sqlElapsedMs = performance.now() - sqlStartTs;
      console.info(
        `[rotacion API matview] EXPLAIN empresa=${empresa ?? "*"} sede=${sedeId ?? "*"} duration=${(sqlElapsedMs / 1000).toFixed(2)}s`,
      );
      return {
        empresa,
        sedeId,
        rows: 0,
        durationMs: sqlElapsedMs,
        plan: planLines.join("\n"),
      } satisfies ExplainPlanResult;
    }

    const result = await client.query(baseSql, params);
    if (txnStarted) await client.query("COMMIT");

    const sqlElapsedMs = performance.now() - sqlStartTs;
    console.info(
      `[rotacion API matview] sql empresa=${empresa ?? "*"} sede=${sedeId ?? "*"} rows=${
        result.rows?.length ?? 0
      } duration=${(sqlElapsedMs / 1000).toFixed(2)}s`,
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
        totalCost: toNumber(row.total_cost),
        totalMargin: toNumber(row.total_margin),
        marginDailyAvgPct: toNumber(row.margin_daily_avg_pct),
        totalUnits: toNumber(row.total_units),
        openingInventoryUnits: toNumber(row.opening_inventory_units),
        minInventoryUnits: toNumber(row.min_inventory_units),
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
  } catch (queryErr) {
    if (txnStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    throw queryErr;
  }
}

async function queryRotationRows(args: {
  startDate: string;
  endDate: string;
  maxSalesValue: number | null;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  categoriaKeys: string[] | null;
  precomputedFields?: RotacionBaseSqlFields;
  explain: true;
}): Promise<ExplainPlanResult>;
async function queryRotationRows(args: {
  startDate: string;
  endDate: string;
  maxSalesValue: number | null;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  categoriaKeys: string[] | null;
  precomputedFields?: RotacionBaseSqlFields;
  explain?: false;
}): Promise<RotationRow[]>;
async function queryRotationRows({
  startDate,
  endDate,
  maxSalesValue,
  empresa,
  sedeId,
  lineasN1,
  categoriaKeys,
  precomputedFields,
  explain = false,
}: {
  startDate: string;
  endDate: string;
  maxSalesValue: number | null;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  categoriaKeys: string[] | null;
  /**
   * Si el caller ya resolvio los campos via `resolveRotacionBaseSqlFields`, se
   * pasan aqui para evitar volver a hacer la introspeccion del esquema en cada
   * sede (cuando hay N sedes, esto ahorra N - 1 round-trips).
   */
  precomputedFields?: RotacionBaseSqlFields;
  /**
   * Si es `true`, envuelve el query en `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`
   * y devuelve el plan como string en vez de las filas. Util para diagnostico
   * desde `?explain=1` (admin only). NO modifica el query original ni lo afecta
   * de ninguna forma cuando `explain=false`.
   */
  explain?: boolean;
}): Promise<RotationRow[] | ExplainPlanResult> {
  const fetchRows = async (): Promise<RotationRow[] | ExplainPlanResult> =>
    withPoolClient(async (client) => {
      // Si la vista materializada rotacion_item_dia_clean existe, usamos el
      // camino simplificado que evita CTEs intermedias y aprovecha que las
      // metricas diarias ya estan pre-sumadas y los strings limpios. Si no
      // existe (porque la migracion aun no se aplico), fallback al query
      // original sobre la tabla cruda.
      const matViewExists = await ensureRotacionCleanMatViewProbe(client);
      if (matViewExists) {
        return queryRotationRowsViaMatview({
          client,
          startDate,
          endDate,
          maxSalesValue,
          empresa,
          sedeId,
          lineasN1,
          categoriaKeys,
          explain,
        });
      }

      const fields =
        precomputedFields ?? (await resolveRotacionBaseSqlFields(client));
      const dateColumn = fields.dateColumn;
      const sqlStartTs = performance.now();
      const baseSql = `
      -- IMPORTANTE: NO usar 'WITH scoped AS MATERIALIZED'. Se intento para
      -- evitar los 3 escaneos de rotacion_base (scoped es referenciada por
      -- ranked, item_day_margin, item_day_inventory), pero el resultado de
      -- scoped es demasiado grande y termina spilleando a disco; en prod
      -- empeoro de ~30s a ~150s. Dejamos que PostgreSQL inlinee la CTE.
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
          ${fields.salesExpr} AS venta_sin_impuesto,
          ${fields.costOfSalesExpr} AS cost_value,
          ${fields.marginExpr} AS margin_value,
          ${fields.unitsSoldExpr} AS unidades_vendidas,
          ${fields.closingUnitsExpr} AS inventory_units,
          ${fields.inventoryValueExpr} AS inventory_value,
          ${buildConsultaDateSql(dateColumn)} AS consulta_date,
          CASE
            WHEN (${fields.lastEntryDateExpr}) BETWEEN TO_DATE($1::text, 'YYYYMMDD') AND TO_DATE($2::text, 'YYYYMMDD')
            THEN (${fields.lastEntryDateExpr})
            WHEN (${fields.lastSaleDateExpr}) BETWEEN TO_DATE($1::text, 'YYYYMMDD') AND TO_DATE($2::text, 'YYYYMMDD')
            THEN (${fields.lastSaleDateExpr})
            ELSE NULL
          END AS last_movement_date,
          (${fields.lastSaleDateExpr}) AS last_purchase_date,
          ${fields.bodegaExpr} AS bodega,
          ${fields.nombreBodegaExpr} AS nombre_bodega,
          ${fields.categoriaExpr} AS categoria,
          ${fields.categoriaNameExpr} AS nombre_categoria,
          ${fields.linea01Expr} AS linea01,
          ${fields.nombreLinea01Expr} AS nombre_linea01,
          ${fields.loadTimestampExpr} AS carga_ts
        FROM ${getRotacionSourceTable()}
        WHERE ${buildCompactDateRangeSql(dateColumn)}
          AND ${fields.itemPresentCondition}
          AND ${fields.allowedCategoriaExpr}
          AND ($5::text IS NULL OR ${fields.empresaExpr} = $5)
          AND ($6::text IS NULL OR ${fields.sedeIdExpr} = $6)
          AND ($7::text[] IS NULL OR COALESCE(${fields.n1CodeExpr}, '__sin_n1__') = ANY($7::text[]))
          AND ($10::text[] IS NULL OR ${fields.categoriaKeyExpr} = ANY($10::text[]))
          AND ${buildHiddenSedeWhereClause(fields.sedeNameExpr)}
      ),
      ranked AS (
        SELECT
          *,
          MIN(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS first_consulta_date,
          MAX(consulta_date) OVER (
            PARTITION BY empresa, sede_id, item
          ) AS latest_consulta_date,
          ROW_NUMBER() OVER (
            PARTITION BY empresa, sede_id, item
            ORDER BY consulta_date DESC, carga_ts DESC NULLS LAST
          ) AS latest_rank
        FROM scoped
      ),
      item_day_margin AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          consulta_date,
          SUM(venta_sin_impuesto)::numeric AS daily_sales,
          SUM(margin_value)::numeric AS daily_margin
        FROM scoped
        GROUP BY
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          consulta_date
      ),
      item_day_inventory AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          consulta_date,
          SUM(inventory_units)::numeric AS daily_inventory_units
        FROM scoped
        GROUP BY
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          consulta_date
      ),
      item_inventory_range_summary AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          MIN(daily_inventory_units)::numeric AS min_inventory_units
        FROM item_day_inventory
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
      item_day_margin_avg AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          COALESCE(
            AVG(
              CASE
                WHEN daily_sales > 0 THEN (daily_margin / daily_sales) * 100
                ELSE NULL
              END
            ),
            0
          )::numeric AS margin_daily_avg_pct
        FROM item_day_margin
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
      aggregated AS (
        SELECT
          r.empresa,
          r.sede_id,
          r.sede_name,
          r.linea,
          r.linea_n1_codigo,
          r.item,
          r.descripcion,
          r.unidad,
          SUM(r.venta_sin_impuesto)::numeric AS total_sales,
          SUM(r.cost_value)::numeric AS total_cost,
          SUM(r.margin_value)::numeric AS total_margin,
          COALESCE(MAX(dma.margin_daily_avg_pct), 0)::numeric AS margin_daily_avg_pct,
          SUM(r.unidades_vendidas)::numeric AS total_units,
          MAX(r.last_movement_date) AS last_movement_date,
          MAX(r.last_purchase_date) AS last_purchase_date,
          SUM(
            CASE
              WHEN r.consulta_date = r.first_consulta_date THEN r.inventory_units
              ELSE 0
            END
          )::numeric AS opening_inventory_units,
          COALESCE(MAX(iir.min_inventory_units), 0)::numeric AS min_inventory_units,
          SUM(
            CASE
              WHEN r.consulta_date = r.latest_consulta_date THEN r.inventory_units
              ELSE 0
            END
          )::numeric AS inventory_units,
          SUM(
            CASE
              WHEN r.consulta_date = r.latest_consulta_date THEN r.inventory_value
              ELSE 0
            END
          )::numeric AS inventory_value,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.bodega END) AS bodega,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.nombre_bodega END) AS nombre_bodega,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.categoria END) AS categoria,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.nombre_categoria END) AS nombre_categoria,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.linea01 END) AS linea01,
          MAX(CASE WHEN r.latest_rank = 1 THEN r.nombre_linea01 END) AS nombre_linea01,
          COUNT(DISTINCT r.consulta_date)::int AS tracked_days,
          COUNT(
            DISTINCT CASE
              WHEN r.unidades_vendidas > 0 THEN r.consulta_date
              ELSE NULL
            END
          )::int AS sales_effective_days
        FROM ranked r
        LEFT JOIN item_day_margin_avg dma
          ON dma.empresa = r.empresa
          AND dma.sede_id = r.sede_id
          AND dma.item = r.item
          AND dma.linea IS NOT DISTINCT FROM r.linea
          AND dma.linea_n1_codigo IS NOT DISTINCT FROM r.linea_n1_codigo
          AND dma.descripcion IS NOT DISTINCT FROM r.descripcion
          AND dma.unidad IS NOT DISTINCT FROM r.unidad
        LEFT JOIN item_inventory_range_summary iir
          ON iir.empresa = r.empresa
          AND iir.sede_id = r.sede_id
          AND iir.item = r.item
          AND iir.linea IS NOT DISTINCT FROM r.linea
          AND iir.linea_n1_codigo IS NOT DISTINCT FROM r.linea_n1_codigo
          AND iir.descripcion IS NOT DISTINCT FROM r.descripcion
          AND iir.unidad IS NOT DISTINCT FROM r.unidad
        GROUP BY
          r.empresa,
          r.sede_id,
          r.sede_name,
          r.linea,
          r.linea_n1_codigo,
          r.item,
          r.descripcion,
          r.unidad
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
          total_cost,
          total_margin,
          margin_daily_avg_pct,
          total_units,
          COALESCE(opening_inventory_units, 0) AS opening_inventory_units,
          COALESCE(min_inventory_units, 0) AS min_inventory_units,
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
          total_cost,
          total_margin,
          margin_daily_avg_pct,
          total_units,
          opening_inventory_units,
          min_inventory_units,
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
        total_cost,
        total_margin,
        margin_daily_avg_pct,
        total_units,
        opening_inventory_units,
        min_inventory_units,
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
      `;
      const params = [
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
      ];

      // El query principal de rotacion tiene 9 CTEs encadenadas, varios
      // window functions y 3 escaneos del CTE `scoped` (~365k filas para una
      // sede grande). Con el default de `work_mem=64MB` por rol, el plan
      // observado spillea ~210 MB a disco temporal (WindowAgg sort 80MB,
      // GroupAggregate 88MB, HashAggregate dma 28MB, HashAggregate iir 16MB)
      // y pierde ~10s solo en I/O temporal. Subir `work_mem` a 256MB SOLO
      // para esta transaccion (SET LOCAL) elimina los spills. Como es LOCAL,
      // al hacer COMMIT/ROLLBACK la sesion vuelve a 64MB y no afecta otras
      // queries. Necesitamos transaccion explicita porque sin BEGIN el
      // `SET LOCAL` seria un no-op (cada client.query es su propia transaccion
      // implicita). Si BEGIN falla seguimos con el default sin romper.
      //
      // Ademas forzamos `max_parallel_workers_per_gather = 4` para recuperar
      // el paralelismo que el planner pierde despues de un ANALYZE: con stats
      // mas precisas, decide que el Parallel Index Scan no vale la pena, pero
      // en la realidad SI vale (medimos 22s con 2 workers vs 35s sin workers).
      // Lo seteamos a 4 para que use 2-4 segun disponibilidad del cluster.
      let txnStarted = false;
      try {
        await client.query("BEGIN");
        txnStarted = true;
        await client.query("SET LOCAL work_mem = '256MB'");
        await client.query("SET LOCAL max_parallel_workers_per_gather = 4");
      } catch (err) {
        console.warn(
          `[rotacion API] no se pudo elevar work_mem/parallelism (sigue con default): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      try {
        if (explain) {
          const explainResult = await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${baseSql}`,
            params,
          );
          const planLines = (explainResult.rows ?? [])
            .map((row) => (row as { "QUERY PLAN": string })["QUERY PLAN"])
            .filter((line): line is string => typeof line === "string");
          if (txnStarted) await client.query("COMMIT");
          const sqlElapsedMs = performance.now() - sqlStartTs;
          console.info(
            `[rotacion API] EXPLAIN empresa=${empresa ?? "*"} sede=${sedeId ?? "*"} duration=${(sqlElapsedMs / 1000).toFixed(2)}s`,
          );
          return {
            empresa,
            sedeId,
            rows: 0,
            durationMs: sqlElapsedMs,
            plan: planLines.join("\n"),
          } satisfies ExplainPlanResult;
        }

        const result = await client.query(baseSql, params);
        if (txnStarted) await client.query("COMMIT");

        const sqlElapsedMs = performance.now() - sqlStartTs;
        console.info(
          `[rotacion API] sql empresa=${empresa ?? "*"} sede=${sedeId ?? "*"} rows=${
            result.rows?.length ?? 0
          } duration=${(sqlElapsedMs / 1000).toFixed(2)}s`,
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
            totalCost: toNumber(row.total_cost),
            totalMargin: toNumber(row.total_margin),
            marginDailyAvgPct: toNumber(row.margin_daily_avg_pct),
            totalUnits: toNumber(row.total_units),
            openingInventoryUnits: toNumber(row.opening_inventory_units),
            minInventoryUnits: toNumber(row.min_inventory_units),
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
      } catch (queryErr) {
        if (txnStarted) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
        }
        throw queryErr;
      }
    });

  try {
    return await fetchRows();
  } catch (first) {
    if (!isPgConnectionFailure(first)) throw first;
    return await fetchRows();
  }
}

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
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "rotacion"))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  if (
    !canAccessRotacionBoard(
      session.user.specialRoles,
      session.user.role === "admin",
      session.user.allowedSubdashboards,
    )
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para ver rotacion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  if (
    getRotacionSourceTable() === ROTACION_SOURCE_V4 &&
    !canAccessRotacionV4Board(session.user.role === "admin")
  ) {
    return withSession(
      NextResponse.json(
        { error: "Rotacion v4 solo esta disponible para administradores." },
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
              lineasN1Nombres: {},
              categorias: [],
              lineasN1PorCategoria: {},
            },
            meta: {
              effectiveRange: { start: "", end: "" },
              availableRange: { min: "", max: "" },
              sourceTable: getRotacionSourceTable(),
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
    const requestedSedeScopesRaw = url.searchParams
      .getAll("sedeScope")
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedLineasN1 = url.searchParams
      .getAll("lineasN1")
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedCategoriaKeys = url.searchParams
      .getAll("categoria")
      .map((value) => value.trim())
      .filter(Boolean);
    const isCatalogOnly = url.searchParams.get("catalogOnly") === "1";
    /**
     * Modo diagnostico: cuando un admin pasa `?explain=1`, en vez de devolver
     * filas se devuelve el plan de ejecucion (EXPLAIN ANALYZE) del query
     * principal de rotacion para la PRIMERA sede seleccionada. NO modifica el
     * query original ni afecta a otros usuarios; solo es accesible para admins
     * y se ejecuta una sola vez por request.
     */
    const isExplain = url.searchParams.get("explain") === "1";
    if (isExplain && session.user.role !== "admin") {
      return withSession(
        NextResponse.json(
          { error: "El modo explain solo esta disponible para admins." },
          { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
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
          lineasN1Nombres: {} as Record<string, string>,
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
      lineasN1Nombres: {},
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

    const requestedVisibleSedesFromScope = requestedSedeScopesRaw
      .map((scope) => {
        const idx = scope.indexOf("::");
        if (idx <= 0) return null;
        const empresa = scope.slice(0, idx).trim();
        const sedeId = scope.slice(idx + 2).trim();
        if (!empresa || !sedeId) return null;
        return (
          visibleSedes.find(
            (sede) => sede.empresa === empresa && sede.sedeId === sedeId,
          ) ?? null
        );
      })
      .filter(Boolean) as RotationFilterCatalog["sedes"];

    const selectedVisibleSedes =
      requestedVisibleSedesFromScope.length > 0
        ? requestedVisibleSedesFromScope
        : requestedVisibleSede
          ? [requestedVisibleSede]
          : [];
    const scopedAbcdConfig = await getRotacionAbcdConfigForScope(
      selectedVisibleSedes.length === 1 ? selectedVisibleSedes[0].empresa : null,
      selectedVisibleSedes.length === 1 ? selectedVisibleSedes[0].sedeId : null,
    );

    if (selectedVisibleSedes.length === 0 && requestedSedeScopesRaw.length > 0) {
      return withSession(
        NextResponse.json(
          { error: "Las sedes solicitadas no estan autorizadas." },
          { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const lineasSet = new Set<string>();
    let lineasN1NombresAcc: Record<string, string> = {};
    const categoriaMap = new Map<string, RotationCategoriaOption>();
    const lineasByCategoriaSet = new Map<string, Set<string>>();
    const catalogsPerSede = await mapWithConcurrency(
      selectedVisibleSedes,
      4,
      async (sede) => {
        const [lineasSede, bundle] = await Promise.all([
          queryRotationLineasN1({
            startDate: boundedRange.start,
            endDate: boundedRange.end,
            empresa: sede.empresa,
            sedeId: sede.sedeId,
          }),
          queryRotationCategoriaBundle({
            startDate: boundedRange.start,
            endDate: boundedRange.end,
            empresa: sede.empresa,
            sedeId: sede.sedeId,
          }),
        ]);
        return { lineasSede, bundle };
      },
    );
    for (const { lineasSede, bundle } of catalogsPerSede) {
      for (const linea of lineasSede.codes) lineasSet.add(linea);
      lineasN1NombresAcc = mergeLineaN1NombreRecords(
        lineasN1NombresAcc,
        lineasSede.nombres,
      );
      for (const categoria of bundle.categorias) {
        categoriaMap.set(categoria.categoriaKey, categoria);
      }
      for (const [categoriaKey, lineas] of Object.entries(
        bundle.lineasN1PorCategoria,
      )) {
        const current = lineasByCategoriaSet.get(categoriaKey) ?? new Set<string>();
        for (const linea of lineas) current.add(linea);
        lineasByCategoriaSet.set(categoriaKey, current);
      }
    }
    filters.lineasN1 = Array.from(lineasSet).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    filters.lineasN1Nombres = lineasN1NombresAcc;
    filters.categorias = Array.from(categoriaMap.values()).sort((a, b) =>
      a.categoriaKey.localeCompare(b.categoriaKey, "es"),
    );
    filters.lineasN1PorCategoria = {};
    for (const [categoriaKey, lineas] of lineasByCategoriaSet.entries()) {
      filters.lineasN1PorCategoria[categoriaKey] = Array.from(lineas).sort((a, b) =>
        a.localeCompare(b, "es"),
      );
    }

    if (selectedVisibleSedes.length === 0) {
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
              sourceTable: getRotacionSourceTable(),
              maxSalesValue,
              abcdConfig: scopedAbcdConfig,
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
              sourceTable: getRotacionSourceTable(),
              maxSalesValue,
              abcdConfig: scopedAbcdConfig,
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
      filters.categorias.map((c) => c.categoriaKey),
    );
    const validatedCategoriaKeys = requestedCategoriaKeys.filter((k) =>
      catalogCategoriaKeySet.has(k),
    );
    const isFullCategoriaSelection =
      filters.categorias.length > 0 &&
      validatedCategoriaKeys.length === filters.categorias.length &&
      filters.categorias.every((c) =>
        validatedCategoriaKeys.includes(c.categoriaKey),
      );
    const categoriaKeysForQuery =
      validatedCategoriaKeys.length === 0 || isFullCategoriaSelection
        ? null
        : validatedCategoriaKeys;

    // Resolvemos los campos del esquema UNA sola vez por request y los pasamos
    // a todas las queries por sede. Antes cada `queryRotationRows` ejecutaba su
    // propio `resolveRotacionBaseSqlFields` (introspeccion del esquema), lo que
    // se traducia en N round-trips innecesarios cuando el usuario seleccionaba
    // varias sedes.
    const precomputedFields = await withPoolClient((client) =>
      resolveRotacionBaseSqlFields(client),
    );

    if (isExplain) {
      // Solo corremos EXPLAIN para la PRIMERA sede para no recargar la BD.
      // Esto es suficiente para diagnosticar el plan: las sedes adicionales
      // ejecutan el mismo query con distintos parametros.
      const targetSede = selectedVisibleSedes[0];
      const explainStartTs = performance.now();
      const explainResult = await queryRotationRows({
        startDate: boundedRange.start,
        endDate: boundedRange.end,
        maxSalesValue,
        empresa: targetSede.empresa,
        sedeId: targetSede.sedeId,
        lineasN1: requestedLineasN1.length > 0 ? requestedLineasN1 : null,
        categoriaKeys: categoriaKeysForQuery,
        precomputedFields,
        explain: true,
      });
      const totalExplainMs = performance.now() - explainStartTs;
      return withSession(
        NextResponse.json(
          {
            explain: true,
            sede: {
              empresa: explainResult.empresa,
              sedeId: explainResult.sedeId,
              sedeName: targetSede.sedeName,
            },
            range: boundedRange,
            durationMs: Math.round(explainResult.durationMs),
            totalDurationMs: Math.round(totalExplainMs),
            plan: explainResult.plan,
            note: "Plan generado con EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT). Solo primera sede seleccionada.",
          },
          {
            headers: {
              "Cache-Control": CACHE_CONTROL,
              "Content-Type": "application/json; charset=utf-8",
              "X-Data-Source": "explain",
            },
          },
        ),
      );
    }

    const totalStartTs = performance.now();
    console.info(
      `[rotacion API] iniciando fetch de filas para ${selectedVisibleSedes.length} sede(s)`,
    );
    // Pre-probe para reportar en el header si esta usando matview o raw.
    // El probe esta cacheado 5 min, asi que no pagamos un round-trip por sede.
    const dataSource = await withPoolClient(async (client) =>
      (await ensureRotacionCleanMatViewProbe(client)) ? "matview" : "raw",
    );
    const rowsBySede = await mapWithConcurrency(
      selectedVisibleSedes,
      3,
      (sede) =>
        queryRotationRows({
          startDate: boundedRange.start,
          endDate: boundedRange.end,
          maxSalesValue,
          empresa: sede.empresa,
          sedeId: sede.sedeId,
          lineasN1: requestedLineasN1.length > 0 ? requestedLineasN1 : null,
          categoriaKeys: categoriaKeysForQuery,
          precomputedFields,
        }),
    );
    const rows = rowsBySede.flat();
    const totalElapsedMs = performance.now() - totalStartTs;
    console.info(
      `[rotacion API] fetch completo en ${(totalElapsedMs / 1000).toFixed(2)}s (${rows.length} filas totales, source=${dataSource})`,
    );

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
            sourceTable: getRotacionSourceTable(),
            maxSalesValue,
            abcdConfig: scopedAbcdConfig,
          },
        },
        {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": dataSource,
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
            lineasN1Nombres: {},
            categorias: [],
            lineasN1PorCategoria: {},
          },
          meta: {
            effectiveRange: { start: "", end: "" },
            availableRange: { min: "", max: "" },
            sourceTable: getRotacionSourceTable(),
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
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "rotacion"))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  if (
    getRotacionSourceTable() === ROTACION_SOURCE_V4 &&
    !canAccessRotacionV4Board(session.user.role === "admin")
  ) {
    return withSession(
      NextResponse.json(
        { error: "Rotacion v4 solo esta disponible para administradores." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

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
    const body = (await request.json()) as
      | (Partial<AbcdConfig> & {
          saveScope?: "global" | "sede";
          empresa?: string | null;
          sedeId?: string | null;
        })
      | null;
    const config = normalizeAbcdConfig(body);
    const saveScope = body?.saveScope === "sede" ? "sede" : "global";
    const empresa = (body?.empresa ?? "").trim();
    const sedeId = (body?.sedeId ?? "").trim();
    if (saveScope === "sede" && (!empresa || !sedeId)) {
      return withSession(
        NextResponse.json(
          { error: "Para guardar por sede debes enviar empresa y sedeId." },
          { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    const updated =
      saveScope === "sede"
        ? await saveRotacionAbcdConfigForSede(
            config,
            session.user.username ?? "admin",
            empresa,
            sedeId,
          )
        : await saveRotacionAbcdConfig(config, session.user.username ?? "admin");

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
