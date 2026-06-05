import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  canonicalizeSedeKey,
  resolveAllowedSedeKeys,
} from "@/lib/horarios/visible-sedes";
import {
  TIPOS_HORARIO_BUCKETS,
  TIPOS_HORARIO_DEFAULT_BUCKET,
  TIPOS_HORARIO_DEFAULT_TOP_N,
  TIPOS_HORARIO_MAX_RANGE_DAYS,
  TIPOS_HORARIO_MAX_TOP_N,
  formatTurno,
  jornadaBand,
  type TipoHorarioBucket,
  type TipoHorarioGrupoMeta,
  type TipoHorarioRow,
  type TiposHorarioResponse,
} from "@/lib/horarios/tipos-horario";

// ---------------------------------------------------------------------------
// Mapeo de sede a nombre canonico. Replicado del patron de alex-report para
// mantener coherencia entre los modulos de la seccion operacion.
// ---------------------------------------------------------------------------

type SedeConfig = { name: string; aliases: string[] };

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

const normalizeSedeName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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

const mapSedeToCanonical = (rawSede: string): string | null => {
  const key = canonicalizeSedeMatchKey(rawSede);
  if (!key) return null;
  const config = SEDE_CONFIGS.find((cfg) =>
    [cfg.name, ...cfg.aliases]
      .map(canonicalizeSedeMatchKey)
      .some((alias) => key === alias || key.includes(alias) || alias.includes(key)),
  );
  return config?.name ?? null;
};

const titleCaseSede = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

// Misma normalizacion de sede en SQL que hourly-analysis (acentos y no alfanumericos).
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

// ---------------------------------------------------------------------------
// Deteccion dinamica de columnas de empleado (igual que alex-report).
// ---------------------------------------------------------------------------

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
  return columns.find((col) => normalizedCandidates.has(normalizeColumnName(col))) ?? null;
};

// ---------------------------------------------------------------------------
// Validacion, rate limit y sesion (patron compartido de la seccion operacion).
// ---------------------------------------------------------------------------

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const NO_STORE_CACHE_CONTROL = "no-store, private";
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

const parseBucket = (raw: string): TipoHorarioBucket => {
  const parsed = Number(raw);
  return (TIPOS_HORARIO_BUCKETS as readonly number[]).includes(parsed)
    ? (parsed as TipoHorarioBucket)
    : TIPOS_HORARIO_DEFAULT_BUCKET;
};

const parseTopN = (raw: string): number => {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return TIPOS_HORARIO_DEFAULT_TOP_N;
  return Math.min(parsed, TIPOS_HORARIO_MAX_TOP_N);
};

