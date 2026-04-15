import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { canAccessRotacionBoard } from "@/lib/special-role-features";

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
  total_sales: string | number | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  rotation: string | number | null;
  tracked_days: number | string | null;
  last_movement_date: string | null;
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
  totalSales: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  lastMovementDate: string | null;
  effectiveDays: number | null;
  status: "Agotado" | "Futuro agotado" | "Baja rotacion" | "En seguimiento";
};

type RotationFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
  lineasN1: string[];
};

type AbcdConfig = {
  aUntilPercent: number;
  bUntilPercent: number;
  cUntilPercent: number;
};

const CACHE_CONTROL = "no-store";
const LOW_ROTATION_DAYS_THRESHOLD = 45;
const ROTATION_META_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ROTATION_RANGE_DAYS = 93;
const MAX_SALES_THRESHOLD = 200000;
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
  | { maxDate: string; value: RotationFilterCatalog; expiresAt: number }
  | null = null;

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

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

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
    normalizedAllowed.has(normalizeKey(sede.sedeName)),
  );
  if (visibleFromAllowed.length > 0) {
    return {
      authorized: true,
      visibleSedes: visibleFromAllowed,
    };
  }

  if (sessionUser.sede) {
    const legacyVisible = catalog.sedes.filter(
      (sede) => normalizeKey(sede.sedeName) === normalizeKey(sessionUser.sede ?? ""),
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
  if (value === null) return MAX_SALES_THRESHOLD;
  return Math.max(0, Math.min(value, MAX_SALES_THRESHOLD));
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

    if (!row) return DEFAULT_ABCD_CONFIG;
    return normalizeAbcdConfig({
      aUntilPercent:
        row.a_until_percent == null ? undefined : Number(row.a_until_percent),
      bUntilPercent:
        row.b_until_percent == null ? undefined : Number(row.b_until_percent),
      cUntilPercent:
        row.c_until_percent == null ? undefined : Number(row.c_until_percent),
    });
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

const getRotationFilterCatalog = async (
  maxDateCompact: string,
): Promise<RotationFilterCatalog> => {
  const now = Date.now();
  if (
    rotationFilterCatalogCache &&
    rotationFilterCatalogCache.maxDate === maxDateCompact &&
    rotationFilterCatalogCache.expiresAt > now
  ) {
    return rotationFilterCatalogCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
        COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta = $1
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
      `,
      [maxDateCompact],
    );

    const sedes = ((result.rows ?? []) as RotationFilterDbRow[])
      .map((row) => ({
        empresa: row.empresa,
        sedeId: row.sede_id,
        sedeName: row.sede_name,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));

    const companies = Array.from(new Set(sedes.map((row) => row.empresa))).sort(
      (a, b) => a.localeCompare(b, "es"),
    );

    const value = {
      companies,
      sedes,
      lineasN1: [],
    };

    rotationFilterCatalogCache = {
      maxDate: maxDateCompact,
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
  const client = await (await getDbPool()).connect();
  try {
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

    return ((result.rows ?? []) as Array<{ linea_n1_codigo: string | null }>)
      .map((row) => String(row.linea_n1_codigo ?? "__sin_n1__"))
      .filter(Boolean);
  } finally {
    client.release();
  }
};

const queryRotationRows = async ({
  startDate,
  endDate,
  maxSalesValue,
  empresa,
  sedeId,
  lineasN1,
  periodDays,
}: {
  startDate: string;
  endDate: string;
  maxSalesValue: number;
  empresa: string | null;
  sedeId: string | null;
  lineasN1: string[] | null;
  periodDays: number;
}): Promise<RotationRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
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
          GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0) AS inventory_units,
          GREATEST(COALESCE(valor_inventario, 0), 0) AS inventory_value,
          TO_DATE(fecha_consulta, 'YYYYMMDD') AS consulta_date,
          CASE
            WHEN fecha_ultima_compra ~ '^[0-9]{8}$' THEN TO_DATE(fecha_ultima_compra, 'YYYYMMDD')
            ELSE NULL
          END AS last_movement_date,
          fecha_carga
        FROM rotacion_base_item_dia_sede
        WHERE fecha_consulta BETWEEN $1 AND $2
          AND fecha_consulta ~ '^[0-9]{8}$'
          AND item IS NOT NULL
          AND ($5::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $5)
          AND ($6::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $6)
          AND ($7::text[] IS NULL OR COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), '__sin_n1__') = ANY($7::text[]))
      ),
      ranked AS (
        SELECT
          *,
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
          MAX(last_movement_date) AS last_movement_date,
          MAX(CASE WHEN latest_rank = 1 THEN inventory_units END)::numeric AS inventory_units,
          MAX(CASE WHEN latest_rank = 1 THEN inventory_value END)::numeric AS inventory_value,
          COUNT(*)::int AS tracked_days
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
          total_sales,
          COALESCE(inventory_units, 0) AS inventory_units,
          COALESCE(inventory_value, 0) AS inventory_value,
          tracked_days,
          last_movement_date,
          CASE
            WHEN COALESCE(inventory_units, 0) <= 0 OR COALESCE(inventory_value, 0) <= 0 THEN 0::numeric
            WHEN total_sales <= 0 THEN 999999::numeric
            ELSE (COALESCE(inventory_value, 0) * $10::numeric) / NULLIF(total_sales, 0)
          END AS rotation,
          CASE
            WHEN last_movement_date IS NULL THEN NULL
            ELSE ($3::date - last_movement_date)
          END::int AS effective_days
        FROM aggregated
        WHERE total_sales <= $4::numeric
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
          total_sales,
          inventory_units,
          inventory_value,
          rotation,
          tracked_days,
          last_movement_date,
          effective_days,
          CASE
            WHEN inventory_units <= 0 OR inventory_value <= 0 THEN 'Agotado'
            WHEN total_sales > 0
              AND tracked_days > 0
              AND inventory_value > 0
              AND inventory_value <= ((total_sales / tracked_days) * $8::numeric)
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
        total_sales,
        inventory_units,
        inventory_value,
        rotation,
        tracked_days,
        TO_CHAR(last_movement_date, 'YYYY-MM-DD') AS last_movement_date,
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
        periodDays,
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
        totalSales: toNumber(row.total_sales),
        inventoryUnits: toNumber(row.inventory_units),
        inventoryValue: toNumber(row.inventory_value),
        rotation: toNumber(row.rotation),
        trackedDays: toNumber(row.tracked_days),
        lastMovementDate: row.last_movement_date,
        effectiveDays:
          row.effective_days === null || row.effective_days === undefined
            ? null
            : toNumber(row.effective_days),
        status: row.status,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));
  } finally {
    client.release();
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
            },
            meta: {
              effectiveRange: { start: "", end: "" },
              availableRange: { min: "", max: "" },
              sourceTable: "rotacion_base_item_dia_sede",
              maxSalesValue: MAX_SALES_THRESHOLD,
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
    const fullCatalog = await getRotationFilterCatalog(filterCatalogMaxDate);
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

    const rows = await queryRotationRows({
      startDate: boundedRange.start,
      endDate: boundedRange.end,
      maxSalesValue,
      empresa: effectiveCompany,
      sedeId: requestedVisibleSede?.sedeId ?? null,
      lineasN1: requestedLineasN1.length > 0 ? requestedLineasN1 : null,
      periodDays: Math.max(
        1,
        Math.floor(
          (new Date(`${boundedRange.end}T12:00:00`).getTime() -
            new Date(`${boundedRange.start}T12:00:00`).getTime()) /
            (24 * 60 * 60 * 1000),
        ) + 1,
      ),
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
          },
          meta: {
            effectiveRange: { start: "", end: "" },
            availableRange: { min: "", max: "" },
            sourceTable: "rotacion_base_item_dia_sede",
            maxSalesValue: MAX_SALES_THRESHOLD,
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

  if (session.user.role !== "admin") {
    return withSession(
      NextResponse.json(
        { error: "Solo administradores pueden actualizar esta configuracion." },
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
