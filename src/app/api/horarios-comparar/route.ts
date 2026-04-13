import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import type { Sede } from "@/lib/constants";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { canAccessHorariosCompararBoard } from "@/lib/special-role-features";
import { normalizeKeySpaced } from "@/lib/normalize";
import {
  buildComparisonLookupKey,
  mergePlanillaWithAttendance,
  type AttendanceCompareInput,
  type PlanillaCompareInput,
} from "@/lib/horarios-comparar-utils";

const NO_STORE_CACHE_CONTROL = "no-store, private";
const MAX_RANGE_DAYS = 45;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 40;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (request: Request) => {
  const trustProxy = process.env.TRUST_PROXY === "true";
  const forwarded = trustProxy ? request.headers.get("x-forwarded-for") : null;
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
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

const normalizeColumnName = (value: string) => value.trim().toLowerCase();
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const normalizeText = (value?: string | null) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeSedeKey = normalizeKeySpaced;

const BASE_SEDES: Sede[] = [
  { id: "Calle 5ta", name: "Calle 5ta" },
  { id: "La 39", name: "La 39" },
  { id: "Plaza Norte", name: "Plaza Norte" },
  { id: "Ciudad Jardin", name: "Ciudad Jardin" },
  { id: "Centro Sur", name: "Centro Sur" },
  { id: "Palmira", name: "Palmira" },
  { id: "Floresta", name: "Floresta" },
  { id: "Floralia", name: "Floralia" },
  { id: "Guaduales", name: "Guaduales" },
  { id: "Bogota", name: "Bogota" },
  { id: "Chia", name: "Chia" },
  { id: "ADM", name: "ADM" },
  { id: "CEDI-CAVASA", name: "CEDI-CAVASA" },
  { id: "Panificadora", name: "Panificadora" },
  { id: "Planta Desposte Mixto", name: "Planta Desposte Mixto" },
  { id: "Planta Desprese Pollo", name: "Planta Desprese Pollo" },
];

const SEDE_CONFIGS = [
  { name: "Calle 5ta", attendanceNames: ["la 5a", "calle 5ta"], aliases: ["calle 5ta", "la 5a", "la 5"] },
  { name: "La 39", attendanceNames: ["la 39"], aliases: ["la 39", "39"] },
  { name: "Plaza Norte", attendanceNames: ["plaza norte", "mio plaza norte"], aliases: ["plaza norte", "mio plaza norte"] },
  { name: "Ciudad Jardin", attendanceNames: ["ciudad jardin"], aliases: ["ciudad jardin", "ciudad jard", "jardin"] },
  { name: "Centro Sur", attendanceNames: ["centro sur"], aliases: ["centro sur"] },
  { name: "Palmira", attendanceNames: ["palmira", "palmira mercamio"], aliases: ["palmira", "palmira mercamio"] },
  { name: "Floresta", attendanceNames: ["floresta"], aliases: ["floresta"] },
  { name: "Floralia", attendanceNames: ["floralia", "floralia mercatodo", "mercatodo floralia"], aliases: ["floralia", "mercatodo floralia"] },
  { name: "Guaduales", attendanceNames: ["guaduales"], aliases: ["guaduales"] },
  { name: "Bogota", attendanceNames: ["bogota", "merkmios bogota"], aliases: ["bogota", "bogot", "merkmios bogota", "merkmios bogot"] },
  { name: "Chia", attendanceNames: ["chia", "merkmios chia"], aliases: ["chia", "chi", "ch a", "merkmios chia"] },
  { name: "ADM", attendanceNames: ["adm"], aliases: ["adm"] },
  { name: "CEDI-CAVASA", attendanceNames: ["cedi cavasa", "cedi-cavasa", "cedicavasa"], aliases: ["cedi cavasa", "cedi-cavasa", "cedicavasa"] },
  { name: "Panificadora", attendanceNames: ["panificadora"], aliases: ["panificadora"] },
  { name: "Planta Desposte Mixto", attendanceNames: ["planta desposte mixto", "planta de desposte mixto"], aliases: ["planta desposte mixto", "planta de desposte mixto", "planta desposte", "desposte mixto"] },
  { name: "Planta Desprese Pollo", attendanceNames: ["planta desposte pollo", "planta desprese pollo", "planta de desposte pollo", "planta de desprese pollo"], aliases: ["planta desposte pollo", "planta desprese pollo", "planta de desposte pollo", "planta de desprese pollo", "desposte pollo", "desprese pollo"] },
] as const;

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeKey("CEDI-CAVASA");
  }
  if (
    normalized.includes("planta desposte pollo") ||
    normalized.includes("planta desprese pollo")
  ) {
    return normalizeSedeKey("Planta Desprese Pollo");
  }
  if (normalized.includes("planta desposte mixto")) {
    return normalizeSedeKey("Planta Desposte Mixto");
  }
  return normalized;
};

