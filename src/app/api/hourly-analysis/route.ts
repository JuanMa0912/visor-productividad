import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getDbPool, testDbConnection } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { isHorariosOcultarCedula } from "@/lib/horarios-ocultar-cedulas";
import { canAccessPortalSection } from "@/lib/portal-sections";
import type {
  HourlyAnalysisData,
  HourlyLineSales,
  HourlyPersonContribution,
  HourSlot,
  OvertimeEmployee,
} from "@/types";

// ============================================================================
// CONSTANTES
// ============================================================================

const LINE_TABLES = [
  { id: "cajas", name: "Cajas", table: "ventas_cajas" },
  { id: "fruver", name: "Fruver", table: "ventas_fruver" },
  { id: "industria", name: "Industria", table: "ventas_industria" },
  { id: "carnes", name: "Carnes", table: "ventas_carnes" },
  { id: "pollo y pescado", name: "Pollo y pescado", table: "ventas_pollo_pesc" },
  { id: "asadero", name: "Asadero", table: "ventas_asadero" },
] as const;

const LINE_IDS = new Set<string>(LINE_TABLES.map((line) => line.id));
const normalizeLineId = (value: string) => value.trim().toLowerCase();
const NO_STORE_CACHE_CONTROL = "no-store, private";
const OVERTIME_MAX_RANGE_DAYS = 31;
type DashboardContext = "productividad" | "jornada-extendida";
const DASHBOARD_CONTEXTS = new Set<DashboardContext>([
  "productividad",
  "jornada-extendida",
]);

const resolveSessionAllowedLineIds = (allowedLines: string[] | null | undefined) => {
  if (!Array.isArray(allowedLines) || allowedLines.length === 0) {
    return [] as string[];
  }
  const allowed = new Set(Array.from(LINE_IDS).map(normalizeLineId));
  return Array.from(
    new Set(
      allowedLines
        .map((line) => (typeof line === "string" ? normalizeLineId(line) : ""))
        .filter((line) => allowed.has(line)),
    ),
  );
};

const SEDE_CONFIGS = [
  { name: "Calle 5ta", centro: "001", empresa: "mercamio", attendanceNames: ["la 5a", "calle 5a", "calle 5ta"], aliases: ["calle 5ta", "calle 5a", "la 5a", "la 5"] },
  { name: "La 39", centro: "002", empresa: "mercamio", attendanceNames: ["la 39"], aliases: ["la 39", "39"] },
  { name: "Plaza Norte", centro: "003", empresa: "mercamio", attendanceNames: ["plaza norte", "mio plaza norte"], aliases: ["plaza norte", "mio plaza norte"] },
  { name: "Ciudad Jardin", centro: "004", empresa: "mercamio", attendanceNames: ["ciudad jardin"], aliases: ["ciudad jardin", "ciudad jard", "jardin"] },
  { name: "Centro Sur", centro: "005", empresa: "mercamio", attendanceNames: ["centro sur"], aliases: ["centro sur"] },
  { name: "Palmira", centro: "006", empresa: "mercamio", attendanceNames: ["palmira", "palmira mercamio"], aliases: ["palmira", "palmira mercamio"] },
  { name: "Floresta", centro: "001", empresa: "mtodo", attendanceNames: ["floresta"], aliases: ["floresta"] },
  { name: "Floralia", centro: "002", empresa: "mtodo", attendanceNames: ["floralia", "floralia mercatodo", "mercatodo floralia"], aliases: ["floralia", "mercatodo floralia"] },
  { name: "Guaduales", centro: "003", empresa: "mtodo", attendanceNames: ["guaduales"], aliases: ["guaduales"] },
  { name: "Bogota", centro: "001", empresa: "bogota", attendanceNames: ["bogota", "merkmios bogota"], aliases: ["bogota", "bogot", "merkmios bogota", "merkmios bogot"] },
  { name: "Chia", centro: "002", empresa: "bogota", attendanceNames: ["chia", "merkmios chia"], aliases: ["chia", "chi", "ch a", "merkmios chia"] },
  { name: "ADM", centro: null, empresa: null, attendanceNames: ["adm"], aliases: ["adm"] },
  {
    name: "CEDI-CAVASA",
    centro: null,
    empresa: null,
    attendanceNames: ["cedi cavasa", "cedi-cavasa", "cedicavasa"],
    aliases: ["cedi cavasa", "cedi-cavasa", "cedicavasa"],
  },
  {
    name: "Planta Desposte Mixto",
    centro: "999",
    empresa: "mercamio",
    attendanceNames: ["planta desposte mixto"],
    aliases: ["planta desposte mixto", "planta desposte"],
  },
  {
    name: "Panificadora",
    centro: "998",
    empresa: "mercamio",
    attendanceNames: ["panificadora"],
    aliases: ["panificadora"],
  },
  {
    name: "Planta Desprese Pollo",
    centro: "997",
    empresa: "mercamio",
    attendanceNames: ["planta desprese pollo"],
    aliases: ["planta desprese pollo", "desprese pollo"],
  },
] as const;

const DEPARTAMENTO_TO_LINE: Record<string, string> = {
  cajas: "cajas",
  "supervision y cajas": "cajas",
  fruver: "fruver",
  "surtidor fruver": "fruver",
  industria: "industria",
  surtidores: "industria",
  carnes: "carnes",
  "carnes rojas": "carnes",
  "pollo y pescado": "pollo y pescado",
  "surtidor (a) pollo y pescado": "pollo y pescado",
  "surtidor a pollo y pescado": "pollo y pescado",
  asadero: "asadero",
  "pollo asado": "asadero",
  "planta de produccion": "industria",
};

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

const normalizeSedeName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const canonicalizeSedeMatchKey = (value: string) => {
  const normalized = normalizeSedeName(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeName("Calle 5ta");
  }
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeName("CEDI-CAVASA");
  }
  return normalized;
};

