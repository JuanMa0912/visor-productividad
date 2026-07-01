import crypto from "crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getDbPool } from "@/lib/db";
import bcrypt from "bcryptjs";
import {
  normalizeAllowedPortalSections,
  normalizeAllowedPortalSubsections,
} from "@/lib/shared/portal-sections";
import { resolveValidPortalProfile } from "@/lib/shared/portal-profiles";
import {
  getPasswordDaysUntilExpiry,
  isPasswordExpired,
  validatePasswordLength,
  validatePasswordPolicy,
  type PasswordChangeReason,
} from "@/lib/auth/password-policy";

export {
  PASSWORD_MIN_CHARS,
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_AGE_DAYS,
  PASSWORD_POLICY_HINT,
  validatePasswordLength,
  validatePasswordPolicy,
  evaluatePasswordChangeRequirement,
  isKnownWeakPassword,
  isPasswordExpired,
  getPasswordDaysUntilExpiry,
} from "@/lib/auth/password-policy";
export type { PasswordChangeReason } from "@/lib/auth/password-policy";

// La definicion del tipo vive en ./types.ts para que sea importable desde
// codigo cliente sin arrastrar dependencias de Node. Aqui lo importamos para
// usarlo internamente y lo re-exportamos para mantener la API publica intacta.
import type { AuthUser, AuthRole, AuthUserPublic } from "./types";
export type { AuthUser, AuthRole, AuthUserPublic };

const SESSION_COOKIE = "vp_session";
const CSRF_COOKIE = "vp_csrf";
const SESSION_IDLE_MINUTES = 60;
/** Namespace for `pg_advisory_xact_lock` so login for one user serializes without colliding with other app locks. */
const SESSION_LOGIN_ADVISORY_KEY1 = 849_201;

const getSessionExpiry = () =>
  new Date(Date.now() + SESSION_IDLE_MINUTES * 60 * 1000);

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createCsrfToken = () => crypto.randomBytes(32).toString("base64url");

const shouldUseSecureCookies = () => {
  const envValue = process.env.SESSION_COOKIE_SECURE;
  if (envValue === "true") return true;
  if (envValue === "false") return false;
  return process.env.NODE_ENV === "production";
};

// bcrypt trunca silenciosamente todo lo que excede 72 bytes UTF-8: dos passwords
// distintas con los mismos primeros 72 bytes producirian el mismo hash. Validamos
// upfront para evitar esa colision invisible.

export const hashPassword = async (password: string) => {
  const validationError = validatePasswordPolicy(password);
  if (validationError) {
    throw new Error(validationError);
  }
  return bcrypt.hash(password, 12);
};

export const verifyPassword = async (password: string, hash: string) =>
  bcrypt.compare(password, hash);

// Hash precalculado (lazy + memoizado) que usamos como fallback para hacer
// `bcrypt.compare` cuando el usuario no existe, asi la latencia de respuesta
// es la misma para "usuario inexistente" que para "password incorrecta" y un
// atacante no puede inferir que usernames son validos midiendo timing.
let dummyPasswordHashCache: Promise<string> | null = null;
export const getDummyPasswordHash = () => {
  if (!dummyPasswordHashCache) {
    dummyPasswordHashCache = bcrypt.hash(
      "anti-timing-attack-placeholder-not-a-real-password",
      12,
    );
  }
  return dummyPasswordHashCache;
};

// Prime al cargar el modulo: arranca el hash en background para que el primer
// login fallido no espere los ~250ms iniciales.
void getDummyPasswordHash();

export const getClientIp = (req: Request) => {
  const trustProxy = process.env.TRUST_PROXY === "true";
  const forwarded = trustProxy ? req.headers.get("x-forwarded-for") : null;
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    null
  );
};

const normalizeClientIp = (ip: string | null) => {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    return trimmed.slice(7);
  }
  return trimmed;
};

const maskIpv4Subnet = (ip: string) => {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
};

const maskIpv6Subnet = (ip: string) => {
  const normalized = ip.toLowerCase();
  const segments = normalized.split(":").filter(Boolean);
  if (segments.length === 0) return null;
  return `${segments.slice(0, 4).join(":")}::/64`;
};

