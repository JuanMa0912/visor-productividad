import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { loadInformeVariacionMeta } from "@/lib/informe-variacion/meta";
import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";
import {
  canonicalizeEmpresaCode,
  DINASTIA_EMPRESA_CODE,
  resolveDataSourceKind,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, private";
const META_TTL_MS = 60_000;

let metaCache: {
  at: number;
  key: string;
  payload: Awaited<ReturnType<typeof loadInformeVariacionMeta>>;
} | null = null;

const buildCacheKey = (
  allowedKeys: string[] | null,
  kind: "default" | "dinastia",
) => {
  const scope = !allowedKeys?.length ? "*" : [...allowedKeys].sort().join(",");
  return `${kind}:${scope}`;
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

  const url = new URL(request.url);
  const empresaParam = url.searchParams.get("empresa")?.trim() || null;
  const selectedEmpresas = empresaParam
    ? [empresaParam]
    : userIsDinastiaOnly(session.user)
      ? [DINASTIA_EMPRESA_CODE]
      : [];
  const dataSource = resolveDataSourceKind(session.user, selectedEmpresas);
  if (!dataSource.ok) {
    return withSession(
      NextResponse.json(
        { error: dataSource.error },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  const dataKind = dataSource.kind;

  const scope = resolveMargenSedeScope({
    role: session.user.role,
    sede: session.user.sede,
    allowedSedes: session.user.allowedSedes,
    allowedEmpresas: session.user.allowedEmpresas,
  });

  if (!scope.authorized) {
    return withSession(
      NextResponse.json(
        { error: "No tienes sedes asignadas para consultar el informe." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  // Si el tenant es Dinastia, acotar sedes a esas claves (evita mezclar catalogo).
  let allowedKeys = scope.allowedKeys;
  if (dataKind === "dinastia") {
    if (allowedKeys) {
      allowedKeys = allowedKeys.filter((key) => {
        const empresa = key.split("|")[0] ?? "";
        return canonicalizeEmpresaCode(empresa) === DINASTIA_EMPRESA_CODE;
      });
    } else {
      allowedKeys = listMargenSedeCatalogOptions()
        .filter((option) => option.empresa === DINASTIA_EMPRESA_CODE)
        .map((option) => option.value);
    }
  } else if (dataKind === "default" && allowedKeys) {
    allowedKeys = allowedKeys.filter((key) => {
      const empresa = key.split("|")[0] ?? "";
      return canonicalizeEmpresaCode(empresa) !== DINASTIA_EMPRESA_CODE;
    });
  }

  const cacheKey = buildCacheKey(allowedKeys, dataKind);
  if (metaCache && metaCache.key === cacheKey && Date.now() - metaCache.at < META_TTL_MS) {
    return withSession(
      NextResponse.json(metaCache.payload, {
        headers: { "Cache-Control": CACHE_CONTROL },
      }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const payload = await loadInformeVariacionMeta(client, allowedKeys, {
      kind: dataKind,
    });
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