const matchSelectedSedeConfigs = (selectedSedes: string[]) => {
  if (selectedSedes.length === 0) return SEDE_CONFIGS;

  const normalizedSelected = selectedSedes.map(canonicalizeSedeMatchKey);
  const matched = SEDE_CONFIGS.filter((cfg) => {
    const aliasPool = [cfg.name, ...cfg.aliases].map(canonicalizeSedeMatchKey);
    return normalizedSelected.some((selected) =>
      aliasPool.some(
        (alias) =>
          selected === alias ||
          selected.includes(alias) ||
          alias.includes(selected),
      ),
    );
  });

  return matched.length > 0 ? matched : SEDE_CONFIGS;
};

const findSedeConfigByName = (sedeName?: string | null) => {
  if (!sedeName) return null;
  const normalizedTarget = canonicalizeSedeMatchKey(sedeName);
  return (
    SEDE_CONFIGS.find((cfg) => {
      const aliasPool = [cfg.name, ...cfg.aliases].map(canonicalizeSedeMatchKey);
      return aliasPool.some(
        (alias) =>
          normalizedTarget === alias ||
          normalizedTarget.includes(alias) ||
          alias.includes(normalizedTarget),
      );
    }) ?? null
  );
};

const normalizeRequestedSedeNames = (sedeNames: string[]): string[] => {
  const normalized: string[] = [];
  for (const sede of sedeNames) {
    const matchedName = findSedeConfigByName(sede)?.name;
    if (matchedName) {
      normalized.push(matchedName);
    }
  }
  return Array.from(new Set(normalized));
};