const mapToCanonicalSede = (rawSede?: string | null) => {
  if (!rawSede) return "";
  const normalized = canonicalizeSedeKey(normalizeText(rawSede));
  const matched = SEDE_CONFIGS.find((cfg) =>
    [cfg.name, ...cfg.aliases].map((alias) => canonicalizeSedeKey(normalizeText(alias))).some(
      (alias) =>
        normalized === alias || normalized.includes(alias) || alias.includes(normalized),
    ),
  );
  return matched?.name ?? rawSede.trim();
};

const resolveVisibleSedes = (sessionUser: {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
}) => {
  if (sessionUser.role === "admin") {
    return {
      authorized: true as const,
      visibleSedes: BASE_SEDES,
      defaultSede: null as string | null,
    };
  }
  const rawAllowed = Array.isArray(sessionUser.allowedSedes) ? sessionUser.allowedSedes : [];
  const normalizedAllowed = new Set(
    rawAllowed.map((sede) => canonicalizeSedeKey(sede)).filter(Boolean),
  );
  if (normalizedAllowed.has(normalizeSedeKey("Todas"))) {
    return {
      authorized: true as const,
      visibleSedes: BASE_SEDES,
      defaultSede: null as string | null,
    };
  }
  const allowedMatches = BASE_SEDES.filter((sede) =>
    normalizedAllowed.has(canonicalizeSedeKey(sede.name)),
  );
  if (allowedMatches.length > 0) {
    return {
      authorized: true as const,
      visibleSedes: allowedMatches,
      defaultSede: allowedMatches.length === 1 ? allowedMatches[0].name : null,
    };
  }
  const legacyKey = sessionUser.sede ? canonicalizeSedeKey(sessionUser.sede) : null;
  const legacyMatch = legacyKey
    ? BASE_SEDES.find((sede) => canonicalizeSedeKey(sede.name) === legacyKey)
    : null;
  if (legacyMatch) {
    return {
      authorized: true as const,
      visibleSedes: [legacyMatch],
      defaultSede: legacyMatch.name,
    };
  }
  return {
    authorized: false as const,
    visibleSedes: [] as Sede[],
    defaultSede: null as string | null,
  };
};

const buildNormalizeSql = (columnName: string) => `
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

const flattenAttendanceFilters = (visibleSedes: Sede[]): string[] => {
  if (visibleSedes.length >= BASE_SEDES.length) {
    return SEDE_CONFIGS.flatMap((cfg) => cfg.attendanceNames.map((n) => normalizeText(n)));
  }
  return visibleSedes.flatMap((visibleSede) => {
    const cfg = SEDE_CONFIGS.find(
      (item) => normalizeText(item.name) === normalizeText(visibleSede.name),
    );
    return cfg
      ? cfg.attendanceNames.map((value) => normalizeText(value))
      : [normalizeSedeKey(visibleSede.name)];
  });
};

const HAS_SCHEDULE_CONTENT_SQL = `
  (
    d.is_rest_day = TRUE
    OR d.he1 IS NOT NULL
    OR d.hs1 IS NOT NULL
    OR d.he2 IS NOT NULL
    OR d.hs2 IS NOT NULL
  )
