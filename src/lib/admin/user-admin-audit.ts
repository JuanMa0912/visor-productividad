import type { PoolClient } from "pg";

export type UserAdminAuditAction =
  | "create"
  | "update"
  | "delete"
  | "password_reset";

export type UserAuditSnapshot = {
  username: string;
  role: string;
  portalProfile: string | null;
  sede: string | null;
  allowedSedes: string[] | null;
  allowedLines: string[] | null;
  allowedDashboards: string[] | null;
  allowedSubdashboards: string[] | null;
  specialRoles: string[] | null;
  isActive: boolean;
  /** Solo en after_state cuando se resetea password (nunca el hash). */
  passwordReset?: boolean;
};

export type LoginFailureReason =
  | "unknown_user"
  | "bad_password"
  | "inactive"
  | "rate_limited"
  | "other";

const sorted = (values: string[] | null | undefined): string[] | null => {
  if (!values || values.length === 0) return null;
  return [...values].map((v) => v.trim()).filter(Boolean).sort();
};

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const buildUserAuditSnapshot = (input: {
  username: string;
  role: string;
  portalProfile?: string | null;
  sede?: string | null;
  allowedSedes?: string[] | null;
  allowedLines?: string[] | null;
  allowedDashboards?: string[] | null;
  allowedSubdashboards?: string[] | null;
  specialRoles?: string[] | null;
  isActive?: boolean;
  passwordReset?: boolean;
}): UserAuditSnapshot => {
  const snap: UserAuditSnapshot = {
    username: input.username.trim(),
    role: input.role,
    portalProfile: input.portalProfile?.trim() || null,
    sede: input.sede?.trim() || null,
    allowedSedes: sorted(input.allowedSedes),
    allowedLines: sorted(input.allowedLines),
    allowedDashboards: sorted(input.allowedDashboards),
    allowedSubdashboards: sorted(input.allowedSubdashboards),
    specialRoles: sorted(input.specialRoles),
    isActive: input.isActive !== false,
  };
  if (input.passwordReset) snap.passwordReset = true;
  return snap;
};

export const diffUserAuditSnapshots = (
  before: UserAuditSnapshot | null,
  after: UserAuditSnapshot | null,
): string[] => {
  if (!before && after) return ["create"];
  if (before && !after) return ["delete"];
  if (!before || !after) return [];

  const fields: Array<keyof UserAuditSnapshot> = [
    "username",
    "role",
    "portalProfile",
    "sede",
    "allowedSedes",
    "allowedLines",
    "allowedDashboards",
    "allowedSubdashboards",
    "specialRoles",
    "isActive",
    "passwordReset",
  ];
  const changed: string[] = [];
  for (const field of fields) {
    if (field === "passwordReset") {
      if (after.passwordReset) changed.push("password");
      continue;
    }
    if (!sameJson(before[field], after[field])) changed.push(field);
  }
  return changed;
};

export type InsertUserAdminAuditInput = {
  actorUserId: string | null;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string;
  action: UserAdminAuditAction;
  before: UserAuditSnapshot | null;
  after: UserAuditSnapshot | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
};

export const insertUserAdminAudit = async (
  client: PoolClient,
  input: InsertUserAdminAuditInput,
): Promise<void> => {
  const changedFields =
    input.action === "password_reset"
      ? ["password"]
      : diffUserAuditSnapshots(input.before, input.after);

  if (
    input.action === "update" &&
    changedFields.length === 0 &&
    !input.after?.passwordReset
  ) {
    return;
  }

  const action =
    input.action === "update" &&
    changedFields.length === 1 &&
    changedFields[0] === "password"
      ? "password_reset"
      : input.action;

  try {
    await client.query(
      `
      INSERT INTO app_user_admin_audit (
        actor_user_id,
        actor_username,
        target_user_id,
        target_username,
        action,
        before_state,
        after_state,
        changed_fields,
        actor_ip,
        actor_user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
      `,
      [
        input.actorUserId,
        input.actorUsername,
        input.targetUserId,
        input.targetUsername,
        action,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        changedFields.length > 0 ? changedFields : [action],
        input.actorIp ?? null,
        input.actorUserAgent ?? null,
      ],
    );
  } catch (error) {
    // No tumbar la mutacion si falta la migracion: registrar y seguir.
    console.error("[user-admin-audit] insert failed:", error);
  }
};

export const insertLoginFailureAttempt = async (
  client: PoolClient,
  input: {
    username: string;
    userId?: string | null;
    reason: LoginFailureReason;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> => {
  try {
    await client.query(
      `
      INSERT INTO app_user_login_attempt_log (
        username,
        user_id,
        failure_reason,
        ip,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        input.username.trim().slice(0, 120),
        input.userId ?? null,
        input.reason,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
  } catch (error) {
    console.error("[login-attempt] insert failed:", error);
  }
};

/** Rutas sensibles para alertas de audit (primera visita / uso reciente). */
export const AUDIT_SENSITIVE_PATH_PREFIXES = [
  "/admin",
  "/margenes",
  "/informe-variacion",
  "/ExcelDian",
  "/excel-dian",
  "/rotacion",
  "/kardex",
  "/inventario-x-item",
] as const;

export const isAuditSensitivePath = (path: string): boolean => {
  const normalized = path.trim().toLowerCase();
  if (!normalized.startsWith("/")) return false;
  return AUDIT_SENSITIVE_PATH_PREFIXES.some(
    (prefix) =>
      normalized === prefix.toLowerCase() ||
      normalized.startsWith(`${prefix.toLowerCase()}/`),
  );
};
