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

    const bounds = await client.query<{
      min_date: string | null;
      max_date: string | null;
      has_rows: boolean;
      row_estimate: string | null;
    }>(`
      SELECT
        (
          SELECT MIN(fecha_dcto)
          FROM margen_final
          WHERE fecha_dcto ~ '^[0-9]{8}$'
        ) AS min_date,
        (
          SELECT MAX(fecha_dcto)
          FROM margen_final
          WHERE fecha_dcto ~ '^[0-9]{8}$'
        ) AS max_date,
        EXISTS (
          SELECT 1
          FROM margen_final
          WHERE fecha_dcto IS NOT NULL
            AND fecha_dcto ~ '^[0-9]{8}$'
          LIMIT 1
        ) AS has_rows,
        (
          SELECT GREATEST(c.reltuples::bigint, 0)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'margen_final'
        ) AS row_estimate
    `);

    const row = bounds.rows[0];
    const rowCount = Number(row?.row_estimate ?? 0);
    const hasRows = Boolean(row?.has_rows);
    const minDate = row?.min_date ?? null;
    const maxDate = row?.max_date ?? null;

    let distinctDateCount = 0;
    let dates: Array<{ value: string; rowCount: number }> = [];
    if (hasRows && minDate && maxDate && minDate <= maxDate) {
      const spanResult = await client.query<{ distinct_dates: string }>(`
        SELECT COUNT(*)::bigint AS distinct_dates
        FROM (
          SELECT DISTINCT fecha_dcto
          FROM margen_final
          WHERE fecha_dcto BETWEEN $1 AND $2
        ) d
      `, [minDate, maxDate]);
      distinctDateCount = Number(spanResult.rows[0]?.distinct_dates ?? 0);
      if (distinctDateCount > 0 && distinctDateCount <= 31) {
        const datesResult = await client.query<{ fecha_dcto: string; row_count: string }>(`
          SELECT fecha_dcto, COUNT(*)::bigint AS row_count
          FROM margen_final
          WHERE fecha_dcto BETWEEN $1 AND $2
            AND fecha_dcto ~ '^[0-9]{8}$'
          GROUP BY 1
          ORDER BY 1
        `, [minDate, maxDate]);
        dates = datesResult.rows.map((entry) => ({
          value: entry.fecha_dcto,
          rowCount: Number(entry.row_count ?? 0),
        }));
      }
    }

    const response = NextResponse.json(
      {
        ready: hasRows,
        table: "margen_final",
        rowCount,
        minDate,
        maxDate,
        distinctDateCount,
        invalidDateRows: 0,
        dates,
        sedeCount: 0,
        rowCountIsEstimate: true,
        message:
          hasRows
            ? distinctDateCount > 0 && distinctDateCount <= 2
              ? `Solo hay ${distinctDateCount} día(s) cargado(s) en margen_final. Si esperas el mes completo, falta ETL o sync a GCP.`
              : null
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