export const getAuditNetworkId = (ip: string | null) => {
  const normalized = normalizeClientIp(ip);
  if (!normalized) return null;

  const auditSecret = process.env.AUDIT_IP_HMAC_SECRET?.trim();
  if (auditSecret) {
    const digest = crypto
      .createHmac("sha256", auditSecret)
      .update(normalized)
      .digest("hex");
    return `hmac:${digest.slice(0, 24)}`;
  }

  const version = isIP(normalized);
  if (version === 4) {
    return maskIpv4Subnet(normalized);
  }
  if (version === 6) {
    return maskIpv6Subnet(normalized);
  }
  return null;
};

export const createSession = async (
  userId: string,
  ip: string | null,
  userAgent: string | null,
  dbClient?: PoolClient,
  options?: {
    passwordChangeRequired?: boolean;
    passwordChangeReason?: PasswordChangeReason | null;
  },
) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = getSessionExpiry();
  const passwordChangeRequired = options?.passwordChangeRequired === true;
  const passwordChangeReason = passwordChangeRequired
    ? (options?.passwordChangeReason ?? "weak")
    : null;

  const ownClient = !dbClient;
  const client = dbClient ?? (await (await getDbPool()).connect());
  try {
    await client.query(
      `
      INSERT INTO app_user_sessions (
        user_id,
        token_hash,
        expires_at,
        ip,
        user_agent,
        password_change_required,
        password_change_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        userId,
        tokenHash,
        expiresAt.toISOString(),
        ip,
        userAgent,
        passwordChangeRequired,
        passwordChangeReason,
      ],
    );
  } finally {
    if (ownClient) {
      client.release();
    }
  }

  return { token, expiresAt, passwordChangeRequired };
};

/**
 * Revokes any existing sessions for the user, then inserts a new one, in a single transaction
 * with a per-user advisory lock so concurrent logins cannot leave two active rows.
 */
export const createSessionReplacingOthers = async (
  userId: string,
  ip: string | null,
  userAgent: string | null,
  dbClient: PoolClient,
  options?: {
    passwordChangeRequired?: boolean;
    passwordChangeReason?: PasswordChangeReason | null;
  },
) => {
  await dbClient.query("BEGIN");
  try {
    await dbClient.query(
      `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`,
      [SESSION_LOGIN_ADVISORY_KEY1, userId],
    );
    await revokeAllSessionsForUser(userId, dbClient);
    const session = await createSession(userId, ip, userAgent, dbClient, options);
    await dbClient.query("COMMIT");
    return session;
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  }
};

export const revokeSessionByToken = async (token: string) => {
  const tokenHash = hashToken(token);
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      UPDATE app_user_sessions
      SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [tokenHash],
    );
  } finally {
    client.release();
  }
};

export const revokeAllSessionsForUser = async (
  userId: string,
  dbClient?: PoolClient,
) => {
  const ownClient = !dbClient;
  const client = dbClient ?? (await (await getDbPool()).connect());
  try {
    await client.query(
      `
      UPDATE app_user_sessions
      SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [userId],
    );
  } finally {
    if (ownClient) {
      client.release();
    }
  }
};

const refreshSession = async (tokenHash: string, expiresAt: Date) => {
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      UPDATE app_user_sessions
      SET expires_at = $2,
          last_activity_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [tokenHash, expiresAt.toISOString()],
    );
  } finally {
    client.release();
  }
};

const MAX_LAST_PATH_LENGTH = 256;

/**
 * Marca el `last_path` (tablero actual) de la sesion vigente. Se invoca desde
 * el endpoint /api/auth/heartbeat cuando el cliente reporta su pathname.
 */
export const updateSessionLastPath = async (pathValue: string) => {
  const token = await getSessionToken();
  if (!token) return;
  const trimmed = String(pathValue ?? "").trim();
  if (!trimmed || !trimmed.startsWith("/")) return;
  const safePath = trimmed.slice(0, MAX_LAST_PATH_LENGTH);
  const tokenHash = hashToken(token);
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      UPDATE app_user_sessions
      SET last_path = $2
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [tokenHash, safePath],
    );
  } finally {
    client.release();
  }
};

