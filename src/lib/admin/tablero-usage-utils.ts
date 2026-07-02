import { getPathLabel } from "@/lib/shared/path-labels";
import { formatYmdInBogota } from "@/lib/admin/login-logs-utils";

export type TableroUsagePathRow = {
  path: string;
  uniqueUsers: number;
  observations: number;
  activeMinutes: number;
  sharePercent: number;
};

const csvCell = (value: string): string => {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  if (/[",\n;]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

export const buildTableroUsageCsv = (rows: TableroUsagePathRow[]): string => {
  const header = [
    "tablero",
    "ruta",
    "usuarios_unicos",
    "pings",
    "minutos_activos",
    "porcentaje_tiempo",
  ];
  const lines = rows.map((row) =>
    [
      csvCell(getPathLabel(row.path)),
      csvCell(row.path),
      String(row.uniqueUsers),
      String(row.observations),
      String(row.activeMinutes),
      String(row.sharePercent),
    ].join(","),
  );
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}`;
};

export const downloadTableroUsageCsv = (
  rows: TableroUsagePathRow[],
  filenameStem: string,
): void => {
  const csv = buildTableroUsageCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenameStem}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const buildTableroUsageExportFilename = (params: {
  from?: string;
  to?: string;
  user?: string;
  sede?: string;
  profile?: string;
}): string => {
  const stamp = formatYmdInBogota(new Date());
  const range =
    params.from && params.to
      ? `${params.from}_${params.to}`
      : params.from
        ? `desde_${params.from}`
        : params.to
          ? `hasta_${params.to}`
          : "ultimos_30_dias";
  const userPart = params.user
    ? `_usuario_${params.user.replace(/[^\w.-]+/g, "_").slice(0, 40)}`
    : "";
  const sedePart = params.sede
    ? `_sede_${params.sede.replace(/[^\w.-]+/g, "_").slice(0, 40)}`
    : "";
  const profilePart = params.profile ? `_perfil_${params.profile}` : "";
  return `uso_tableros_${range}${userPart}${sedePart}${profilePart}_${stamp}`;
};

export const formatUsageMinutes = (minutes: number): string => {
  if (!minutes || minutes < 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours} h`;
  return `${hours} h ${remainder} min`;
};
