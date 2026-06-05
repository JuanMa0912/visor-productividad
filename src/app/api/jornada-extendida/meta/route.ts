import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { resolveVisibleSedes } from "@/lib/horarios/visible-sedes";

const NO_STORE_CACHE_CONTROL = "no-store, private";

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
  const hasAlexRole =
    isAdmin ||
    (Array.isArray(session.user.specialRoles) &&
      session.user.specialRoles.includes("alex"));
  const allowedDashboards = session.user.allowedDashboards;
  if (
    !isAdmin &&
    (!canAccessPortalSection(allowedDashboards, "operacion") ||
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
    console.error("[jornada-extendida/meta] Error:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar los metadatos de jornada extendida." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
