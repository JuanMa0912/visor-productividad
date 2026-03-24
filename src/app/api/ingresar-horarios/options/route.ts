import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import type { Sede } from "@/lib/constants";
import { canAccessPortalSection } from "@/lib/portal-sections";

const NO_STORE_CACHE_CONTROL = "no-store, private";

const normalizeSedeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

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

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeKey("CEDI-CAVASA");
  }
  return normalized;
};

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
  { name: "Planta Desposte Mixto", attendanceNames: ["planta desposte mixto"], aliases: ["planta desposte mixto", "planta desposte"] },
  { name: "Planta Desprese Pollo", attendanceNames: ["planta desprese pollo"], aliases: ["planta desprese pollo", "desprese pollo"] },
] as const;

const resolveVisibleSedes = (sessionUser: {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
}) => {
  if (sessionUser.role === "admin") {
    return {
      authorized: true,
      visibleSedes: BASE_SEDES,
      defaultSede: null as string | null,
    };
  }
  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed
      .map((sede) => canonicalizeSedeKey(sede))
      .filter(Boolean),
  );
  if (normalizedAllowed.has(normalizeSedeKey("Todas"))) {
    return {
      authorized: true,
      visibleSedes: BASE_SEDES,
      defaultSede: null as string | null,
    };
  }
  const allowedMatches = BASE_SEDES.filter((sede) =>
    normalizedAllowed.has(canonicalizeSedeKey(sede.name)),
  );
  if (allowedMatches.length > 0) {
    return {
      authorized: true,
      visibleSedes: allowedMatches,
      defaultSede: allowedMatches[0].name,
    };
  }
  const legacyKey = sessionUser.sede ? canonicalizeSedeKey(sessionUser.sede) : null;
  const legacyMatch = legacyKey
    ? BASE_SEDES.find((sede) => canonicalizeSedeKey(sede.name) === legacyKey)
    : null;
  if (legacyMatch) {
    return {
      authorized: true,
      visibleSedes: [legacyMatch],
      defaultSede: legacyMatch.name,
    };
  }
  return {
    authorized: false,
    visibleSedes: [] as Sede[],
    defaultSede: null as string | null,
  };
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

export async function GET() {
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

  const { authorized, visibleSedes, defaultSede } = resolveVisibleSedes(
    session.user,
  );
  if (!authorized) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para consultar las sedes asignadas." },
        { status: 403 },
      ),
    );
  }

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'asistencia_horas'
    `);
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

    const params: unknown[] = [];
    let sedeFilterSql = "";
    if (visibleSedes.length > 0 && visibleSedes.length < BASE_SEDES.length) {
      const allowedSedeNames = visibleSedes.flatMap((visibleSede) => {
        const cfg = SEDE_CONFIGS.find(
          (item) => normalizeText(item.name) === normalizeText(visibleSede.name),
        );
        return cfg
          ? cfg.attendanceNames.map((value) => normalizeText(value))
          : [normalizeSedeKey(visibleSede.name)];
      });
      params.push(allowedSedeNames);
      sedeFilterSql = `AND ${buildNormalizeSql("sede")} = ANY($1::text[])`;
    }

    const employeesQuery = `
      SELECT DISTINCT
        ${nameExpr} AS employee_name,
        NULLIF(TRIM(CAST(sede AS text)), '') AS raw_sede
      FROM asistencia_horas
      WHERE (
          ${buildNormalizeSql("COALESCE(departamento, '')")} LIKE '%caja%'
          OR ${buildNormalizeSql("COALESCE(departamento, '')")} = 'supervision y cajas'
          OR ${buildNormalizeSql("COALESCE(cargo, '')")} LIKE '%caj%'
        )
        AND (
          ${nameExpr} IS NOT NULL
        )
        ${sedeFilterSql}
      ORDER BY employee_name ASC
    `;
    const employeesResult = await client.query(employeesQuery, params);
    const employees = (employeesResult.rows ?? [])
      .map((row) => ({
        name: (row as { employee_name?: string }).employee_name?.trim() ?? "",
        sede: mapToCanonicalSede((row as { raw_sede?: string }).raw_sede?.trim() ?? ""),
      }))
      .filter((row) => row.name.length > 0);

    return withSession(
      NextResponse.json({
        sedes: visibleSedes,
        defaultSede,
        employees,
      }),
    );
  } catch (error) {
    console.error("[ingresar-horarios/options] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar las opciones de ingresar horarios." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
