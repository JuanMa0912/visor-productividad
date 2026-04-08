import { NextResponse } from "next/server";
import {
  applySessionCookies,
  createSession,
  getAuditNetworkId,
  getClientIp,
  verifyPassword,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { normalizeAllowedPortalSections } from "@/lib/portal-sections";

const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const FAILED_LOGIN_MAX_PER_IP = 10;
const FAILED_LOGIN_MAX_PER_USER = 5;

type FailedLoginEntry = {
  count: number;
  resetAt: number;
};

const failedLoginByIp = new Map<string, FailedLoginEntry>();
const failedLoginByUser = new Map<string, FailedLoginEntry>();

const getActiveFailedLoginEntry = (
  store: Map<string, FailedLoginEntry>,
  key: string,
  now: number,
) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.resetAt <= now) {
    store.delete(key);
    return null;
  }
  return entry;
};

const getFailedLoginResetAt = (ipKey: string, userKey: string, now: number) => {
  const ipEntry = getActiveFailedLoginEntry(failedLoginByIp, ipKey, now);
  if (ipEntry && ipEntry.count >= FAILED_LOGIN_MAX_PER_IP) {
    return ipEntry.resetAt;
  }

  const userEntry = getActiveFailedLoginEntry(failedLoginByUser, userKey, now);
  if (userEntry && userEntry.count >= FAILED_LOGIN_MAX_PER_USER) {
    return userEntry.resetAt;
  }

  return null;
};

const registerFailedLogin = (
  store: Map<string, FailedLoginEntry>,
  key: string,
  now: number,
) => {
  const entry = getActiveFailedLoginEntry(store, key, now);
  if (!entry) {
    store.set(key, { count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
};

const registerFailedLoginAttempt = (ipKey: string, userKey: string, now: number) => {
  registerFailedLogin(failedLoginByIp, ipKey, now);
  registerFailedLogin(failedLoginByUser, userKey, now);
};

const clearFailedLoginAttempts = (ipKey: string, userKey: string) => {
  failedLoginByIp.delete(ipKey);
  failedLoginByUser.delete(userKey);
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Usuario y contraseña son obligatorios." },
        { status: 400 },
      );
    }

    const now = Date.now();
    const clientIp = getClientIp(req);
    const auditNetworkId = getAuditNetworkId(clientIp);
    const rateLimitKey = auditNetworkId ?? clientIp ?? "unknown";
    const ipForDb = auditNetworkId ?? clientIp ?? null;
    const userKey = username.toLowerCase();
    const blockedUntil = getFailedLoginResetAt(rateLimitKey, userKey, now);
    if (blockedUntil) {
      const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil - now) / 1000));
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }

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
          to_jsonb(u)->'special_roles' AS "specialRoles",
          u.is_active,
          u.password_hash
        FROM app_users u
        WHERE u.username = $1
        LIMIT 1
        `,
        [username],
      );

      if (!result.rows || result.rows.length === 0) {
        registerFailedLoginAttempt(rateLimitKey, userKey, now);
        return NextResponse.json(
          { error: "Credenciales inválidas." },
          { status: 401 },
        );
      }

      const user = result.rows[0] as {
        id: string;
        username: string;
        role: "admin" | "user";
        sede: string | null;
        allowedSedes: string[] | null;
        allowedLines: string[] | null;
        allowedDashboards: string[] | null;
        specialRoles: string[] | null;
        is_active: boolean;
        password_hash: string;
      };
      const allowedDashboards = normalizeAllowedPortalSections(user.allowedDashboards);

      if (!user.is_active) {
        registerFailedLoginAttempt(rateLimitKey, userKey, now);
        return NextResponse.json(
          { error: "Cuenta desactivada." },
          { status: 403 },
        );
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        registerFailedLoginAttempt(rateLimitKey, userKey, now);
        return NextResponse.json(
          { error: "Credenciales inválidas." },
          { status: 401 },
        );
      }

      clearFailedLoginAttempts(rateLimitKey, userKey);
      const userAgent = req.headers.get("user-agent");
      const session = await createSession(user.id, ipForDb, userAgent);

      await client.query(
        `
        INSERT INTO app_user_login_logs (user_id, ip, user_agent)
        VALUES ($1, $2, $3)
        `,
        [user.id, ipForDb, userAgent],
      );

      await client.query(
        `
        UPDATE app_users
        SET last_login_at = now(), last_login_ip = $2, updated_at = now()
        WHERE id = $1
        `,
        [user.id, ipForDb],
      );

      const response = NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          sede: user.sede,
          allowedSedes: user.allowedSedes,
          allowedLines: user.allowedLines,
          allowedDashboards,
          specialRoles: user.specialRoles,
        },
      });
      return applySessionCookies(response, session);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : "No se pudo iniciar sesión.",
      },
      { status: 500 },
    );
  }
}
