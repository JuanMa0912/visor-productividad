import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { getDbPool } from "@/lib/db";
import { compactRangeSpanDays } from "@/lib/margenes/date-range";

const CACHE_CONTROL = "no-store, private";
const META_TTL_MS = 60_000;

type MetaPayload = {
  ready: boolean;
  table: string;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
  distinctDateCount?: number;
  invalidDateRows?: number;
  dates?: Array<{ value: string; rowCount: number }>;
  sedeCount: number;
  rowCountIsEstimate?: boolean;
  message?: string | null;
  error?: string;
};

let metaCache: { at: number; payload: MetaPayload } | null = null;

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

  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) {
    const response = NextResponse.json(metaCache.payload, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
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
      const payload: MetaPayload = {
        ready: false,
        table: "margen_final",
        rowCount: 0,
        minDate: null,
        maxDate: null,
        sedeCount: 0,
        message:
          "Tabla margen_final no existe aun. Aplica db/migrations/20260622_margen_final.sql.",
      };
      const response = NextResponse.json(payload, {
        headers: { "Cache-Control": CACHE_CONTROL },
      });
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
          SELECT fecha_dcto
          FROM margen_final
          WHERE fecha_dcto IS NOT NULL
          ORDER BY fecha_dcto ASC
          LIMIT 1
        ) AS min_date,
        (
          SELECT fecha_dcto
          FROM margen_final
          WHERE fecha_dcto IS NOT NULL
          ORDER BY fecha_dcto DESC
          LIMIT 1
        ) AS max_date,
        EXISTS (
          SELECT 1
          FROM margen_final
          WHERE fecha_dcto IS NOT NULL
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
    const rawEstimate = Number(row?.row_estimate ?? 0);
    // reltuples a veces llega mal tipado / overflow; evita mostrar negativos.
    const rowCount =
      Number.isFinite(rawEstimate) && rawEstimate > 0
        ? Math.trunc(rawEstimate)
        : 0;
    const hasRows = Boolean(row?.has_rows);
    const minDate = row?.min_date ?? null;
    const maxDate = row?.max_date ?? null;

    let distinctDateCount = 0;
    if (hasRows && minDate && maxDate && minDate <= maxDate) {
      const spanDays = compactRangeSpanDays(minDate, maxDate);
      distinctDateCount = spanDays > 0 && spanDays <= 62 ? spanDays : 0;
    }

    const payload: MetaPayload = {
      ready: hasRows,
      table: "margen_final",
      rowCount,
      minDate,
      maxDate,
      distinctDateCount: distinctDateCount || undefined,
      invalidDateRows: 0,
      dates: [],
      sedeCount: 0,
      rowCountIsEstimate: true,
      message: hasRows
        ? null
        : "Tabla margen_final vacia. Pendiente carga ETL desde origen.",
    };

    metaCache = { at: Date.now(), payload };

    const response = NextResponse.json(payload, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
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
