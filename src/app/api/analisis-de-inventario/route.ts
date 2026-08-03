import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { parseAnalisisInventarioDrillPath } from "@/lib/analisis-inventario/drill-path";
import {
  applySedeColumnFilters,
  columnsToSedePairs,
  parseAnalisisInventarioDimensionFilters,
} from "@/lib/analisis-inventario/filters";
import { parseAnalisisInventarioLineFamily } from "@/lib/analisis-inventario/line-family";
import {
  queryAnalisisInventarioBoard,
  queryAnalisisInventarioDateBounds,
  queryAnalisisInventarioDrill,
  queryAnalisisInventarioFilterCatalog,
  queryAnalisisInventarioHeatmap,
  resolveDefaultAnalisisDateRange,
} from "@/lib/analisis-inventario/queries";
import { resolveAnalisisInventarioScope } from "@/lib/analisis-inventario/scope";
import type { AnalisisInventarioSedeColumn } from "@/lib/analisis-inventario/types";
import {
  getCachedQuery,
  setCachedQuery,
} from "@/lib/margenes/query-cache";
import {
  getRotacionPeriodoStdMeta,
  matchesRotacionPeriodoStdRange,
} from "@/lib/rotacion/periodo-std-server";
import type { RotacionSourceTable } from "@/lib/rotacion/source-tables";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";

const CACHE_CONTROL = "no-store";
const BOARD_CACHE_TTL_MS = 5 * 60 * 1000;

const isIsoDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const isStatementTimeout = (error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "57014" || /statement timeout/i.test(message);
};

type ResolvedMeta = {
  availableDateStart: string;
  availableDateEnd: string;
  defaultDateStart: string;
  defaultDateEnd: string;
  selectedDateStart: string;
  selectedDateEnd: string;
  sourceTable: string;
  sedes: AnalisisInventarioSedeColumn[];
  fastPath: boolean;
};

async function resolveDatesAndMeta(
  client: import("pg").PoolClient,
  scope: Extract<
    ReturnType<typeof resolveAnalisisInventarioScope>,
    { ok: true }
  >,
  url: URL,
): Promise<
  | { ok: true; meta: ResolvedMeta; dateStart: string; dateEnd: string }
  | { ok: false; payload: Record<string, unknown> }
