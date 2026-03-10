import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import type { Sede } from "@/lib/constants";

const normalizeSedeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeKey("Calle 5ta");
  }
  return normalized;
};

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
  { id: "Panificadora", name: "Panificadora" },
  { id: "Planta Desposte Mixto", name: "Planta Desposte Mixto" },
  { id: "Planta Desprese Pollo", name: "Planta Desprese Pollo" },
];

const resolveVisibleSedes = (sessionUser: {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
}) => {
  if (sessionUser.role === "admin") {
    return { visibleSedes: BASE_SEDES, defaultSede: null as string | null };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed
      .map((sede) => canonicalizeSedeKey(sede))
      .filter(Boolean),
  );
  if (normalizedAllowed.has(canonicalizeSedeKey("Todas"))) {
    return { visibleSedes: BASE_SEDES, defaultSede: null as string | null };
  }

  const allowedMatches = BASE_SEDES.filter((sede) =>
    normalizedAllowed.has(canonicalizeSedeKey(sede.name)),
  );
  if (allowedMatches.length > 0) {
    return { visibleSedes: allowedMatches, defaultSede: allowedMatches[0].name };
  }

  const legacySedeKey = sessionUser.sede
    ? canonicalizeSedeKey(sessionUser.sede)
    : null;
  const legacySede = legacySedeKey
    ? BASE_SEDES.find((sede) => canonicalizeSedeKey(sede.name) === legacySedeKey)
    : null;
  if (legacySede) {
    return { visibleSedes: [legacySede], defaultSede: legacySede.name };
  }

  return { visibleSedes: BASE_SEDES, defaultSede: null as string | null };
};

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };

  const isAdmin = session.user.role === "admin";
  const hasAlexRole =
    isAdmin ||
    (Array.isArray(session.user.specialRoles) &&
      session.user.specialRoles.includes("alex"));
  const allowedDashboards = session.user.allowedDashboards;
  if (
    !isAdmin &&
    Array.isArray(allowedDashboards) &&
    !allowedDashboards.includes("jornada-extendida")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para este tablero." },
        { status: 403 },
      ),
    );
  }

  const { visibleSedes, defaultSede } = resolveVisibleSedes(session.user);

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT DISTINCT fecha::text AS fecha
      FROM asistencia_horas
      WHERE fecha IS NOT NULL
      ORDER BY fecha
    `);

    const dates = (result.rows ?? [])
      .map((row) => (row as { fecha?: string }).fecha?.slice(0, 10))
      .filter((value): value is string => Boolean(value));

    return withSession(
      NextResponse.json({
        dates,
        sedes: visibleSedes,
        defaultSede,
        canSeeAlexReport: hasAlexRole,
      }),
    );
  } catch (error) {
    return withSession(
      NextResponse.json(
        {
          error:
            "No se pudieron cargar los metadatos de jornada extendida: " +
            (error instanceof Error ? error.message : String(error)),
        },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
