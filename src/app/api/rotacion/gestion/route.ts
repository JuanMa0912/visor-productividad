import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { canAccessRotacionBoard } from "@/lib/shared/special-role-features";
import type { RotacionCriticalBucket } from "@/lib/rotacion/critical-digest";
import type { RotacionCriticalDigestFamily } from "@/lib/rotacion/critical-digest";
import { loadRotacionGestionKpis } from "@/lib/rotacion/server/load-gestion-kpis";
import { loadRotacionGestionTrend } from "@/lib/rotacion/server/load-gestion-trend";
import { buildGestionMonthlySedeSeries } from "@/lib/rotacion/gestion-kpis";

const CACHE_CONTROL = "private, max-age=120, stale-while-revalidate=600";

const FAMILIES: RotacionCriticalDigestFamily[] = ["manufactura", "perecederos"];
const BUCKETS: RotacionCriticalBucket[] = ["demandaD", "cero", "restock"];

const parseList = <T extends string>(
  raw: string[],
  allowed: readonly T[],
): T[] => {
  const allowedSet = new Set(allowed);
  const next = raw
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is T => allowedSet.has(value as T));
  return next.length > 0 ? Array.from(new Set(next)) : [...allowed];
};

export async function GET(request: Request) {
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

  if (
    session.user.role !== "admin" &&
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
      session.user.role === "admin",
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

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode")?.trim() || "kpis";
  const sedeScopes = url.searchParams.getAll("sedeScope").map((v) => v.trim());
  const families = parseList(
    url.searchParams.getAll("family"),
    FAMILIES,
  );
  const buckets = parseList(
    url.searchParams.getAll("buckets"),
    BUCKETS,
  );

  try {
    if (mode === "trend") {
      const rows = await loadRotacionGestionTrend(sedeScopes);
      const monthly = buildGestionMonthlySedeSeries(rows, {
        sedeKeys: sedeScopes,
        families,
        buckets,
      });
      return withSession(
        NextResponse.json(
          { monthly, source: rows.length > 0 ? "roll" : "empty" },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const start = url.searchParams.get("start")?.trim() ?? "";
    const end = url.searchParams.get("end")?.trim() ?? "";
    const result = await loadRotacionGestionKpis({
      user: session.user,
      start,
      end,
      sedeScopes,
      families,
      buckets,
      lineaKeys: url.searchParams.getAll("lineasN1").map((v) => v.trim()),
      sublineaKeys: url.searchParams.getAll("sublineas").map((v) => v.trim()),
    });
    return withSession(
      NextResponse.json(
        { kpis: result.kpis, range: result.range },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No fue posible calcular gestion.";
    const status =
      /autorizad|invalido|Selecciona/i.test(message) ? 400 : 500;
    return withSession(NextResponse.json({ error: message }, { status }));
  }
}
