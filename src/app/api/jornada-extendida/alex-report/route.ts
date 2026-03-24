import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { canAccessPortalSection } from "@/lib/portal-sections";

type AlexRow = {
  sede: string;
  moreThan72With2: number;
  moreThan92: number;
  oddMarks: number;
  absences: number;
};

type SedeConfig = {
  name: string;
  aliases: string[];
};

const SEDE_CONFIGS: SedeConfig[] = [
  { name: "Calle 5ta", aliases: ["calle 5ta", "calle 5a", "la 5a", "la 5"] },
  { name: "La 39", aliases: ["la 39", "39"] },
  { name: "Plaza Norte", aliases: ["plaza norte", "mio plaza norte"] },
  { name: "Ciudad Jardin", aliases: ["ciudad jardin", "ciudad jard", "jardin"] },
  { name: "Centro Sur", aliases: ["centro sur"] },
  { name: "Palmira", aliases: ["palmira", "palmira mercamio"] },
  { name: "Floresta", aliases: ["floresta"] },
  { name: "Floralia", aliases: ["floralia", "floralia mercatodo", "mercatodo floralia"] },
  { name: "Guaduales", aliases: ["guaduales"] },
  { name: "Bogota", aliases: ["bogota", "bogot", "merkmios bogota", "merkmios bogot"] },
  { name: "Chia", aliases: ["chia", "chi", "ch a", "merkmios chia"] },
  { name: "ADM", aliases: ["adm"] },
  { name: "CEDI-CAVASA", aliases: ["cedi cavasa", "cedi-cavasa", "cedicavasa"] },
  {
    name: "Planta",
    aliases: ["planta desposte mixto", "planta desposte", "panificadora", "planta desprese pollo", "desprese pollo"],
  },
];

const REPORT_SEDES = [
  "Calle 5ta",
  "La 39",
  "Plaza Norte",
  "Ciudad Jardin",
  "Centro Sur",
  "Palmira",
  "Floresta",
  "Floralia",
  "Guaduales",
  "Bogota",
  "Chia",
  "ADM",
  "CEDI-CAVASA",
  "Planta",
];

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const EMPLOYEE_ID_COLUMN_CANDIDATES = [
  "numero",
  "identificacion",
  "cedula",
  "cedula_empleado",
  "documento",
  "id_empleado",
  "codigo_empleado",
  "codigo",
] as const;

const EMPLOYEE_NAME_COLUMN_CANDIDATES = [
  "nombres",
  "nombre",
  "nombre_empleado",
  "empleado",
  "nombre_completo",
] as const;

