import { NextResponse } from "next/server";
import {
  applySessionCookies,
  getAuditNetworkId,
  getClientIp,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  insertExportDownloadLog,
  parseExportDownloadFormat,
  sanitizeExportFilters,
} from "@/lib/admin/export-download-log";
import { getPathLabel } from "@/lib/shared/path-labels";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export const dynamic = "force-dynamic";

type Body = {
  panelPath?: unknown;
  panelLabel?: unknown;
  exportKind?: unknown;
  format?: unknown;
  fileName?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  filters?: unknown;
  rowCount?: unknown;
  byteSize?: unknown;
};

const asOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 90,
    keyPrefix: "exports-log",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }),
    );
  }

  let body: Body | null = null;
  try {
    body = (await request.json()) as Body;
  } catch {
    return withSession(
      NextResponse.json({ error: "JSON invalido." }, { status: 400 }),
    );
  }

  const fileName = asOptionalString(body?.fileName);
  const exportKind = asOptionalString(body?.exportKind);
  if (!fileName || !exportKind) {
    return withSession(
      NextResponse.json(
        { error: "fileName y exportKind son obligatorios." },
        { status: 400 },
      ),
    );
  }

  const panelPath = asOptionalString(body?.panelPath) ?? "/";
  const panelLabel =
    asOptionalString(body?.panelLabel) ?? getPathLabel(panelPath);
  const format = parseExportDownloadFormat(body?.format);
  const clientIp = getClientIp(request);
  const auditIp = getAuditNetworkId(clientIp) ?? clientIp;
  const userAgent = request.headers.get("user-agent");

  const client = await (await getDbPool()).connect();
  try {
    const id = await insertExportDownloadLog(client, {
      userId: session.user.id,
      username: session.user.username,
      panelPath,
      panelLabel,
      exportKind,
      format,
      fileName,
      dateFrom: asOptionalString(body?.dateFrom),
      dateTo: asOptionalString(body?.dateTo),
      filters: sanitizeExportFilters(body?.filters),
      rowCount: asOptionalNumber(body?.rowCount),
      byteSize: asOptionalNumber(body?.byteSize),
      source: "client",
      ip: auditIp,
      userAgent,
    });
    return withSession(NextResponse.json({ ok: true, id }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/app_export_download_log/i.test(message) && /does not exist|no existe/i.test(message)) {
      return withSession(
        NextResponse.json(
          {
            error:
              "Falta aplicar db/migrations/20260721_app_export_download_log.sql",
          },
          { status: 503 },
        ),
      );
    }
    console.error("[exports/log] error", error);
    return withSession(
      NextResponse.json({ error: "No se pudo registrar la descarga." }, { status: 500 }),
    );
  } finally {
    client.release();
  }
}
