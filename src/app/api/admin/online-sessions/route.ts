import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const PRESENCE_ACTIVE_MS = 10 * 60_000;

export type OnlineSessionRow = {
  userId: string;
  username: string;
  sede: string | null;
  portalProfile: string | null;
  lastActivityAt: string;
  lastPath: string | null;
  sessionStartedAt: string;
  ip: string | null;
  userAgent: string | null;
  isActive: boolean;
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 120,
    keyPrefix: "admin-online-sessions-get",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query<{
      userId: string;
      username: string;
      sede: string | null;
      portalProfile: string | null;
      lastActivityAt: Date;
      lastPath: string | null;
      sessionStartedAt: Date;
      ip: string | null;
      userAgent: string | null;
      isActive: boolean;
    }>(
      `
      SELECT DISTINCT ON (s.user_id)
        s.user_id::text AS "userId",
        u.username,
        u.sede,
        u.portal_profile AS "portalProfile",
        s.last_activity_at AS "lastActivityAt",
        s.last_path AS "lastPath",
        s.created_at AS "sessionStartedAt",
        host(s.ip::inet) AS ip,
        s.user_agent AS "userAgent",
        u.is_active AS "isActive"
      FROM app_user_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > now()
      ORDER BY s.user_id, s.last_activity_at DESC
      `,
    );

    const now = Date.now();
    const sessions: OnlineSessionRow[] = (result.rows ?? []).map((row) => ({
      userId: row.userId,
      username: row.username,
      sede: row.sede,
      portalProfile: row.portalProfile,
      lastActivityAt:
        row.lastActivityAt instanceof Date
          ? row.lastActivityAt.toISOString()
          : new Date(row.lastActivityAt).toISOString(),
      lastPath: row.lastPath,
      sessionStartedAt:
        row.sessionStartedAt instanceof Date
          ? row.sessionStartedAt.toISOString()
          : new Date(row.sessionStartedAt).toISOString(),
      ip: row.ip,
      userAgent: row.userAgent,
      isActive: row.isActive,
    }));

    sessions.sort((a, b) => {
      const aMs = new Date(a.lastActivityAt).getTime();
      const bMs = new Date(b.lastActivityAt).getTime();
      const aLive = now - aMs <= PRESENCE_ACTIVE_MS;
      const bLive = now - bMs <= PRESENCE_ACTIVE_MS;
      if (aLive !== bLive) return aLive ? -1 : 1;
      return bMs - aMs;
    });

    const activeNow = sessions.filter(
      (row) => now - new Date(row.lastActivityAt).getTime() <= PRESENCE_ACTIVE_MS,
    ).length;

    return withSession(
      NextResponse.json({
        sessions,
        activeNow,
        openSessions: sessions.length,
        generatedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("[admin/online-sessions] error", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo obtener las sesiones en línea." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