const resolveAuthorizedSedeAccess = (sessionUser: {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
}) => {
  if (sessionUser.role === "admin") {
    return { authorized: true, hasAllSedes: true, fixedSedeNames: [] as string[] };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const hasAllSedes = rawAllowed.some(
    (sede) => normalizeSedeName(sede) === normalizeSedeName("Todas"),
  );
  if (hasAllSedes) {
    return { authorized: true, hasAllSedes: true, fixedSedeNames: [] as string[] };
  }

  const allowedSedeNames = normalizeRequestedSedeNames(rawAllowed);
  if (allowedSedeNames.length > 0) {
    return {
      authorized: true,
      hasAllSedes: false,
      fixedSedeNames: allowedSedeNames,
    };
  }

  const legacySedeName = sessionUser.sede
    ? findSedeConfigByName(sessionUser.sede)?.name ?? null
    : null;
  if (legacySedeName) {
    return {
      authorized: true,
      hasAllSedes: false,
      fixedSedeNames: [legacySedeName],
    };
  }

  return { authorized: false, hasAllSedes: false, fixedSedeNames: [] as string[] };
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

// ============================================================================
// UTILIDADES DE PARSEO
// ============================================================================

const parseMinuteOfDay = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    const h = Math.floor(raw);
    return h >= 0 && h <= 23 ? h * 60 : null;
  }

  if (raw instanceof Date) {
    const h = raw.getHours();
    const m = raw.getMinutes();
    return h >= 0 && h <= 23 ? h * 60 + m : null;
  }

  const str = String(raw).trim();
  if (!str) return null;

  const asInt = parseInt(str, 10);
  if (!isNaN(asInt) && asInt >= 0 && asInt <= 23 && /^\d{1,2}$/.test(str)) {
    return asInt * 60;
  }

  const timeMatch = str.match(/^(\d{1,2}):(\d{1,2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute;
    }
  }

  return null;
};

const buildSlotLabel = (slotStartMinute: number, bucketMinutes: number) => {
  const startHour = Math.floor(slotStartMinute / 60);
  const startMinute = slotStartMinute % 60;
  const slotEndMinute = (slotStartMinute + bucketMinutes) % 1440;
  const endHour = Math.floor(slotEndMinute / 60);
  const endMinute = slotEndMinute % 60;
  return `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} - ${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
};

const compactDateToISO = (value: string | null | undefined): string | null => {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const EMPLOYEE_ID_COLUMN_CANDIDATES = [
  "numero",
  "identificacion",
  "cedula",
  "cedula_empleado",
  "cedula_colaborador",
  "documento",
  "documento_empleado",
  "documento_colaborador",
  "id_empleado",
  "codigo_empleado",
  "codigo",
  "nit",
  "dni",
  "num_documento",
  "numero_documento",
  "nro_documento",
  "documento_numero",
] as const;

const EMPLOYEE_NAME_COLUMN_CANDIDATES = [
  "nombre_empleado",
  "nombre_trabajador",
  "empleado",
  "trabajador",
  "nombre_completo",
  "nombre_y_apellido",
  "nombre_colaborador",
  "colaborador",
  "nombres_apellidos",
  "nombre",
  "funcionario",
] as const;

const SALES_PERSON_ID_COLUMN_CANDIDATES = [
  ...EMPLOYEE_ID_COLUMN_CANDIDATES,
  "id_vend_cc",
  "id_cajero",
  "codigo_cajero",
  "documento_cajero",
  "cedula_cajero",
  "id_vendedor",
  "codigo_vendedor",
  "documento_vendedor",
  "cedula_vendedor",
  "usuario",
  "usuario_cajero",
  "usuario_vendedor",
] as const;

const SALES_PERSON_NAME_COLUMN_CANDIDATES = [
  ...EMPLOYEE_NAME_COLUMN_CANDIDATES,
  "cajero",
  "nombre_cajero",
  "nombre_cajera",
  "nombre_vendedor",
  "vendedor",
  "vendedora",
  "usuario",
  "usuario_cajero",
  "usuario_vendedor",
  "operador",
  "nombre_operador",
] as const;

const normalizeColumnName = (value: string) => value.trim().toLowerCase();

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const pickAttendanceColumn = (
  columns: string[],
  candidates: readonly string[],
  fuzzyTokens: readonly string[],
): string | null => {
  const exact = columns.find((col) =>
    candidates.includes(normalizeColumnName(col)),
  );
  if (exact) return exact;

  const fuzzy = columns.find((col) => {
    const normalized = normalizeColumnName(col);
    if (normalized.includes("tipo")) return false;
    return fuzzyTokens.some((token) => normalized.includes(token));
  });
  return fuzzy ?? null;
};

const parseHoursValue = (value: string | number): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeIncidentValue = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const isAbsenceIncident = (value: string | null | undefined) =>
  normalizeIncidentValue(value).includes("inasistencia");

const buildNormalizeSedeSql = (columnName: string) => `
  REGEXP_REPLACE(
    LOWER(
      TRANSLATE(
        TRIM(${columnName}),
        CHR(225)||CHR(233)||CHR(237)||CHR(243)||CHR(250)||CHR(252)||CHR(241)||CHR(193)||CHR(201)||CHR(205)||CHR(211)||CHR(218)||CHR(220)||CHR(209),
        'aeiouunaeiouun'
      )
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  )
`;

const computePresenceSlots = (
  horaEntrada: unknown,
  horaIntermedia1: unknown,
  horaIntermedia2: unknown,
  horaSalida: unknown,
  bucketMinutes: number,
): Set<number> => {
  const presentSlots = new Set<number>();

  const entry = parseMinuteOfDay(horaEntrada);
  const exit = parseMinuteOfDay(horaSalida);
  if (entry === null || exit === null) return presentSlots;

  const break1 = parseMinuteOfDay(horaIntermedia1);
  const break2 = parseMinuteOfDay(horaIntermedia2);

  const isInBreak = (minuteOfDay: number) => {
    if (break1 === null || break2 === null) return false;
    if (break1 <= break2) {
      return minuteOfDay >= break1 && minuteOfDay < break2;
    }
    return minuteOfDay >= break1 || minuteOfDay < break2;
  };

  const isInShift = (minuteOfDay: number) => {
    if (entry <= exit) {
      return minuteOfDay >= entry && minuteOfDay <= exit;
    }
    return minuteOfDay >= entry || minuteOfDay <= exit;
  };

  for (let slotStart = 0; slotStart < 1440; slotStart += bucketMinutes) {
    if (isInShift(slotStart) && !isInBreak(slotStart)) {
      presentSlots.add(slotStart);
    }
  }

  return presentSlots;
};

// ============================================================================
// RATE LIMITING
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RESPONSE_CACHE_TTL_MS = 30_000;
const responseCache = new Map<string, { expiresAt: number; data: HourlyAnalysisData }>();
const TABLE_COLUMNS_CACHE_TTL_MS = 5 * 60_000;
const tableColumnsCache = new Map<string, { expiresAt: number; columns: string[] }>();

const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
};

const getInclusiveDateRangeDays = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

const checkRateLimit = (request: Request) => {
  const now = Date.now();
  const clientIp = getClientIp(request);
  const entry = rateLimitStore.get(clientIp);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }
  if (entry.count >= RATE_LIMIT_MAX) return entry.resetAt;
  entry.count += 1;
  return null;
};

const getCachedResponse = (key: string): HourlyAnalysisData | null => {
  const now = Date.now();
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    responseCache.delete(key);
    return null;
  }
  return cached.data;
};

const setCachedResponse = (key: string, data: HourlyAnalysisData) => {
  const now = Date.now();
  responseCache.set(key, {
    expiresAt: now + RESPONSE_CACHE_TTL_MS,
    data,
  });
  // Limpieza simple para evitar crecimiento infinito.
  for (const [cacheKey, value] of responseCache.entries()) {
    if (value.expiresAt <= now) {
      responseCache.delete(cacheKey);
    }
  }
};

const getTableColumns = async (client: PoolClient, tableName: string) => {
  const now = Date.now();
  const cached = tableColumnsCache.get(tableName);
  if (cached && cached.expiresAt > now) {
    return cached.columns;
  }

  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName],
  );

  const columns = (result.rows ?? [])
    .map((row) => (row as { column_name?: string }).column_name)
    .filter((value): value is string => Boolean(value));

  tableColumnsCache.set(tableName, {
    expiresAt: now + TABLE_COLUMNS_CACHE_TTL_MS,
    columns,
  });

  return columns;
};

// ============================================================================
// FETCH DATA
// ============================================================================

const fetchHourlyData = async (
  dateISO: string,
  lineFilter: string | null,
  bucketMinutes: number,
  selectedSedes: string[],
  allowedLineIds: string[] = [],
  includePeopleBreakdown = false,
  overtimeOnly = false,
  overtimeDateStart?: string | null,
  overtimeDateEnd?: string | null,
): Promise<HourlyAnalysisData> => {
  const pool = await getDbPool();
  const client = await pool.connect();

  try {
    const dateCompact = dateISO.split("-").join("");
    const allowedSet = new Set(allowedLineIds.map(normalizeLineId));
    const allowedLineTables =
      allowedSet.size > 0
        ? LINE_TABLES.filter((line) => allowedSet.has(normalizeLineId(line.id)))
        : LINE_TABLES;
    const selectedLineTables = lineFilter
      ? allowedLineTables.filter((line) => line.id === lineFilter)
      : allowedLineTables;
    const selectedSedeConfigs = matchSelectedSedeConfigs(selectedSedes);
    const selectedScopeLabel =
      selectedSedeConfigs.length === 0 || selectedSedeConfigs.length === SEDE_CONFIGS.length
        ? "Todas las sedes"
        : selectedSedeConfigs.map((cfg) => cfg.name).join(", ");
    const salesBranchClauses = selectedSedeConfigs
      .map(
        (_cfg, index) =>
          `(centro_operacion = $${index * 2 + 2} AND (empresa_bd = $${index * 2 + 3} OR ($${index * 2 + 3} IS NULL AND empresa_bd IS NULL)))`,
      )
      .join(" OR ");
    const salesBranchFilter =
      selectedSedeConfigs.length > 0 ? `AND (${salesBranchClauses})` : "AND 1=0";
    const salesBranchParams: Array<string | null> = [];
    selectedSedeConfigs.forEach((cfg) => {
      salesBranchParams.push(cfg.centro, cfg.empresa);
    });

    let salesDateCompact = dateCompact;
    let salesDateUsed: string | null = dateISO;
    if (overtimeOnly) {
      salesDateUsed = null;
    }
    if (!overtimeOnly) try {
      const latestSalesDateSubqueries = selectedLineTables
        .map(
          (line) => `
            SELECT MAX(fecha_dcto) AS max_fecha
            FROM ${line.table}
            WHERE fecha_dcto <= $1
              ${salesBranchFilter}
          `,
        )
        .join(" UNION ALL ");
      const latestSalesDateResult = await client.query(
        `
          SELECT MAX(max_fecha) AS sales_date
          FROM (
            ${latestSalesDateSubqueries}
          ) AS latest_dates
        `,
        [dateCompact, ...salesBranchParams],
      );
      const candidate = (latestSalesDateResult.rows?.[0] as { sales_date?: string })
        ?.sales_date;
      if (candidate && /^\d{8}$/.test(candidate)) {
        salesDateCompact = candidate;
      }
    } catch (error) {
      console.warn("[hourly-analysis] Error resolviendo fecha de ventas:", error);
    }

    const salesByHourByLine = new Map<number, Map<string, number>>();

    if (!overtimeOnly) {
      const salesPromises = selectedLineTables.map(async (line) => {
        try {
          const query = `
            SELECT
              hora_final_hora,
              COALESCE(SUM(total_bruto), 0) AS total_sales
            FROM ${line.table}
            WHERE fecha_dcto = $1
              ${salesBranchFilter}
            GROUP BY hora_final_hora
            ORDER BY hora_final_hora
          `;

          const queryParams: Array<string | null> = [salesDateCompact, ...salesBranchParams];
          const result = await client.query(query, queryParams);

          if (!result.rows) return;

          for (const row of result.rows) {
            const typedRow = row as {
              hora_final_hora: unknown;
              total_sales: string | number;
            };
            const minuteOfDay = parseMinuteOfDay(typedRow.hora_final_hora);
            if (minuteOfDay === null) continue;
            const bucketStartMinute =
              Math.floor(minuteOfDay / bucketMinutes) * bucketMinutes;

            if (!salesByHourByLine.has(bucketStartMinute)) {
              salesByHourByLine.set(bucketStartMinute, new Map());
            }
            const lineMap = salesByHourByLine.get(bucketStartMinute)!;
            lineMap.set(
              line.id,
              (lineMap.get(line.id) ?? 0) + (Number(typedRow.total_sales) || 0),
            );
          }
        } catch (error) {
          console.warn(`[hourly-analysis] Error consultando ${line.table}:`, error);
        }
      });

      await Promise.all(salesPromises);
    }

    const personContributions: HourlyPersonContribution[] = [];

    if (
      !overtimeOnly &&
      includePeopleBreakdown &&
      lineFilter === "cajas" &&
      selectedLineTables.some((line) => line.id === "cajas")
    ) {
      try {
        const salesColumns = await getTableColumns(client, "ventas_cajas");
        const salesColumnLookup = new Map(
          salesColumns.map((column) => [normalizeColumnName(column), column]),
        );

        const personIdColumn =
          salesColumnLookup.get("id_vend_cc") ??
          pickAttendanceColumn(salesColumns, SALES_PERSON_ID_COLUMN_CANDIDATES, [
            "cedula",
            "document",
            "codigo",
            "id",
            "numero",
            "usuario",
          ]);
        const personNameColumn =
          salesColumnLookup.get("vendedor") ??
          pickAttendanceColumn(salesColumns, SALES_PERSON_NAME_COLUMN_CANDIDATES, [
            "cajer",
            "vendedor",
            "usuario",
            "operador",
            "emplead",
            "nombre",
          ]);

        const personIdIdentifier = personIdColumn
          ? quoteIdentifier(personIdColumn)
          : null;
        const personNameIdentifier = personNameColumn
          ? quoteIdentifier(personNameColumn)
          : null;
        const personIdExpr = personIdIdentifier
          ? `NULLIF(TRIM(CAST(${personIdIdentifier} AS text)), '')`
          : "NULL::text";
        const personNameExpr = personNameIdentifier
          ? `NULLIF(TRIM(CAST(${personNameIdentifier} AS text)), '')`
          : "NULL::text";

        const peopleQuery = `
          SELECT
            COALESCE(${personIdExpr}, 'sin-id') || '|' || COALESCE(${personNameExpr}, 'sin-nombre') AS person_key,
            ${personIdExpr} AS person_id,
            COALESCE(${personNameExpr}, ${personIdExpr}, 'Sin identificar') AS person_name,
            hora_final_hora,
            COALESCE(SUM(total_bruto), 0) AS total_sales
          FROM ventas_cajas
          WHERE fecha_dcto = $1
            ${salesBranchFilter}
          GROUP BY 1, 2, 3, hora_final_hora
          ORDER BY 3, hora_final_hora
        `;

        const peopleResult = await client.query(peopleQuery, [
          salesDateCompact,
          ...salesBranchParams,
        ]);

        const peopleMap = new Map<
          string,
          {
            personKey: string;
            personId?: string | null;
            personName: string;
            firstMinuteOfDay: number | null;
            lastMinuteOfDay: number | null;
            hourlySales: Map<number, number>;
          }
        >();

        for (const row of peopleResult.rows ?? []) {
          const typedRow = row as {
            person_key: string;
            person_id?: string | null;
            person_name: string;
            hora_final_hora: unknown;
            total_sales: string | number;
          };
          const minuteOfDay = parseMinuteOfDay(typedRow.hora_final_hora);
          if (minuteOfDay === null) continue;
          const bucketStartMinute =
            Math.floor(minuteOfDay / bucketMinutes) * bucketMinutes;
          const personKey = typedRow.person_key?.trim() || "sin-identificar";
          const personName =
            typedRow.person_name?.trim() ||
            typedRow.person_id?.trim() ||
            "Sin identificar";
          const personId = typedRow.person_id?.trim() || null;
          const salesValue = Number(typedRow.total_sales) || 0;

          if (!peopleMap.has(personKey)) {
            peopleMap.set(personKey, {
              personKey,
              personId,
              personName,
              firstMinuteOfDay: bucketStartMinute,
              lastMinuteOfDay: bucketStartMinute,
              hourlySales: new Map<number, number>(),
            });
          }

          const personEntry = peopleMap.get(personKey)!;
          personEntry.hourlySales.set(
            bucketStartMinute,
            (personEntry.hourlySales.get(bucketStartMinute) ?? 0) + salesValue,
          );
          personEntry.firstMinuteOfDay =
            personEntry.firstMinuteOfDay === null
              ? bucketStartMinute
              : Math.min(personEntry.firstMinuteOfDay, bucketStartMinute);
          personEntry.lastMinuteOfDay =
            personEntry.lastMinuteOfDay === null
              ? bucketStartMinute
              : Math.max(personEntry.lastMinuteOfDay, bucketStartMinute);
        }

        for (const person of peopleMap.values()) {
          if (isHorariosOcultarCedula(person.personId)) {
            continue;
          }
          const hourlySales = Array.from(person.hourlySales.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([slotStartMinute, sales]) => ({
              slotStartMinute,
              slotEndMinute: (slotStartMinute + bucketMinutes) % 1440,
              label: buildSlotLabel(slotStartMinute, bucketMinutes),
              sales,
            }));

          personContributions.push({
            personKey: person.personKey,
            personId: person.personId,
            personName: person.personName,
            firstMinuteOfDay: person.firstMinuteOfDay,
            lastMinuteOfDay: person.lastMinuteOfDay,
            hourlySales,
          });
        }

        personContributions.sort((a, b) => {
          const totalA = a.hourlySales.reduce((sum, slot) => sum + slot.sales, 0);
          const totalB = b.hourlySales.reduce((sum, slot) => sum + slot.sales, 0);
          return totalB - totalA;
        });
      } catch (error) {
        console.warn("[hourly-analysis] Error consultando detalle de cajas:", error);
      }
    }

    const presenceByHour = new Map<number, number>();
    const presenceByHourByLine = new Map<number, Map<string, number>>();

    let attendanceDateUsed: string | null = null;
    const overtimeEmployees: OvertimeEmployee[] = [];

    try {
      const selectedAttendanceNames = Array.from(
        new Set(
          selectedSedeConfigs.flatMap((cfg) =>
            [cfg.name, ...cfg.attendanceNames].map((name) =>
              normalizeSedeName(name),
            ),
          ),
        ),
      );
      const attendanceDateResult = await client.query(
        `
        SELECT MAX(fecha::date)::text AS attendance_date
        FROM asistencia_horas
        WHERE fecha::date <= $1::date
          ${
            selectedSedeConfigs.length > 0
              ? `AND ${buildNormalizeSedeSql("sede")} = ANY($2::text[])`
              : "AND 1=0"
          }
        `,
        selectedSedeConfigs.length > 0
          ? [dateISO, selectedAttendanceNames]
          : [dateISO],
      );
      attendanceDateUsed =
        (attendanceDateResult.rows?.[0] as { attendance_date?: string })
          ?.attendance_date ?? null;

      const attendanceQuery = `
        SELECT
          hora_entrada,
          hora_intermedia1,
          hora_intermedia2,
          hora_salida,
          departamento
        FROM asistencia_horas
        WHERE fecha::date = $1::date
          AND departamento IS NOT NULL
          ${
            selectedSedeConfigs.length > 0
              ? `AND ${buildNormalizeSedeSql("sede")} = ANY($2::text[])`
              : "AND 1=0"
          }
      `;
      const attendanceColumns = await getTableColumns(client, "asistencia_horas");
      const attendanceColumnSet = new Set(
        attendanceColumns.map((col) => normalizeColumnName(col)),
      );
      if (!overtimeOnly && attendanceDateUsed) {
        const attendanceParams: unknown[] = [attendanceDateUsed];
        if (selectedSedeConfigs.length > 0) {
          attendanceParams.push(selectedAttendanceNames);
        }
        const attendanceResult = await client.query(attendanceQuery, attendanceParams);

        if (attendanceResult.rows) {
          for (const row of attendanceResult.rows) {
            const typedRow = row as {
              hora_entrada: unknown;
              hora_intermedia1: unknown;
              hora_intermedia2: unknown;
              hora_salida: unknown;
              departamento: string;
            };

            const lineId = resolveLineId(typedRow.departamento);
            if (!lineId) continue;
            if (allowedSet.size > 0 && !allowedSet.has(normalizeLineId(lineId))) {
              continue;
            }

            const slots = computePresenceSlots(
              typedRow.hora_entrada,
              typedRow.hora_intermedia1,
              typedRow.hora_intermedia2,
              typedRow.hora_salida,
              bucketMinutes,
            );

            for (const slotStartMinute of slots) {
              presenceByHour.set(
                slotStartMinute,
                (presenceByHour.get(slotStartMinute) ?? 0) + 1,
              );

              if (!presenceByHourByLine.has(slotStartMinute)) {
                presenceByHourByLine.set(slotStartMinute, new Map());
              }
              const linePresenceMap = presenceByHourByLine.get(slotStartMinute)!;
              linePresenceMap.set(lineId, (linePresenceMap.get(lineId) ?? 0) + 1);
            }
          }
        }
      }

      if (attendanceColumnSet.has("total_laborado_horas")) {
        const employeeNameColumn = pickAttendanceColumn(
          attendanceColumns,
          EMPLOYEE_NAME_COLUMN_CANDIDATES,
          ["nombre", "emplead", "trabajador", "colaborador", "funcionario"],
        );
        const firstNameColumn =
          attendanceColumns.find(
            (col) => normalizeColumnName(col) === "nombres",
          ) ?? null;
        const lastNameColumn =
          attendanceColumns.find(
            (col) => normalizeColumnName(col) === "apellidos",
          ) ?? null;
        const employeeIdColumns = Array.from(
          new Set([
            ...attendanceColumns.filter((col) =>
              EMPLOYEE_ID_COLUMN_CANDIDATES.includes(
                normalizeColumnName(col) as (typeof EMPLOYEE_ID_COLUMN_CANDIDATES)[number],
              ),
            ),
            ...Array.from(attendanceColumns).filter((col) => {
              const normalized = normalizeColumnName(col);
              if (normalized.includes("tipo")) return false;
              return ["cedula", "ident", "document", "doc", "dni", "nit"].some(
                (token) => normalized.includes(token),
              );
            }),
          ]),
        );
        const employeeIdIdentifiers = employeeIdColumns
          .map((col) => quoteIdentifier(col))
          .filter((value): value is string => Boolean(value));
        const employeeNameIdentifier = employeeNameColumn
          ? quoteIdentifier(employeeNameColumn)
          : null;
        const firstNameIdentifier = firstNameColumn
          ? quoteIdentifier(firstNameColumn)
          : null;
        const lastNameIdentifier = lastNameColumn
          ? quoteIdentifier(lastNameColumn)
          : null;
        const nominaColumn =
          attendanceColumns.find(
            (col) => normalizeColumnName(col) === "nomina",
          ) ?? null;
        const nominaIdentifier = nominaColumn
          ? quoteIdentifier(nominaColumn)
          : null;

        if (
          employeeIdIdentifiers.length > 0 ||
          employeeNameIdentifier ||
          firstNameIdentifier ||
          lastNameIdentifier
        ) {
          const employeeIdExpr =
            employeeIdIdentifiers.length > 0
              ? `COALESCE(${employeeIdIdentifiers
                  .map(
                    (identifier) =>
                      `NULLIF(TRIM(BOTH '"' FROM CAST(${identifier} AS text)), '')`,
                  )
                  .join(", ")})`
              : "NULL::text";
          const employeeNameExpr = employeeNameIdentifier
            ? `NULLIF(TRIM(CAST(${employeeNameIdentifier} AS text)), '')`
            : firstNameIdentifier || lastNameIdentifier
              ? `NULLIF(
                   TRIM(
                     CONCAT_WS(
                       ' ',
                       ${
                         firstNameIdentifier
                           ? `NULLIF(TRIM(CAST(${firstNameIdentifier} AS text)), '')`
                           : "NULL"
                       },
                       ${
                         lastNameIdentifier
                           ? `NULLIF(TRIM(CAST(${lastNameIdentifier} AS text)), '')`
                           : "NULL"
                       }
                     )
                   ),
                   ''
                 )`
              : "NULL::text";
          const overtimeStart = overtimeDateStart ?? attendanceDateUsed ?? dateISO;
          const overtimeEnd = overtimeDateEnd ?? overtimeStart;
          const overtimeQuery = `
            WITH raw AS (
              SELECT
                ${employeeIdExpr} AS employee_id,
                ${employeeNameExpr} AS employee_name,
                NULLIF(TRIM(CAST(sede AS text)), '') AS sede,
                fecha::date::text AS worked_date,
                NULLIF(TRIM(CAST(departamento AS text)), '') AS departamento,
                NULLIF(TRIM(CAST(cargo AS text)), '') AS cargo,
                NULLIF(TRIM(CAST(incidencia AS text)), '') AS incidencia,
                ${
                  nominaIdentifier
                    ? `NULLIF(TRIM(CAST(${nominaIdentifier} AS text)), '')`
                    : "NULL::text"
                } AS nomina,
                TO_CHAR(hora_entrada, 'HH24:MI:SS') AS hora_entrada,
                TO_CHAR(hora_intermedia1, 'HH24:MI:SS') AS hora_intermedia1,
                TO_CHAR(hora_intermedia2, 'HH24:MI:SS') AS hora_intermedia2,
                TO_CHAR(hora_salida, 'HH24:MI:SS') AS hora_salida,
                COALESCE(total_laborado_horas, 0) AS total_hours_row,
                (
                  (CASE WHEN hora_entrada IS NOT NULL THEN 1 ELSE 0 END) +
                  (CASE WHEN hora_intermedia1 IS NOT NULL THEN 1 ELSE 0 END) +
                  (CASE WHEN hora_intermedia2 IS NOT NULL THEN 1 ELSE 0 END) +
                  (CASE WHEN hora_salida IS NOT NULL THEN 1 ELSE 0 END)
                )::int AS marks_count_row,
                COALESCE(
                  ${employeeIdExpr},
                  ${employeeNameExpr},
                  md5(
                    COALESCE(sede::text, '') || '|' ||
                    COALESCE(departamento::text, '') || '|' ||
                    COALESCE(TO_CHAR(hora_entrada, 'HH24:MI:SS'), '') || '|' ||
                    COALESCE(TO_CHAR(hora_salida, 'HH24:MI:SS'), '') || '|' ||
                    COALESCE(fecha::date::text, '')
                  )
                ) AS employee_key
              FROM asistencia_horas
              WHERE fecha::date >= $1::date
                AND fecha::date <= $2::date
                AND departamento IS NOT NULL
                ${
                  selectedSedeConfigs.length > 0
                    ? `AND ${buildNormalizeSedeSql("sede")} = ANY($3::text[])`
                    : "AND 1=0"
                }
            ),
            base AS (
              SELECT
                employee_key,
                worked_date,
                sede,
                COALESCE(MAX(employee_id), MAX(employee_name)) AS employee_id,
                COALESCE(MAX(employee_name), MAX(employee_id)) AS employee_name,
                MAX(departamento) AS departamento,
                MAX(cargo) AS cargo,
                MAX(incidencia) AS incidencia,
                MAX(nomina) AS nomina,
                MAX(hora_entrada) AS hora_entrada,
                MAX(hora_intermedia1) AS hora_intermedia1,
                MAX(hora_intermedia2) AS hora_intermedia2,
                MAX(hora_salida) AS hora_salida,
                COALESCE(SUM(total_hours_row), 0) AS total_hours,
                MAX(marks_count_row)::int AS marks_count
              FROM raw
              GROUP BY employee_key, worked_date, sede
            )
            SELECT
              employee_id,
              employee_name,
              sede,
              departamento,
              cargo,
              incidencia,
              nomina,
              hora_entrada,
              hora_intermedia1,
              hora_intermedia2,
              hora_salida,
              worked_date,
              total_hours,
              marks_count
            FROM base
            ORDER BY worked_date DESC, total_hours DESC
          `;
          const overtimeParams: unknown[] = [overtimeStart, overtimeEnd];
          if (selectedSedeConfigs.length > 0) {
            overtimeParams.push(selectedAttendanceNames);
          }

          const overtimeResult = await client.query(overtimeQuery, overtimeParams);
          const lineNameById = new Map<string, string>(
            LINE_TABLES.map((line) => [line.id, line.name]),
          );
          for (const row of overtimeResult.rows ?? []) {
            const typedRow = row as {
              employee_id: string | null;
              employee_name: string | null;
              sede: string | null;
              departamento: string;
              cargo?: string | null;
              incidencia?: string | null;
              nomina?: string | null;
              hora_entrada?: string | null;
              hora_intermedia1?: string | null;
              hora_intermedia2?: string | null;
              hora_salida?: string | null;
              worked_date: string;
              total_hours: string | number;
              marks_count?: number | null;
            };
            const lineId = resolveLineId(typedRow.departamento);
            if (allowedSet.size > 0 && lineId && !allowedSet.has(normalizeLineId(lineId))) {
              continue;
            }
            if (lineFilter && lineId !== lineFilter) continue;

            const employeeId = typedRow.employee_id?.trim() || null;
            if (isHorariosOcultarCedula(employeeId)) {
              continue;
            }
            const employeeNameRaw = typedRow.employee_name?.trim() || "";
            const employeeName =
              employeeNameRaw || employeeId || "Empleado sin nombre";
            const workedHours = parseHoursValue(typedRow.total_hours);
            const incident = typedRow.incidencia?.trim() || undefined;
            const isAbsence = isAbsenceIncident(incident);
            if (workedHours <= 0 && !isAbsence) {
              continue;
            }
            const role = typedRow.cargo?.trim() || undefined;
            const roleSource = `${typedRow.cargo ?? ""} ${typedRow.departamento ?? ""}`.trim();
            const roleKey = roleSource
              ? roleSource
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, " ")
                  .trim()
              : "";
            const roleKeyCompact = roleKey.replace(/\s+/g, "");
            let employeeType: string | undefined;
            if (
              (roleKey.includes("36") && roleKey.includes("hora")) ||
              roleKeyCompact.includes("36h") ||
              roleKeyCompact.includes("36hora") ||
              roleKeyCompact.includes("36horas")
            ) {
              employeeType = "36 horas";
            } else if (roleKey.includes("medio")) {
              employeeType = "Medio tiempo";
            } else {
              employeeType = "Tiempo completo";
            }

            overtimeEmployees.push({
              employeeId,
              employeeName,
              workedHours,
              isAbsence,
              lineName: lineId ? lineNameById.get(lineId) ?? lineId : undefined,
              sede: typedRow.sede?.trim() || undefined,
              department: typedRow.departamento?.trim() || undefined,
              nomina: typedRow.nomina?.trim() || undefined,
              marksCount: Number(typedRow.marks_count ?? 0),
              role,
              employeeType,
              incident,
              markIn: typedRow.hora_entrada?.trim() || undefined,
              markBreak1: typedRow.hora_intermedia1?.trim() || undefined,
              markBreak2: typedRow.hora_intermedia2?.trim() || undefined,
              markOut: typedRow.hora_salida?.trim() || undefined,
              workedDate: typedRow.worked_date,
            });
          }

          overtimeEmployees.sort((a, b) => b.workedHours - a.workedHours);
        }
      }
    } catch (error) {
      console.warn("[hourly-analysis] Error consultando asistencia_horas:", error);
    }

    const hours: HourSlot[] = [];
    if (!overtimeOnly) {
      for (
        let slotStartMinute = 0;
        slotStartMinute < 1440;
        slotStartMinute += bucketMinutes
      ) {
        const lineSalesMap =
          salesByHourByLine.get(slotStartMinute) ?? new Map<string, number>();
        const linePresenceMap =
          presenceByHourByLine.get(slotStartMinute) ?? new Map<string, number>();

        const lines: HourlyLineSales[] = selectedLineTables.map((lt) => ({
          lineId: lt.id,
          lineName: lt.name,
          sales: lineSalesMap.get(lt.id) ?? 0,
        }));

        const totalSales = lines.reduce((sum, l) => sum + l.sales, 0);
        const employeesByLine = Object.fromEntries(
          selectedLineTables.map((line) => [line.id, linePresenceMap.get(line.id) ?? 0]),
        );

        hours.push({
          hour: Math.floor(slotStartMinute / 60),
          slotStartMinute,
          slotEndMinute: (slotStartMinute + bucketMinutes) % 1440,
          label: buildSlotLabel(slotStartMinute, bucketMinutes),
          totalSales,
          employeesPresent: lineFilter
            ? linePresenceMap.get(lineFilter) ?? 0
            : presenceByHour.get(slotStartMinute) ?? 0,
          employeesByLine,
          lines,
        });
      }
    }

    const lineName = lineFilter
      ? selectedLineTables.find((line) => line.id === lineFilter)?.name || lineFilter
      : null;

    return {
      date: dateISO,
      scopeLabel: lineName
        ? `${selectedScopeLabel} - ${lineName}`
        : selectedScopeLabel,
      attendanceDateUsed,
      salesDateUsed: salesDateUsed ? compactDateToISO(salesDateCompact) : null,
      bucketMinutes,
      overtimeEmployees,
      personContributions,
      hours,
    };
  } finally {
    client.release();
  }
};

// ============================================================================
// HANDLER
// ============================================================================

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
  const url = new URL(request.url);
  const dashboardContextParam = url.searchParams.get("dashboardContext")?.trim();
  if (
    dashboardContextParam &&
    !DASHBOARD_CONTEXTS.has(dashboardContextParam as DashboardContext)
  ) {
    return withSession(
      NextResponse.json(
        { error: "Contexto de modulo invalido para el analisis por hora." },
        { status: 400 },
      ),
    );
  }
  const dashboardContext: DashboardContext =
    dashboardContextParam === "jornada-extendida"
      ? "jornada-extendida"
      : "productividad";
  const requiredSection =
    dashboardContext === "jornada-extendida" ? "operacion" : "producto";
  const allowedDashboards = session.user.allowedDashboards;
  if (
    session.user.role !== "admin" &&
    !canAccessPortalSection(allowedDashboards, requiredSection)
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }
  const allowedLineSet = new Set(allowedLineIds.map(normalizeLineId));
  const limitedUntil = checkRateLimit(request);
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta mas tarde." },
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

  const dateParam = url.searchParams.get("date");
  const overtimeDateStartParam = url.searchParams.get("overtimeDateStart");
  const overtimeDateEndParam = url.searchParams.get("overtimeDateEnd");
  const overtimeOnlyParam = url.searchParams.get("overtimeOnly");
  const overtimeOnly =
    overtimeOnlyParam === "1" || overtimeOnlyParam === "true";
  const lineParam = url.searchParams.get("line")?.trim() || null;
  const includePeopleBreakdown =
    url.searchParams.get("includePeople") === "1" ||
    url.searchParams.get("includePeople") === "true";
  const sedeParams = url.searchParams.getAll("sede").filter(Boolean);
  const requestedSedeNames = normalizeRequestedSedeNames(sedeParams);
  if (sedeParams.length > 0 && requestedSedeNames.length === 0) {
    return withSession(
      NextResponse.json(
        { error: "Sede invalida para el analisis por hora." },
        { status: 400 },
      ),
    );
  }
  let effectiveSedeParams = requestedSedeNames;
  if (dashboardContext === "jornada-extendida") {
    const sedeAccess = resolveAuthorizedSedeAccess(session.user);
    if (!sedeAccess.authorized) {
      return withSession(
        NextResponse.json(
          { error: "No tienes permisos para consultar las sedes asignadas." },
          { status: 403 },
        ),
      );
    }
    const allowedSedeSet = new Set(sedeAccess.fixedSedeNames);
    if (
      !sedeAccess.hasAllSedes &&
      requestedSedeNames.some((sede) => !allowedSedeSet.has(sede))
    ) {
      return withSession(
        NextResponse.json(
          { error: "No tienes permisos para consultar alguna de las sedes solicitadas." },
          { status: 403 },
        ),
      );
    }
    effectiveSedeParams = sedeAccess.hasAllSedes
      ? requestedSedeNames
      : requestedSedeNames.length > 0
        ? requestedSedeNames
        : sedeAccess.fixedSedeNames;
  }
  const bucketParamRaw = url.searchParams.get("bucketMinutes");
  const bucketMinutes = bucketParamRaw ? Number(bucketParamRaw) : 60;

  if (!dateParam) {
    return withSession(
      NextResponse.json(
        { error: 'Parametro "date" es requerido.' },
        { status: 400 },
      ),
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de fecha invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }

  if (overtimeDateStartParam && !/^\d{4}-\d{2}-\d{2}$/.test(overtimeDateStartParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de overtimeDateStart invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }

  if (overtimeDateEndParam && !/^\d{4}-\d{2}-\d{2}$/.test(overtimeDateEndParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de overtimeDateEnd invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }

  if (
    overtimeDateStartParam &&
    overtimeDateEndParam &&
    overtimeDateStartParam > overtimeDateEndParam
  ) {
    return withSession(
      NextResponse.json(
        { error: "overtimeDateStart no puede ser mayor que overtimeDateEnd." },
        { status: 400 },
      ),
    );
  }

  if (overtimeDateStartParam && overtimeDateEndParam) {
    const overtimeRangeDays = getInclusiveDateRangeDays(
      overtimeDateStartParam,
      overtimeDateEndParam,
    );
    if (!overtimeRangeDays || overtimeRangeDays > OVERTIME_MAX_RANGE_DAYS) {
      return withSession(
        NextResponse.json(
          {
            error: `El rango de overtime no puede superar ${OVERTIME_MAX_RANGE_DAYS} dias.`,
          },
          { status: 400 },
        ),
      );
    }
  }

  if (lineParam && !LINE_IDS.has(lineParam)) {
    return withSession(
      NextResponse.json(
        { error: "Linea invalida para el analisis por hora." },
        { status: 400 },
      ),
    );
  }
  if (
    lineParam &&
    allowedLineSet.size > 0 &&
    !allowedLineSet.has(normalizeLineId(lineParam))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para consultar esa linea." },
        { status: 403 },
      ),
    );
  }

  const allowedBuckets = new Set([60, 30, 20, 15, 10]);
  if (!allowedBuckets.has(bucketMinutes)) {
    return withSession(
      NextResponse.json(
        { error: "bucketMinutes invalido. Valores permitidos: 60, 30, 20, 15, 10." },
        { status: 400 },
      ),
    );
  }

  const cacheKey = JSON.stringify({
    userId: session.user.id,
    role: session.user.role,
    dashboardContext,
    dateParam,
    overtimeDateStartParam,
    overtimeDateEndParam,
    lineParam,
    includePeopleBreakdown,
    bucketMinutes,
    effectiveSedeParams,
    allowedLineIds,
  });
  const cachedData = getCachedResponse(cacheKey);
  if (cachedData) {
    return withSession(
      NextResponse.json(cachedData, {
        headers: {
          "Cache-Control": NO_STORE_CACHE_CONTROL,
          "X-Data-Source": "memory-cache",
        },
      }),
    );
  }

  try {
    await testDbConnection();
    const data = await fetchHourlyData(
      dateParam,
      lineParam,
      bucketMinutes,
      effectiveSedeParams,
      allowedLineIds,
      includePeopleBreakdown,
      overtimeOnly,
      overtimeDateStartParam,
      overtimeDateEndParam,
    );

    setCachedResponse(cacheKey, data);

    return withSession(
      NextResponse.json(data, {
        headers: {
          "Cache-Control": NO_STORE_CACHE_CONTROL,
          "X-Data-Source": "database",
        },
      }),
    );
  } catch (error) {
    console.error("[hourly-analysis] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar los datos del analisis por hora." },
        { status: 500 },
      ),
    );
  }
}
