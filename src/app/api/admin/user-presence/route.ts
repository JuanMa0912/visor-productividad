import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export type UserPresenceRow = {
  userId: string;
  lastActivityAt: string;
  lastPath: string | null;
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
    max: 240,
    keyPrefix: "admin-user-presence-get",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        {
          status: 429,
          headers: { "Retry-After": retryAfterSeconds.toString() },
        },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT DISTINCT ON (user_id)
             user_id::text AS "userId",
             last_activity_at AS "lastActivityAt",
             last_path AS "lastPath"
      FROM app_user_sessions
      WHERE revoked_at IS NULL
        AND expires_at > now()
      ORDER BY user_id, last_activity_at DESC
      `,
    );
    const presence: UserPresenceRow[] = (result.rows ?? []).map(
      (row: {
        userId: string;
        lastActivityAt: Date | string;
        lastPath: string | null;
      }) => ({
        userId: row.userId,
        lastActivityAt:
          row.lastActivityAt instanceof Date
            ? row.lastActivityAt.toISOString()
            : new Date(row.lastActivityAt).toISOString(),
        lastPath: row.lastPath ?? null,
      }),
    );
    return withSession(
      NextResponse.json({ presence, generatedAt: new Date().toISOString() }),
    );
  } catch (error) {
    console.error("[admin/user-presence] error", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo obtener la presencia." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
