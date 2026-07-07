import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { loadInformeVariacionMeta } from "@/lib/informe-variacion/meta";
import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, private";
const META_TTL_MS = 60_000;

let metaCache: {
  at: number;
  key: string;
  payload: Awaited<ReturnType<typeof loadInformeVariacionMeta>>;
} | null = null;

const buildCacheKey = (allowedKeys: string[] | null) => {
  if (!allowedKeys?.length) return "*";
  return [...allowedKeys].sort().join(",");
};

export async function GET() {
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
      session.user.specialRoles,
    )
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
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

  const cacheKey = buildCacheKey(scope.allowedKeys);
  if (metaCache && metaCache.key === cacheKey && Date.now() - metaCache.at < META_TTL_MS) {
    return withSession(
      NextResponse.json(metaCache.payload, {
        headers: { "Cache-Control": CACHE_CONTROL },
      }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const payload = await loadInformeVariacionMeta(client, scope.allowedKeys);
    metaCache = { at: Date.now(), key: cacheKey, payload };
    return withSession(
      NextResponse.json(payload, {
        headers: { "Cache-Control": CACHE_CONTROL },
      }),
    );
  } catch (error) {
    console.error("[informe-variacion/meta] error", error);
    return withSession(
      NextResponse.json(
        { error: "Error consultando metadata del informe de variacion." },
        { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } finally {
    client.release();
  }
}
