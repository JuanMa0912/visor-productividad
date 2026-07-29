import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { parseAnalisisInventarioDrillPath } from "@/lib/analisis-inventario/drill-path";
import {
  queryAnalisisInventarioDateBounds,
  queryAnalisisInventarioDrill,
  queryAnalisisInventarioHeatmap,
  resolveDefaultAnalisisDateRange,
} from "@/lib/analisis-inventario/queries";
import { resolveAnalisisInventarioScope } from "@/lib/analisis-inventario/scope";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";

const CACHE_CONTROL = "no-store";

const isIsoDate = (value: string | null): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

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
      NextResponse.json(
        { error: scope.error },
        { status: scope.status },
      ),
    );
  }

  const url = new URL(request.url);
  const modeRaw = url.searchParams.get("mode");
  const mode =
    modeRaw === "drill" || modeRaw === "heatmap" || modeRaw === "meta"
      ? modeRaw
      : "meta";

  const client = await (await getDbPool()).connect();
  try {
    const bounds = await queryAnalisisInventarioDateBounds(
      client,
      scope.matview,
    );
    if (!bounds.min || !bounds.max) {
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
          },
          message:
            "Aún no hay matview de inventario limpia disponible para este alcance.",
        }),
      );
    }

    const defaults = resolveDefaultAnalisisDateRange(bounds.min, bounds.max);
    let dateStart = isIsoDate(url.searchParams.get("dateStart"))
      ? (url.searchParams.get("dateStart") as string)
      : defaults.start;
    let dateEnd = isIsoDate(url.searchParams.get("dateEnd"))
      ? (url.searchParams.get("dateEnd") as string)
      : defaults.end;
    if (dateStart < bounds.min) dateStart = bounds.min;
    if (dateEnd > bounds.max) dateEnd = bounds.max;
    if (dateStart > dateEnd) {
      const tmp = dateStart;
      dateStart = dateEnd;
      dateEnd = tmp;
    }

    const meta = {
      availableDateStart: bounds.min,
      availableDateEnd: bounds.max,
      defaultDateStart: defaults.start,
      defaultDateEnd: defaults.end,
      selectedDateStart: dateStart,
      selectedDateEnd: dateEnd,
      sourceTable: scope.matview,
      sedes: scope.columns,
    };

    if (mode === "meta") {
      return withSession(NextResponse.json({ mode, meta }));
    }

    const path = parseAnalisisInventarioDrillPath(
      url.searchParams.get("drillPath"),
    );

    if (mode === "drill") {
      const drill = await queryAnalisisInventarioDrill(client, {
        matview: scope.matview,
        dateStart,
        dateEnd,
        sedePairs: scope.sedePairs,
        path,
      });
      return withSession(
        NextResponse.json({
          mode,
          meta,
          drill: {
            level: drill.level,
            rows: drill.rows,
            path,
          },
        }),
      );
    }

    const heatmap = await queryAnalisisInventarioHeatmap(client, {
      matview: scope.matview,
      dateStart,
      dateEnd,
      sedePairs: scope.sedePairs,
      path,
      columns: scope.columns,
    });
    return withSession(
      NextResponse.json({
        mode,
        meta,
        heatmap,
      }),
    );
  } catch (error) {
    console.error("[analisis-de-inventario]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo consultar el análisis de inventario." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
