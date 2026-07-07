import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import { loadInformeVariacionPayload } from "@/lib/informe-variacion/query";
import { buildInformeDemoPayload } from "@/lib/informe-variacion/demo-payload";
import { resolveInformeMockBasesEnabled } from "@/lib/informe-variacion/mock-bases";
import {
  buildInformeCacheKey,
  getCachedInformePayload,
  setCachedInformePayload,
} from "@/lib/informe-variacion/informe-cache";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, private";

const canAccessInformeVariacion = (
  role: string,
  allowedDashboards: unknown,
  allowedSubdashboards: unknown,
): boolean => {
  if (role === "admin") return true;
  if (!canAccessPortalSection(allowedDashboards, "producto")) return false;
  return (
    canAccessPortalSubsection(allowedSubdashboards, "rotacion") ||
    canAccessPortalSubsection(allowedSubdashboards, "margenes")
  );
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
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
    !canAccessInformeVariacion(
      session.user.role,
      session.user.allowedDashboards,
      session.user.allowedSubdashboards,
    )
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return withSession(
      NextResponse.json(
        { error: "Parametros year y month invalidos." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const scope = resolveMargenSedeScope({
    role: session.user.role,
    sede: session.user.sede,
    allowedSedes: session.user.allowedSedes,
  });
  if (!scope.authorized) {
    return withSession(
      NextResponse.json(
        { error: "No tienes sedes asignadas para consultar el informe." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const mockBases = resolveInformeMockBasesEnabled(url.searchParams.get("mock"));
  const cacheKey = buildInformeCacheKey(year, month, mockBases, scope.allowedKeys);
  const cached = getCachedInformePayload(cacheKey);
  if (cached) {
    return withSession(
      NextResponse.json(cached, {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "X-Data-Source": cached.meta.demoData ? "demo" : "cache",
          ...(cached.meta.mockBases ? { "X-Informe-Mock-Bases": "1" } : {}),
        },
      }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    let payload;
    if (mockBases) {
      try {
        payload = await Promise.race([
          loadInformeVariacionPayload(client, year, month, scope.allowedKeys, {
            mockBases: true,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("informe-mock-timeout")), 8_000);
          }),
        ]);
      } catch (error) {
        console.warn("[informe-variacion] modo demo: fallback sintetico", error);
        payload = buildInformeDemoPayload(year, month, scope.allowedKeys);
      }
    } else {
      payload = await loadInformeVariacionPayload(client, year, month, scope.allowedKeys);
    }

    setCachedInformePayload(cacheKey, payload);

    return withSession(
      NextResponse.json(payload, {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "X-Data-Source": payload.meta.demoData ? "demo" : "database",
          ...(payload.meta.mockBases ? { "X-Informe-Mock-Bases": "1" } : {}),
        },
      }),
    );
  } catch (error) {
    console.error("Error en /api/informe-variacion:", error);
    return withSession(
      NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "No fue posible generar el informe de variacion.",
        },
        { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } finally {
    client.release();
  }
}
