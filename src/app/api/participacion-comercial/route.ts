import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { resolveAnalisisInventarioScope } from "@/lib/analisis-inventario/scope";
import { parseParticipacionDrillPath } from "@/lib/participacion-comercial/format";
import {
  queryParticipacionBoard,
  queryParticipacionDateBounds,
  queryParticipacionDrill,
  queryParticipacionMatrix,
  resolveDefaultParticipacionDateRange,
} from "@/lib/participacion-comercial/queries";
import type { ParticipacionOrientation } from "@/lib/participacion-comercial/types";
import {
  getCachedQuery,
  setCachedQuery,
} from "@/lib/margenes/query-cache";
import {
  getRotacionPeriodoStdMeta,
  matchesRotacionPeriodoStdRange,
} from "@/lib/rotacion/periodo-std-server";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";

const CACHE_CONTROL = "no-store";
const CACHE_TTL_MS = 5 * 60 * 1000;

const isIsoDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const parseOrientation = (raw: string | null): ParticipacionOrientation =>
  raw === "linea" ? "linea" : "sede";

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
        "participacion-comercial",
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
    modeRaw === "matrix" ||
    modeRaw === "board" ||
    modeRaw === "meta"
      ? modeRaw
      : "meta";
  const orientation = parseOrientation(url.searchParams.get("orientation"));

  const cacheKey = `participacion:${session.user.id}:${scope.sourceTable}:${url.search}`;
  if (mode !== "meta") {
    const cached = getCachedQuery(cacheKey);
    if (cached) return withSession(NextResponse.json(cached));
  }

  try {
    const pool = await getDbPool();
    const metaClient = await pool.connect();
    let meta;
    let dateStart: string;
    let dateEnd: string;
    try {
      const periodoMeta = await getRotacionPeriodoStdMeta(
        metaClient,
        scope.sourceTable,
      );
      const bounds = await queryParticipacionDateBounds(
        metaClient,
        scope.matview,
        scope.sourceTable,
      );
      const availableEnd = bounds.max ?? periodoMeta?.periodoEnd ?? "";
      const availableStart =
        bounds.min ?? periodoMeta?.periodoStart ?? availableEnd;
      if (!availableEnd) {
        return withSession(
          NextResponse.json({
            mode,
            meta: {
              availableDateStart: "",
              availableDateEnd: "",
              defaultDateStart: "",
              defaultDateEnd: "",
              sourceTable: scope.matview,
              sedes: scope.columns,
              fastPath: false,
            },
            message: "Aún no hay datos de venta disponibles.",
          }),
        );
      }

      const rolling = resolveDefaultParticipacionDateRange(
        availableStart || availableEnd,
        availableEnd,
      );
      const defaults =
        periodoMeta && periodoMeta.rowCount > 0
          ? { start: periodoMeta.periodoStart, end: periodoMeta.periodoEnd }
          : rolling;

      dateStart = isIsoDate(url.searchParams.get("dateStart"))
        ? (url.searchParams.get("dateStart") as string)
        : defaults.start;
      dateEnd = isIsoDate(url.searchParams.get("dateEnd"))
        ? (url.searchParams.get("dateEnd") as string)
        : defaults.end;
      if (dateStart < availableStart) dateStart = availableStart;
      if (dateEnd > availableEnd) dateEnd = availableEnd;
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
      meta = {
        availableDateStart: availableStart,
        availableDateEnd: availableEnd,
        defaultDateStart: defaults.start,
        defaultDateEnd: defaults.end,
        selectedDateStart: dateStart,
        selectedDateEnd: dateEnd,
        sourceTable: fastPath ? scope.periodoStdTable : scope.matview,
        sedes: scope.columns,
        fastPath,
      };
    } finally {
      metaClient.release();
    }

    if (mode === "meta") {
      return withSession(NextResponse.json({ mode, meta }));
    }

    const path = parseParticipacionDrillPath(url.searchParams.get("drillPath"));
    const queryArgs = {
      matview: scope.matview,
      periodoStdTable: scope.periodoStdTable,
      sourceTable: scope.sourceTable,
      dateStart,
      dateEnd,
      sedePairs: scope.sedePairs,
    };

    if (mode === "board") {
      const { drill, matrix } = await queryParticipacionBoard(pool, {
        ...queryArgs,
        orientation,
        path,
        columns: scope.columns,
      });
      const payload = {
        mode,
        meta: {
          ...meta,
          fastPath: drill.sourceMode === "periodo_std",
          sourceTable:
            drill.sourceMode === "periodo_std"
              ? scope.periodoStdTable
              : scope.matview,
        },
        drill: {
          orientation,
          level: drill.level,
          rows: drill.rows,
          path,
          parentTotalSales: drill.parentTotalSales,
        },
        matrix,
      };
      setCachedQuery(cacheKey, payload, CACHE_TTL_MS);
      return withSession(NextResponse.json(payload));
    }

    const client = await pool.connect();
    try {
      if (mode === "drill") {
        const drill = await queryParticipacionDrill(client, {
          ...queryArgs,
          orientation,
          path,
        });
        const payload = {
          mode,
          meta,
          drill: {
            orientation,
            level: drill.level,
            rows: drill.rows,
            path,
            parentTotalSales: drill.parentTotalSales,
          },
        };
        setCachedQuery(cacheKey, payload, CACHE_TTL_MS);
        return withSession(NextResponse.json(payload));
      }

      const matrix = await queryParticipacionMatrix(client, {
        ...queryArgs,
        columns: scope.columns,
      });
      const payload = { mode, meta, matrix };
      setCachedQuery(cacheKey, payload, CACHE_TTL_MS);
      return withSession(NextResponse.json(payload));
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[participacion-comercial]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo consultar la participación comercial." },
        { status: 500 },
      ),
    );
  }
}
