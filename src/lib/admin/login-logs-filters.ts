import type { PortalProfileId } from "@/lib/auth/types";
import { PORTAL_PROFILE_IDS } from "@/lib/shared/portal-profiles";

export type LoginLogFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  userPattern: string | null;
  sede: string | null;
  profile: PortalProfileId | null;
};

export type LoginLogFilterSql = {
  conds: string[];
  params: unknown[];
  nextIndex: number;
};

const parseYmd = (value: string | null): string | null => {
  if (!value) return null;
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return t;
};

const escapeIlikePattern = (raw: string): string =>
  `%${raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

export const parseLoginLogFilters = (
  input: URLSearchParams | Record<string, unknown>,
): LoginLogFilters => {
  const get = (key: string): string | null => {
    if (input instanceof URLSearchParams) {
      const value = input.get(key);
      return value?.trim() ? value.trim() : null;
    }
    const raw = input[key];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  let dateFrom = parseYmd(get("from"));
  let dateTo = parseYmd(get("to"));
  if (dateFrom && dateTo && dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  const userRaw = (get("user") ?? "").slice(0, 128);
  const userPattern = userRaw.length > 0 ? escapeIlikePattern(userRaw) : null;

  const sedeRaw = (get("sede") ?? "").slice(0, 120);
  const sede = sedeRaw.length > 0 ? sedeRaw : null;

  const profileRaw = get("profile");
  const profile =
    profileRaw && PORTAL_PROFILE_IDS.includes(profileRaw as PortalProfileId)
      ? (profileRaw as PortalProfileId)
      : null;

  return { dateFrom, dateTo, userPattern, sede, profile };
};

export const buildLoginLogFilterSql = (
  filters: LoginLogFilters,
  startIndex = 1,
  tableAlias = "l",
  userAlias = "u",
): LoginLogFilterSql => {
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;

  if (filters.dateFrom) {
    conds.push(
      `(${tableAlias}.logged_at AT TIME ZONE 'America/Bogota')::date >= $${i}::date`,
    );
    params.push(filters.dateFrom);
    i += 1;
  }
  if (filters.dateTo) {
    conds.push(
      `(${tableAlias}.logged_at AT TIME ZONE 'America/Bogota')::date <= $${i}::date`,
    );
    params.push(filters.dateTo);
    i += 1;
  }
  if (filters.userPattern) {
    conds.push(`${userAlias}.username ILIKE $${i} ESCAPE '\\'`);
    params.push(filters.userPattern);
    i += 1;
  }
  if (filters.sede) {
    conds.push(`${userAlias}.sede = $${i}`);
    params.push(filters.sede);
    i += 1;
  }
  if (filters.profile) {
    conds.push(`COALESCE(${userAlias}.portal_profile, 'personalizado') = $${i}`);
    params.push(filters.profile);
    i += 1;
  }

  return { conds, params, nextIndex: i };
};

export const loginLogFiltersAreScoped = (filters: LoginLogFilters): boolean =>
  Boolean(
    filters.dateFrom ||
      filters.dateTo ||
      filters.userPattern ||
      filters.sede ||
      filters.profile,
  );

export const parseMonthKey = (raw: string | null): string | null => {
  const monthRaw = (raw ?? "").trim();
  const monthMatch = monthRaw.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) {
    return null;
  }
  return monthRaw;
};

export const monthRangeBounds = (monthKey: string) => {
  const [monthYear, monthNumber] = monthKey.split("-");
  const nextMonthDate = new Date(
    Date.UTC(Number(monthYear), Number(monthNumber), 1),
  );
  const nextMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
  }).format(nextMonthDate);
  return {
    from: `${monthKey}-01`,
    toExclusive: `${nextMonth}-01`,
  };
};

export const currentMonthKeyBogota = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
