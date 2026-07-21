import type { PoolClient } from "pg";
import {
  insertExportDownloadLog,
  parseExportDownloadFormat,
  type ExportDownloadFormat,
} from "@/lib/admin/export-download-log";
import { getPathLabel } from "@/lib/shared/path-labels";

/** Log de export desde un API route (best-effort; no lanza). */
export const tryLogApiExportDownload = async (
  client: PoolClient,
  input: {
    userId: string | null;
    username: string;
    panelPath: string;
    exportKind: string;
    format: ExportDownloadFormat | string;
    fileName: string;
    dateFrom?: string | null;
    dateTo?: string | null;
    filters?: Record<string, unknown> | null;
    rowCount?: number | null;
    byteSize?: number | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> => {
  try {
    await insertExportDownloadLog(client, {
      userId: input.userId,
      username: input.username,
      panelPath: input.panelPath,
      panelLabel: getPathLabel(input.panelPath),
      exportKind: input.exportKind,
      format: parseExportDownloadFormat(input.format),
      fileName: input.fileName,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      filters: input.filters,
      rowCount: input.rowCount,
      byteSize: input.byteSize,
      source: "api",
      ip: input.ip,
      userAgent: input.userAgent,
    });
  } catch (error) {
    console.warn("[exports/log-api] no se pudo registrar", error);
  }
};
