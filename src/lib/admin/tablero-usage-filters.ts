import {
  parseLoginLogFilters,
  type LoginLogFilters,
  type LoginLogFilterSql,
} from "@/lib/admin/login-logs-filters";

export type { LoginLogFilters as TableroUsageFilters };

export { parseLoginLogFilters as parseTableroUsageFilters };

export const buildActivityFilterSql = (
  filters: LoginLogFilters,
  startIndex = 1,
  activityAlias = "a",
  userAlias = "u",
): LoginLogFilterSql => {
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;

  if (filters.dateFrom) {
    conds.push(
      `(${activityAlias}.observed_at AT TIME ZONE 'America/Bogota')::date >= $${i}::date`,
    );
    params.push(filters.dateFrom);
    i += 1;
  }
  if (filters.dateTo) {
    conds.push(
      `(${activityAlias}.observed_at AT TIME ZONE 'America/Bogota')::date <= $${i}::date`,
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