> {
  const periodoMeta = await getRotacionPeriodoStdMeta(
    client,
    scope.sourceTable as RotacionSourceTable,
  );
  const bounds = await queryAnalisisInventarioDateBounds(
    client,
    scope.matview,
    scope.sourceTable,
  );

  const availableEnd = bounds.max ?? periodoMeta?.periodoEnd ?? "";
  const availableStart = bounds.min ?? periodoMeta?.periodoStart ?? availableEnd;

  if (!availableEnd) {
    return {
      ok: false,
      payload: {
        meta: {
          availableDateStart: "",
          availableDateEnd: "",
          defaultDateStart: "",
          defaultDateEnd: "",
          sourceTable: scope.matview,
          sedes: scope.columns,
          fastPath: false,
        },
        message:
          "Aún no hay datos de inventario disponibles para este alcance.",
      },
    };
  }

  const rollingDefaults = resolveDefaultAnalisisDateRange(
    availableStart || availableEnd,
    availableEnd,
  );
  const defaults =
    periodoMeta && periodoMeta.rowCount > 0
      ? { start: periodoMeta.periodoStart, end: periodoMeta.periodoEnd }
      : rollingDefaults;

  let dateStart = isIsoDate(url.searchParams.get("dateStart"))
    ? (url.searchParams.get("dateStart") as string)
    : defaults.start;
  let dateEnd = isIsoDate(url.searchParams.get("dateEnd"))
    ? (url.searchParams.get("dateEnd") as string)
    : defaults.end;

  const clampMin = availableStart || dateStart;
  const clampMax = availableEnd;
  if (dateStart < clampMin) dateStart = clampMin;
  if (dateEnd > clampMax) dateEnd = clampMax;
  if (dateStart > dateEnd) {
    const tmp = dateStart;
    dateStart = dateEnd;
    dateEnd = tmp;
  }

  const fastPath = matchesRotacionPeriodoStdRange(
    periodoMeta,
    dateStart,
    dateEnd,
  );

  return {
    ok: true,
    dateStart,
    dateEnd,
    meta: {
      availableDateStart: clampMin,
      availableDateEnd: clampMax,
      defaultDateStart: defaults.start,
      defaultDateEnd: defaults.end,
      selectedDateStart: dateStart,
      selectedDateEnd: dateEnd,
      sourceTable: fastPath ? scope.periodoStdTable : scope.matview,
      sedes: scope.columns,
      fastPath,
    },
  };
}

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
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "venta") ||
      !canAccessPortalSubsection(
        session.user.allowedSubdashboards,
        "analisis-de-inventario",
      ))
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta sección." },
        { status: 403 },
      ),
    );
  }

  const scope = resolveAnalisisInventarioScope(session.user);
  if (!scope.ok) {
    return withSession(
      NextResponse.json({ error: scope.error }, { status: scope.status }),
    );
  }

  const url = new URL(request.url);
  const modeRaw = url.searchParams.get("mode");
  const mode =
    modeRaw === "drill" ||
    modeRaw === "heatmap" ||
    modeRaw === "board" ||
    modeRaw === "filters" ||
    modeRaw === "meta"
      ? modeRaw
      : "meta";

  const cacheKey = `analisis-inv:${session.user.id}:${scope.sourceTable}:${url.search}`;
  if (
    mode === "board" ||
    mode === "drill" ||
    mode === "heatmap" ||
    mode === "filters"
  ) {
    const cached = getCachedQuery(cacheKey);
    if (cached) {
      return withSession(NextResponse.json(cached));
    }
  }

  try {
    const pool = await getDbPool();
    const metaClient = await pool.connect();
    let resolved: Awaited<ReturnType<typeof resolveDatesAndMeta>>;
    try {
      resolved = await resolveDatesAndMeta(metaClient, scope, url);
    } finally {
      metaClient.release();
    }

    if (!resolved.ok) {
      return withSession(NextResponse.json({ mode, ...resolved.payload }));
    }

    const { meta, dateStart, dateEnd } = resolved;

    if (mode === "meta") {
      return withSession(NextResponse.json({ mode, meta }));
    }

    const path = parseAnalisisInventarioDrillPath(
      url.searchParams.get("drillPath"),
    );
    const heatmapPath = parseAnalisisInventarioDrillPath(
      url.searchParams.get("heatmapPath") ??
        (mode === "heatmap" ? url.searchParams.get("drillPath") : null),
    );
    const lineFamily = parseAnalisisInventarioLineFamily(
      url.searchParams.get("lineFamily"),
    );
    const dimFilters = parseAnalisisInventarioDimensionFilters(url.searchParams);
    const filteredColumns = applySedeColumnFilters(scope.columns, dimFilters);
    const activeColumns =
      filteredColumns.length > 0 ? filteredColumns : scope.columns;
    const activeSedePairs = columnsToSedePairs(activeColumns);
    const metricRaw = url.searchParams.get("metric");
    const metric: "units" | "value" =
      metricRaw === "value" ? "value" : "units";

    const queryArgs = {
      matview: scope.matview,
      periodoStdTable: scope.periodoStdTable,
      sourceTable: scope.sourceTable,
      dateStart,
      dateEnd,
      sedePairs: activeSedePairs,
      lineFamily,
      metric,
      dimFilters: {
        lineas: dimFilters.lineas,
        sublineas: dimFilters.sublineas,
        items: dimFilters.items,
        diMinDays: dimFilters.diMinDays,
      },
    };

    if (mode === "filters") {
      const client = await pool.connect();
      try {
        const catalog = await queryAnalisisInventarioFilterCatalog(client, {
          ...queryArgs,
          itemQuery: url.searchParams.get("itemQuery") ?? "",
        });
        const payload = { mode, meta, filters: catalog };
        setCachedQuery(cacheKey, payload, BOARD_CACHE_TTL_MS);
        return withSession(NextResponse.json(payload));
      } finally {
        client.release();
      }
    }

    if (mode === "board") {
      const { drill, heatmap } = await queryAnalisisInventarioBoard(pool, {
        ...queryArgs,
        path,
        heatmapPath,
        columns: activeColumns,
      });
      const payload = {
        mode,
        meta: {
          ...meta,
          sourceTable:
            drill.sourceMode === "periodo_std"
              ? scope.periodoStdTable
              : scope.matview,
          fastPath: drill.sourceMode === "periodo_std",
          sedes: scope.columns,
        },
        drill: { level: drill.level, rows: drill.rows, path },
        heatmap,
      };
      setCachedQuery(cacheKey, payload, BOARD_CACHE_TTL_MS);
      return withSession(NextResponse.json(payload));
    }

    const single = await pool.connect();
    try {
      if (mode === "drill") {
        const drill = await queryAnalisisInventarioDrill(single, {
          ...queryArgs,
          path,
        });
        const payload = {
          mode,
          meta,
          drill: { level: drill.level, rows: drill.rows, path },
        };
        setCachedQuery(cacheKey, payload, BOARD_CACHE_TTL_MS);
        return withSession(NextResponse.json(payload));
      }

      const heatmap = await queryAnalisisInventarioHeatmap(single, {
        ...queryArgs,
        path: heatmapPath,
        columns: activeColumns,
      });
      const payload = { mode, meta, heatmap };
      setCachedQuery(cacheKey, payload, BOARD_CACHE_TTL_MS);
      return withSession(NextResponse.json(payload));
    } finally {
      single.release();
    }
  } catch (error) {
    console.error("[analisis-de-inventario]", error);
    if (isStatementTimeout(error)) {
      return withSession(
        NextResponse.json(
          {
            error:
              "La consulta tardó demasiado. Prueba un rango más corto o menos sedes.",
          },
          { status: 504 },
        ),
      );
    }
    return withSession(
      NextResponse.json(
        { error: "No se pudo consultar el análisis de inventario." },
        { status: 500 },
      ),
    );
  }
}
