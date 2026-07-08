import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import { loadInformeVariacionPayload } from "@/lib/informe-variacion/query";
import { loadInformeVariacionMonthBundle } from "@/lib/informe-variacion/daily-bundle";
import {
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
  isInformeDayRangeAvailable,
  parseInformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import {
  buildInformeBundleCacheKey,
  buildInformeCacheKey,
  getCachedInformeMonthBundle,
  getCachedInformePayload,
  setCachedInformeMonthBundle,
  setCachedInformePayload,
} from "@/lib/informe-variacion/informe-cache";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, private";

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

  const availableRanges = getAvailableInformeDayRanges(year, month);
  const wantsBundle = url.searchParams.get("bundle") === "month";

  if (wantsBundle) {
    if (availableRanges.length === 0) {
      return withSession(
        NextResponse.json(
          { error: "No hay rangos de dias disponibles para el mes seleccionado." },
          { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const bundleKey = buildInformeBundleCacheKey(year, month, scope.allowedKeys);
    const cachedBundle = getCachedInformeMonthBundle(bundleKey);
    if (cachedBundle) {
      return withSession(
        NextResponse.json(cachedBundle, {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "cache",
          },
        }),
      );
    }

    const client = await (await getDbPool()).connect();
    try {
      await client.query("SET LOCAL work_mem = '256MB'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      await client.query("SET LOCAL jit = off");

      const startedAt = Date.now();
      const bundle = await loadInformeVariacionMonthBundle(
        client,
        year,
        month,
        scope.allowedKeys,
        availableRanges,
      );
      const elapsedMs = Date.now() - startedAt;

      if (!bundle) {
        return withSession(
          NextResponse.json(
            { bundle: false as const },
            {
              headers: {
                "Cache-Control": CACHE_CONTROL,
                "X-Informe-Bundle-Fallback": "1",
              },
            },
          ),
        );
      }

      if (elapsedMs > 5_000) {
        console.info(
          `[informe-variacion] bundle lento ${elapsedMs}ms year=${year} month=${month} ranges=${bundle.rangeIds.length}`,
        );
      }

      setCachedInformeMonthBundle(bundleKey, bundle, scope.allowedKeys);

      return withSession(
        NextResponse.json(bundle, {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "database",
            "X-Informe-Elapsed-Ms": String(elapsedMs),
          },
        }),
      );
    } catch (error) {
      console.error("Error en /api/informe-variacion (bundle):", error);
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

  const dayRange = parseInformeDayRangeId(url.searchParams.get("range"));
  if (url.searchParams.get("range") && !dayRange) {
    return withSession(
      NextResponse.json(
        { error: "Parametro range invalido." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }
  if (dayRange && !isInformeDayRangeAvailable(dayRange.id, year, month)) {
    return withSession(
      NextResponse.json(
        { error: "El rango de dias seleccionado aun no esta disponible para este mes." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const effectiveRange =
    dayRange ??
    parseInformeDayRangeId(defaultInformeDayRangeId(availableRanges) ?? undefined);
  if (!effectiveRange) {
    return withSession(
      NextResponse.json(
        { error: "No hay rangos de dias disponibles para el mes seleccionado." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const cacheKey = buildInformeCacheKey(
    year,
    month,
    scope.allowedKeys,
    effectiveRange?.id,
  );
  const cached = getCachedInformePayload(cacheKey);
  if (cached) {
    return withSession(
      NextResponse.json(cached, {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "X-Data-Source": "cache",
        },
      }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL statement_timeout = '90s'");
    await client.query("SET LOCAL jit = off");

    const startedAt = Date.now();
    const payload = await loadInformeVariacionPayload(
      client,
      year,
      month,
      scope.allowedKeys,
      { dayRange: effectiveRange },
    );
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 5_000) {
      console.info(
        `[informe-variacion] query lenta ${elapsedMs}ms year=${year} month=${month} range=${effectiveRange.id} rows=${payload.meta.rowCount}`,
      );
    }

    setCachedInformePayload(cacheKey, payload);

    return withSession(
      NextResponse.json(payload, {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "X-Data-Source": "database",
          "X-Informe-Elapsed-Ms": String(elapsedMs),
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
