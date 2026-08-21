import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { resolveMargenSedeScope } from "@/lib/margenes/margen-sede-scope";
import {
  loadInformeVariacionPayload,
  loadInformeVariacionRangePayload,
} from "@/lib/informe-variacion/query";
import { loadInformeVariacionMeta } from "@/lib/informe-variacion/meta";
import {
  defaultInformeDayRangeId,
  getInformeCortesDayRanges,
  normalizeInformeCompactDate,
  parseInformeDayRangeId,
  type InformeDayRangeId,
} from "@/lib/informe-variacion/day-ranges";
import {
  buildInformeCacheKey,
  buildInformeRangeCacheKey,
  getCachedInformePayload,
  invalidateInformeCacheKey,
  setCachedInformePayload,
} from "@/lib/informe-variacion/informe-cache";
import {
  adaptInformePayloadStdForRequest,
  getInformePayloadStd,
} from "@/lib/informe-variacion/payload-std-server";
import { canAccessInformeVariacion } from "@/lib/shared/special-role-features";
import { ensureInformeProveedores } from "@/lib/informe-variacion/proveedores";
import { ensureInformeMarcas } from "@/lib/informe-variacion/marcas";
import { resolveSessionLineCategoryScope } from "@/lib/shared/line-category-scope";
import {
  resolveDataSourceKind,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import {
  defaultInformeYtdRanges,
  informeRangeCacheKey,
  isInformeCompactDateError,
  parseInformeCompactDateParam,
  validateInformeSelectedRanges,
  type InformeSelectedRanges,
} from "@/lib/informe-variacion/date-range";
import {
  isDefaultInformeCompareMonth,
  isInformeCompareMonthError,
  parseInformeCompareMonthParam,
} from "@/lib/informe-variacion/periods";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "no-store, private";

const parseRangeParam = (
  raw: string | null,
  fallback: string,
): string | { error: string } => {
  if (raw == null || raw.trim() === "") return fallback;
  return parseInformeCompactDateParam(raw);
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

  const scope = resolveMargenSedeScope({
    role: session.user.role,
    sede: session.user.sede,
    allowedSedes: session.user.allowedSedes,
    allowedEmpresas: session.user.allowedEmpresas,
  });
  const lineScope = resolveSessionLineCategoryScope(session.user);
  if (!scope.authorized) {
    return withSession(
      NextResponse.json(
        { error: "No tienes sedes asignadas para consultar el informe." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const url = new URL(request.url);
  const empresaParam = url.searchParams.get("empresa")?.trim() || null;
  const selectedEmpresas = empresaParam
    ? [empresaParam]
    : userIsDinastiaOnly(session.user)
      ? ["dinastia"]
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

  let allowedSedeKeys = scope.allowedKeys;
  if (dataKind === "dinastia") {
    if (allowedSedeKeys) {
      allowedSedeKeys = allowedSedeKeys.filter((key) =>
        key.toLowerCase().startsWith("dinastia|"),
      );
    } else {
      allowedSedeKeys = listMargenSedeCatalogOptions()
        .filter((option) => option.empresa === "dinastia")
        .map((option) => option.value);
    }
  } else if (dataKind === "default" && allowedSedeKeys) {
    allowedSedeKeys = allowedSedeKeys.filter(
      (key) => !key.toLowerCase().startsWith("dinastia|"),
    );
  }

  const metaClient = await (await getDbPool()).connect();
  let maxCompactDate: string | null = null;
  let minCompactDate: string | null = null;
  let metaFailed = false;
  try {
    try {
      const meta = await loadInformeVariacionMeta(metaClient, allowedSedeKeys, {
        kind: dataKind,
      });
      maxCompactDate = normalizeInformeCompactDate(meta.maxDate);
      minCompactDate = normalizeInformeCompactDate(meta.minDate);
    } catch (metaError) {
      metaFailed = true;
      console.error("[informe-variacion] error cargando maxDate:", metaError);
    }
  } finally {
    metaClient.release();
  }

  if (metaFailed && !maxCompactDate) {
    return withSession(
      NextResponse.json(
        {
          error:
            "No fue posible consultar la fecha maxima de datos. Reintenta en unos segundos.",
        },
        { status: 503, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const yearRaw = url.searchParams.get("year");
  const monthRaw = url.searchParams.get("month");
  const cutsMode =
    Boolean(yearRaw?.trim() && monthRaw?.trim()) &&
    url.searchParams.get("from") == null;

  if (cutsMode) {
    const year = Number(yearRaw);
    const month = Number(monthRaw);
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

    const compareOrError = parseInformeCompareMonthParam(
      year,
      month,
      url.searchParams.get("compareYear"),
      url.searchParams.get("compareMonth"),
    );
    if (isInformeCompareMonthError(compareOrError)) {
      return withSession(
        NextResponse.json(
          { error: compareOrError.error },
          { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    const compare = compareOrError;
    const customCompare = !isDefaultInformeCompareMonth(year, month, compare);
    const asOf = new Date();
    const availableRanges = getInformeCortesDayRanges(
      year,
      month,
      asOf,
      maxCompactDate,
    );
    if (availableRanges.length === 0) {
      return withSession(
        NextResponse.json(
          { error: "No hay cortes de dias disponibles para el mes seleccionado." },
          { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const requestedRange = url.searchParams.get("range")?.trim() ?? "";
    const rangeId = (
      requestedRange
        ? parseInformeDayRangeId(requestedRange)?.id
        : defaultInformeDayRangeId(availableRanges)
    ) as InformeDayRangeId | null;
    const dayRange =
      rangeId == null
        ? null
        : availableRanges.find((range) => range.id === rangeId) ??
          parseInformeDayRangeId(rangeId);
    if (!rangeId || !dayRange || !availableRanges.some((range) => range.id === rangeId)) {
      return withSession(
        NextResponse.json(
          { error: "Rango de dias invalido para el mes seleccionado." },
          { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const forceRefresh = url.searchParams.get("force") === "1";
    const cacheKey = `${buildInformeCacheKey(
      year,
      month,
      allowedSedeKeys,
      rangeId,
      lineScope.forcedMargenTipos,
      lineScope.forcedMargenLineas,
      lineScope.excludedMargenTipos,
      compare,
    )}:ds=${dataKind}`;
    if (forceRefresh) {
      invalidateInformeCacheKey(cacheKey);
    } else {
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
    }

    const useStd =
      dataKind === "default" &&
      !forceRefresh &&
      !customCompare &&
      !rangeId.startsWith("proj-") &&
      !rangeId.startsWith("mtd-");
    if (useStd) {
      const stdClient = await (await getDbPool()).connect();
      try {
        const snapped = await getInformePayloadStd(stdClient, year, month, rangeId);
        if (snapped) {
          const cleaned = adaptInformePayloadStdForRequest(
            snapped,
            allowedSedeKeys,
            lineScope,
          );
          const withProv = await ensureInformeProveedores(stdClient, cleaned);
          const withLookups = await ensureInformeMarcas(stdClient, withProv);
          setCachedInformePayload(cacheKey, withLookups);
          return withSession(
            NextResponse.json(withLookups, {
              headers: {
                "Cache-Control": CACHE_CONTROL,
                "X-Data-Source": "payload-std",
              },
            }),
          );
        }
      } finally {
        stdClient.release();
      }
    }

    const client = await (await getDbPool()).connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL work_mem = '256MB'");
      await client.query("SET LOCAL statement_timeout = '90s'");
      await client.query("SET LOCAL jit = off");
      const startedAt = Date.now();
      const payload = await loadInformeVariacionPayload(
        client,
        year,
        month,
        allowedSedeKeys,
        {
          dayRange,
          forcedMargenTipos: lineScope.forcedMargenTipos,
          forcedMargenLineas: lineScope.forcedMargenLineas,
          excludedMargenTipos: lineScope.excludedMargenTipos,
          kind: dataKind,
          compare,
        },
      );
      const elapsedMs = Date.now() - startedAt;
      await client.query("COMMIT");
      setCachedInformePayload(cacheKey, payload);
      return withSession(
        NextResponse.json(payload, {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "database",
            "X-Informe-Elapsed-Ms": String(elapsedMs),
            "X-Informe-Row-Count": String(payload.meta.rowCount),
          },
        }),
      );
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      console.error("Error en /api/informe-variacion (cortes):", error);
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

  const defaults = defaultInformeYtdRanges(maxCompactDate);
  const currentFrom = parseRangeParam(
    url.searchParams.get("from"),
    defaults.currentFrom,
  );
  const currentTo = parseRangeParam(
    url.searchParams.get("to"),
    defaults.currentTo,
  );
  const previousFrom = parseRangeParam(
    url.searchParams.get("compareFrom"),
    defaults.previousFrom,
  );
  const previousTo = parseRangeParam(
    url.searchParams.get("compareTo"),
    defaults.previousTo,
  );
  if (
    isInformeCompactDateError(currentFrom) ||
    isInformeCompactDateError(currentTo) ||
    isInformeCompactDateError(previousFrom) ||
    isInformeCompactDateError(previousTo)
  ) {
    const firstError = [currentFrom, currentTo, previousFrom, previousTo].find(
      isInformeCompactDateError,
    );
    return withSession(
      NextResponse.json(
        { error: firstError?.error ?? "Fechas invalidas." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const ranges: InformeSelectedRanges = {
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
  };
  const valid = validateInformeSelectedRanges(ranges, {
    maxDate: maxCompactDate,
    minDate: minCompactDate,
  });
  if (!valid.ok) {
    return withSession(
      NextResponse.json(
        { error: valid.error },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const forceRefresh = url.searchParams.get("force") === "1";
  const rangeId = informeRangeCacheKey(ranges);
  const toYear = Number(ranges.currentTo.slice(0, 4));
  const toMonth = Number(ranges.currentTo.slice(4, 6));

  const cacheKey = `${buildInformeRangeCacheKey(
    ranges,
    allowedSedeKeys,
    lineScope.forcedMargenTipos,
    lineScope.forcedMargenLineas,
    lineScope.excludedMargenTipos,
  )}:ds=${dataKind}`;
  if (forceRefresh) {
    invalidateInformeCacheKey(cacheKey);
  } else {
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
  }

  const isDefaultYtd =
    ranges.currentFrom === defaults.currentFrom &&
    ranges.currentTo === defaults.currentTo &&
    ranges.previousFrom === defaults.previousFrom &&
    ranges.previousTo === defaults.previousTo;
  const useStd = dataKind === "default" && !forceRefresh && isDefaultYtd;
  if (useStd) {
    const stdClient = await (await getDbPool()).connect();
    try {
      const snapped = await getInformePayloadStd(
        stdClient,
        toYear,
        toMonth,
        rangeId,
      );
      if (snapped) {
        const cleaned = adaptInformePayloadStdForRequest(
          snapped,
          allowedSedeKeys,
          lineScope,
        );
        const withProv = await ensureInformeProveedores(stdClient, cleaned);
        const withLookups = await ensureInformeMarcas(stdClient, withProv);
        setCachedInformePayload(cacheKey, withLookups);
        return withSession(
          NextResponse.json(withLookups, {
            headers: {
              "Cache-Control": CACHE_CONTROL,
              "X-Data-Source": "payload-std",
            },
          }),
        );
      }
    } finally {
      stdClient.release();
    }
  }

  const client = await (await getDbPool()).connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL work_mem = '256MB'");
    await client.query("SET LOCAL statement_timeout = '90s'");
    await client.query("SET LOCAL jit = off");

    const startedAt = Date.now();
    const payload = await loadInformeVariacionRangePayload(
      client,
      ranges,
      allowedSedeKeys,
      {
        forcedMargenTipos: lineScope.forcedMargenTipos,
        forcedMargenLineas: lineScope.forcedMargenLineas,
        excludedMargenTipos: lineScope.excludedMargenTipos,
        kind: dataKind,
      },
    );
    const elapsedMs = Date.now() - startedAt;
    await client.query("COMMIT");
    if (elapsedMs > 5_000) {
      console.info(
        `[informe-variacion] query lenta ${elapsedMs}ms ${rangeId} rows=${payload.meta.rowCount}`,
      );
    }

    setCachedInformePayload(cacheKey, payload);

    return withSession(
      NextResponse.json(payload, {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "X-Data-Source": "database",
          "X-Informe-Elapsed-Ms": String(elapsedMs),
          "X-Informe-Row-Count": String(payload.meta.rowCount),
        },
      }),
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
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
