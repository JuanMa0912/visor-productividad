import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { canAccessRotacionBoard } from "@/lib/shared/special-role-features";
import {
  getAvailableBounds,
  getRotationFilterCatalog,
  compactToIsoDate,
  isIsoDate,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";
import { loadRotacionSedeSalesTrend } from "@/lib/rotacion/server/load-sede-sales-trend";
import { clampTendenciaDateRange } from "@/lib/rotacion/tendencia-scope";
import { mergeDinastiaIntoRotationCatalog } from "@/lib/rotacion/dinastia-catalog";
import {
  canonicalizeEmpresaCode,
  resolveDataSourceKind,
  userHasDinastiaAccess,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";
import {
  ROTACION_SOURCE_DINASTIA,
  ROTACION_SOURCE_LEGACY,
} from "@/lib/rotacion/source-tables";
import { runWithRotacionSourceTableAsync } from "@/lib/rotacion/source-context";

const CACHE_CONTROL = "private, max-age=60, stale-while-revalidate=300";
const MAX_ITEMS = 8_000;

const padSede = (value: string) => value.trim().padStart(3, "0");

const readString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export async function POST(request: Request) {
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

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return withSession(
      NextResponse.json({ error: "JSON invalido." }, { status: 400 }),
    );
  }

  const empresa = readString(body.empresa);
  const sedeId = readString(body.sedeId);
  const startRaw = readString(body.start);
  const endRaw = readString(body.end);
  if (!empresa || !sedeId || !isIsoDate(startRaw) || !isIsoDate(endRaw)) {
    return withSession(
      NextResponse.json(
        { error: "Faltan sede o fechas validas." },
        { status: 400 },
      ),
    );
  }
  const itemIds = Array.isArray(body.items)
    ? body.items
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .slice(0, MAX_ITEMS)
    : [];

  const tenantHint = canonicalizeEmpresaCode(empresa)
    ? [canonicalizeEmpresaCode(empresa)!]
    : userIsDinastiaOnly(session.user)
      ? ["dinastia"]
      : [];
  const tenantSource = resolveDataSourceKind(session.user, tenantHint);
  if (!tenantSource.ok) {
    return withSession(
      NextResponse.json({ error: tenantSource.error }, { status: 400 }),
    );
  }
  const sourceTable =
    tenantSource.kind === "dinastia"
      ? ROTACION_SOURCE_DINASTIA
      : ROTACION_SOURCE_LEGACY;

  try {
    const payload = await runWithRotacionSourceTableAsync(
      sourceTable,
      async () => {
        const bounds = await getAvailableBounds();
        const range = clampTendenciaDateRange({
          start: startRaw,
          end: endRaw,
          availableMin: compactToIsoDate(bounds?.min_date ?? null) ?? undefined,
          availableMax: compactToIsoDate(bounds?.max_date ?? null) ?? undefined,
        });
        const catalog = await getRotationFilterCatalog(
          range.start.replaceAll("-", ""),
          range.end.replaceAll("-", ""),
        );
        const merged = userHasDinastiaAccess(session.user)
          ? mergeDinastiaIntoRotationCatalog(catalog)
          : catalog;
        const { visibleSedes } = resolveVisibleSedes(session.user, merged);
        const wantedEmpresa =
          canonicalizeEmpresaCode(empresa) ?? empresa.toLowerCase();
        const wantedSede = padSede(sedeId);
        const allowed = visibleSedes.some((sede) => {
          const code =
            canonicalizeEmpresaCode(sede.empresa) ??
            sede.empresa.trim().toLowerCase();
          return code === wantedEmpresa && padSede(sede.sedeId) === wantedSede;
        });
        if (!allowed) {
          throw new Error("SEDE_FORBIDDEN");
        }
        const points = await loadRotacionSedeSalesTrend({
          empresa,
          sedeId,
          start: range.start,
          end: range.end,
          itemIds,
        });
        return { range, points };
      },
    );

    return withSession(
      NextResponse.json(
        {
          start: payload.range.start,
          end: payload.range.end,
          min: payload.range.min,
          max: payload.range.max,
          points: payload.points,
        },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SEDE_FORBIDDEN") {
      return withSession(
        NextResponse.json(
          { error: "No tienes acceso a esa sede." },
          { status: 403 },
        ),
      );
    }
    return withSession(
      NextResponse.json(
        { error: "No fue posible cargar la tendencia." },
        { status: 500 },
      ),
    );
  }
}
