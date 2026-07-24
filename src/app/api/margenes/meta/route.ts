import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { getDbPool } from "@/lib/db";
import { compactRangeSpanDays } from "@/lib/margenes/date-range";
import {
  canonicalizeEmpresaCode,
  DINASTIA_EMPRESA_CODE,
  userHasDinastiaAccess,
  userIsDinastiaOnly,
} from "@/lib/shared/data-tenant";

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

type MetaTable = "margen_final" | "margen_dinastia";

const metaCacheByTable = new Map<
  MetaTable,
  { at: number; payload: MetaPayload }
>();

const resolveMetaTable = (
  user: { role: "admin" | "user"; allowedEmpresas?: string[] | null },
  empresaParam: string | null,
): MetaTable | { error: string } => {
  if (userIsDinastiaOnly(user)) return "margen_dinastia";
  const code = canonicalizeEmpresaCode(empresaParam);
  if (code === DINASTIA_EMPRESA_CODE) {
    if (!userHasDinastiaAccess(user)) {
      return { error: "No tienes permiso para consultar metadata de Dinastía." };
    }
    return "margen_dinastia";
  }
  return "margen_final";
};

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const metaTableOrError = resolveMetaTable(
    session.user,
    url.searchParams.get("empresa"),
  );
  if (typeof metaTableOrError === "object") {
    return NextResponse.json(
      { error: metaTableOrError.error },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
  const metaTable = metaTableOrError;

  const cached = metaCacheByTable.get(metaTable);
  if (cached && Date.now() - cached.at < META_TTL_MS) {
    const response = NextResponse.json(cached.payload, {
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
    const tableCheck = await client.query(
      `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1
      `,
      [metaTable],
    );

    if (!tableCheck.rows?.length) {
      const payload: MetaPayload = {
        ready: false,
        table: metaTable,
        rowCount: 0,
        minDate: null,
        maxDate: null,
        sedeCount: 0,
        message:
          metaTable === "margen_dinastia"
            ? "Tabla margen_dinastia no existe aun. Aplica db/migrations/20260723_dinastia_tenant_tables.sql."
            : "Tabla margen_final no existe aun. Aplica db/migrations/20260622_margen_final.sql.",
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
    }>(
      `
      SELECT
        (
          SELECT fecha_dcto
          FROM ${metaTable}
          WHERE fecha_dcto IS NOT NULL
          ORDER BY fecha_dcto ASC
          LIMIT 1
        ) AS min_date,
        (
          SELECT fecha_dcto
          FROM ${metaTable}
          WHERE fecha_dcto IS NOT NULL
          ORDER BY fecha_dcto DESC
          LIMIT 1
        ) AS max_date,
        EXISTS (
          SELECT 1
          FROM ${metaTable}
          WHERE fecha_dcto IS NOT NULL
          LIMIT 1
        ) AS has_rows,
        (
          SELECT GREATEST(c.reltuples::bigint, 0)
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = $1
        ) AS row_estimate
      `,
      [metaTable],
    );

    const row = bounds.rows[0];
    const rawEstimate = Number(row?.row_estimate ?? 0);
    const rowCount =
      Number.isFinite(rawEstimate) && rawEstimate > 0
        ? Math.trunc(rawEstimate)
        : 0;
    const hasRows = Boolean(row?.has_rows);
    const normalizeMetaDate = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (/^\d{8}$/.test(trimmed)) return trimmed;
      const digits = trimmed.slice(0, 10).replace(/[^0-9]/g, "");
      return /^\d{8}$/.test(digits) ? digits : null;
    };
    const minDate = normalizeMetaDate(row?.min_date ?? null);
    const maxDate = normalizeMetaDate(row?.max_date ?? null);

    let distinctDateCount = 0;
    if (hasRows && minDate && maxDate && minDate <= maxDate) {
      const spanDays = compactRangeSpanDays(minDate, maxDate);
      distinctDateCount = spanDays > 0 && spanDays <= 62 ? spanDays : 0;
    }

    const emptyMessage =
      metaTable === "margen_dinastia"
        ? "Tabla margen_dinastia vacia. Pendiente carga ETL desde origen."
        : "Tabla margen_final vacia. Pendiente carga ETL desde origen.";

    const payload: MetaPayload = {
      ready: hasRows,
      table: metaTable,
      rowCount,
      minDate,
      maxDate,
      distinctDateCount: distinctDateCount || undefined,
      invalidDateRows: 0,
      dates: [],
      sedeCount: 0,
      rowCountIsEstimate: true,
      message: hasRows ? null : emptyMessage,
    };

    metaCacheByTable.set(metaTable, { at: Date.now(), payload });

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
      table: metaTable,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: `Error consultando metadata de ${metaTable}.` },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } finally {
    client.release();
  }
}
