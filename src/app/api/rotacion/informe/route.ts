import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  canAccessRotacionBoard,
  canViewRotacionInforme,
} from "@/lib/shared/special-role-features";
import { loadRotacionConsolidatedDigestReport } from "@/lib/rotacion/server/load-consolidated-digest";

const CACHE_CONTROL = "private, max-age=120, stale-while-revalidate=600";

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
  if (
    !isAdmin &&
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "rotacion"))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }
  if (
    !canAccessRotacionBoard(
      session.user.specialRoles,
      isAdmin,
      session.user.allowedSubdashboards,
    )
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para rotacion." },
        { status: 403 },
      ),
    );
  }
  if (!canViewRotacionInforme(session.user.specialRoles, isAdmin)) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para este informe." },
        { status: 403 },
      ),
    );
  }

  try {
    const report = await loadRotacionConsolidatedDigestReport();
    return withSession(
      NextResponse.json(
        {
          subject: report.subject,
          html: report.html,
          range: report.range,
          sedeCount: report.sedeCount,
          generatedAt: report.generatedAt,
        },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No fue posible armar el informe de rotacion.";
    const status = /autorizad|No hay/i.test(message) ? 400 : 500;
    return withSession(NextResponse.json({ error: message }, { status }));
  }
}
