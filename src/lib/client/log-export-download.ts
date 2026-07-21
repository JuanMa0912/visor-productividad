import type { ExportDownloadFormat } from "@/lib/admin/export-download-log";

export type ClientExportDownloadLogInput = {
  /** Si se omite, usa window.location.pathname. */
  panelPath?: string;
  panelLabel?: string;
  exportKind: string;
  format: ExportDownloadFormat | string;
  fileName: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  filters?: Record<string, unknown> | null;
  rowCount?: number | null;
  byteSize?: number | null;
};

/**
 * Registra una descarga/export en el servidor (fire-and-forget).
 * Nunca lanza: un fallo de bitacora no debe bloquear la descarga.
 */
export const logExportDownload = (
  input: ClientExportDownloadLogInput,
): void => {
  if (typeof window === "undefined") return;
  try {
    const panelPath =
      input.panelPath?.trim() ||
      window.location.pathname ||
      "/";
    const body = {
      panelPath,
      panelLabel: input.panelLabel ?? null,
      exportKind: input.exportKind,
      format: input.format,
      fileName: input.fileName,
      dateFrom: input.dateFrom ?? null,
      dateTo: input.dateTo ?? null,
      filters: input.filters ?? null,
      rowCount: input.rowCount ?? null,
      byteSize: input.byteSize ?? null,
    };
    void fetch("/api/exports/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
};