`;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const daySpanInclusive = (start: string, end: string) => {
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
};

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

  const isAdmin = session.user.role === "admin";
  if (
    !isAdmin &&
    !canAccessPortalSection(session.user.allowedDashboards, "operacion")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }

  if (!canAccessHorariosCompararBoard(session.user.specialRoles, isAdmin)) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para ver la comparacion de horarios." },
        { status: 403 },
      ),
    );
  }

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

  const { authorized, visibleSedes, defaultSede } = resolveVisibleSedes(session.user);
  if (!authorized) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para consultar las sedes asignadas." },
        { status: 403 },
      ),
    );
  }

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start")?.trim() ?? "";
  const endParam = url.searchParams.get("end")?.trim() ?? "";
  const sedeParam = url.searchParams.get("sede")?.trim() ?? "";

  if (!isIsoDate(startParam) || !isIsoDate(endParam)) {
    return withSession(
      NextResponse.json(
        { error: "Indica start y end en formato YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }

  const span = daySpanInclusive(startParam, endParam);
  if (span === null || span > MAX_RANGE_DAYS) {
    return withSession(
      NextResponse.json(
        {
          error: `El rango maximo es ${MAX_RANGE_DAYS} dias y la fecha inicial no puede ser posterior a la final.`,
        },
        { status: 400 },
      ),
    );
  }

  let sedesForQuery = visibleSedes;
  if (sedeParam) {
    const allowedName = visibleSedes.find(
      (s) => canonicalizeSedeKey(s.name) === canonicalizeSedeKey(sedeParam),
    );
    if (!allowedName) {
      return withSession(
        NextResponse.json(
          { error: "La sede seleccionada no esta permitida para tu usuario." },
          { status: 403 },
        ),
      );
    }
    sedesForQuery = [allowedName];
  }

  const attendanceNameFilters = flattenAttendanceFilters(sedesForQuery);

  const pool = await getDbPool();
  const client = await pool.connect();

  try {
    const columnsResult = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asistencia_horas'
      `,
    );
    const columns = (columnsResult.rows ?? [])
      .map((row) => (row as { column_name?: string }).column_name)
      .filter((value): value is string => Boolean(value));
    const normalizedToOriginal = new Map<string, string>();
    columns.forEach((col) => normalizedToOriginal.set(normalizeColumnName(col), col));

    const nameCandidates = [
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
    ];
    const nameColumn = nameCandidates
      .map((candidate) => normalizedToOriginal.get(candidate))
      .find(Boolean);
    const firstNameColumn = normalizedToOriginal.get("nombres");
    const lastNameColumn = normalizedToOriginal.get("apellidos");

    const nameExpr = nameColumn
      ? `NULLIF(TRIM(CAST(${quoteIdentifier(nameColumn)} AS text)), '')`
      : firstNameColumn || lastNameColumn
        ? `NULLIF(TRIM(CONCAT_WS(' ',
            ${firstNameColumn ? `NULLIF(TRIM(CAST(${quoteIdentifier(firstNameColumn)} AS text)), '')` : "NULL"},
            ${lastNameColumn ? `NULLIF(TRIM(CAST(${quoteIdentifier(lastNameColumn)} AS text)), '')` : "NULL"}
          )), '')`
        : "NULL::text";

    const planillaResult = await client.query(
      `
      SELECT
        d.planilla_id,
        COALESCE(NULLIF(TRIM(p.sede), ''), '') AS planilla_sede,
        COALESCE(NULLIF(TRIM(p.seccion), ''), '') AS seccion,
        d.worked_date::text AS worked_date,
        TRIM(COALESCE(d.employee_name, '')) AS employee_name,
        d.is_rest_day,
        COALESCE(TO_CHAR(d.he1, 'HH24:MI'), '') AS he1,
        COALESCE(TO_CHAR(d.hs1, 'HH24:MI'), '') AS hs1,
        COALESCE(TO_CHAR(d.he2, 'HH24:MI'), '') AS he2,
        COALESCE(TO_CHAR(d.hs2, 'HH24:MI'), '') AS hs2
      FROM horario_planilla_detalles d
      INNER JOIN horario_planillas p ON p.id = d.planilla_id
      WHERE d.worked_date IS NOT NULL
        AND d.worked_date >= $1::date
        AND d.worked_date <= $2::date
        AND TRIM(COALESCE(d.employee_name, '')) <> ''
        AND ${HAS_SCHEDULE_CONTENT_SQL}
      ORDER BY d.worked_date ASC, p.sede ASC, d.planilla_id ASC, d.row_index ASC
      `,
      [startParam, endParam],
    );

    const planillaRows: PlanillaCompareInput[] = (planillaResult.rows ?? [])
      .map((row) => {
        const typed = row as {
          planilla_id: number;
          planilla_sede: string;
          seccion: string;
          worked_date: string;
          employee_name: string;
          is_rest_day: boolean;
          he1: string;
          hs1: string;
          he2: string;
          hs2: string;
        };
        const canon = mapToCanonicalSede(typed.planilla_sede);
        if (!canon) return null;
        if (
          !sedesForQuery.some(
            (s) => canonicalizeSedeKey(s.name) === canonicalizeSedeKey(canon),
          )
        ) {
          return null;
        }
        return {
          planillaId: Number(typed.planilla_id),
          planillaSede: typed.planilla_sede,
          seccion: typed.seccion,
          workedDate: typed.worked_date.slice(0, 10),
          employeeName: typed.employee_name,
          isRestDay: Boolean(typed.is_rest_day),
          he1: typed.he1,
          hs1: typed.hs1,
          he2: typed.he2,
          hs2: typed.hs2,
        };
      })
      .filter((row): row is PlanillaCompareInput => row !== null);

    const attendanceQuery = `
      SELECT
        fecha::date::text AS worked_date,
        NULLIF(TRIM(CAST(sede AS text)), '') AS raw_sede,
        ${nameExpr} AS emp_name,
        COALESCE(TO_CHAR(hora_entrada, 'HH24:MI'), '') AS hora_entrada,
        COALESCE(TO_CHAR(hora_intermedia1, 'HH24:MI'), '') AS hora_intermedia1,
        COALESCE(TO_CHAR(hora_intermedia2, 'HH24:MI'), '') AS hora_intermedia2,
        COALESCE(TO_CHAR(hora_salida, 'HH24:MI'), '') AS hora_salida
      FROM asistencia_horas
      WHERE fecha::date >= $1::date
        AND fecha::date <= $2::date
        AND departamento IS NOT NULL
        AND ${buildNormalizeSql("sede")} = ANY($3::text[])
        AND ${nameExpr} IS NOT NULL
      ORDER BY fecha ASC, sede ASC
    `;

    const attendanceResult = await client.query(attendanceQuery, [
      startParam,
      endParam,
      attendanceNameFilters,
    ]);

    const attendanceByKey = new Map<string, AttendanceCompareInput>();
    for (const raw of attendanceResult.rows ?? []) {
      const typed = raw as {
        worked_date: string;
        raw_sede: string;
        emp_name: string;
        hora_entrada: string;
        hora_intermedia1: string;
        hora_intermedia2: string;
        hora_salida: string;
      };
      const canon = mapToCanonicalSede(typed.raw_sede);
      if (
        !canon ||
        !sedesForQuery.some(
          (s) => canonicalizeSedeKey(s.name) === canonicalizeSedeKey(canon),
        )
      ) {
        continue;
      }
      const key = buildComparisonLookupKey(
        typed.emp_name,
        typed.worked_date.slice(0, 10),
        normalizeKeySpaced(canon),
      );
      if (!attendanceByKey.has(key)) {
        attendanceByKey.set(key, {
          workedDate: typed.worked_date.slice(0, 10),
          rawSede: typed.raw_sede,
          employeeName: typed.emp_name.trim(),
          horaEntrada: typed.hora_entrada,
          horaIntermedia1: typed.hora_intermedia1,
          horaIntermedia2: typed.hora_intermedia2,
          horaSalida: typed.hora_salida,
        });
      }
    }

    const rows = mergePlanillaWithAttendance(
      planillaRows,
      attendanceByKey,
      (raw) => mapToCanonicalSede(raw),
    );

    return withSession(
      NextResponse.json({
        rows,
        meta: {
          start: startParam,
          end: endParam,
          maxRangeDays: MAX_RANGE_DAYS,
          sedes: visibleSedes,
          defaultSede,
        },
      }),
    );
  } catch (error) {
    console.error("[horarios-comparar] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo generar la comparacion de horarios." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
