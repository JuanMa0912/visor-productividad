import { formatUserAgentLabel } from "@/lib/parse-user-agent";

export type LoginLogRow = {
  id: number;
  logged_at: string;
  ip: string | null;
  user_agent: string | null;
  user_id: string;
  username: string;
};

export type LoginLogDateShortcutId = "today" | "yesterday" | "last7" | "last30";

export type LoginLogDateRange = {
  from: string;
  to: string;
};

const BOGOTA_TZ = "America/Bogota";
const EXPORT_PAGE_SIZE = 300;
const EXPORT_MAX_ROWS = 5_000;

export const formatYmdInBogota = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const parseYmdUtc = (ymd: string): Date =>
  new Date(`${ymd}T12:00:00.000Z`);

const addDaysYmd = (ymd: string, days: number): string => {
  const dt = parseYmdUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatYmdInBogota(dt);
};

export const getLoginLogDateRangeForShortcut = (
  shortcut: LoginLogDateShortcutId,
  now: Date = new Date(),
): LoginLogDateRange => {
  const today = formatYmdInBogota(now);
  switch (shortcut) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDaysYmd(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "last7":
      return { from: addDaysYmd(today, -6), to: today };
    case "last30":
      return { from: addDaysYmd(today, -29), to: today };
    default:
      return { from: today, to: today };
  }
};

export const LOGIN_LOG_DATE_SHORTCUTS: Array<{
  id: LoginLogDateShortcutId;
  label: string;
}> = [
  { id: "today", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "last7", label: "Últimos 7 días" },
  { id: "last30", label: "Últimos 30 días" },
];

const csvCell = (value: string): string => {
  const normalized = value.replace(/\r?\n/g, " ").trim();
  if (/[",\n;]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

export const formatLoginLogDateTimeForCsv = (isoDate: string): string => {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: BOGOTA_TZ,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(isoDate));
  } catch {
    return isoDate;
  }
};

export const buildLoginLogsCsv = (rows: LoginLogRow[]): string => {
  const header = [
    "usuario",
    "fecha_hora",
    "ip",
    "navegador_dispositivo",
    "user_agent",
  ];
  const lines = rows.map((row) =>
    [
      csvCell(row.username),
      csvCell(formatLoginLogDateTimeForCsv(row.logged_at)),
      csvCell(row.ip ?? ""),
      csvCell(formatUserAgentLabel(row.user_agent)),
      csvCell(row.user_agent ?? ""),
    ].join(","),
  );
  return `\uFEFF${[header.join(","), ...lines].join("\r\n")}`;
};

export const downloadLoginLogsCsv = (
  rows: LoginLogRow[],
  filenameStem: string,
): void => {
  const csv = buildLoginLogsCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenameStem}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export type FetchLoginLogsParams = {
  sort: "logged_at" | "username";
  order: "asc" | "desc";
  from?: string;
  to?: string;
  user?: string;
  sede?: string;
  profile?: string;
};

export const fetchAllLoginLogs = async (
  params: FetchLoginLogsParams,
): Promise<{ rows: LoginLogRow[]; total: number; truncated: boolean }> => {
  const collected: LoginLogRow[] = [];
  let offset = 0;
  let total = 0;

  while (collected.length < EXPORT_MAX_ROWS) {
    const search = new URLSearchParams({
      limit: String(EXPORT_PAGE_SIZE),
      offset: String(offset),
      sort: params.sort,
      order: params.order,
    });
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    if (params.user) search.set("user", params.user);
    if (params.sede) search.set("sede", params.sede);
    if (params.profile) search.set("profile", params.profile);

    const response = await fetch(`/api/admin/login-logs?${search.toString()}`);
    if (!response.ok) {
      throw new Error("No se pudo exportar el registro de accesos.");
    }

    const payload = (await response.json()) as {
      logs?: LoginLogRow[];
      total?: number;
    };
    const batch = payload.logs ?? [];
    total = typeof payload.total === "number" ? payload.total : batch.length;

    if (batch.length === 0) break;
    collected.push(...batch);
    offset += batch.length;
    if (collected.length >= total) break;
  }

  const truncated = total > collected.length;
  return { rows: collected, total, truncated };
};

export const buildLoginLogsExportFilename = (params: {
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
          : "todos";
  const userPart = params.user
    ? `_usuario_${params.user.replace(/[^\w.-]+/g, "_").slice(0, 40)}`
    : "";
  const sedePart = params.sede
    ? `_sede_${params.sede.replace(/[^\w.-]+/g, "_").slice(0, 40)}`
    : "";
  const profilePart = params.profile ? `_perfil_${params.profile}` : "";
  return `accesos_${range}${userPart}${sedePart}${profilePart}_${stamp}`;
};
