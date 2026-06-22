import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { getDbPool } from "@/lib/db";

const CACHE_CONTROL = "no-store, private";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(session.user.allowedSubdashboards, "margenes"))
  ) {
    return NextResponse.json(
      { error: "No tienes permisos para esta seccion." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const pool = await getDbPool();
  const client = await pool.connect();
  try {
    const tableCheck = await client.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'margen_final'
      LIMIT 1
    `);

    if (!tableCheck.rows?.length) {
      const response = NextResponse.json(
        {
          ready: false,
          table: "margen_final",
          rowCount: 0,
          minDate: null,
          maxDate: null,
          sedeCount: 0,
          message:
            "Tabla margen_final no existe aun. Aplica db/migrations/20260622_margen_final.sql.",
        },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      );
      response.cookies.set(
        "vp_session",
        session.token,
        getSessionCookieOptions(session.expiresAt),
      );
      return response;
    }

    const stats = await client.query<{
      row_count: string;
      min_date: string | null;
      max_date: string | null;
      sede_count: string;
    }>(`
      SELECT
        COUNT(*)::bigint AS row_count,
        MIN(fecha_dcto) AS min_date,
        MAX(fecha_dcto) AS max_date,
        COUNT(DISTINCT (COALESCE(empresa, ''), COALESCE(id_co, '')))::bigint AS sede_count
      FROM margen_final
      WHERE fecha_dcto IS NOT NULL
        AND fecha_dcto ~ '^[0-9]{8}$'
    `);

    const row = stats.rows[0];
    const rowCount = Number(row?.row_count ?? 0);
    const response = NextResponse.json(
      {
        ready: rowCount > 0,
        table: "margen_final",
        rowCount,
        minDate: row?.min_date ?? null,
        maxDate: row?.max_date ?? null,
        sedeCount: Number(row?.sede_count ?? 0),
        message:
          rowCount > 0
            ? null
            : "Tabla margen_final vacia. Pendiente carga ETL desde origen.",
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  } catch (error) {
    console.error("[margenes/meta] error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Error consultando metadata de margen_final." },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } finally {
    client.release();
  }
}