/**
 * Inserta una fila en `app_user_activity_log` con el path actual del usuario.
 * Se invoca desde el heartbeat. Para evitar duplicados (si el cliente envia
 * varios heartbeats por minuto), descarta la insercion si ya hay una fila
 * con el mismo `(session_id, path)` en los ultimos 45 segundos.
 */
export const recordUserActivity = async (pathValue: string) => {
  const token = await getSessionToken();
  if (!token) return;
  const trimmed = String(pathValue ?? "").trim();
  if (!trimmed || !trimmed.startsWith("/")) return;
  const safePath = trimmed.slice(0, MAX_LAST_PATH_LENGTH);
  const tokenHash = hashToken(token);
  const client = await (await getDbPool()).connect();
  try {
    await client.query(
      `
      WITH current_session AS (
        SELECT id, user_id
        FROM app_user_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL
        LIMIT 1
      )
      INSERT INTO app_user_activity_log (user_id, session_id, path)
      SELECT cs.user_id, cs.id, $2
      FROM current_session cs
      WHERE NOT EXISTS (
        SELECT 1
        FROM app_user_activity_log a
        WHERE a.session_id = cs.id
          AND a.path = $2
          AND a.observed_at > now() - interval '45 seconds'
      )
      `,
      [tokenHash, safePath],
    );
  } finally {
    client.release();
  }
};

export const getSessionCookieOptions = (expiresAt?: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: shouldUseSecureCookies(),
  path: "/",
  ...(expiresAt ? { expires: expiresAt } : {}),
});

export const getCsrfCookieOptions = () => ({
  httpOnly: false,
  sameSite: "lax" as const,
  secure: shouldUseSecureCookies(),
  path: "/",
});

export const getExpiredSessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: shouldUseSecureCookies(),
  path: "/",
  expires: new Date(0),
});

export const getExpiredCsrfCookieOptions = () => ({
  httpOnly: false,
  sameSite: "lax" as const,
  secure: shouldUseSecureCookies(),
  path: "/",
  expires: new Date(0),
});

export const getCsrfToken = async () => {
  const cookieStore = await cookies();
  return cookieStore.get(CSRF_COOKIE)?.value ?? null;
};

export const ensureCsrfCookie = async (response: NextResponse) => {
  const existing = await getCsrfToken();
  if (existing) return existing;
  const token = createCsrfToken();
  response.cookies.set(CSRF_COOKIE, token, getCsrfCookieOptions());
  return token;
};

export const verifyCsrf = async (req: Request) => {
  const csrfToken = await getCsrfToken();
  const headerToken = req.headers.get("x-csrf-token");
  if (!csrfToken || !headerToken) return false;
  return csrfToken === headerToken;
};

export const applySessionCookies = async (
  response: NextResponse,
  session: { token: string; expiresAt: Date },
) => {
  response.cookies.set(
    "vp_session",
    session.token,
    getSessionCookieOptions(session.expiresAt),
  );
  await ensureCsrfCookie(response);
  return response;
};

export type UserSession = {
  user: AuthUser;
  token: string;
  expiresAt: Date;
  passwordChangeRequired: boolean;
};

export type RequireAuthSessionOptions = {
  /** Permite la sesión mientras el usuario debe cambiar contraseña (p. ej. /api/auth/me). */
  allowPasswordChangePending?: boolean;
};

const resolvePasswordChangeState = (row: {
  password_change_required: boolean;
  password_change_reason: string | null;
  password_changed_at: string | null;
}): {
  required: boolean;
  reason: PasswordChangeReason | null;
  daysUntilExpiry: number | null;
} => {
  const expired = isPasswordExpired(row.password_changed_at);
  const required = row.password_change_required || expired;
  if (!required) {
    return {
      required: false,
      reason: null,
      daysUntilExpiry: getPasswordDaysUntilExpiry(row.password_changed_at),
    };
  }

  let reason: PasswordChangeReason = "weak";
  if (expired) {
    reason = "expired";
  } else if (row.password_change_reason === "unset") {
    reason = "unset";
  } else if (row.password_change_reason === "expired") {
    reason = "expired";
  } else if (row.password_change_reason === "weak") {
    reason = "weak";
  } else if (!row.password_changed_at) {
    reason = "unset";
  }

  return {
    required: true,
    reason,
    daysUntilExpiry: getPasswordDaysUntilExpiry(row.password_changed_at),
  };
};

