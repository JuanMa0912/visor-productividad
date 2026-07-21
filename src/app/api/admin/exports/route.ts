import { NextResponse } from "next/server";
import { applySessionCookies, requireAdminSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export type AdminExportDownloadRow = {
  id: number;
  userId: string | null;
  username: string;
  panelPath: string;
  panelLabel: string | null;
  exportKind: string;
  format: string;
  fileName: string;
  dateFrom: string | null;
  dateTo: string | null;
  filters: Record<string, unknown> | null;
  rowCount: number | null;
  byteSize: number | null;
  source: string;
  ip: string | null;
  createdAt: string;
};

export type AdminExportDownloadListResponse = {
  rows: AdminExportDownloadRow[];
  generatedAt: string;
  tableMissing?: boolean;
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-exports-get",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }),
    );
  }

  const url = new URL(req.url);
  const username = url.searchParams.get("username")?.trim() || null;
  const panelPath = url.searchParams.get("panelPath")?.trim() || null;
  const format = url.searchParams.get("format")?.trim() || null;
  const dateFrom = url.searchParams.get("dateFrom")?.trim() || null;
  const dateTo = url.searchParams.get("dateTo")?.trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(500, Math.max(1, Math.trunc(limitRaw)))
    : 100;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (username) {
    params.push(`%${username.toLowerCase()}%`);
    conditions.push(`lower(username) LIKE $${params.length}`);
  }
  if (panelPath) {
    params.push(`${panelPath}%`);
    conditions.push(`panel_path LIKE $${params.length}`);
  }
  if (format) {
    params.push(format.toLowerCase());
    conditions.push(`format = $${params.length}`);
  }
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    params.push(dateFrom);
    conditions.push(`created_at::date >= $${params.length}::date`);
  }
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    params.push(dateTo);
    conditions.push(`created_at::date <= $${params.length}::date`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query<{
      id: string | number;
      userId: string | null;
      username: string;
      panelPath: string;
      panelLabel: string | null;
      exportKind: string;
      format: string;
      fileName: string;
      dateFrom: string | null;
      dateTo: string | null;
      filters: Record<string, unknown> | null;
      rowCount: number | null;
      byteSize: number | null;
      source: string;
      ip: string | null;
      createdAt: Date | string;
    }>(
      `
      SELECT
        id,
        user_id AS "userId",
        username,
        panel_path AS "panelPath",
        panel_label AS "panelLabel",
        export_kind AS "exportKind",
        format,
        file_name AS "fileName",
        date_from AS "dateFrom",
        date_to AS "dateTo",
        filters,
        row_count AS "rowCount",
        byte_size AS "byteSize",
        source,
        ip,
        created_at AS "createdAt"
      FROM app_export_download_log
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}
      `,
      params,
    );

    const rows: AdminExportDownloadRow[] = result.rows.map((row) => ({
      id: Number(row.id),
      userId: row.userId,
      username: row.username,
      panelPath: row.panelPath,
      panelLabel: row.panelLabel,
      exportKind: row.exportKind,
      format: row.format,
      fileName: row.fileName,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      filters: row.filters,
      rowCount: row.rowCount == null ? null : Number(row.rowCount),
      byteSize: row.byteSize == null ? null : Number(row.byteSize),
      source: row.source,
      ip: row.ip,
      createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    }));

    const payload: AdminExportDownloadListResponse = {
      rows,
      generatedAt: new Date().toISOString(),
    };
    return withSession(NextResponse.json(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /app_export_download_log/i.test(message) &&
      /does not exist|no existe/i.test(message)
    ) {
      return withSession(
        NextResponse.json({
          rows: [],
          generatedAt: new Date().toISOString(),
          tableMissing: true,
        } satisfies AdminExportDownloadListResponse),
      );
    }
    console.error("[admin/exports] error", error);
    return withSession(
      NextResponse.json({ error: "No se pudo listar descargas." }, { status: 500 }),
    );
  } finally {
    client.release();
  }
}