// Acumulador por turno antes de recortar a topN.
type TurnoAcc = {
  entradaMin: number;
  salidaMin: number;
  dias: number;
  empleados: number;
  sumHoras: number;
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
  if (
    !isAdmin &&
    (!canAccessPortalSection(session.user.allowedDashboards, "operacion") ||
      !canAccessPortalSubsection(
        session.user.allowedSubdashboards,
        "consulta-operativa",
      ))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }

  // Autorizacion fina por sede: un usuario amarrado solo puede ver sus sedes.
  // null = sin restriccion (admin / "Todas"); Set vacio = sin sedes asignadas.
  const allowedSedeKeys = resolveAllowedSedeKeys(session.user);
  if (allowedSedeKeys !== null && allowedSedeKeys.size === 0) {
    return withSession(
      NextResponse.json(
        { error: "No tienes sedes asignadas para consultar." },
        { status: 403 },
      ),
    );
  }

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start")?.trim() ?? "";
  const endParam = url.searchParams.get("end")?.trim() ?? "";
  const sedeParam = url.searchParams.get("sede")?.trim() ?? "";
  const bucket = parseBucket(url.searchParams.get("bucket")?.trim() ?? "");
  const topN = parseTopN(url.searchParams.get("topN")?.trim() ?? "");
  const selectedSede =
    !sedeParam || sedeParam === "all" ? null : mapSedeToCanonical(sedeParam);

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
    let startDate = startParam;
    let endDate = endParam;

    // Sin rango: por defecto el ano de la ultima fecha con datos hasta esa fecha.
    if (!startDate || !endDate) {
      const latestResult = await client.query(
        `SELECT MAX(fecha::date)::text AS max_fecha FROM asistencia_horas WHERE fecha IS NOT NULL`,
      );
      const maxDate = String(
        (latestResult.rows?.[0] as { max_fecha?: string } | undefined)?.max_fecha ?? "",
      );
      if (!maxDate) {
        return withSession(
          NextResponse.json<TiposHorarioResponse>({
            usedRange: null,
            bucket,
            topN,
            rows: [],
            grupos: [],
            departamentos: [],
          }),
        );
      }
      endDate = endDate || maxDate;
      startDate = startDate || `${maxDate.slice(0, 4)}-01-01`;
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
    if (!rangeDays) {
      return withSession(
        NextResponse.json({ error: "Rango de fechas invalido." }, { status: 400 }),
      );
    }
    if (rangeDays > TIPOS_HORARIO_MAX_RANGE_DAYS) {
      return withSession(
        NextResponse.json(
          {
            error: `El rango no puede superar ${TIPOS_HORARIO_MAX_RANGE_DAYS} dias.`,
          },
          { status: 400 },
        ),
      );
    }

    const columnsResult = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'asistencia_horas'`,
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

    // Agregacion del rango completo en SQL: nunca se traen filas crudas.
    const result = await client.query(
      `
      WITH raw AS (
        SELECT
          ${buildNormalizeSedeSql("sede")} AS sede_norm,
          NULLIF(TRIM(CAST(departamento AS text)), '') AS departamento,
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
          ) AS employee_key,
          (FLOOR((EXTRACT(HOUR FROM hora_entrada) * 60 + EXTRACT(MINUTE FROM hora_entrada)) / $3::int) * $3::int)::int AS ent_min,
          (FLOOR((EXTRACT(HOUR FROM hora_salida) * 60 + EXTRACT(MINUTE FROM hora_salida)) / $3::int) * $3::int)::int AS sal_min,
          COALESCE(total_laborado_horas, 0)::float8 AS total_hours
        FROM asistencia_horas
        WHERE fecha::date >= $1::date
          AND fecha::date <= $2::date
          AND departamento IS NOT NULL
          AND hora_entrada IS NOT NULL
          AND hora_salida IS NOT NULL
      )
      SELECT
        sede_norm,
        departamento,
        ent_min,
        sal_min,
        COUNT(*)::int AS dias_empleado,
        COUNT(DISTINCT employee_key)::int AS empleados_distintos,
        AVG(total_hours)::float8 AS horas_promedio
      FROM raw
      WHERE departamento IS NOT NULL AND sede_norm <> ''
      GROUP BY sede_norm, departamento, ent_min, sal_min
      `,
      [startDate, endDate, bucket],
    );

    // Agrupa por (sede canonica, departamento) -> turno. Une variantes de
    // escritura de sede que mapean al mismo nombre canonico.
    const grupos = new Map<
      string,
      { sede: string; departamento: string; turnos: Map<string, TurnoAcc> }
    >();
    const departamentos = new Set<string>();

    for (const row of result.rows ?? []) {
      const typed = row as {
        sede_norm: string | null;
        departamento: string | null;
        ent_min: number | null;
        sal_min: number | null;
        dias_empleado: number | null;
        empleados_distintos: number | null;
        horas_promedio: number | null;
      };
      const sedeNorm = (typed.sede_norm ?? "").trim();
      if (!sedeNorm) continue;
      // Enforcing por sede: descarta filas fuera de las sedes del usuario.
      if (
        allowedSedeKeys &&
        !allowedSedeKeys.has(canonicalizeSedeKey(sedeNorm))
      ) {
        continue;
      }
      const sede = mapSedeToCanonical(sedeNorm) ?? titleCaseSede(sedeNorm);
      if (selectedSede && sede !== selectedSede) continue;
      const departamento = (typed.departamento ?? "").trim();
      if (!departamento) continue;
      departamentos.add(departamento);

      const entradaMin = Number(typed.ent_min ?? 0);
      const salidaMin = Number(typed.sal_min ?? 0);
      const dias = Number(typed.dias_empleado ?? 0);
      const empleados = Number(typed.empleados_distintos ?? 0);
      const horasProm = Number(typed.horas_promedio ?? 0);
      if (dias <= 0) continue;

      const groupKey = `${sede}||${departamento}`;
      let grupo = grupos.get(groupKey);
      if (!grupo) {
        grupo = { sede, departamento, turnos: new Map() };
        grupos.set(groupKey, grupo);
      }
      const turnoKey = `${entradaMin}|${salidaMin}`;
      const acc = grupo.turnos.get(turnoKey);
      if (acc) {
        acc.dias += dias;
        acc.empleados += empleados;
        acc.sumHoras += horasProm * dias;
      } else {
        grupo.turnos.set(turnoKey, {
          entradaMin,
          salidaMin,
          dias,
          empleados,
          sumHoras: horasProm * dias,
        });
      }
    }

    const rows: TipoHorarioRow[] = [];
    const gruposMeta: TipoHorarioGrupoMeta[] = [];

    for (const grupo of grupos.values()) {
      const turnos = Array.from(grupo.turnos.values()).sort(
        (a, b) => b.dias - a.dias,
      );
      const totalDias = turnos.reduce((sum, t) => sum + t.dias, 0);
      if (totalDias <= 0) continue;
      const visibles = turnos.slice(0, topN);

      gruposMeta.push({
        sede: grupo.sede,
        departamento: grupo.departamento,
        totalTurnos: turnos.length,
        turnosMostrados: visibles.length,
        totalDias,
      });

      for (const t of visibles) {
        const horasPromedio = t.dias > 0 ? t.sumHoras / t.dias : 0;
        rows.push({
          sede: grupo.sede,
          departamento: grupo.departamento,
          turno: formatTurno(t.entradaMin, t.salidaMin),
          entradaMin: t.entradaMin,
          salidaMin: t.salidaMin,
          cruzaMedianoche: t.salidaMin < t.entradaMin,
          jornada: jornadaBand(horasPromedio),
          horasPromedio: Math.round(horasPromedio * 100) / 100,
          diasEmpleado: t.dias,
          empleadosDistintos: t.empleados,
          pctDias: Math.round((t.dias / totalDias) * 1000) / 10,
        });
      }
    }

    rows.sort(
      (a, b) =>
        a.sede.localeCompare(b.sede, "es", { sensitivity: "base" }) ||
        a.departamento.localeCompare(b.departamento, "es", { sensitivity: "base" }) ||
        b.diasEmpleado - a.diasEmpleado,
    );
    gruposMeta.sort(
      (a, b) =>
        a.sede.localeCompare(b.sede, "es", { sensitivity: "base" }) ||
        a.departamento.localeCompare(b.departamento, "es", { sensitivity: "base" }),
    );

    return withSession(
      NextResponse.json<TiposHorarioResponse>({
        usedRange: { start: startDate, end: endDate },
        bucket,
        topN,
        rows,
        grupos: gruposMeta,
        departamentos: Array.from(departamentos).sort((a, b) =>
          a.localeCompare(b, "es", { sensitivity: "base" }),
        ),
      }),
    );
  } catch (error) {
    console.error("[jornada-extendida/tipos-horario] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo construir el analisis de tipos de horario." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
