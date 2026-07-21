import type { PoolClient } from "pg";

/** Retencion por defecto: 9 meses (~274 dias). */
export const EXPORT_DOWNLOAD_RETENTION_DAYS = 274;

export const EXPORT_DOWNLOAD_FORMATS = [
  "xlsx",
  "pdf",
  "csv",
  "png",
  "jpeg",
  "other",
] as const;

export type ExportDownloadFormat = (typeof EXPORT_DOWNLOAD_FORMATS)[number];

export type ExportDownloadSource = "client" | "api";

export type InsertExportDownloadLogInput = {
  userId: string | null;
  username: string;
  panelPath: string;
  panelLabel: string | null;
  exportKind: string;
  format: ExportDownloadFormat;
  fileName: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  filters?: Record<string, unknown> | null;
  rowCount?: number | null;
  byteSize?: number | null;
  source?: ExportDownloadSource;
  ip?: string | null;
  userAgent?: string | null;
};

const MAX_TEXT = 240;
const MAX_PATH = 200;
const MAX_KIND = 80;
const MAX_FILENAME = 260;
const MAX_FILTERS_JSON = 8_000;

const clip = (value: string, max: number) =>
  value.length <= max ? value : value.slice(0, max);

export const parseExportDownloadFormat = (
  value: unknown,
): ExportDownloadFormat => {
  if (typeof value !== "string") return "other";
  const normalized = value.trim().toLowerCase();
  if ((EXPORT_DOWNLOAD_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as ExportDownloadFormat;
  }
  if (normalized === "xls" || normalized === "excel") return "xlsx";
  if (normalized === "jpg") return "jpeg";
  return "other";
};

export const sanitizeExportFilters = (
  value: unknown,
): Record<string, unknown> | null => {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_FILTERS_JSON) {
      return { truncated: true, preview: json.slice(0, 500) };
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const insertExportDownloadLog = async (
  client: PoolClient,
  input: InsertExportDownloadLogInput,
): Promise<number> => {
  const username = clip(input.username.trim() || "unknown", MAX_TEXT);
  const panelPath = clip(input.panelPath.trim() || "/", MAX_PATH);
  const panelLabel = input.panelLabel?.trim()
    ? clip(input.panelLabel.trim(), MAX_TEXT)
    : null;
  const exportKind = clip(input.exportKind.trim() || "export", MAX_KIND);
  const fileName = clip(input.fileName.trim() || "archivo", MAX_FILENAME);
  const filters = sanitizeExportFilters(input.filters ?? null);
  const dateFrom = input.dateFrom?.trim() ? clip(input.dateFrom.trim(), 32) : null;
  const dateTo = input.dateTo?.trim() ? clip(input.dateTo.trim(), 32) : null;
  const rowCount =
    typeof input.rowCount === "number" && Number.isFinite(input.rowCount)
      ? Math.max(0, Math.trunc(input.rowCount))
      : null;
  const byteSize =
    typeof input.byteSize === "number" && Number.isFinite(input.byteSize)
      ? Math.max(0, Math.trunc(input.byteSize))
      : null;

  const result = await client.query<{ id: string }>(
    `
    INSERT INTO app_export_download_log (
      user_id,
      username,
      panel_path,
      panel_label,
      export_kind,
      format,
      file_name,
      date_from,
      date_to,
      filters,
      row_count,
      byte_size,
      source,
      ip,
      user_agent
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
      $11, $12, $13, $14, $15
    )
    RETURNING id
    `,
    [
      input.userId,
      username,
      panelPath,
      panelLabel,
      exportKind,
      input.format,
      fileName,
      dateFrom,
      dateTo,
      filters ? JSON.stringify(filters) : null,
      rowCount,
      byteSize,
      input.source ?? "client",
      input.ip ?? null,
      input.userAgent ? clip(input.userAgent, 500) : null,
    ],
  );
  return Number(result.rows[0]?.id ?? 0);
};