const normalizeColumnName = (value: string) => value.trim().toLowerCase();
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const pickAttendanceColumn = (columns: string[], candidates: readonly string[]) => {
  const normalizedCandidates = new Set(candidates.map((c) => c.toLowerCase()));
  const exact = columns.find((col) =>
    normalizedCandidates.has(normalizeColumnName(col)),
  );
  return exact ?? null;
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

const mapSedeToCanonical = (rawSede: string) => {
  const key = canonicalizeSedeMatchKey(rawSede);
  const config = SEDE_CONFIGS.find((cfg) =>
    [cfg.name, ...cfg.aliases]
      .map(canonicalizeSedeMatchKey)
      .some((alias) => key === alias || key.includes(alias) || alias.includes(key)),
  );
  return config?.name ?? null;
};

const parseHoursValue = (value: string | number | null | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeIncidentValue = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const isAbsenceIncident = (value: string | null | undefined) =>
  normalizeIncidentValue(value).includes("inasistencia");

// Se conserva la etiqueta visible 7:20h, pero el filtro interno usa 7:29h.
const HOURS_7_20 = 7 + 29 / 60;
const HOURS_9_20 = 9 + 20 / 60;
const NO_STORE_CACHE_CONTROL = "no-store, private";
const ALEX_REPORT_MAX_RANGE_DAYS = 31;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
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

const getInclusiveDateRangeDays = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
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

  const isAdmin = session.user.role === "admin";
  const hasAlexRole =
    isAdmin ||
    (Array.isArray(session.user.specialRoles) &&
      session.user.specialRoles.includes("alex"));
  const allowedDashboards = session.user.allowedDashboards;
  if (
    !isAdmin &&
    !canAccessPortalSection(allowedDashboards, "operacion")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }
  if (!hasAlexRole) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para el reporte Alex." },
        { status: 403 },
      ),
    );
  }

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date")?.trim() ?? "";
  const startParam = url.searchParams.get("start")?.trim() ?? "";
  const endParam = url.searchParams.get("end")?.trim() ?? "";
  if (dateParam && !isDateKey(dateParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de fecha invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  if (startParam && !isDateKey(startParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de start invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  if (endParam && !isDateKey(endParam)) {
    return withSession(
      NextResponse.json(
        { error: "Formato de end invalido. Use YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    let startDate = startParam || dateParam;
    let endDate = endParam || dateParam;
    if (!startDate && !endDate) {
      const latestResult = await client.query(
        `
        SELECT MAX(fecha::date)::text AS max_fecha
        FROM asistencia_horas
        WHERE fecha IS NOT NULL
        `,
      );
      const maxDate = String(
        (latestResult.rows?.[0] as { max_fecha?: string } | undefined)
          ?.max_fecha ?? "",
      );
      if (!maxDate) {
        return withSession(
          NextResponse.json(
            {
              usedRange: null,
              rows: [],
              totals: { moreThan72With2: 0, moreThan92: 0, oddMarks: 0, absences: 0 },
            },
          ),
        );
      }
      startDate = maxDate;
      endDate = maxDate;
    } else if (!startDate || !endDate) {
      return withSession(
        NextResponse.json(
          { error: "Debes enviar start y end, o date." },
          { status: 400 },
        ),
      );
    }
    if (startDate > endDate) {
      return withSession(
        NextResponse.json(
          { error: "start no puede ser mayor que end." },
          { status: 400 },
        ),
      );
    }
    const rangeDays = getInclusiveDateRangeDays(startDate, endDate);
    if (!rangeDays || rangeDays > ALEX_REPORT_MAX_RANGE_DAYS) {
      return withSession(
        NextResponse.json(
          {
            error: `El rango del reporte Alex no puede superar ${ALEX_REPORT_MAX_RANGE_DAYS} dias.`,
          },
          { status: 400 },
        ),
      );
    }

    const columnsResult = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'asistencia_horas'
      `,
    );
    const attendanceColumns = (columnsResult.rows ?? [])
      .map((row) => String((row as { column_name?: string }).column_name ?? ""))
      .filter(Boolean);
    const employeeIdColumn = pickAttendanceColumn(
      attendanceColumns,
      EMPLOYEE_ID_COLUMN_CANDIDATES,
    );
    const employeeNameColumn = pickAttendanceColumn(
      attendanceColumns,
      EMPLOYEE_NAME_COLUMN_CANDIDATES,
    );
    const employeeIdExpr = employeeIdColumn
      ? `NULLIF(TRIM(CAST(${quoteIdentifier(employeeIdColumn)} AS text)), '')`
      : "NULL::text";
    const employeeNameExpr = employeeNameColumn
      ? `NULLIF(TRIM(CAST(${quoteIdentifier(employeeNameColumn)} AS text)), '')`
      : "NULL::text";

    const result = await client.query(
      `
      WITH raw AS (
        SELECT
          NULLIF(TRIM(CAST(sede AS text)), '') AS raw_sede,
          fecha::date AS worked_date,
          COALESCE(total_laborado_horas, 0) AS total_laborado_horas,
          NULLIF(TRIM(CAST(incidencia AS text)), '') AS incidencia,
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
      ),
      base AS (
        SELECT
          raw_sede,
          worked_date,
          employee_key,
          COALESCE(SUM(total_laborado_horas), 0) AS total_hours,
          MAX(marks_count_row)::int AS marks_count,
          MAX(incidencia) AS incidencia
        FROM raw
        GROUP BY raw_sede, worked_date, employee_key
      )
      SELECT
        raw_sede,
        total_hours,
        marks_count,
        incidencia
      FROM base
      `,
      [startDate, endDate],
    );
    const counters = new Map<
      string,
      { moreThan72With2: number; moreThan92: number; oddMarks: number; absences: number }
    >();
    REPORT_SEDES.forEach((sede) => {
      counters.set(sede, { moreThan72With2: 0, moreThan92: 0, oddMarks: 0, absences: 0 });
    });

    for (const row of result.rows ?? []) {
      const typed = row as {
        raw_sede: string | null;
        total_hours: number | string | null;
        marks_count: number | null;
        incidencia: string | null;
      };
      const sedeMapped = mapSedeToCanonical(typed.raw_sede ?? "");
      if (!sedeMapped || !counters.has(sedeMapped)) continue;
      const totalHours = parseHoursValue(typed.total_hours);
      const marksCount = Number(typed.marks_count ?? 0);
      const incident = typed.incidencia;
      const current = counters.get(sedeMapped)!;

      if (totalHours > HOURS_7_20 && totalHours <= HOURS_9_20 && marksCount === 2) {
        current.moreThan72With2 += 1;
      }
      if (totalHours > HOURS_9_20) {
        current.moreThan92 += 1;
      }
      if (marksCount > 0 && marksCount % 2 !== 0) {
        current.oddMarks += 1;
      }
      if (isAbsenceIncident(incident)) {
        current.absences += 1;
      }
    }

    const rows: AlexRow[] = REPORT_SEDES.map((sede) => ({
      sede,
      moreThan72With2: counters.get(sede)?.moreThan72With2 ?? 0,
      moreThan92: counters.get(sede)?.moreThan92 ?? 0,
      oddMarks: counters.get(sede)?.oddMarks ?? 0,
      absences: counters.get(sede)?.absences ?? 0,
    }));

    const totals = rows.reduce(
      (acc, row) => ({
        moreThan72With2: acc.moreThan72With2 + row.moreThan72With2,
        moreThan92: acc.moreThan92 + row.moreThan92,
        oddMarks: acc.oddMarks + row.oddMarks,
        absences: acc.absences + row.absences,
      }),
      { moreThan72With2: 0, moreThan92: 0, oddMarks: 0, absences: 0 },
    );

    return withSession(
      NextResponse.json({
        usedRange: { start: startDate, end: endDate },
        rows,
        totals,
      }),
    );
  } catch (error) {
    console.error("[jornada-extendida/alex-report] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo construir el reporte Alex." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