const attachPasswordPolicyToUser = (
  user: AuthUser,
  state: ReturnType<typeof resolvePasswordChangeState>,
): AuthUser => ({
  ...user,
  passwordChangeRequired: state.required,
  passwordChangeReason: state.reason,
  passwordDaysUntilExpiry: state.daysUntilExpiry,
});

export const getSessionToken = async () => {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
};

export const getUserSession = async (): Promise<UserSession | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  const tokenHash = hashToken(token);

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        u.id,
        u.username,
        u.role,
        to_jsonb(u)->>'sede' AS sede,
        to_jsonb(u)->'allowed_sedes' AS "allowedSedes",
        to_jsonb(u)->'allowed_lines' AS "allowedLines",
        to_jsonb(u)->'allowed_dashboards' AS "allowedDashboards",
        to_jsonb(u)->'allowed_subdashboards' AS "allowedSubdashboards",
        to_jsonb(u)->'special_roles' AS "specialRoles",
        to_jsonb(u)->>'portal_profile' AS "portalProfile",
        u.is_active,
        u.last_login_at,
        u.last_login_ip,
        u.password_changed_at,
        s.expires_at,
        s.password_change_required,
        s.password_change_reason
      FROM app_user_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active = true
      `,
      [tokenHash],
    );

    if (!result.rows || result.rows.length === 0) return null;
    const row = result.rows[0] as AuthUser & {
      password_changed_at: string | null;
      password_change_required: boolean;
      password_change_reason: string | null;
      portalProfile?: string | null;
    };
    const passwordState = resolvePasswordChangeState({
      password_change_required: row.password_change_required,
      password_change_reason: row.password_change_reason,
      password_changed_at: row.password_changed_at,
    });
    const profileResult = resolveValidPortalProfile(row.portalProfile);
    const user = attachPasswordPolicyToUser(
      {
        id: row.id,
        username: row.username,
        role: row.role,
        sede: row.sede,
        allowedSedes: row.allowedSedes,
        allowedLines: row.allowedLines,
        allowedDashboards: normalizeAllowedPortalSections(row.allowedDashboards),
        allowedSubdashboards: normalizeAllowedPortalSubsections(
          row.allowedSubdashboards,
        ),
        specialRoles: row.specialRoles,
        portalProfile: profileResult.ok ? profileResult.value : null,
        is_active: row.is_active,
        last_login_at: row.last_login_at,
        last_login_ip: row.last_login_ip,
      },
      passwordState,
    );
    const expiresAt = getSessionExpiry();
    await refreshSession(tokenHash, expiresAt);
    return {
      user,
      token,
      expiresAt,
      passwordChangeRequired: passwordState.required,
    };
  } finally {
    client.release();
  }
};

export const getUserFromSession = async (): Promise<AuthUser | null> => {
  const session = await getUserSession();
  return session?.user ?? null;
};

export const requireAuthUser = async () => {
  const user = await getUserFromSession();
  if (!user) {
    return null;
  }
  return user;
};

export const requireAuthSession = async (
  options?: RequireAuthSessionOptions,
) => {
  const session = await getUserSession();
  if (!session) {
    return null;
  }
  if (
    session.passwordChangeRequired &&
    !options?.allowPasswordChangePending
  ) {
    return null;
  }
  return session;
};

export const requireAdminUser = async () => {
  const user = await getUserFromSession();
  if (!user || user.role !== "admin") {
    return null;
  }
  return user;
};

export const requireAdminSession = async () => {
  const session = await getUserSession();
  if (!session || session.user.role !== "admin") {
    return null;
  }
  return session;
};
